import type { UserSummary } from '../core/models';

export function fullName(u: Pick<UserSummary, 'firstName' | 'lastName'> | null | undefined): string {
  return u ? `${u.firstName} ${u.lastName}` : 'System';
}

export function money(value: string | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "3 min ago", "2 h ago", "4 days ago", then a date. */
export function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} days ago`;
  return date(iso);
}

/** Acronyms that stay uppercase when an enum value is shown as words. */
const ACRONYMS = new Set(['NDA', 'SLA', 'IP']);

export function humanize(value: string): string {
  if (ACRONYMS.has(value)) return value;
  const s = value.replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
