import { Component, computed, input } from '@angular/core';

const TINTS = [
  'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
];

/** Initials in a circle, with a stable color per person. */
@Component({
  selector: 'cms-avatar',
  template: `<span class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none" [class]="tint()" [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size() * 0.38">{{ initials() }}</span>`,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(32);
  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
  );
  protected readonly tint = computed(() => {
    let h = 0;
    for (const ch of this.name()) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return TINTS[Math.abs(h) % TINTS.length];
  });
}
