import { EventEmitter } from 'node:events';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { prisma, type DbClient } from './prisma.js';

/**
 * Live updates, fanned out through Postgres LISTEN/NOTIFY.
 *
 * `publish` runs `pg_notify` on the caller's transaction, so an event is only
 * delivered if the change it describes commits, and it is delivered to every
 * API instance, not just the one that made the change. Each instance keeps one
 * listening connection and re-emits events locally for its SSE streams.
 *
 * Events carry ids only; clients re-read through the normal, access-checked
 * API. The one exception is a notification, which goes only to its recipients.
 */
export type LiveEvent =
  | { kind: 'notification'; userIds: string[]; title: string }
  | { kind: 'contract'; contractId: string };

const CHANNEL = 'cms_live';
/** pg_notify payloads are limited to 8000 bytes. */
const MAX_PAYLOAD = 7900;

export const liveBus = new EventEmitter<{ event: [LiveEvent] }>();
liveBus.setMaxListeners(0);

export async function publish(db: DbClient, event: LiveEvent): Promise<void> {
  let payload = JSON.stringify(event);
  if (payload.length > MAX_PAYLOAD && event.kind === 'notification') {
    payload = JSON.stringify({ ...event, title: event.title.slice(0, 200) });
  }
  if (payload.length > MAX_PAYLOAD) return; // too many recipients: they'll catch up on the next poll
  await db.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
}

/** Publishes outside any transaction, for changes already committed. */
export function publishNow(event: LiveEvent): void {
  publish(prisma, event).catch((err: unknown) => logger.warn({ err }, 'Live event not published'));
}

let client: pg.Client | null = null;
let stopped = false;
let retry: NodeJS.Timeout | undefined;

/** Starts listening (idempotent). Reconnects with backoff if the connection drops. */
export function startLiveListener(attempt = 0): () => Promise<void> {
  if (client || stopped) return stopLiveListener;
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  client = c;
  const reconnect = (err?: unknown) => {
    if (client !== c) return;
    client = null;
    c.end().catch(() => undefined);
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    logger.warn({ err, delay }, 'Live listener disconnected, retrying');
    retry = setTimeout(() => startLiveListener(attempt + 1), delay);
  };
  c.on('error', reconnect);
  c.on('end', () => reconnect());
  c.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      liveBus.emit('event', JSON.parse(msg.payload) as LiveEvent);
    } catch (err) {
      logger.warn({ err }, 'Malformed live event');
    }
  });
  c.connect()
    .then(() => c.query(`LISTEN ${CHANNEL}`))
    .then(() => {
      attempt = 0;
      logger.debug('Live listener ready');
    })
    .catch(reconnect);
  return stopLiveListener;
}

export async function stopLiveListener(): Promise<void> {
  stopped = true;
  clearTimeout(retry);
  const c = client;
  client = null;
  await c?.end().catch(() => undefined);
}
