import { z } from 'zod';
import { ContractType } from '../../generated/prisma/enums.js';

/**
 * The condition language for workflow steps, stored as JSON on
 * WorkflowStepTemplate.condition, e.g.
 *
 *   { "field": "value", "op": "gt", "value": 10000 }
 *   { "all": [ { "field": "type", "op": "eq", "value": "VENDOR" },
 *              { "field": "durationDays", "op": "gte", "value": 365 } ] }
 *
 * Data, not code: an admin can edit policies without a deploy, and nothing an
 * admin types is ever executed. Conditions are validated with zod before being
 * saved and evaluated by the pure functions below.
 *
 * Evaluation uses three-valued logic (true / false / unknown). A fact that isn't
 * set yet, such as a draft with no value, is *unknown*, and a step whose
 * condition is unknown is **required**. Missing data must never be a way to
 * skip Finance.
 */

/** The facts a condition can test, derived from the contract being submitted. */
export interface ConditionFacts {
  value: number | null;
  currency: string;
  type: ContractType;
  /** Length of the contract in days (end − start), when both dates are set. */
  durationDays: number | null;
  autoRenew: boolean;
}

const NUMERIC_FIELDS = ['value', 'durationDays'] as const;
const FIELDS = ['value', 'durationDays', 'currency', 'type', 'autoRenew'] as const;
type Field = (typeof FIELDS)[number];

const Scalar = z.union([z.number(), z.string().max(100), z.boolean()]);

const Leaf = z
  .object({
    field: z.enum(FIELDS),
    op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in']),
    value: z.union([Scalar, z.array(Scalar).min(1).max(50)]),
  })
  .strict()
  .superRefine((leaf, ctx) => {
    const numeric = (NUMERIC_FIELDS as readonly string[]).includes(leaf.field);
    const expectsList = leaf.op === 'in';
    if (expectsList !== Array.isArray(leaf.value)) {
      ctx.addIssue({ code: 'custom', message: expectsList ? '"in" needs a list of values' : 'Only "in" takes a list' });
      return;
    }
    const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
    const kind = numeric ? 'number' : leaf.field === 'autoRenew' ? 'boolean' : 'string';
    if (values.some((v) => typeof v !== kind)) {
      ctx.addIssue({ code: 'custom', message: `"${leaf.field}" is compared with ${kind} values` });
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(leaf.op) && !numeric) {
      ctx.addIssue({ code: 'custom', message: `"${leaf.op}" only applies to ${NUMERIC_FIELDS.join(', ')}` });
    }
    if (leaf.field === 'type' && values.some((v) => !(Object.values(ContractType) as unknown[]).includes(v))) {
      ctx.addIssue({ code: 'custom', message: `Contract type must be one of ${Object.values(ContractType).join(', ')}` });
    }
  });

export type LeafCondition = z.infer<typeof Leaf>;
export type Condition = LeafCondition | { all: Condition[] } | { any: Condition[] } | { not: Condition };

const MAX_DEPTH = 4;

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    Leaf,
    z.object({ all: z.array(ConditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1).max(20) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
  ]),
).superRefine((c, ctx) => {
  if (depth(c) > MAX_DEPTH) ctx.addIssue({ code: 'custom', message: `Conditions may nest at most ${MAX_DEPTH} levels` });
});

function depth(c: Condition): number {
  if ('all' in c) return 1 + Math.max(...c.all.map(depth));
  if ('any' in c) return 1 + Math.max(...c.any.map(depth));
  if ('not' in c) return 1 + depth(c.not);
  return 1;
}

// -----------------------------------------------------------------------------
//  Evaluation
// -----------------------------------------------------------------------------

type Truth = true | false | 'unknown';

export interface ConditionResult {
  /** Whether the step applies. Unknown counts as applying (fail-safe). */
  applies: boolean;
  /** Human-readable explanation, e.g. "value 8,000.00 USD is not > 10,000". */
  reason: string;
}

