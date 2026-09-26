import type { ContractStatus } from '../../generated/prisma/enums.js';

/**
 * How much attention an ending contract needs, for the renewals calendar.
 *
 *   covered      a renewal is signed or active, nothing to do
 *   auto         renews automatically unless someone acts
 *   in-progress  a renewal exists but isn't signed yet
 *   decision     ends without renewal unless someone decides
 *   overdue      the end date passed and nothing continues it
 */
export type RenewalRisk = 'covered' | 'auto' | 'in-progress' | 'decision' | 'overdue';

const IN_FORCE: ContractStatus[] = ['SIGNED', 'ACTIVE'];

export function renewalRisk(c: { status: ContractStatus; autoRenew: boolean; renewedBy: { status: ContractStatus } | null }): RenewalRisk {
  if (c.status === 'RENEWED' || (c.renewedBy && IN_FORCE.includes(c.renewedBy.status))) return 'covered';
  if (c.status === 'EXPIRED') return 'overdue';
  if (c.renewedBy) return 'in-progress';
  return c.autoRenew ? 'auto' : 'decision';
}
