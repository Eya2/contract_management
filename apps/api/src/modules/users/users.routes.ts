import { Router } from 'express';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, requirePermission } from '../../common/middleware/authenticate.js';
import { userRepository } from './user.repository.js';

export const usersRouter = Router();

// User administration is Admin-only (only ADMIN holds user.manage).
usersRouter.get('/', authenticate, requirePermission(Permission.USER_MANAGE), async (_req, res) => {
  res.json(await userRepository.findMany());
});
