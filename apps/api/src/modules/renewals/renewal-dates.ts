/**
 * Date arithmetic for renewals, on UTC calendar days (contract dates are
 * stored as `date` columns, i.e. UTC midnight).
 */

const DAY = 86_400_000;

/** Reminder points, most urgent last. */
export const REMINDER_DAYS = [30, 7, 1] as const;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days from `from` to `to` (both taken as UTC days). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY);
}

/**
 * Which reminder applies with `daysLeft` days to go: the most urgent threshold
 * reached (5 days left → the 7-day reminder, 0 → the 1-day one). If the
 * scheduler was down for a while, only the current reminder is sent, not every
 * one that was missed. Null when more than 30 days remain or the date passed.
 */
export function reminderThreshold(daysLeft: number): (typeof REMINDER_DAYS)[number] | null {
  if (daysLeft < 0) return null;
  const reached = REMINDER_DAYS.filter((t) => daysLeft <= t);
  return reached.length ? reached[reached.length - 1]! : null;
}

function addMonths(d: Date, months: number): Date {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay)));
}

/**
 * The next term: it starts the day after the current end date and lasts as
 * long as the current term. Whole-month terms stay whole months (1 Jan–31 Dec
 * renews as 1 Jan–31 Dec, not 365 days that drift in leap years). Without a
 * start date, the term is taken to be one year.
 */
export function nextTerm(c: { startDate: Date | null; endDate: Date | null }): { startDate: Date; endDate: Date } {
  if (!c.endDate) throw new Error('A contract without an end date has no next term');
  const end = startOfUtcDay(c.endDate);
  const startDate = new Date(end.getTime() + DAY);
  if (!c.startDate) return { startDate, endDate: new Date(addMonths(startDate, 12).getTime() - DAY) };

  const start = startOfUtcDay(c.startDate);
  // Whole months? (start on day N, end the day before day N some months later).
  // The month span is the calendar difference, or one more when the end falls
  // on a later day of its month (1 Jan → 31 Dec).
  const diff = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  for (const months of [diff, diff + 1]) {
    if (months > 0 && addMonths(start, months).getTime() - DAY === end.getTime()) {
      return { startDate, endDate: new Date(addMonths(startDate, months).getTime() - DAY) };
    }
  }
  return { startDate, endDate: new Date(startDate.getTime() + (end.getTime() - start.getTime())) };
}
