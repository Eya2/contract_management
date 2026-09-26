import { describe, expect, it } from 'vitest';
import { approvalTimes, currencyOrder, monthRange, renewalValueByMonth, sumByMonth } from './insights.js';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('dashboard insights', () => {
  it('builds month ranges across year boundaries', () => {
    expect(monthRange(d('2026-02-15'), -3, 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange(d('2026-11-30'), 0, 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('orders currencies by use', () => {
    expect(currencyOrder([{ currency: 'USD' }, { currency: 'EUR' }, { currency: 'EUR' }, { currency: 'GBP' }])).toEqual(['EUR', 'GBP', 'USD']);
  });

  it('sums values per currency and month, never across currencies', () => {
    const months = ['2026-08', '2026-09'];
    const rows = [
      { at: d('2026-08-03'), value: 100, currency: 'EUR' },
      { at: d('2026-08-20'), value: 50, currency: 'EUR' },
      { at: d('2026-09-01'), value: 70, currency: 'TND' },
      { at: d('2026-07-31'), value: 999, currency: 'EUR' },
    ];
    expect(sumByMonth(rows, months)).toEqual({ EUR: [150, 0], TND: [0, 70] });
  });

  it('splits upcoming renewal value by risk and leaves covered terms out', () => {
    const months = ['2026-10', '2026-11'];
    const out = renewalValueByMonth(
      [
        { at: d('2026-10-01'), value: 10, currency: 'EUR', risk: 'decision' },
        { at: d('2026-10-20'), value: 5, currency: 'EUR', risk: 'auto' },
        { at: d('2026-11-02'), value: 7, currency: 'EUR', risk: 'covered' },
      ],
      months,
    );
    expect(out).toEqual({ EUR: { decision: [10, 0], 'in-progress': [0, 0], auto: [5, 0] } });
  });

  it('averages approval time per department, slowest first', () => {
    const rows = [
      { department: 'Sales', submittedAt: d('2026-09-01'), completedAt: d('2026-09-02') },
      { department: 'Sales', submittedAt: d('2026-09-01'), completedAt: d('2026-09-04') },
      { department: 'Legal', submittedAt: d('2026-09-01'), completedAt: d('2026-09-01') },
    ];
    expect(approvalTimes(rows)).toEqual([
      { department: 'Sales', avgHours: 48, count: 2 },
      { department: 'Legal', avgHours: 0, count: 1 },
    ]);
  });
});
