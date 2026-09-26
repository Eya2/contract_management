import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../common/middleware/authenticate.js';
import { IdParams } from '../contracts/contract.schemas.js';
import { commentService } from './comment.service.js';

const Body = z.string().trim().min(1).max(4000);

/** Mounted under /api/contracts. */
export const contractCommentsRouter = Router();

contractCommentsRouter.get('/:id/comments', authenticate, async (req, res) => {
  res.json(await commentService.list(currentUser(req), IdParams.parse(req.params).id));
});

contractCommentsRouter.get('/:id/comment-participants', authenticate, async (req, res) => {
  res.json(await commentService.participants(currentUser(req), IdParams.parse(req.params).id));
});

contractCommentsRouter.post('/:id/comments', authenticate, async (req, res) => {
  const input = z
    .object({
      body: Body,
      clauseKey: z.string().max(100).nullish(),
      parentId: z.uuid().nullish(),
      mentions: z.array(z.uuid()).max(20).optional(),
    })
    .parse(req.body);
  res.status(201).json(await commentService.create(currentUser(req), IdParams.parse(req.params).id, input));
});

/** Mounted under /api/comments. */
export const commentsRouter = Router();
commentsRouter.use(authenticate);

commentsRouter.patch('/:id', async (req, res) => {
  const { body } = z.object({ body: Body }).parse(req.body);
  await commentService.edit(currentUser(req), IdParams.parse(req.params).id, body);
  res.status(204).end();
});

commentsRouter.delete('/:id', async (req, res) => {
  await commentService.remove(currentUser(req), IdParams.parse(req.params).id);
  res.status(204).end();
});

commentsRouter.post('/:id/resolve', async (req, res) => {
  await commentService.setResolved(currentUser(req), IdParams.parse(req.params).id, true);
  res.status(204).end();
});

commentsRouter.post('/:id/reopen', async (req, res) => {
  await commentService.setResolved(currentUser(req), IdParams.parse(req.params).id, false);
  res.status(204).end();
});
