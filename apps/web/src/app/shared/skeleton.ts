import { Component, input } from '@angular/core';
import { TPipe } from '../core/i18n';

/** Shimmering placeholder rows shown while data loads. */
@Component({
  imports: [TPipe],
  selector: 'cms-skeleton',
  template: `
    <div class="space-y-3 p-5" aria-busy="true" [attr.aria-label]="'Loading' | t">
      @for (r of rowsArray(); track $index) {
        <div class="flex items-center gap-4">
          <div class="skeleton size-9 shrink-0 rounded-full"></div>
          <div class="flex-1 space-y-2">
            <div class="skeleton h-3" [style.width.%]="60 - ($index % 3) * 12"></div>
            <div class="skeleton h-2.5 w-1/3"></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class Skeleton {
  readonly rows = input(4);
  protected rowsArray() {
    return Array.from({ length: this.rows() });
  }
}
