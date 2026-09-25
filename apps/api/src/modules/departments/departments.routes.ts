import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, requirePermission } from '../../common/middleware/authenticate.js';
import { prisma } from '../../lib/prisma.js';
import { userAdminService } from '../users/user-admin.service.js';

export const departmentsRouter = Router();

/** Reference data for filters and forms: readable by any signed-in user. */
departmentsRouter.get('/', authenticate, async (_req, res) => {
  res.json(
    await prisma.department.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
  );
});

const admin = [authenticate, requirePermission(Permission.USER_MANAGE)];

/** With heads and member counts, for the admin screen. */
departmentsRouter.get('/overview', ...admin, async (_req, res) => {
  res.json(await userAdminService.listDepartments());
});

departmentsRouter.post('/', ...admin, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(100),
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,16}$/, '2–16 letters or digits'),
    })
    .parse(req.body);
  res.status(201).json(await userAdminService.createDepartment(body));
});

departmentsRouter.put('/:id/head', ...admin, async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  const { userId } = z.object({ userId: z.uuid().nullable() }).parse(req.body);
  res.json(await userAdminService.setDepartmentHead(id, userId));
});
