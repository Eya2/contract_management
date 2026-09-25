import type { AuthUser } from '../../common/auth/auth-user.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import { refreshTokenRepository } from '../auth/refresh-token.repository.js';
import { publicUserSelect } from './user.repository.js';

/**
 * User and department administration (Admin only).
 *
 * Users are never deleted, only deactivated: approvals, signatures and the
 * audit log must keep pointing at them. Deactivating or changing someone's
 * role revokes their sessions, so the change applies at once instead of at
 * their next token refresh.
 */

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Prisma.UserCreateInput['role'] & string;
  departmentId: string;
  password: string;
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'email' | 'password'>> & { isActive?: boolean; password?: string };

const adminUserSelect = {
  ...publicUserSelect,
  headOf: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export const userAdminService = {
  list(filter: { q?: string; role?: string; departmentId?: string; active?: boolean }) {
    return prisma.user.findMany({
      where: {
        ...(filter.role ? { role: filter.role as never } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.active !== undefined ? { isActive: filter.active } : {}),
        ...(filter.q
          ? {
              OR: [
                { email: { contains: filter.q, mode: 'insensitive' } },
                { firstName: { contains: filter.q, mode: 'insensitive' } },
                { lastName: { contains: filter.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: adminUserSelect,
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });
  },

  async create(input: CreateUserInput) {
    await assertDepartment(input.departmentId);
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictError('A user with this email already exists');
    }
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          departmentId: input.departmentId,
          passwordHash: await hashPassword(input.password),
        },
        select: adminUserSelect,
      });
      await recordAudit({ action: 'USER_CREATED', entityType: 'user', entityId: user.id, metadata: { email: user.email, role: user.role } }, tx);
      return user;
    });
  },

  async update(actor: AuthUser, id: string, input: UpdateUserInput) {
    const existing = await prisma.user.findUnique({ where: { id }, include: { headOf: true } });
    if (!existing) throw new NotFoundError('User');
    if (input.departmentId) await assertDepartment(input.departmentId);

    // Admins can't lock themselves out, and the last active admin can't go.
    if (id === actor.id && (input.isActive === false || (input.role && input.role !== 'ADMIN'))) {
      throw new BadRequestError("You can't deactivate yourself or remove your own admin role");
    }
    const losesAdmin = existing.role === 'ADMIN' && existing.isActive && (input.isActive === false || (input.role && input.role !== 'ADMIN'));
    if (losesAdmin && (await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })) <= 1) {
      throw new ConflictError('This is the last active admin');
    }
    // A department head who moves department or leaves stops being its head.
    const leavesHeadship = existing.headOf && ((input.departmentId && input.departmentId !== existing.departmentId) || input.isActive === false);

    const changes: Record<string, unknown> = {};
    for (const key of ['firstName', 'lastName', 'role', 'departmentId', 'isActive'] as const) {
      if (input[key] !== undefined && input[key] !== existing[key]) changes[key] = { from: existing[key], to: input[key] };
    }
    if (!Object.keys(changes).length && !input.password) throw new BadRequestError('Nothing changed');

    return prisma.$transaction(async (tx) => {
      if (leavesHeadship) await tx.department.update({ where: { id: existing.headOf!.id }, data: { headId: null } });
      const user = await tx.user.update({
        where: { id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          departmentId: input.departmentId,
          isActive: input.isActive,
          ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
        },
        select: adminUserSelect,
      });
      // Sessions end at once when access shrinks or the password is reset.
      if (changes['isActive'] || changes['role'] || changes['departmentId'] || input.password) {
        await refreshTokenRepository.revokeAllForUser(id, tx);
      }
      await recordAudit(
        {
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: id,
          metadata: { changes, passwordReset: !!input.password, ...(leavesHeadship ? { noLongerHeadOf: existing.headOf!.name } : {}) } as Prisma.InputJsonValue,
        },
        tx,
      );
      return user;
    });
  },

  async setDepartmentHead(departmentId: string, userId: string | null) {
    await assertDepartment(departmentId);
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.isActive) throw new BadRequestError('Unknown or inactive user');
      if (user.departmentId !== departmentId) throw new BadRequestError('The head must be a member of the department');
    }
    return prisma.$transaction(async (tx) => {
      // headId is unique: someone heads at most one department.
      if (userId) await tx.department.updateMany({ where: { headId: userId, NOT: { id: departmentId } }, data: { headId: null } });
      const dept = await tx.department.update({ where: { id: departmentId }, data: { headId: userId } });
      await recordAudit({ action: 'USER_UPDATED', entityType: 'department', entityId: departmentId, metadata: { head: userId } }, tx);
      return dept;
    });
  },

  async createDepartment(input: { name: string; code: string }) {
    const clash = await prisma.department.findFirst({ where: { OR: [{ name: input.name }, { code: input.code }] } });
    if (clash) throw new ConflictError('A department with this name or code already exists');
    return prisma.department.create({ data: input });
  },

  listDepartments() {
    return prisma.department.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        head: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { members: { where: { isActive: true } }, contracts: true } },
      },
      orderBy: { name: 'asc' },
    });
  },
};

async function assertDepartment(id: string) {
  if (!(await prisma.department.findUnique({ where: { id } }))) throw new BadRequestError('Unknown department');
}
