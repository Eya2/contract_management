/**
 * One-off: attaches translatable messages to text stored before server
 * messages were translated (notifications, skip reasons, routing notes, status
 * reasons), so existing data shows up in French too. Rows it can't recognise
 * keep their English text. Safe to run more than once.
 *
 *   npm run db:backfill-messages -w apps/api
 */
import { fixed, msg, type Msg, type Param } from '../src/lib/i18n.js';
import { FR } from '../src/lib/i18n.fr.js';
import { prisma } from '../src/lib/prisma.js';
import type { Prisma } from '../src/generated/prisma/client.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** English templates with placeholders, most specific (longest literal text) first. */
const TEMPLATES = Object.keys(FR)
  .filter((t) => t.includes('{') && !t.startsWith('{a}') && t !== '({a})' && t !== 'NOT {a}')
  .map((t) => {
    const names: string[] = [];
    const pattern = t
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(m[1]!);
        return '([\\s\\S]+?)';
      })
      .join('');
    return { t, names, re: new RegExp(`^${pattern}$`), literal: t.replace(/\{\w+\}/g, '').length };
  })
  // Templates made only of placeholders ("{field} {op} {expected}") would match any text.
  .filter((x) => x.t.replace(/\{\w+\}/g, '').replace(/[\s:,.()"«»]/g, '').length >= 4)
  .sort((a, b) => b.literal - a.literal);

const WORDS = new Set(['admin', 'Admin', 'Legal', 'Finance', 'Manager', 'Employee']);

function param(name: string, value: string): Param {
  if (ISO_DATE.test(value)) return { date: value };
  if (name === 'n' && /^\d+$/.test(value)) return Number(value);
  if ((name === 'label' || name === 'role') && WORDS.has(value)) return msg(value);
  if (name === 'label') return fromTemplate(value) ?? value;
  return value;
}

function fromTemplate(text: string): Msg | null {
  if (!text.includes(' ') && WORDS.has(text)) return msg(text);
  if (!text.includes('{') && text in FR && !TEMPLATES.some((x) => x.t === text)) return msg(text);
  for (const { t, names, re } of TEMPLATES) {
    const m = re.exec(text);
    if (m) return msg(t, Object.fromEntries(names.map((n, i) => [n, param(n, m[i + 1]!)])));
  }
  return null;
}

const OPS = new Set(['>', '≥', '<', '≤', '=', '≠', 'one of']);

/** "value 8,000.00 USD is not > 10,000 and type VENDOR is = VENDOR, so the step is required" */
function fromSkipReason(text: string): Msg | null {
  let body = text;
  let required = false;
  if (body.endsWith(', so the step is required')) {
    body = body.slice(0, -', so the step is required'.length);
    required = true;
  }
  const parts: Msg[] = [];
  for (const piece of body.split(' and ')) {
    const unset = /^(\w+) is not set$/.exec(piece);
    if (unset) {
      parts.push(msg('{field} is not set', { field: msg(unset[1]!) }));
      continue;
    }
    const m = /^(\w+) (.+?) (is not|is) (one of|[>≥<≤=≠]) (.+)$/.exec(piece);
    if (!m || !OPS.has(m[4]!)) return null;
    const [, field, actual, is, op, expected] = m as unknown as [string, string, string, string, string, string];
    const money = /^([\d,]+\.\d{2}) (\w{3})$/.exec(actual);
    const num = (s: string): Param => (/^-?[\d,]+(\.\d+)?$/.test(s) ? Number(s.replaceAll(',', '')) : s);
    parts.push(
      msg(is === 'is' ? '{field} {actual} is {op} {expected}' : '{field} {actual} is not {op} {expected}', {
        field: msg(field),
        actual: money ? msg('{amount} {currency}', { amount: fixed(Number(money[1]!.replaceAll(',', ''))), currency: money[2]! }) : num(actual),
        op: op === 'one of' ? msg('one of') : op,
        expected: num(expected),
      }),
    );
  }
  const joined = parts.slice(1).reduce<Msg>((a, b) => msg('{a} and {b}', { a, b }), parts[0]!);
  return required ? msg('{reason}, so the step is required', { reason: joined }) : joined;
}

const json = (m: Msg) => m as unknown as Prisma.InputJsonValue;

async function main() {
  let count = 0;

  const notifications = await prisma.notification.findMany({ select: { id: true, title: true, body: true, titleMsg: true, bodyMsg: true } });
  for (const n of notifications) {
    const titleMsg = n.titleMsg ? null : fromTemplate(n.title);
    const bodyMsg = n.bodyMsg ? null : fromTemplate(n.body);
    if (!titleMsg && !bodyMsg) continue;
    await prisma.notification.update({
      where: { id: n.id },
      data: { ...(titleMsg ? { titleMsg: json(titleMsg) } : {}), ...(bodyMsg ? { bodyMsg: json(bodyMsg) } : {}) },
    });
    count++;
  }

  const steps = await prisma.approvalStep.findMany({
    where: { OR: [{ skipReason: { not: null } }, { routingNote: { not: null } }] },
    select: { id: true, skipReason: true, routingNote: true, skipReasonMsg: true, routingNoteMsg: true },
  });
  for (const s of steps) {
    const skipReasonMsg = s.skipReason && !s.skipReasonMsg ? fromSkipReason(s.skipReason) : null;
    const routingNoteMsg = s.routingNote && !s.routingNoteMsg ? fromTemplate(s.routingNote) : null;
    if (!skipReasonMsg && !routingNoteMsg) continue;
    await prisma.approvalStep.update({
      where: { id: s.id },
      data: { ...(skipReasonMsg ? { skipReasonMsg: json(skipReasonMsg) } : {}), ...(routingNoteMsg ? { routingNoteMsg: json(routingNoteMsg) } : {}) },
    });
    count++;
  }

  const changes = await prisma.contractStatusChange.findMany({ where: { reason: { not: null } }, select: { id: true, reason: true, reasonMsg: true } });
  for (const c of changes) {
    if (c.reasonMsg) continue;
    const reasonMsg = fromTemplate(c.reason!);
    if (!reasonMsg) continue;
    await prisma.contractStatusChange.update({ where: { id: c.id }, data: { reasonMsg: json(reasonMsg) } });
    count++;
  }

  console.log(`Attached messages to ${count} rows.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
