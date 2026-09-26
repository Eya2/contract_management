import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { actionableStepFilter } from '../contracts/contract-access.js';
import { startOfUtcDay } from '../renewals/renewal-dates.js';

const DAY = 86_400_000;
const ENDING_WINDOW_DAYS = 7;

export interface DigestSummary {
  firstName: string;
  pendingApprovals: number;
  awaitingSignature: number;
  toRevise: number;
  endingSoon: { referenceNumber: string; title: string; endDate: Date }[];
  notifications: string[];
}

/** Nothing to report: no email is sent that day. */
export function isEmpty(s: DigestSummary): boolean {
  return !s.pendingApprovals && !s.awaitingSignature && !s.toRevise && !s.endingSoon.length && !s.notifications.length;
}

export function digestEmail(s: DigestSummary): { subject: string; text: string } {
  const lines: string[] = [`Hello ${s.firstName},`, '', 'Here is your Contract Hub summary for today.', ''];
  const todo: string[] = [];
  if (s.pendingApprovals) todo.push(`- ${s.pendingApprovals} approval${s.pendingApprovals > 1 ? 's' : ''} waiting for you`);
  if (s.awaitingSignature) todo.push(`- ${s.awaitingSignature} contract${s.awaitingSignature > 1 ? 's' : ''} to sign`);
  if (s.toRevise) todo.push(`- ${s.toRevise} rejected contract${s.toRevise > 1 ? 's' : ''} to revise`);
  if (todo.length) lines.push('To do', ...todo, '');
  if (s.endingSoon.length) {
    lines.push(`Ending in the next ${ENDING_WINDOW_DAYS} days`);
    for (const c of s.endingSoon) lines.push(`- ${c.referenceNumber} ${c.title}, ends ${c.endDate.toISOString().slice(0, 10)}`);
    lines.push('');
  }
  if (s.notifications.length) {
    lines.push('In the last 24 hours');
    for (const n of s.notifications) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push('You receive this summary because it is on in your account settings.');
  const count = s.pendingApprovals + s.awaitingSignature + s.toRevise;
  const subject = count ? `Your Contract Hub summary: ${count} item${count > 1 ? 's' : ''} to do` : 'Your Contract Hub summary';
  return { subject, text: lines.join('\n') };
}

/**
 * The daily summary email. From DIGEST_HOUR_UTC on, each user who asked for it
 * gets one email a day. A user is claimed by setting `lastDigestOn` in a
 * conditional update first, so several API instances never send it twice.
 */
export const digestService = {
  async runOnce(now = new Date()): Promise<{ sent: number; skipped: number }> {
    const result = { sent: 0, skipped: 0 };
    if (now.getUTCHours() < env.DIGEST_HOUR_UTC) return result;
    const today = startOfUtcDay(now);
    const due = await prisma.user.findMany({
      where: { isActive: true, dailyDigest: true, OR: [{ lastDigestOn: null }, { lastDigestOn: { lt: today } }] },
      select: { id: true, email: true, firstName: true, role: true, departmentId: true, headOf: { select: { id: true } } },
      take: 200,
    });

    for (const u of due) {
      try {
        const { count } = await prisma.user.updateMany({
          where: { id: u.id, OR: [{ lastDigestOn: null }, { lastDigestOn: { lt: today } }] },
          data: { lastDigestOn: today },
        });
        if (!count) continue; // another instance took it

        const summary = await summarize(u, now);
        if (isEmpty(summary)) {
          result.skipped++;
          continue;
        }
        const { subject, text } = digestEmail(summary);
        await prisma.job.createMany({
          data: [{ type: 'email.send', payload: { to: u.email, subject, text, link: '/' }, dedupeKey: `digest:${u.id}:${today.toISOString().slice(0, 10)}` }],
          skipDuplicates: true,
        });
        result.sent++;
      } catch (err) {
        logger.error({ err, userId: u.id }, 'Daily summary failed');
      }
    }
    return result;
  },
};

async function summarize(
  u: { id: string; email: string; firstName: string; role: Parameters<typeof actionableStepFilter>[0]['role']; departmentId: string; headOf: { id: string } | null },
  now: Date,
): Promise<DigestSummary> {
  const today = startOfUtcDay(now);
  const [pendingApprovals, awaitingSignature, toRevise, endingSoon, notifications] = await Promise.all([
    prisma.approvalStep.count({ where: actionableStepFilter({ id: u.id, email: u.email, role: u.role, departmentId: u.departmentId }) }),
    prisma.contractSigner.count({ where: { userId: u.id, status: 'PENDING', contract: { status: 'APPROVED' } } }),
    prisma.contract.count({ where: { ownerId: u.id, status: 'REJECTED' } }),
    // Their own contracts, and their department's if they head it.
    prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: today, lte: new Date(today.getTime() + ENDING_WINDOW_DAYS * DAY) },
        OR: [{ ownerId: u.id }, ...(u.headOf ? [{ departmentId: u.departmentId }] : [])],
      },
      select: { referenceNumber: true, title: true, endDate: true },
      orderBy: { endDate: 'asc' },
      take: 10,
    }),
    prisma.notification.findMany({
      where: { userId: u.id, createdAt: { gte: new Date(now.getTime() - DAY) } },
      select: { title: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);
  return {
    firstName: u.firstName,
    pendingApprovals,
    awaitingSignature,
    toRevise,
    endingSoon: endingSoon.map((c) => ({ ...c, endDate: c.endDate! })),
    notifications: [...new Set(notifications.map((n) => n.title))],
  };
}
