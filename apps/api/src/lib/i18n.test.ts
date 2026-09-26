import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dateParam, fixed, localize, msg, parseLocale, render } from './i18n.js';
import { FR } from './i18n.fr.js';

describe('server messages', () => {
  it('renders templates with nested messages, numbers and dates', () => {
    const m = msg('{ref} {title} ends in {n} days', { ref: 'CTR-1', title: 'Lease', n: 1200 });
    expect(render(m, 'en')).toBe('CTR-1 Lease ends in 1,200 days');
    expect(render(m, 'fr')).toBe('CTR-1 Lease se termine dans 1 200 jours');
    expect(render(msg('It renews automatically on {date} unless you act before then.', { date: dateParam('2026-10-01') }), 'fr')).toBe(
      'Il se renouvelle automatiquement le 1 oct. 2026, sauf action de votre part d’ici là.',
    );
    expect(render(msg('{amount} {currency}', { amount: fixed(8000) , currency: 'EUR' }), 'en')).toBe('8,000.00 EUR');
  });

  it('falls back to English, and shows enum values by name in English', () => {
    expect(render(msg('Something new'), 'fr')).toBe('Something new');
    expect(render(msg('enum.NDA'), 'en')).toBe('NDA');
    expect(render(msg('enum.NDA'), 'fr')).toBe('Confidentialité (NDA)');
  });

  it('reads the language from Accept-Language', () => {
    expect(parseLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(parseLocale('en-GB')).toBe('en');
    expect(parseLocale(undefined)).toBe('en');
  });

  it('localises xxxMsg fields in responses and drops the Msg', () => {
    const body = { items: [{ title: 'Approval needed: CTR-1 Lease', titleMsg: msg('Approval needed: {ref} {title}', { ref: 'CTR-1', title: 'Lease' }), body: 'free text', bodyMsg: null }] };
    expect(localize(body, 'fr')).toEqual({ items: [{ title: 'Approbation requise : CTR-1 Lease', body: 'free text' }] });
  });

  it('has a French entry for every message template in the code', () => {
    const missing: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) return f === 'generated' ? [] : walk(p);
        return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
      });
    for (const file of walk(join(import.meta.dirname, '..'))) {
      const source = readFileSync(file, 'utf8');
      for (const [, raw] of source.matchAll(/\b(?:msg|tr)\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        const key = raw!.replace(/\\n/g, '\n').replace(/\\'/g, "'");
        if (!key.startsWith('enum.') && !(key in FR)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
