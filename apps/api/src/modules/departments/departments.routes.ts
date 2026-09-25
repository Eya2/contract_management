import { Router } from 'express';
import { authenticate } from '../../common/middleware/authenticate.js';
import { prisma } from '../../lib/prisma.js';

export const departmentsRouter = Router();

/** Reference data for filters and forms: readable by any signed-in user. */
departmentsRouter.get('/', authenticate, async (_req, res) => {
  res.json(
    await prisma.department.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
  );
});
