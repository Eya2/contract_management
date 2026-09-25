import { describe, expect, it } from 'vitest';
import { daysBetween, nextTerm, reminderThreshold } from './renewal-dates.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (t: { startDate: Date; endDate: Date }) => [t.startDate.toISOString().slice(0, 10), t.endDate.toISOString().slice(0, 10)];

describe('reminderThreshold', () => {
  it('picks the most urgent reminder reached', () => {
    expect([45, 31, 30, 8, 7, 5, 2, 1, 0].map(reminderThreshold)).toEqual([null, null, 30, 30, 7, 7, 7, 1, 1]);
  });

  it('sends nothing once the end date has passed', () => {
    expect(reminderThreshold(-1)).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts calendar days, ignoring the time of day', () => {
    expect(daysBetween(new Date('2026-09-25T23:30:00Z'), d('2026-09-26'))).toBe(1);
    expect(daysBetween(d('2026-12-31'), d('2027-01-01'))).toBe(1);
  });
});

describe('nextTerm', () => {
  it('renews a calendar year as the next calendar year', () => {
    expect(iso(nextTerm({ startDate: d('2027-01-01'), endDate: d('2027-12-31') }))).toEqual(['2028-01-01', '2028-12-31']);
  });

  it('keeps whole-month terms whole across month lengths and leap years', () => {
    expect(iso(nextTerm({ startDate: d('2027-12-01'), endDate: d('2028-02-29') }))).toEqual(['2028-03-01', '2028-05-31']);
    expect(iso(nextTerm({ startDate: d('2026-11-01'), endDate: d('2027-10-31') }))).toEqual(['2027-11-01', '2028-10-31']);
    // Mid-month terms, across a leap year: still exactly one year.
    expect(iso(nextTerm({ startDate: d('2026-06-15'), endDate: d('2027-06-14') }))).toEqual(['2027-06-15', '2028-06-14']);
    expect(iso(nextTerm({ startDate: d('2026-01-31'), endDate: d('2026-02-27') }))).toEqual(['2026-02-28', '2026-03-27']);
  });

  it('repeats an irregular term length in days', () => {
    expect(iso(nextTerm({ startDate: d('2026-01-10'), endDate: d('2026-03-01') }))).toEqual(['2026-03-02', '2026-04-21']);
  });

  it('assumes a one-year term without a start date', () => {
    expect(iso(nextTerm({ startDate: null, endDate: d('2026-06-30') }))).toEqual(['2026-07-01', '2027-06-30']);
  });
});
