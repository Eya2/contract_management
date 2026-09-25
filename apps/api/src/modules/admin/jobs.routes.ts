import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, requirePermission } from '../../common/middleware/authenticate.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Email delivery status for admins: what's queued, sent or failing, and why.
 * Failed emails can be sent again once the mail server problem is fixed.
 */
export const jobsRouter = Router();
jobsRouter.use(authenticate, requirePermission(Permission.WORKFLOW_MANAGE));

const ListQuery = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

jobsRouter.get('/', async (req, res) => {
  const { status, limit } = ListQuery.parse(req.query);
  const [items, counts] = await Promise.all([
    prisma.job.findMany({
      where: { type: 'email.send', ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, status: true, attempts: true, maxAttempts: true, lastError: true, runAt: true, createdAt: true, completedAt: true, payload: true },
    }),
    prisma.job.groupBy({ by: ['status'], where: { type: 'email.send' }, _count: { _all: true } }),
  ]);
  res.json({
    // The mail server in use, so a misconfiguration is visible (never the password).
    smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, authenticated: !!env.SMTP_USER },
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    // Only what an admin needs to recognise the email: recipient and subject. Signing links stay hidden.
    items: items.map(({ payload, ...j }) => {
      const p = payload as { to?: string; subject?: string };
      return { ...j, to: p.to ?? null, subject: p.subject ?? null };
    }),
  });
});

/** Puts failed emails (and those waiting on a retry) back in the queue, to be sent right away. */
jobsRouter.post('/retry', async (_req, res) => {
  const { count } = await prisma.job.updateMany({
    where: { type: 'email.send', status: { in: ['FAILED', 'PENDING'] } },
    data: { status: 'PENDING', attempts: 0, runAt: new Date(), lastError: null },
  });
  res.json({ retried: count });
});
