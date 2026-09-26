import { Component } from '@angular/core';
import { lang, setLang, type Lang } from '../core/i18n';

/** EN / FR switch. The whole interface, dates, amounts and PDF defaults follow it instantly. */
@Component({
  selector: 'cms-lang-switch',
  template: `
    <div class="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 text-xs font-semibold" role="radiogroup" aria-label="Language / Langue">
      @for (o of options; track o.value) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="lang() === o.value"
          [attr.aria-label]="o.name"
          [attr.lang]="o.value"
          class="flex h-8 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:text-ink"
          [class]="lang() === o.value ? 'bg-card text-ink shadow-sm ring-1 ring-line' : ''"
          (click)="choose(o.value)"
        >
          {{ o.label }}
        </button>
      }
    </div>
  `,
})
export class LangSwitch {
  protected readonly lang = lang;
  protected readonly options: { value: Lang; label: string; name: string }[] = [
    { value: 'en', label: 'EN', name: 'English' },
    { value: 'fr', label: 'FR', name: 'Français' },
  ];

  protected choose(l: Lang) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => setLang(l));
    else setLang(l);
  }
}
