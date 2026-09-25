import type { NotificationType } from '../../generated/prisma/enums.js';
import type { DbClient } from '../../lib/prisma.js';

export interface NotificationMessage {
  type: NotificationType;
  title: string;
  body: string;
  contractId?: string;
  /** Front-end route, e.g. /contracts/<id>?tab=approvals */
  link?: string;
  /**
   * Makes the notification and its email exactly-once per recipient: both are
   * keyed `<dedupeKey>:<userId>`, so re-running the same trigger creates nothing new.
   */
  dedupeKey?: string;
}

/**
 * Sends an in-app notification and queues an email for each recipient, as part
 * of the caller's transaction (transactional outbox). If the state change rolls
 * back, nobody is notified. If it commits, the email job exists and a worker
 * will deliver it even if this process dies a moment later.
 */
export async function notify(tx: DbClient, userIds: Iterable<string>, message: NotificationMessage): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;

  const users = await tx.user.findMany({
    where: { id: { in: recipients }, isActive: true },
    select: { id: true, email: true },
  });
  if (users.length === 0) return;

  await tx.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: message.type,
      title: message.title,
      body: message.body,
      link: message.link,
      contractId: message.contractId,
      dedupeKey: message.dedupeKey ? `${message.dedupeKey}:${u.id}` : null,
    })),
    skipDuplicates: true,
  });
  await tx.job.createMany({
    data: users.map((u) => ({
      type: 'email.send',
      payload: { to: u.email, subject: message.title, text: message.body, link: message.link ?? null },
      dedupeKey: message.dedupeKey ? `${message.dedupeKey}:${u.id}` : null,
    })),
    skipDuplicates: true,
  });
}

export function contractLink(contractId: string, tab?: string): string {
  return `/contracts/${contractId}${tab ? `?tab=${tab}` : ''}`;
}
