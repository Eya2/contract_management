import { ContractStatus } from './enums.js';

/**
 * The contract lifecycle as a static transition table.
 *
 *   DRAFT ─submit─▶ SUBMITTED ─first approval─▶ UNDER_REVIEW ─last approval─▶ APPROVED
 *     ▲                 │                            │                          │
 *     │                 └──────────reject────────────┴──────▶ REJECTED          │ all parties sign
 *     └──revise──────────────────────────────────────────────────┘              ▼
 *                                                   ACTIVE ◀─start date── SIGNED
 *                                                      │
 *                                     ┌────────────────┼──────────────┐
 *                                  EXPIRED          RENEWED       TERMINATED
 *
 * This table only answers "is this edge legal at all?". *Who* may trigger an edge,
 * and under which conditions (e.g. all approval steps done), is enforced by the
 * workflow engine on the API. The web app uses the same table to decide which
 * action buttons to render, so UI and server can never disagree about the graph.
 */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  DRAFT: ['SUBMITTED'],
  // Withdrawing a request sends the contract back to DRAFT.
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'],
  // Edits after approval invalidate it: the contract must be re-approved.
  APPROVED: ['SIGNED', 'ACTIVE', 'DRAFT'],
  REJECTED: ['DRAFT'],
  // SIGNED = fully signed but the start date is still in the future.
  SIGNED: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['EXPIRED', 'RENEWED', 'TERMINATED'],
  EXPIRED: ['RENEWED'],
  RENEWED: [],
  TERMINATED: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** Statuses in which the contract content may still be edited (creating a new version). */
export const EDITABLE_STATUSES: readonly ContractStatus[] = [ContractStatus.DRAFT, ContractStatus.REJECTED];

/** Terminal states: nothing further can happen to the contract. */
export const TERMINAL_STATUSES: readonly ContractStatus[] = [ContractStatus.RENEWED, ContractStatus.TERMINATED];
