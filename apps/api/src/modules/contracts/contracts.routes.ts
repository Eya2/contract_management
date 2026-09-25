import { Router } from 'express';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, requirePermission } from '../../common/middleware/authenticate.js';
import { singleFile } from '../../common/middleware/upload.js';
import { contractController as c } from './contract.controller.js';

export const contractsRouter = Router();
contractsRouter.use(authenticate);

const read = requirePermission(Permission.CONTRACT_READ);

contractsRouter.get('/', read, c.list);
// Create/update accept JSON, or multipart with a `data` JSON field plus an optional `document` file.
contractsRouter.post('/', requirePermission(Permission.CONTRACT_CREATE), singleFile('document'), c.create);
contractsRouter.get('/:id', read, c.get);
contractsRouter.patch('/:id', requirePermission(Permission.CONTRACT_UPDATE), singleFile('document'), c.update);

contractsRouter.get('/:id/timeline', read, c.timeline);
contractsRouter.get('/:id/versions', read, c.listVersions);
contractsRouter.get('/:id/versions/diff', read, c.diff);
contractsRouter.get('/:id/versions/:versionNumber', read, c.getVersion);
contractsRouter.get('/:id/versions/:versionNumber/document', read, c.downloadDocument);

contractsRouter.post('/:id/attachments', requirePermission(Permission.CONTRACT_UPDATE), singleFile('file'), c.addAttachment);
contractsRouter.get('/:id/attachments/:attachmentId/download', read, c.downloadAttachment);
contractsRouter.delete('/:id/attachments/:attachmentId', requirePermission(Permission.CONTRACT_UPDATE), c.removeAttachment);
