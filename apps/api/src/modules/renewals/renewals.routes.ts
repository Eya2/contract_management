import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { prisma } from '../../lib/prisma.js';
import { contractVisibilityFilter } from '../contracts/contract-access.js';
import { contractListSelect } from '../contracts/contract.repository.js';
import { IdParams } from '../contracts/contract.schemas.js';
import { renewalService } from './renewal.service.js';
import { renewalRisk } from './renewal-risk.js';

/** Mounted under /api/contracts. */
export const contractRenewalRouter = Router();

contractRenewalRouter.post('/:id/renew', authenticate, requirePermission(Permission.CONTRACT_CREATE), async (req, res) => {
  res.status(201).json(await renewalService.renew(currentUser(req), IdParams.parse(req.params).id));
});

/** Mounted under /api/renewals. */
export const renewalsRouter = Router();

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));
const CalendarQuery = z
  .object({ from: IsoDate, to: IsoDate })
  .refine((q) => q.to >= q.from && q.to.getTime() - q.from.getTime() <= 100 * 86_400_000, { message: 'The range must be at most 100 days' });

/**
 * Contracts whose term ends between `from` and `to` (inclusive), with how much
 * attention each needs. Terminated contracts and contracts not yet signed are
 * left out: their end date isn't a renewal question.
 */
renewalsRouter.get('/calendar', authenticate, async (req, res) => {
  const { from, to } = CalendarQuery.parse(req.query);
  const rows = await prisma.contract.findMany({
    where: {
      AND: [contractVisibilityFilter(currentUser(req)), { status: { in: ['SIGNED', 'ACTIVE', 'EXPIRED', 'RENEWED'] }, endDate: { gte: from, lte: to } }],
    },
    select: { ...contractListSelect, renewedBy: { select: { id: true, referenceNumber: true, status: true } } },
    orderBy: [{ endDate: 'asc' }, { referenceNumber: 'asc' }],
    take: 500,
  });
  res.json(rows.map((c) => ({ ...c, risk: renewalRisk(c) })));
});
