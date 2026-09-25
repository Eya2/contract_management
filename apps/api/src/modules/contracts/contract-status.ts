import { canTransition } from '@cms/shared';
import { ConflictError } from '../../common/errors/app-error.js';
import type { ContractStatus } from '../../generated/prisma/enums.js';
import type { DbClient } from '../../lib/prisma.js';

/**
 * The single way a contract changes status. It enforces the shared transition
 * table, writes the timeline entry, and uses compare-and-set on the current
 * status: if another request moved the contract first, this one gets a 409
 * instead of overwriting that change.
 *
 * Must be called inside the transaction that makes the related change.
 */
export async function transitionContract(
  tx: DbClient,
  params: {
    contractId: string;
    from: ContractStatus;
    to: ContractStatus;
    /** Null for system changes (scheduler). */
    actorId: string | null;
    reason?: string;
    data?: { activatedAt?: Date; terminatedAt?: Date; terminationReason?: string };
  },
): Promise<void> {
  const { contractId, from, to } = params;
  if (!canTransition(from, to)) {
    throw new ConflictError(`A ${from} contract cannot move to ${to}`);
  }
  const { count } = await tx.contract.updateMany({
    where: { id: contractId, status: from },
    data: { status: to, ...params.data },
  });
  if (count !== 1) throw new ConflictError('The contract status changed in the meantime, please reload');
  await tx.contractStatusChange.create({
    data: { contractId, fromStatus: from, toStatus: to, actorId: params.actorId, reason: params.reason },
  });
}
