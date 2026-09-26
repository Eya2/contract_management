import type { RenewalRisk } from '../renewals/renewal-risk.js';

/**
 * Pure aggregation for the dashboard charts. Amounts stay per currency: there
 * are no exchange rates in the system, so the charts show one currency at a
 * time rather than adding euros to dinars.
 */

/** 'YYYY-MM' of a date, in UTC. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** `count` consecutive month keys starting `offset` months from `now`'s month. */
export function monthRange(now: Date, offset: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + i, 1))));
}

/** Currencies ordered by how many contracts use them, then by name. */
export function currencyOrder(rows: { currency: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/** Sum of values per currency per month; months outside `months` are ignored. */
export function sumByMonth(rows: { at: Date; value: number; currency: string }[], months: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const r of rows) {
    const i = months.indexOf(monthKey(r.at));
    if (i < 0) continue;
    (out[r.currency] ??= months.map(() => 0))[i]! += r.value;
  }
  return out;
}

export type UpcomingRisk = Exclude<RenewalRisk, 'covered' | 'overdue'>;
export const UPCOMING_RISKS: UpcomingRisk[] = ['decision', 'in-progress', 'auto'];

/** Value ending per month and currency, split by what it needs. Covered terms are left out. */
export function renewalValueByMonth(
  rows: { at: Date; value: number; currency: string; risk: RenewalRisk }[],
  months: string[],
): Record<string, Record<UpcomingRisk, number[]>> {
  const out: Record<string, Record<UpcomingRisk, number[]>> = {};
  for (const r of rows) {
    if (r.risk === 'covered' || r.risk === 'overdue') continue;
    const i = months.indexOf(monthKey(r.at));
    if (i < 0) continue;
    const series = (out[r.currency] ??= { decision: months.map(() => 0), 'in-progress': months.map(() => 0), auto: months.map(() => 0) });
    series[r.risk][i]! += r.value;
  }
  return out;
}

/** Average hours from submission to final approval, per department, slowest first. */
export function approvalTimes(rows: { department: string; submittedAt: Date; completedAt: Date }[]): { department: string; avgHours: number; count: number }[] {
  const acc = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const a = acc.get(r.department) ?? { total: 0, count: 0 };
    a.total += (r.completedAt.getTime() - r.submittedAt.getTime()) / 3_600_000;
    a.count++;
    acc.set(r.department, a);
  }
  return [...acc]
    .map(([department, a]) => ({ department, avgHours: Math.round((a.total / a.count) * 10) / 10, count: a.count }))
    .sort((a, b) => b.avgHours - a.avgHours || a.department.localeCompare(b.department));
}