export function evaluateCondition(condition: Condition, facts: ConditionFacts): ConditionResult {
  const { truth, reason } = evaluate(condition, facts);
  if (truth === 'unknown') return { applies: true, reason: `${reason}, so the step is required` };
  return { applies: truth, reason };
}

function evaluate(c: Condition, facts: ConditionFacts): { truth: Truth; reason: string } {
  if ('all' in c) {
    const parts = c.all.map((x) => evaluate(x, facts));
    const failed = parts.find((p) => p.truth === false);
    if (failed) return failed;
    const unknown = parts.find((p) => p.truth === 'unknown');
    return unknown ?? { truth: true, reason: parts.map((p) => p.reason).join(' and ') };
  }
  if ('any' in c) {
    const parts = c.any.map((x) => evaluate(x, facts));
    const passed = parts.find((p) => p.truth === true);
    if (passed) return passed;
    const unknown = parts.find((p) => p.truth === 'unknown');
    return unknown ?? { truth: false, reason: parts.map((p) => p.reason).join(' and ') };
  }
  if ('not' in c) {
    const inner = evaluate(c.not, facts);
    return inner.truth === 'unknown' ? inner : { truth: !inner.truth, reason: inner.reason };
  }
  return evaluateLeaf(c, facts);
}

function evaluateLeaf(c: LeafCondition, facts: ConditionFacts): { truth: Truth; reason: string } {
  const actual = facts[c.field as Field];
  if (actual === null) return { truth: 'unknown', reason: `${c.field} is not set` };

  const expected = c.value;
  let truth: boolean;
  switch (c.op) {
    case 'gt': truth = (actual as number) > (expected as number); break;
    case 'gte': truth = (actual as number) >= (expected as number); break;
    case 'lt': truth = (actual as number) < (expected as number); break;
    case 'lte': truth = (actual as number) <= (expected as number); break;
    case 'eq': truth = actual === expected; break;
    case 'neq': truth = actual !== expected; break;
    case 'in': truth = (expected as unknown[]).includes(actual); break;
  }
  const shown = c.field === 'value' ? `${formatNumber(actual as number, 2)} ${facts.currency}` : format(actual);
  return { truth, reason: `${c.field} ${shown} ${truth ? 'is' : 'is not'} ${OP_TEXT[c.op]} ${format(expected)}` };
}

const OP_TEXT: Record<LeafCondition['op'], string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
  in: 'one of',
};

function format(v: unknown): string {
  if (Array.isArray(v)) return v.map(format).join(', ');
  return typeof v === 'number' ? formatNumber(v) : String(v);
}

function formatNumber(n: number, decimals?: number): string {
  return n.toLocaleString('en-US', decimals === undefined ? undefined : { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Short description of a condition for policy screens, e.g. "value > 10,000". */
export function describeCondition(c: Condition): string {
  if ('all' in c) return c.all.map(wrap).join(' AND ');
  if ('any' in c) return c.any.map(wrap).join(' OR ');
  if ('not' in c) return `NOT ${wrap(c.not)}`;
  return `${c.field} ${OP_TEXT[c.op]} ${format(c.value)}`;
}

function wrap(c: Condition): string {
  return 'field' in c ? describeCondition(c) : `(${describeCondition(c)})`;
}

/** The facts for a contract. Duration is counted in whole days. */
export function factsFor(contract: {
  value: { toString(): string } | null;
  currency: string;
  type: ContractType;
  startDate: Date | null;
  endDate: Date | null;
  autoRenew: boolean;
}): ConditionFacts {
  const durationDays =
    contract.startDate && contract.endDate
      ? Math.round((contract.endDate.getTime() - contract.startDate.getTime()) / 86_400_000)
      : null;
  return {
    value: contract.value === null ? null : Number(contract.value.toString()),
    currency: contract.currency,
    type: contract.type,
    durationDays,
    autoRenew: contract.autoRenew,
  };
}
