import { describe, expect, it } from 'vitest';
import { computeContentHash, diffContent, renderClauses, type ContractContent } from './contract-content.js';

const base: ContractContent = {
  title: 'Hosting agreement',
  type: 'VENDOR',
  counterpartyId: 'cp-1',
  value: '45000.00',
  currency: 'USD',
  startDate: '2027-01-01',
  endDate: '2027-12-31',
  clauses: [
    { key: 'scope', heading: 'Scope', body: 'Managed hosting.' },
    { key: 'fees', heading: 'Fees', body: '45,000 USD per year.' },
  ],
  fileSha256: null,
};

describe('computeContentHash', () => {
  it('is stable regardless of how the object was built', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as ContractContent;
    expect(computeContentHash(reordered)).toBe(computeContentHash(base));
    expect(computeContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with any field, clause, clause order or document', () => {
    const hash = computeContentHash(base);
    const variants: Partial<ContractContent>[] = [
      { value: '45000.01' },
      { endDate: null },
      { clauses: [base.clauses[0]!, { ...base.clauses[1]!, body: '45,000 USD per year!' }] },
      { clauses: [...base.clauses].reverse() },
      { fileSha256: 'a'.repeat(64) },
    ];
    for (const v of variants) expect(computeContentHash({ ...base, ...v })).not.toBe(hash);
  });

  it('cannot be fooled by moving text across field boundaries', () => {
    const a = { ...base, clauses: [{ key: 'k', heading: 'ab', body: 'c' }] };
    const b = { ...base, clauses: [{ key: 'k', heading: 'a', body: 'bc' }] };
    expect(computeContentHash(a)).not.toBe(computeContentHash(b));
  });
});

describe('diffContent', () => {
  it('reports changed fields, and clauses matched by key', () => {
    const next: ContractContent = {
      ...base,
      value: '50000.00',
      clauses: [
        { key: 'fees', heading: 'Fees', body: '50,000 USD per year.' },
        { key: 'scope', heading: 'Scope', body: 'Managed hosting.' },
        { key: 'sla', heading: 'Service levels', body: '99.9% uptime.' },
      ],
      fileSha256: 'b'.repeat(64),
    };
    const diff = diffContent(base, next);
    expect(diff.fields).toEqual([{ field: 'value', from: '45000.00', to: '50000.00' }]);
    expect(diff.clauses.added.map((c) => c.key)).toEqual(['sla']);
    expect(diff.clauses.removed).toEqual([]);
    expect(diff.clauses.changed.map((c) => c.key)).toEqual(['fees']);
    expect(diff.clauses.reordered).toBe(true);
    expect(diff.documentChanged).toBe(true);
  });

  it('is empty for identical content', () => {
    const diff = diffContent(base, structuredClone(base));
    expect(diff.fields).toEqual([]);
    expect(diff.clauses).toEqual({ added: [], removed: [], changed: [], reordered: false });
    expect(diff.documentChanged).toBe(false);
  });

  it('does not flag a reorder when a clause is only removed', () => {
    const diff = diffContent(base, { ...base, clauses: [base.clauses[1]!] });
    expect(diff.clauses.removed.map((c) => c.key)).toEqual(['scope']);
    expect(diff.clauses.reordered).toBe(false);
  });
});

describe('renderClauses', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    const [clause] = renderClauses(
      [{ key: 'p', heading: 'Parties with {{ counterparty }}', body: 'From {{startDate}} to {{endDate}}.' }],
      { counterparty: 'Globex', startDate: '2026-10-01', endDate: undefined },
    );
    expect(clause).toEqual({ key: 'p', heading: 'Parties with Globex', body: 'From 2026-10-01 to {{endDate}}.' });
  });
});
