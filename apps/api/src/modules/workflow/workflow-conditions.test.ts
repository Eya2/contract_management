import { describe, expect, it } from 'vitest';
import {
  ConditionSchema,
  describeCondition,
  evaluateCondition,
  factsFor,
  type Condition,
  type ConditionFacts,
} from './workflow-conditions.js';

const facts = (overrides: Partial<ConditionFacts> = {}): ConditionFacts => ({
  value: 8000,
  currency: 'USD',
  type: 'VENDOR',
  durationDays: 365,
  autoRenew: false,
  ...overrides,
});

const overTenK: Condition = { field: 'value', op: 'gt', value: 10000 };

describe('evaluateCondition', () => {
  it('explains a skipped step in plain words', () => {
    expect(evaluateCondition(overTenK, facts())).toEqual({
      applies: false,
      reason: 'value 8,000.00 USD is not > 10,000',
    });
  });

  it('applies the step when the condition holds', () => {
    expect(evaluateCondition(overTenK, facts({ value: 45000 })).applies).toBe(true);
  });

  it('requires the step when the fact is missing (fail-safe)', () => {
    const result = evaluateCondition(overTenK, facts({ value: null }));
    expect(result.applies).toBe(true);
    expect(result.reason).toBe('value is not set, so the step is required');
  });

  it('stays fail-safe under negation: NOT(unknown) is still unknown', () => {
    expect(evaluateCondition({ not: overTenK }, facts({ value: null })).applies).toBe(true);
  });

  it('uses three-valued logic for all/any', () => {
    const vendor: Condition = { field: 'type', op: 'eq', value: 'VENDOR' };
    const nda: Condition = { field: 'type', op: 'eq', value: 'NDA' };
    const noValue = facts({ value: null });
    // false AND unknown = false: the step can safely be skipped.
    expect(evaluateCondition({ all: [nda, overTenK] }, noValue).applies).toBe(false);
    // true AND unknown = unknown: required.
    expect(evaluateCondition({ all: [vendor, overTenK] }, noValue).applies).toBe(true);
    // true OR unknown = true.
    expect(evaluateCondition({ any: [vendor, overTenK] }, noValue).applies).toBe(true);
    // false OR unknown = unknown: required.
    expect(evaluateCondition({ any: [nda, overTenK] }, noValue).applies).toBe(true);
    // false OR false = false.
    expect(evaluateCondition({ any: [nda, overTenK] }, facts()).applies).toBe(false);
  });

  it('supports every operator', () => {
    const f = facts({ durationDays: 365 });
    const check = (op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq', value: number) =>
      evaluateCondition({ field: 'durationDays', op, value }, f).applies;
    expect([check('gt', 365), check('gte', 365), check('lt', 365), check('lte', 365)]).toEqual([false, true, false, true]);
    expect([check('eq', 365), check('neq', 365)]).toEqual([true, false]);
    expect(evaluateCondition({ field: 'currency', op: 'in', value: ['EUR', 'USD'] }, f).applies).toBe(true);
    expect(evaluateCondition({ field: 'autoRenew', op: 'eq', value: true }, f).applies).toBe(false);
  });
});

describe('ConditionSchema', () => {
  it('accepts nested conditions', () => {
    const c = { all: [overTenK, { any: [{ field: 'type', op: 'in', value: ['VENDOR', 'CLIENT'] }, { not: overTenK }] }] };
    expect(ConditionSchema.safeParse(c).success).toBe(true);
  });

  it.each([
    ['an unknown field', { field: 'owner', op: 'eq', value: 'x' }],
    ['a numeric operator on a text field', { field: 'currency', op: 'gt', value: 'USD' }],
    ['a value of the wrong type', { field: 'value', op: 'gt', value: '10000' }],
    ['"in" without a list', { field: 'type', op: 'in', value: 'NDA' }],
    ['a list without "in"', { field: 'type', op: 'eq', value: ['NDA'] }],
    ['an unknown contract type', { field: 'type', op: 'eq', value: 'LEASE' }],
    ['extra keys (possible typo)', { field: 'value', op: 'gt', value: 1, vaule: 2 }],
    ['nesting deeper than 4 levels', { not: { not: { not: { not: { not: overTenK } } } } }],
  ])('rejects %s', (_label, condition) => {
    expect(ConditionSchema.safeParse(condition).success).toBe(false);
  });
});

describe('describeCondition', () => {
  it('renders a readable rule', () => {
    expect(describeCondition(overTenK)).toBe('value > 10,000');
    expect(
      describeCondition({ all: [overTenK, { not: { field: 'type', op: 'in', value: ['NDA', 'EMPLOYMENT'] } }] }),
    ).toBe('value > 10,000 AND (NOT type one of NDA, EMPLOYMENT)');
  });
});

describe('factsFor', () => {
  it('derives the facts from a contract', () => {
    expect(
      factsFor({
        value: { toString: () => '12500.50' },
        currency: 'EUR',
        type: 'CLIENT',
        startDate: new Date('2027-01-01'),
        endDate: new Date('2027-12-31'),
        autoRenew: true,
      }),
    ).toEqual({ value: 12500.5, currency: 'EUR', type: 'CLIENT', durationDays: 364, autoRenew: true });
  });

  it('leaves unknown facts null', () => {
    const f = factsFor({ value: null, currency: 'USD', type: 'NDA', startDate: null, endDate: null, autoRenew: false });
    expect(f.value).toBeNull();
    expect(f.durationDays).toBeNull();
  });
});
