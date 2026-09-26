import { Router, type Response } from 'express';
import { authenticate, currentUser } from '../../common/middleware/authenticate.js';
import { liveBus, type LiveEvent } from '../../lib/live.js';
import { prisma } from '../../lib/prisma.js';
import { contractVisibilityFilter } from '../contracts/contract-access.js';

/**
 * GET /api/events: a Server-Sent Events stream of what changed for this user.
 *
 *   event: notification   data: {"title": "..."}      a notification for this user
 *   event: contract       data: {"contractId": "..."} a contract this user can see changed
 *
 * The client reads it with fetch (so the bearer token stays in a header, never
 * in a URL). A stream ends after STREAM_MS so a revoked or expired session
 * can't keep listening; the client reconnects with a fresh token.
 */
export const liveRouter = Router();

const HEARTBEAT_MS = 25_000;
const STREAM_MS = 10 * 60_000;

/** Open streams, closed on shutdown so the server can exit. */
const open = new Set<Response>();

export function closeLiveStreams() {
  for (const res of open) res.end();
  open.clear();
}

liveRouter.get('/', authenticate, (req, res) => {
  const user = currentUser(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: don't buffer the stream
  });
  res.write('retry: 5000\n\n');
  open.add(res);

  const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const visible = contractVisibilityFilter(user);

  const onEvent = (e: LiveEvent) => {
    if (e.kind === 'notification') {
      if (e.userIds.includes(user.id)) send('notification', { title: e.title });
      return;
    }
    if (user.role === 'ADMIN') {
      send('contract', { contractId: e.contractId });
      return;
    }
    prisma.contract
      .count({ where: { AND: [{ id: e.contractId }, visible] } })
      .then((n) => n && !res.writableEnded && send('contract', { contractId: e.contractId }))
      .catch(() => undefined);
  };
  liveBus.on('event', onEvent);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const limit = setTimeout(() => res.end(), STREAM_MS);
  res.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(limit);
    liveBus.off('event', onEvent);
    open.delete(res);
  });
});
