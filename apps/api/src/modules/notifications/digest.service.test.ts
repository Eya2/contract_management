import { describe, expect, it } from 'vitest';
import { digestEmail, isEmpty, type DigestSummary } from './digest.service.js';

const empty: DigestSummary = { firstName: 'Leila', pendingApprovals: 0, awaitingSignature: 0, toRevise: 0, endingSoon: [], notifications: [] };

describe('daily summary', () => {
  it('sends nothing when there is nothing to report', () => {
    expect(isEmpty(empty)).toBe(true);
    expect(isEmpty({ ...empty, notifications: ['x'] })).toBe(false);
  });

  it('lists the work to do and counts it in the subject', () => {
    const { subject, text } = digestEmail({
      ...empty,
      pendingApprovals: 2,
      awaitingSignature: 1,
      endingSoon: [{ referenceNumber: 'CTR-2026-00005', title: 'Globex support', endDate: new Date('2026-10-01T00:00:00Z') }],
    });
    expect(subject).toBe('Your Contract Hub summary: 3 items to do');
    expect(text).toContain('Hello Leila,');
    expect(text).toContain('- 2 approvals waiting for you');
    expect(text).toContain('- 1 contract to sign');
    expect(text).toContain('- CTR-2026-00005 Globex support, ends 2026-10-01');
    expect(text).not.toContain('to revise');
  });
});
