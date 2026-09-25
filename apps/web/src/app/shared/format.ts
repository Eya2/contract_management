import { lang, locale, t } from '../core/i18n';
import type { UserSummary } from '../core/models';

export function fullName(u: Pick<UserSummary, 'firstName' | 'lastName'> | null | undefined): string {
  return u ? `${u.firstName} ${u.lastName}` : t('System');
}

export function money(value: string | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(lang() === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "3 min ago", "2 h ago", "4 days ago", then a date. */
export function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 7 * 86_400) return t('{n} days ago', { n: Math.floor(s / 86_400) });
  return date(iso);
}

/** Acronyms that stay uppercase when an enum value is shown as words. */
const ACRONYMS = new Set(['NDA', 'SLA', 'IP']);

/**
 * An enum value (status, role, type, audit action) as words in the current
 * language: FR has entries like "enum.UNDER_REVIEW"; English is derived.
 */
export function humanize(value: string): string {
  const key = `enum.${value}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (ACRONYMS.has(value)) return value;
  const s = value.replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fileSize(bytes: number): string {
  const unit = lang() === 'fr' ? ['o', 'Ko', 'Mo'] : ['B', 'KB', 'MB'];
  if (bytes < 1024) return `${bytes} ${unit[0]}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ${unit[1]}`;
  return `${(bytes / 1024 / 1024).toFixed(1)} ${unit[2]}`;
}

/** Whole days from today (UTC) to a date-only ISO value; negative once passed. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((new Date(iso).getTime() - today) / 86_400_000);
}
