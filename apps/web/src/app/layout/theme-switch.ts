import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService, type ThemePreference } from '../core/theme.service';

/** Segmented light / dark / system switch. */
@Component({
  selector: 'cms-theme-switch',
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <div class="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1" role="radiogroup" aria-label="Color theme">
      @for (o of options; track o.value) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="theme.preference() === o.value"
          [matTooltip]="o.label"
          [attr.aria-label]="o.label"
          class="flex h-8 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:text-ink"
          [class]="theme.preference() === o.value ? '!bg-card !text-ink shadow-sm ring-1 ring-line' : ''"
          (click)="theme.set(o.value)"
        >
          <mat-icon class="!size-[18px] !text-[18px]">{{ o.icon }}</mat-icon>
        </button>
      }
    </div>
  `,
})
export class ThemeSwitch {
  protected readonly theme = inject(ThemeService);
  protected readonly options: { value: ThemePreference; icon: string; label: string }[] = [
    { value: 'light', icon: 'light_mode', label: 'Light' },
    { value: 'dark', icon: 'dark_mode', label: 'Dark' },
    { value: 'system', icon: 'contrast', label: 'Match system' },
  ];
}
