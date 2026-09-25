import { Router } from 'express';
import { authenticate, currentUser } from '../../common/middleware/authenticate.js';
import { prisma } from '../../lib/prisma.js';
import { actionableStepFilter, contractVisibilityFilter } from '../contracts/contract-access.js';
import { contractListSelect } from '../contracts/contract.repository.js';

/** Numbers and short lists for the home page, all scoped to what the user may see. */
export const dashboardRouter = Router();

const EXPIRY_WINDOW_DAYS = 30;

dashboardRouter.get('/', authenticate, async (req, res) => {
  const user = currentUser(req);
  const visible = contractVisibilityFilter(user);
  const soon = new Date(Date.now() + EXPIRY_WINDOW_DAYS * 86_400_000);
  const expiring = { AND: [visible, { status: 'ACTIVE' as const, endDate: { lte: soon } }] };

  const [byStatus, myDrafts, pendingMyApproval, awaitingMySignature, expiringCount, expiringSoon, recent] = await Promise.all([
    prisma.contract.groupBy({ by: ['status'], where: visible, _count: { _all: true } }),
    prisma.contract.count({ where: { ownerId: user.id, status: { in: ['DRAFT', 'REJECTED'] } } }),
    prisma.approvalStep.count({ where: actionableStepFilter(user) }),
    prisma.contractSigner.count({ where: { userId: user.id, status: 'PENDING', contract: { status: 'APPROVED' } } }),
    prisma.contract.count({ where: expiring }),
    prisma.contract.findMany({
      where: expiring,
      select: contractListSelect,
      orderBy: { endDate: 'asc' },
      take: 5,
    }),
    prisma.contract.findMany({ where: visible, select: contractListSelect, orderBy: { updatedAt: 'desc' }, take: 6 }),
  ]);

  res.json({
    counts: {
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      myDrafts,
      pendingMyApproval,
      awaitingMySignature,
      expiringSoon: expiringCount,
    },
    expiringSoon,
    recent,
    expiryWindowDays: EXPIRY_WINDOW_DAYS,
  });
});
