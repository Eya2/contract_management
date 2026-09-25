import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../common/middleware/authenticate.js';
import { NotFoundError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';

/** The in-app bell. Users only ever see and change their own notifications. */
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const ListQuery = z.object({
  unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Cursor: return notifications older than this one. */
  before: z.uuid().optional(),
});

const select = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  contractId: true,
  readAt: true,
  createdAt: true,
} as const;

notificationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const { unreadOnly, limit, before } = ListQuery.parse(req.query);
  const cursor = before
    ? await prisma.notification.findFirst({ where: { id: before, userId: user.id }, select: { createdAt: true } })
    : null;
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}),
      },
      select,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  res.json({ items, unreadCount });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ unreadCount: await prisma.notification.count({ where: { userId: currentUser(req).id, readAt: null } }) });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: currentUser(req).id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ marked: count });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  const user = currentUser(req);
  // Scoped by user: someone else's notification id behaves as if it didn't exist.
  const { count } = await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { readAt: new Date() },
  });
  if (count === 0) throw new NotFoundError('Notification');
  res.status(204).end();
});
