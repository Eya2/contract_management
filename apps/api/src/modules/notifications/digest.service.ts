import { env } from '../../config/env.js';
import { dateParam, isMsg, localeOf, msg, render, type Locale, type Param } from '../../lib/i18n.js';
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

export function digestEmail(s: DigestSummary, locale: Locale = 'en'): { subject: string; text: string } {
  const tr = (t: string, p?: Record<string, Param>) => render(msg(t, p), locale);
  const lines: string[] = [tr('Hello {name},', { name: s.firstName }), '', tr('Here is your Contract Hub summary for today.'), ''];
  const todo: string[] = [];
  const count = (n: number, one: string, many: string) => `- ${tr(n === 1 ? one : many, { n })}`;
  if (s.pendingApprovals) todo.push(count(s.pendingApprovals, '{n} approval waiting for you', '{n} approvals waiting for you'));
  if (s.awaitingSignature) todo.push(count(s.awaitingSignature, '{n} contract to sign', '{n} contracts to sign'));
  if (s.toRevise) todo.push(count(s.toRevise, '{n} rejected contract to revise', '{n} rejected contracts to revise'));
  if (todo.length) lines.push(tr('To do'), ...todo, '');
  if (s.endingSoon.length) {
    lines.push(tr('Ending in the next {n} days', { n: ENDING_WINDOW_DAYS }));
    for (const c of s.endingSoon) lines.push(`- ${tr('{ref} {title}, ends {date}', { ref: c.referenceNumber, title: c.title, date: dateParam(c.endDate) })}`);
    lines.push('');
  }
  if (s.notifications.length) {
    lines.push(tr('In the last 24 hours'));
    for (const n of s.notifications) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push(tr('You receive this summary because it is on in your account settings.'));
  const total = s.pendingApprovals + s.awaitingSignature + s.toRevise;
  const subject = total
    ? tr(total === 1 ? 'Your Contract Hub summary: {n} item to do' : 'Your Contract Hub summary: {n} items to do', { n: total })
    : tr('Your Contract Hub summary');
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
      select: { id: true, email: true, firstName: true, locale: true, role: true, departmentId: true, headOf: { select: { id: true } } },
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
        const { subject, text } = digestEmail(summary, localeOf(u));
        await prisma.job.createMany({
          data: [{ type: 'email.send', payload: { to: u.email, subject, text, link: '/', locale: localeOf(u) }, dedupeKey: `digest:${u.id}:${today.toISOString().slice(0, 10)}` }],
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
  u: { id: string; email: string; firstName: string; locale: string; role: Parameters<typeof actionableStepFilter>[0]['role']; departmentId: string; headOf: { id: string } | null },
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
      select: { title: true, titleMsg: true },
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
    notifications: [...new Set(notifications.map((n) => (isMsg(n.titleMsg) ? render(n.titleMsg, localeOf(u)) : n.title)))],
  };
}
