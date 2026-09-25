import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { describeCondition, type Condition } from './workflow-conditions.js';
import type { WorkflowTemplateBody } from './workflow.schemas.js';

/**
 * Approval policies. Editing one replaces its steps; requests already in
 * flight are unaffected because they hold frozen copies of the steps.
 */

const templateInclude = {
  department: { select: { id: true, name: true, code: true } },
  steps: { orderBy: [{ stage: 'asc' }, { name: 'asc' }] },
} satisfies Prisma.WorkflowTemplateInclude;

type TemplateWithSteps = Prisma.WorkflowTemplateGetPayload<{ include: typeof templateInclude }>;

/** Adds a readable form of each condition, for policy screens. */
function present(t: TemplateWithSteps) {
  return {
    ...t,
    steps: t.steps.map((s) => ({
      ...s,
      conditionText: s.condition ? describeCondition(s.condition as unknown as Condition) : null,
    })),
  };
}

export const workflowTemplateService = {
  async list() {
    const templates = await prisma.workflowTemplate.findMany({
      include: templateInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return templates.map(present);
  },

  async get(id: string) {
    const t = await prisma.workflowTemplate.findUnique({ where: { id }, include: templateInclude });
    if (!t) throw new NotFoundError('Workflow template');
    return present(t);
  },

  async create(body: WorkflowTemplateBody) {
    const id = await prisma.$transaction(async (tx) => {
      await assertValidScope(tx, body, null);
      const t = await tx.workflowTemplate.create({
        data: { ...templateFields(body), steps: { create: body.steps.map(stepFields) } },
      });
      await audit(tx, t.id, 'created', body);
      return t.id;
    });
    return this.get(id);
  },

  async replace(id: string, body: WorkflowTemplateBody) {
    await prisma.$transaction(async (tx) => {
      if (!(await tx.workflowTemplate.findUnique({ where: { id } }))) throw new NotFoundError('Workflow template');
      await assertValidScope(tx, body, id);
      // In-flight ApprovalSteps keep their frozen copy; their templateStepId is set to null.
      await tx.workflowStepTemplate.deleteMany({ where: { workflowTemplateId: id } });
      await tx.workflowTemplate.update({
        where: { id },
        data: { ...templateFields(body), steps: { create: body.steps.map(stepFields) } },
      });
      await audit(tx, id, 'updated', body);
    });
    return this.get(id);
  },

  /** Templates are deactivated, not deleted: past requests still point at them. */
  async deactivate(id: string) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.workflowTemplate.updateMany({ where: { id }, data: { isActive: false } });
      if (count === 0) throw new NotFoundError('Workflow template');
      await audit(tx, id, 'deactivated');
    });
  },
};

/**
 * Two active templates with the same scope (type + department) would make the
 * choice between them arbitrary, so that's refused up front.
 */
async function assertValidScope(tx: DbClient, body: WorkflowTemplateBody, selfId: string | null) {
  if (body.departmentId && !(await tx.department.findUnique({ where: { id: body.departmentId } }))) {
    throw new BadRequestError('Unknown department');
  }
  if (!body.isActive) return;
  const clash = await tx.workflowTemplate.findFirst({
    where: {
      isActive: true,
      contractType: body.contractType,
      departmentId: body.departmentId,
      ...(selfId ? { id: { not: selfId } } : {}),
    },
    select: { name: true },
  });
  if (clash) {
    throw new ConflictError(`The active template "${clash.name}" already covers this contract type and department`);
  }
}

function templateFields(body: WorkflowTemplateBody) {
  return {
    name: body.name,
    description: body.description ?? null,
    contractType: body.contractType,
    departmentId: body.departmentId,
    isActive: body.isActive,
  };
}

function stepFields(s: WorkflowTemplateBody['steps'][number]) {
  return {
    stage: s.stage,
    name: s.name,
    approverRole: s.approverRole,
    approverScope: s.approverScope,
    condition: (s.condition ?? undefined) as Prisma.InputJsonValue | undefined,
    escalateAfterHours: s.escalateAfterHours ?? null,
  };
}

async function audit(tx: DbClient, id: string, change: string, body?: WorkflowTemplateBody) {
  await recordAudit(
    {
      action: 'WORKFLOW_TEMPLATE_UPDATED',
      entityType: 'workflow_template',
      entityId: id,
      metadata: { change, ...(body ? { snapshot: body as unknown as Prisma.InputJsonValue } : {}) },
    },
    tx,
  );
}
