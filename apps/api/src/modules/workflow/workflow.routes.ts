import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { IdParams } from '../contracts/contract.schemas.js';
import { approvalService } from './approval.service.js';
import { escalationService } from './escalation.service.js';
import { workflowTemplateService } from './workflow-template.service.js';
import {
  DecisionBody,
  RejectBody,
  ReopenBody,
  StepParams,
  SubmitBody,
  WithdrawBody,
  WorkflowTemplateBody,
} from './workflow.schemas.js';

/** Workflow actions on a contract, mounted under /api/contracts next to the CRUD routes. */
export const contractWorkflowRouter = Router();
contractWorkflowRouter.use(authenticate);

contractWorkflowRouter.get('/:id/approvals', requirePermission(Permission.CONTRACT_READ), async (req, res) => {
  res.json(await approvalService.listForContract(currentUser(req), IdParams.parse(req.params).id));
});

contractWorkflowRouter.get('/:id/approval-preview', requirePermission(Permission.CONTRACT_READ), async (req, res) => {
  res.json(await approvalService.preview(currentUser(req), IdParams.parse(req.params).id));
});

contractWorkflowRouter.post('/:id/submit', requirePermission(Permission.CONTRACT_SUBMIT), async (req, res) => {
  const { comment } = SubmitBody.parse(req.body ?? {});
  res.status(201).json(await approvalService.submit(currentUser(req), IdParams.parse(req.params).id, comment));
});

contractWorkflowRouter.post('/:id/withdraw', requirePermission(Permission.CONTRACT_SUBMIT), async (req, res) => {
  const { reason } = WithdrawBody.parse(req.body ?? {});
  res.json(await approvalService.withdraw(currentUser(req), IdParams.parse(req.params).id, reason));
});

contractWorkflowRouter.post('/:id/reopen', requirePermission(Permission.CONTRACT_UPDATE), async (req, res) => {
  const { reason } = ReopenBody.parse(req.body ?? {});
  await approvalService.reopen(currentUser(req), IdParams.parse(req.params).id, reason);
  res.status(204).end();
});

/** The approver's side: /api/approvals */
export const approvalsRouter = Router();
approvalsRouter.use(authenticate);

approvalsRouter.get('/pending', requirePermission(Permission.APPROVAL_DECIDE), async (req, res) => {
  res.json(await approvalService.pending(currentUser(req)));
});

approvalsRouter.post('/steps/:stepId/approve', requirePermission(Permission.APPROVAL_DECIDE), async (req, res) => {
  const { stepId } = StepParams.parse(req.params);
  const { comment } = DecisionBody.parse(req.body ?? {});
  res.json(await approvalService.decide(currentUser(req), stepId, 'APPROVED', comment));
});

approvalsRouter.post('/steps/:stepId/reject', requirePermission(Permission.APPROVAL_DECIDE), async (req, res) => {
  const { stepId } = StepParams.parse(req.params);
  const { comment } = RejectBody.parse(req.body ?? {});
  res.json(await approvalService.decide(currentUser(req), stepId, 'REJECTED', comment));
});

/** Runs the escalation scan immediately (the scheduler also runs it periodically). */
approvalsRouter.post('/escalations/run', requirePermission(Permission.WORKFLOW_MANAGE), async (_req, res) => {
  res.json(await escalationService.runOnce());
});

/** Approval policies: readable by anyone signed in, editable by admins. */
export const workflowTemplatesRouter = Router();
workflowTemplatesRouter.use(authenticate);
const manage = requirePermission(Permission.WORKFLOW_MANAGE);
const TemplateParams = z.object({ id: z.uuid() });

workflowTemplatesRouter.get('/', async (_req, res) => {
  res.json(await workflowTemplateService.list());
});
workflowTemplatesRouter.get('/:id', async (req, res) => {
  res.json(await workflowTemplateService.get(TemplateParams.parse(req.params).id));
});
workflowTemplatesRouter.post('/', manage, async (req, res) => {
  res.status(201).json(await workflowTemplateService.create(WorkflowTemplateBody.parse(req.body)));
});
workflowTemplatesRouter.put('/:id', manage, async (req, res) => {
  res.json(await workflowTemplateService.replace(TemplateParams.parse(req.params).id, WorkflowTemplateBody.parse(req.body)));
});
workflowTemplatesRouter.delete('/:id', manage, async (req, res) => {
  await workflowTemplateService.deactivate(TemplateParams.parse(req.params).id);
  res.status(204).end();
});
