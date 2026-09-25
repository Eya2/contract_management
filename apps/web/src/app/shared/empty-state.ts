import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'cms-empty',
  imports: [MatIconModule],
  template: `
    <div class="flex animate-fade flex-col items-center px-6 py-12 text-center">
      <span class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
        <mat-icon class="!size-7 !text-[28px]">{{ icon() }}</mat-icon>
      </span>
      <p class="font-medium text-ink">{{ title() }}</p>
      @if (text()) {
        <p class="mt-1 max-w-sm text-sm text-muted">{{ text() }}</p>
      }
      <div class="mt-4"><ng-content /></div>
    </div>
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly text = input<string>();
}
