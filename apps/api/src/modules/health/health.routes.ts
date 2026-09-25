import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

export const healthRouter = Router();

/** Liveness + DB connectivity check (used by docker/k8s probes). */
healthRouter.get('/', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', time: new Date().toISOString() });
});
