import { Pipe, signal, type PipeTransform } from '@angular/core';
import { FR } from './i18n.fr';

/**
 * Runtime translation (English / French), switchable without a reload.
 *
 * Keys are the English text itself: templates stay readable, English needs no
 * dictionary, and a missing French entry falls back to English instead of
 * showing a key. Placeholders use {name}: t('Version {n}', { n: 2 }).
 *
 * The choice is a per-browser preference in localStorage (guarded), defaulting
 * to the browser's language. Dates, numbers and currencies follow it too, and
 * so does the default language of contract PDFs.
 */
export type Lang = 'en' | 'fr';

const KEY = 'cms-lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    /* storage unavailable: fall through */
  }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const lang = signal<Lang>(initial());
document.documentElement.lang = lang();

export function setLang(l: Lang) {
  lang.set(l);
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the choice lasts for this page only */
  }
}

/** The BCP 47 locale for Intl formatting. */
export function locale(): string {
  return lang() === 'fr' ? 'fr-FR' : 'en-GB';
}

export function t(key: string, params?: Record<string, string | number | null | undefined>): string {
  const text = lang() === 'fr' ? (FR[key] ?? key) : key;
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (params[name] ?? m).toString()) : text;
}

/**
 * `{{ 'Contracts' | t }}`. Impure so it re-runs when the language changes; the
 * lookup is a single map read.
 */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  transform(key: string | null | undefined, params?: Record<string, string | number | null | undefined>): string {
    return key ? t(key, params) : '';
  }
}
