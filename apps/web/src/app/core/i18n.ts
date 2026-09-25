import { Pipe, signal, type PipeTransform } from '@angular/core';
import { FR } from './i18n.fr';

/**
 * Runtime translation (English / French), switchable without a reload.
 *
 * Keys are the English text itself: templates stay readable, English needs no
 * dictionary, and a missing French entry falls back to English instead of
 * showing a key. Placeholders use {name}: t('Version {n}', { n: 2 }).
 *
 * The French dictionary is not written yet, so the interface is English-only
 * for now: `initial()` always returns 'en' and there is no language switcher.
 * Adding French means filling i18n.fr.ts and restoring the switcher; every
 * template already goes through `t`. (Contract PDFs are already bilingual.)
 */
export type Lang = 'en' | 'fr';

function initial(): Lang {
  return 'en';
}

export const lang = signal<Lang>(initial());
document.documentElement.lang = lang();

export function setLang(l: Lang) {
  lang.set(l);
  document.documentElement.lang = l;
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
