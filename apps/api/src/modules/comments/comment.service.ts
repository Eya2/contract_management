import type { AuthUser } from '../../common/auth/auth-user.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { msg } from '../../lib/i18n.js';
import { publishNow } from '../../lib/live.js';
import { prisma } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { contractVisibilityFilter } from '../contracts/contract-access.js';
import { findVisibleOrThrow } from '../contracts/contract.service.js';
import { notify } from '../notifications/notification.service.js';

/**
 * Discussion on a contract, optionally anchored to a clause.
 *
 * A comment is written on the current version and, when anchored, on a clause
 * of it. Clauses keep their key across versions, so a thread follows its
 * clause into later versions; it is flagged `outdated` once the clause text
 * has changed since. Replies are one level deep (a reply to a reply joins the
 * same thread). Deleting is soft: the thread stays readable around it.
 *
 * Anyone who can see the contract can take part. The owner hears about new
 * threads, participants about replies, and @mentioned people about mentions,
 * each once, through the usual notification settings.
 */

const MAX_EXCERPT = 140;

const author = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

const commentSelect = {
  id: true,
  parentId: true,
  authorId: true,
  author,
  body: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  resolvedAt: true,
  resolvedBy: author,
  clause: { select: { key: true, heading: true, body: true } },
  version: { select: { versionNumber: true } },
} as const;

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(contractId: string) {
  return prisma.comment.findMany({ where: { contractId }, select: commentSelect, orderBy: { createdAt: 'asc' } });
}

