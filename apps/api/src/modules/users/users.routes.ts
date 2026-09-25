import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { Role } from '../../generated/prisma/enums.js';
import { userAdminService } from './user-admin.service.js';

export const usersRouter = Router();

// User administration is Admin-only (only ADMIN holds user.manage).
usersRouter.use(authenticate, requirePermission(Permission.USER_MANAGE));

/** At least 10 characters with a letter and a digit: long beats complex. */
const Password = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a digit');

const Name = z.string().trim().min(1).max(100);

const CreateBody = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  firstName: Name,
  lastName: Name,
  role: z.enum(Role),
  departmentId: z.uuid(),
  password: Password,
});

const UpdateBody = z
  .object({
    firstName: Name,
    lastName: Name,
    role: z.enum(Role),
    departmentId: z.uuid(),
    isActive: z.boolean(),
    password: Password,
  })
  .partial();

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(Role).optional(),
  departmentId: z.uuid().optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

usersRouter.get('/', async (req, res) => {
  res.json(await userAdminService.list(ListQuery.parse(req.query)));
});

usersRouter.post('/', async (req, res) => {
  res.status(201).json(await userAdminService.create(CreateBody.parse(req.body)));
});

usersRouter.patch('/:id', async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  res.json(await userAdminService.update(currentUser(req), id, UpdateBody.parse(req.body)));
});
