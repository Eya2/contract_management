import { describe, expect, it } from 'vitest';
import { renewalRisk } from './renewal-risk.js';

describe('renewalRisk', () => {
  const active = { status: 'ACTIVE' as const, autoRenew: false, renewedBy: null };

  it('asks for a decision when nothing continues the contract', () => {
    expect(renewalRisk(active)).toBe('decision');
  });

  it('is safe when the contract renews automatically', () => {
    expect(renewalRisk({ ...active, autoRenew: true })).toBe('auto');
  });

  it('tracks a renewal that is not signed yet', () => {
    expect(renewalRisk({ ...active, renewedBy: { status: 'UNDER_REVIEW' } })).toBe('in-progress');
  });

  it('is covered once the renewal is signed or already renewed', () => {
    expect(renewalRisk({ ...active, renewedBy: { status: 'SIGNED' } })).toBe('covered');
    expect(renewalRisk({ ...active, status: 'RENEWED' })).toBe('covered');
  });

  it('is overdue once expired without a renewal in force', () => {
    expect(renewalRisk({ ...active, status: 'EXPIRED' })).toBe('overdue');
    expect(renewalRisk({ ...active, status: 'EXPIRED', renewedBy: { status: 'DRAFT' } })).toBe('overdue');
    expect(renewalRisk({ ...active, status: 'EXPIRED', renewedBy: { status: 'ACTIVE' } })).toBe('covered');
  });
});