const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const excerpt = (text: string) => (text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1)}…` : text);

function present(c: Row, userId: string, isAdmin: boolean) {
  const deleted = c.deletedAt !== null;
  return {
    id: c.id,
    author: c.author,
    body: deleted ? null : c.body,
    deleted,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    versionNumber: c.version.versionNumber,
    canEdit: !deleted && c.authorId === userId,
    canDelete: !deleted && (c.authorId === userId || isAdmin),
  };
}

export const commentService = {
  /** Every thread on the contract (all versions), oldest first, with replies. */
  async list(user: AuthUser, contractId: string) {
    const contract = await findVisibleOrThrow(user, contractId);
    const [rows, current] = await Promise.all([
      loadRows(contractId),
      prisma.contractClause.findMany({
        where: { version: { contractId, versionNumber: contract.currentVersionNumber } },
        select: { key: true, body: true },
      }),
    ]);
    const currentBody = new Map(current.map((c) => [c.key, c.body]));
    const isAdmin = user.role === 'ADMIN';
    const canResolveAny = isAdmin || contract.ownerId === user.id;

    return rows
      .filter((c) => c.parentId === null)
      .map((root) => {
        const replies = rows.filter((r) => r.parentId === root.id);
        const clauseNow = root.clause ? currentBody.get(root.clause.key) : undefined;
        return {
          ...present(root, user.id, isAdmin),
          clause: root.clause ? { key: root.clause.key, heading: root.clause.heading } : null,
          // The clause was rewritten (or removed) since this thread started.
          outdated: root.clause !== null && root.version.versionNumber < contract.currentVersionNumber && clauseNow !== root.clause.body,
          resolvedAt: root.resolvedAt,
          resolvedBy: root.resolvedBy,
          canResolve: canResolveAny || root.authorId === user.id,
          replies: replies.map((r) => present(r, user.id, isAdmin)),
        };
      });
  },

  /** People who can see the contract, for @mentions. */
  async participants(user: AuthUser, contractId: string) {
    await findVisibleOrThrow(user, contractId);
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, departmentId: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
    });
    const visible = await Promise.all(users.map((u) => canSee(u, contractId)));
    return users.filter((_, i) => visible[i]).map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email }));
  },

  async create(user: AuthUser, contractId: string, input: { body: string; clauseKey?: string | null; parentId?: string | null; mentions?: string[] }) {
    const contract = await findVisibleOrThrow(user, contractId);
    const body = input.body.trim();
    if (!body) throw new BadRequestError('A comment can’t be empty');

    const created = await prisma.$transaction(async (tx) => {
      let versionId: string;
      let clauseId: string | null = null;
      let clauseHeading: string | null = null;
      let rootId: string | null = null;

      if (input.parentId) {
        const parent = await tx.comment.findFirst({
          where: { id: input.parentId, contractId },
          select: { id: true, parentId: true, versionId: true, clauseId: true, clause: { select: { heading: true } } },
        });
        if (!parent) throw new NotFoundError('Comment');
        rootId = parent.parentId ?? parent.id; // one level of replies
        const root = rootId === parent.id ? parent : await tx.comment.findUniqueOrThrow({
          where: { id: rootId },
          select: { id: true, parentId: true, versionId: true, clauseId: true, clause: { select: { heading: true } } },
        });
        versionId = root.versionId;
        clauseId = root.clauseId;
        clauseHeading = root.clause?.heading ?? null;
      } else {
        const version = await tx.contractVersion.findUniqueOrThrow({
          where: { contractId_versionNumber: { contractId, versionNumber: contract.currentVersionNumber } },
          select: { id: true },
        });
        versionId = version.id;
        if (input.clauseKey) {
          const clause = await tx.contractClause.findUnique({ where: { versionId_key: { versionId, key: input.clauseKey } }, select: { id: true, heading: true } });
          if (!clause) throw new BadRequestError('This clause is not in the current version');
          clauseId = clause.id;
          clauseHeading = clause.heading;
        }
      }

      const comment = await tx.comment.create({
        data: { contractId, versionId, clauseId, parentId: rootId, authorId: user.id, body },
        select: { id: true },
      });
      await recordAudit(
        { action: 'COMMENT_CREATED', entityType: 'comment', entityId: comment.id, contractId, metadata: { clause: clauseHeading, reply: rootId !== null } },
        tx,
      );

      // Who hears about it: mentioned people first, then thread participants
      // (replies) or the owner (new threads). Nobody is told twice, nor about their own comment.
      const me = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { firstName: true, lastName: true } });
      const who = name(me);
      const ref = { ref: contract.referenceNumber, title: contract.title };
      const link = `/contracts/${contractId}?tab=overview&comment=${rootId ?? comment.id}`;
      const text = excerpt(body);
      const told = new Set<string>([user.id]);

      const mentionIds = [...new Set(input.mentions ?? [])].filter((id) => !told.has(id));
      const mentioned: string[] = [];
      for (const id of mentionIds) {
        const u = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, departmentId: true, email: true, isActive: true } });
        if (u?.isActive && (await canSee(u, contractId))) mentioned.push(u.id);
      }
      if (mentioned.length) {
        await notify(tx, mentioned, {
          type: 'COMMENT_MENTION',
          title: msg('{who} mentioned you on {ref} {title}', { who, ...ref }),
          body: text,
          contractId,
          link,
        });
        mentioned.forEach((id) => told.add(id));
      }

      if (rootId) {
        const thread = await tx.comment.findMany({ where: { OR: [{ id: rootId }, { parentId: rootId }], deletedAt: null }, select: { authorId: true } });
        const participants = [...new Set(thread.map((c) => c.authorId))].filter((id) => !told.has(id));
        if (participants.length) {
          await notify(tx, participants, {
            type: 'COMMENT_REPLY',
            title: msg('{who} replied on {ref} {title}', { who, ...ref }),
            body: text,
            contractId,
            link,
          });
        }
      } else if (!told.has(contract.ownerId)) {
        await notify(tx, [contract.ownerId], {
          type: 'COMMENT_ADDED',
          title: clauseHeading ? msg('{who} commented on "{clause}" in {ref} {title}', { who, clause: clauseHeading, ...ref }) : msg('{who} commented on {ref} {title}', { who, ...ref }),
          body: text,
          contractId,
          link,
        });
      }
      return comment.id;
    });
    return { id: created };
  },

  async edit(user: AuthUser, commentId: string, body: string) {
    const c = await visibleComment(user, commentId);
    if (c.authorId !== user.id) throw new ForbiddenError('Only the author can edit a comment');
    if (c.deletedAt) throw new BadRequestError('This comment was deleted');
    if (!body.trim()) throw new BadRequestError('A comment can’t be empty');
    await prisma.comment.update({ where: { id: commentId }, data: { body: body.trim(), editedAt: new Date() } });
    publishNow({ kind: 'contract', contractId: c.contractId });
  },

  async remove(user: AuthUser, commentId: string) {
    const c = await visibleComment(user, commentId);
    if (c.authorId !== user.id && user.role !== 'ADMIN') throw new ForbiddenError('Only the author or an admin can delete a comment');
    if (c.deletedAt) return;
    await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    publishNow({ kind: 'contract', contractId: c.contractId });
  },

  /** Resolves (or reopens) a thread: its author, the contract owner or an admin. */
  async setResolved(user: AuthUser, commentId: string, resolved: boolean) {
    const c = await visibleComment(user, commentId);
    if (c.parentId) throw new BadRequestError('Resolve the thread, not a reply');
    if (c.authorId !== user.id && c.contract.ownerId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenError('Only the thread’s author, the contract owner or an admin can resolve it');
    }
    await prisma.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: commentId },
        data: resolved ? { resolvedAt: new Date(), resolvedById: user.id } : { resolvedAt: null, resolvedById: null },
      });
      await recordAudit({ action: 'COMMENT_RESOLVED', entityType: 'comment', entityId: commentId, contractId: c.contractId, metadata: { resolved } }, tx);
    });
  },
};

/** A comment on a contract the user can see (anything else is a 404). */
async function visibleComment(user: AuthUser, commentId: string) {
  const c = await prisma.comment.findFirst({
    where: { id: commentId, contract: contractVisibilityFilter(user) },
    select: { id: true, parentId: true, authorId: true, deletedAt: true, contractId: true, contract: { select: { ownerId: true } } },
  });
  if (!c) throw new NotFoundError('Comment');
  return c;
}

async function canSee(u: { id: string; email: string; role: AuthUser['role']; departmentId: string }, contractId: string) {
  const n = await prisma.contract.count({ where: { AND: [{ id: contractId }, contractVisibilityFilter({ id: u.id, email: u.email, role: u.role, departmentId: u.departmentId })] } });
  return n > 0;
}
