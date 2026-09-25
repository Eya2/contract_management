import { z } from 'zod';
import { ContractType, Role } from '../../generated/prisma/enums.js';
import { ConditionSchema } from './workflow-conditions.js';

/** Employees hold no approval permission, so a step assigned to that role could never be decided. */
const ApproverRole = z.enum(Role).refine((r) => r !== 'EMPLOYEE', 'Employees cannot approve contracts');

const StepTemplateBody = z.object({
  stage: z.number().int().min(1).max(20),
  name: z.string().trim().min(2).max(100),
  approverRole: ApproverRole,
  approverScope: z.enum(['ANY', 'CONTRACT_DEPARTMENT']).default('ANY'),
  condition: ConditionSchema.nullable().optional(),
  escalateAfterHours: z.number().int().min(1).max(24 * 60).nullable().optional(),
});

export const WorkflowTemplateBody = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  contractType: z.enum(ContractType).nullable().default(null),
  departmentId: z.uuid().nullable().default(null),
  isActive: z.boolean().default(true),
  steps: z
    .array(StepTemplateBody)
    .min(1, 'A workflow needs at least one step')
    .max(30)
    .refine(
      (steps) => new Set(steps.map((s) => `${s.stage}:${s.name.toLowerCase()}`)).size === steps.length,
      'Step names must be unique within a stage',
    ),
});
export type WorkflowTemplateBody = z.infer<typeof WorkflowTemplateBody>;

export const DecisionBody = z.object({ comment: z.string().trim().max(2000).optional() });
export const RejectBody = z.object({ comment: z.string().trim().min(1, 'A reason is required to reject').max(2000) });
export const SubmitBody = z.object({ comment: z.string().trim().max(2000).optional() });
export const WithdrawBody = z.object({ reason: z.string().trim().max(2000).optional() });
export const ReopenBody = z.object({ reason: z.string().trim().min(3, 'Say why the contract is being reopened').max(2000) });
export const StepParams = z.object({ stepId: z.uuid() });
