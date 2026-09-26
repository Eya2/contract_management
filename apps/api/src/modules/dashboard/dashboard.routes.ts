import { Router } from 'express';
import { authenticate, currentUser } from '../../common/middleware/authenticate.js';
import { prisma } from '../../lib/prisma.js';
import { actionableStepFilter, contractVisibilityFilter } from '../contracts/contract-access.js';
import { contractListSelect } from '../contracts/contract.repository.js';
import { renewalRisk } from '../renewals/renewal-risk.js';
import { approvalTimes, currencyOrder, monthRange, renewalValueByMonth, sumByMonth, UPCOMING_RISKS } from './insights.js';

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

const PAST_MONTHS = 12;
const UPCOMING_MONTHS = 6;

/**
 * Chart data, scoped like everything else to the contracts the user can see:
 *  - value signed per month over the last year,
 *  - value ending per month over the next six, split by what it needs,
 *  - average time from submission to final approval, per department.
 */
dashboardRouter.get('/insights', authenticate, async (req, res) => {
  const visible = contractVisibilityFilter(currentUser(req));
  const now = new Date();
  const past = monthRange(now, -(PAST_MONTHS - 1), PAST_MONTHS);
  const upcoming = monthRange(now, 0, UPCOMING_MONTHS);
  const pastStart = new Date(`${past[0]}-01T00:00:00Z`);
  const upcomingEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + UPCOMING_MONTHS, 1));

  const [currencies, signed, ending, approved] = await Promise.all([
    prisma.contract.findMany({ where: visible, select: { currency: true } }),
    prisma.contractStatusChange.findMany({
      // Fully signed: APPROVED → SIGNED, or straight to ACTIVE when it starts at once.
      where: { fromStatus: 'APPROVED', toStatus: { in: ['SIGNED', 'ACTIVE'] }, createdAt: { gte: pastStart }, contract: visible },
      select: { createdAt: true, contract: { select: { value: true, currency: true } } },
    }),
    prisma.contract.findMany({
      where: { AND: [visible, { status: { in: ['SIGNED', 'ACTIVE'] }, endDate: { gte: new Date(`${upcoming[0]}-01T00:00:00Z`), lt: upcomingEnd } }] },
      select: { endDate: true, value: true, currency: true, status: true, autoRenew: true, renewedBy: { select: { status: true } } },
    }),
    prisma.approvalRequest.findMany({
      where: { status: 'APPROVED', completedAt: { gte: pastStart }, contract: visible },
      select: { submittedAt: true, completedAt: true, contract: { select: { department: { select: { name: true } } } } },
    }),
  ]);

  res.json({
    currencies: currencyOrder(currencies),
    signedValue: {
      months: past,
      series: sumByMonth(
        signed.filter((s) => s.contract.value !== null).map((s) => ({ at: s.createdAt, value: Number(s.contract.value), currency: s.contract.currency })),
        past,
      ),
    },
    upcomingRenewals: {
      months: upcoming,
      risks: UPCOMING_RISKS,
      series: renewalValueByMonth(
        ending.filter((c) => c.value !== null).map((c) => ({ at: c.endDate!, value: Number(c.value), currency: c.currency, risk: renewalRisk(c) })),
        upcoming,
      ),
    },
    approvalTime: approvalTimes(approved.map((r) => ({ department: r.contract.department.name, submittedAt: r.submittedAt, completedAt: r.completedAt! }))),
  });
});
