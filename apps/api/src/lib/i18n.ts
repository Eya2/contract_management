import type { RequestHandler } from 'express';
import { getRequestContext } from '../common/context/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { FR } from './i18n.fr.js';

/**
 * Server-side messages in English and French.
 *
 * Text the server writes for people (notifications, emails, skip reasons,
 * routing notes, system status reasons) is built as a `Msg`: an English
 * template with {placeholders} plus its parameters. The template is also the
 * key of the French dictionary, the same convention as the web app.
 *
 * Msgs are stored next to their English rendering (`skipReason` and
 * `skipReasonMsg`), and every JSON response is localised on the way out: a
 * field `xxxMsg` replaces `xxx` with the text in the reader's language, taken
 * from the Accept-Language header. Emails use the recipient's saved language.
 */
export type Locale = 'en' | 'fr';
export const LOCALES: readonly Locale[] = ['en', 'fr'];

/** A date param, shown as a calendar date in the reader's language. */
export interface DateParam {
  date: string;
}
/** A number shown with exactly `decimals` decimals, e.g. an amount. */
export interface FixedParam {
  n: number;
  decimals: number;
}
export type Param = string | number | Msg | DateParam | FixedParam;
export interface Msg {
  t: string;
  p?: Record<string, Param>;
}

export function msg(t: string, p?: Record<string, Param>): Msg {
  return p ? { t, p } : { t };
}

/** A calendar date (YYYY-MM-DD or a Date) as a param. */
export function dateParam(d: Date | string): DateParam {
  return { date: typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10) };
}

export function isMsg(v: unknown): v is Msg {
  return typeof v === 'object' && v !== null && typeof (v as Msg).t === 'string' && Object.keys(v).every((k) => k === 't' || k === 'p');
}

const INTL: Record<Locale, string> = { en: 'en-GB', fr: 'fr-FR' };

export function render(m: Msg | string, locale: Locale): string {
  if (typeof m === 'string') return m;
  // enum.X keys name an enum value: French has a word for it, English shows X.
  const fallback = m.t.startsWith('enum.') ? m.t.slice(5) : m.t;
  const template = locale === 'fr' ? (FR[m.t] ?? fallback) : fallback;
  if (!m.p) return template;
  return template.replace(/\{(\w+)\}/g, (whole: string, name: string) => {
    const v = m.p![name];
    if (v === undefined) return whole;
    if (typeof v === 'number') return v.toLocaleString(INTL[locale], { maximumFractionDigits: 2 });
    if (typeof v === 'string') return v;
    if ('decimals' in v) return v.n.toLocaleString(INTL[locale], { minimumFractionDigits: v.decimals, maximumFractionDigits: v.decimals });
    if ('date' in v) return new Date(`${v.date}T00:00:00Z`).toLocaleDateString(INTL[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return render(v, locale);
  });
}

/** A Msg for a Json column (undefined leaves the column null). */
export function asJson(m: Msg | null | undefined): Prisma.InputJsonValue | undefined {
  return m ? (m as unknown as Prisma.InputJsonValue) : undefined;
}

/** An amount with two decimals. */
export function fixed(n: number, decimals = 2): FixedParam {
  return { n, decimals };
}

/** Joins messages with a translated word: "a and b and c". */
export function joinMsgs(parts: Msg[], word: 'and' | 'or'): Msg {
  return parts.slice(1).reduce<Msg>((acc, part) => msg(word === 'and' ? '{a} and {b}' : '{a} or {b}', { a: acc, b: part }), parts[0]!);
}

export function parseLocale(value: string | undefined | null): Locale {
  const first = value?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('fr') ? 'fr' : 'en';
}

/** A user's saved language (anything unknown is English). */
export function localeOf(user: { locale?: string | null }): Locale {
  return user.locale === 'fr' ? 'fr' : 'en';
}

/** The language of the current request (Accept-Language), English by default. */
export function requestLocale(): Locale {
  return getRequestContext()?.locale ?? 'en';
}

/**
 * Replaces every `xxxMsg` field with its text in `locale`, written to `xxx`.
 * Returns a new structure; Dates and other non-plain values are kept as they are.
 */
export function localize(value: unknown, locale: Locale, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => localize(v, locale, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.endsWith('Msg') && k.length > 3) {
      if (isMsg(v)) out[k.slice(0, -3)] = render(v, locale);
      continue; // the Msg itself is an implementation detail
    }
    if (!(k in out)) out[k] = localize(v, locale, depth + 1);
  }
  return out;
}

/** Localises every JSON response (see `localize`). */
export const localizeResponses: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(localize(body, requestLocale()));
  next();
};
