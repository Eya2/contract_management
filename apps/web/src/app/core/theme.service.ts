import { DestroyRef, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'cms-theme';

/**
 * Light / dark / follow-the-system. The choice is a per-browser convenience,
 * kept in localStorage (guarded: storage can be unavailable), and applied as a
 * `dark` class on <html> that drives both Tailwind tokens and Material.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(read());
  readonly isDark = signal(document.documentElement.classList.contains('dark'));
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    const onSystemChange = () => this.apply();
    this.media.addEventListener('change', onSystemChange);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', onSystemChange));
    this.apply();
  }

  set(pref: ThemePreference) {
    this.preference.set(pref);
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    this.apply(true);
  }

  /** Cycles light → dark → system, for a single toggle button. */
  cycle() {
    const order: ThemePreference[] = ['light', 'dark', 'system'];
    this.set(order[(order.indexOf(this.preference()) + 1) % order.length]!);
  }

  private apply(animate = false) {
    const pref = this.preference();
    const dark = pref === 'dark' || (pref === 'system' && this.media.matches);
    const root = document.documentElement;
    const update = () => {
      root.classList.toggle('dark', dark);
      this.isDark.set(dark);
    };
    // A soft cross-fade when the user switches, where the browser supports it.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (animate && doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(update);
    } else {
      update();
    }
  }
}

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}
