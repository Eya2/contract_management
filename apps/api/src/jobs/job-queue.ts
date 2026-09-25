import { hostname } from 'node:os';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { sendEmail } from '../lib/mailer.js';
import { prisma } from '../lib/prisma.js';

/**
 * Worker for the Postgres job queue (the `jobs` table, filled by the
 * transactional outbox in notification.service.ts).
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`: any number of workers can poll at
 * once and each job goes to exactly one of them, with no Redis. A job that
 * fails is retried with exponential backoff until `maxAttempts`, then marked
 * FAILED with its last error. A worker that dies mid-job leaves it RUNNING;
 * after LOCK_TIMEOUT it's handed back to the queue.
 */

const WORKER_ID = `${hostname()}:${process.pid}`;
const LOCK_TIMEOUT_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 30_000;

const EmailPayload = z.object({
  to: z.email(),
  subject: z.string(),
  text: z.string(),
  /** Front-end route, turned into an absolute URL here. */
  link: z.string().nullable().optional(),
});

type Handler = (payload: unknown) => Promise<void>;

const handlers: Record<string, Handler> = {
  'email.send': async (payload) => {
    const email = EmailPayload.parse(payload);
    const text = email.link ? `${email.text}\n\nOpen in Contract Hub: ${env.APP_URL}${email.link}` : email.text;
    await sendEmail({ to: email.to, subject: email.subject, text });
  },
};

interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export const jobQueue = {
  /** Claims and runs up to `batchSize` due jobs. Returns how many succeeded / failed. */
  async runOnce(batchSize = 20): Promise<{ completed: number; failed: number }> {
    // Timestamps are stored as UTC in `timestamp without time zone` columns (as
    // Prisma writes them), so raw SQL must compare against UTC too: a bare
    // now() would be off by the database session's time-zone offset.
    await prisma.$executeRaw`
      UPDATE jobs SET status = 'PENDING', locked_at = NULL, locked_by = NULL
      WHERE status = 'RUNNING'
        AND locked_at < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${LOCK_TIMEOUT_MS / 1000})`;

    const jobs = await prisma.$queryRaw<ClaimedJob[]>`
      UPDATE jobs
      SET status = 'RUNNING', locked_at = now() AT TIME ZONE 'UTC', locked_by = ${WORKER_ID}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'PENDING' AND run_at <= now() AT TIME ZONE 'UTC'
        ORDER BY run_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts, max_attempts`;

    let completed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const handler = handlers[job.type];
        if (!handler) throw new Error(`No handler for job type "${job.type}"`);
        await handler(job.payload);
        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
        });
        completed++;
      } catch (err) {
        failed++;
        const giveUp = job.attempts >= job.max_attempts;
        const backoff = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: giveUp ? 'FAILED' : 'PENDING',
            runAt: new Date(Date.now() + backoff),
            lockedAt: null,
            lockedBy: null,
            lastError: String(err instanceof Error ? err.message : err).slice(0, 2000),
          },
        });
        logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, giveUp, err }, 'Job failed');
      }
    }
    return { completed, failed };
  },
};
