import { Component, input } from '@angular/core';

/** Title row of a page: eyebrow, title, subtitle, and projected actions on the right. */
@Component({
  selector: 'cms-page-header',
  template: `
    <header class="mb-6 flex animate-rise flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div class="min-w-0">
        @if (eyebrow()) {
          <p class="mb-1 text-xs font-semibold tracking-[0.12em] text-accent uppercase">{{ eyebrow() }}</p>
        }
        <h1 class="text-2xl font-semibold sm:text-[28px]">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
        }
      </div>
      <div class="flex flex-wrap items-center gap-2"><ng-content /></div>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly eyebrow = input<string>();
}
