import * as Shared from '@cms/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as Db from '../src/generated/prisma/enums.js';

/**
 * The web app only sees @cms/shared; the API persists Prisma's enums. If someone
 * adds a status to one and forgets the other, this fails at compile time
 * (expectTypeOf) and at runtime (toEqual).
 */
describe('shared enums mirror the Prisma schema', () => {
  const pairs = [
    ['Role', Shared.Role, Db.Role],
    ['ContractType', Shared.ContractType, Db.ContractType],
    ['ContractStatus', Shared.ContractStatus, Db.ContractStatus],
    ['ApprovalStepStatus', Shared.ApprovalStepStatus, Db.ApprovalStepStatus],
    ['ApprovalRequestStatus', Shared.ApprovalRequestStatus, Db.ApprovalRequestStatus],
  ] as const;

  it.each(pairs)('%s has identical members', (_name, shared, db) => {
    expect(shared).toEqual(db);
  });

  it('types are mutually assignable', () => {
    expectTypeOf<Shared.ContractStatus>().toEqualTypeOf<Db.ContractStatus>();
    expectTypeOf<Shared.Role>().toEqualTypeOf<Db.Role>();
    expectTypeOf<Shared.ApprovalStepStatus>().toEqualTypeOf<Db.ApprovalStepStatus>();
  });

  it('every status appears in the transition table', () => {
    expect(Object.keys(Shared.CONTRACT_TRANSITIONS).sort()).toEqual(Object.values(Db.ContractStatus).sort());
  });
});
