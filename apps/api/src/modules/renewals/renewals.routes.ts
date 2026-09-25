import { Router } from 'express';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { IdParams } from '../contracts/contract.schemas.js';
import { renewalService } from './renewal.service.js';

/** Mounted under /api/contracts. */
export const contractRenewalRouter = Router();

contractRenewalRouter.post('/:id/renew', authenticate, requirePermission(Permission.CONTRACT_CREATE), async (req, res) => {
  res.status(201).json(await renewalService.renew(currentUser(req), IdParams.parse(req.params).id));
});
