import type { ContractType } from '../../generated/prisma/enums.js';
import { sha256Hex } from '../../lib/storage.js';

/**
 * Pure helpers over contract *content* (what a version snapshots): the canonical
 * hash signers sign, the diff between two versions, and template rendering.
 * No database or HTTP here, so every rule is unit-tested directly.
 */

export interface ClauseContent {
  key: string;
  heading: string;
  body: string;
}

/** Everything that makes up one version's content, in normalized form. */
export interface ContractContent {
  title: string;
  type: ContractType;
  counterpartyId: string;
  /** Decimal as a fixed two-decimal string ("12000.00"), or null. */
  value: string | null;
  currency: string;
  /** ISO dates (YYYY-MM-DD), or null. */
  startDate: string | null;
  endDate: string | null;
  clauses: ClauseContent[];
  /** SHA-256 of the uploaded document, if the version has one. */
  fileSha256: string | null;
}

/**
 * SHA-256 over a canonical serialization of the content. Keys are written in a
 * fixed order, so the same content always yields the same hash no matter how the
 * object was built, and any change (even one character of one clause, or a new
 * document with different bytes) yields a different one.
 */
export function computeContentHash(content: ContractContent): string {
  const canonical = [
    content.title,
    content.type,
    content.counterpartyId,
    content.value,
    content.currency,
    content.startDate,
    content.endDate,
    content.clauses.map((c) => [c.key, c.heading, c.body]),
    content.fileSha256,
  ];
  return sha256Hex(JSON.stringify(canonical));
}

export function toIsoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

// -----------------------------------------------------------------------------
//  Version diff
// -----------------------------------------------------------------------------

const DIFFED_FIELDS = ['title', 'type', 'counterpartyId', 'value', 'currency', 'startDate', 'endDate'] as const;
type DiffedField = (typeof DIFFED_FIELDS)[number];

export interface VersionDiff {
  fields: { field: DiffedField; from: string | null; to: string | null }[];
  clauses: {
    added: ClauseContent[];
    removed: ClauseContent[];
    changed: { key: string; from: ClauseContent; to: ClauseContent }[];
    /** True when the same clauses appear in a different order. */
    reordered: boolean;
  };
  documentChanged: boolean;
}

/**
 * What changed from `from` to `to`. Clauses are matched by their stable `key`,
 * so a clause that moved and was edited shows as "changed", not "removed + added".
 */
export function diffContent(from: ContractContent, to: ContractContent): VersionDiff {
  const fields = DIFFED_FIELDS.filter((f) => from[f] !== to[f]).map((field) => ({
    field,
    from: from[field],
    to: to[field],
  }));

  const before = new Map(from.clauses.map((c) => [c.key, c]));
  const after = new Map(to.clauses.map((c) => [c.key, c]));
  const added = to.clauses.filter((c) => !before.has(c.key));
  const removed = from.clauses.filter((c) => !after.has(c.key));
  const changed = to.clauses.flatMap((c) => {
    const old = before.get(c.key);
    return old && (old.heading !== c.heading || old.body !== c.body) ? [{ key: c.key, from: old, to: c }] : [];
  });
  const commonBefore = from.clauses.filter((c) => after.has(c.key)).map((c) => c.key);
  const commonAfter = to.clauses.filter((c) => before.has(c.key)).map((c) => c.key);
  const reordered = commonBefore.some((key, i) => key !== commonAfter[i]);

  return {
    fields,
    clauses: { added, removed, changed, reordered },
    documentChanged: from.fileSha256 !== to.fileSha256,
  };
}

// -----------------------------------------------------------------------------
//  Templates
// -----------------------------------------------------------------------------

/**
 * Fills `{{placeholder}}` tokens in template clauses. Unknown placeholders are
 * left as they are, so a missing value stays visible in the draft instead of
 * silently turning into an empty string.
 */
export function renderClauses(clauses: ClauseContent[], vars: Record<string, string | null | undefined>): ClauseContent[] {
  const fill = (text: string) =>
    text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (token, name: string) => vars[name] ?? token);
  return clauses.map((c) => ({ key: c.key, heading: fill(c.heading), body: fill(c.body) }));
}
