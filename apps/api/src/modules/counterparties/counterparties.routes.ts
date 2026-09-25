import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, requirePermission } from '../../common/middleware/authenticate.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Counterparties are shared reference data (the same supplier may contract with
 * several departments), so any signed-in user can search them and anyone who can
 * draft contracts can add one.
 */
export const counterpartiesRouter = Router();
counterpartiesRouter.use(authenticate);

const ListQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CreateBody = z.object({
  name: z.string().trim().min(2).max(200),
  kind: z.enum(['COMPANY', 'INDIVIDUAL']).default('COMPANY'),
  email: z.email().max(254).optional(),
  contactName: z.string().trim().max(200).optional(),
  registrationNumber: z.string().trim().max(64).optional(),
});

counterpartiesRouter.get('/', async (req, res) => {
  const { q, limit } = ListQuery.parse(req.query);
  res.json(
    await prisma.counterparty.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
      take: limit,
    }),
  );
});

counterpartiesRouter.post('/', requirePermission(Permission.CONTRACT_CREATE), async (req, res) => {
  res.status(201).json(await prisma.counterparty.create({ data: CreateBody.parse(req.body) }));
});
