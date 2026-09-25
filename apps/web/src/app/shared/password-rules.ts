import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** The password rules the API enforces, shown live while typing. */
export function passwordOk(p: string): boolean {
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

@Component({
  selector: 'cms-password-rules',
  imports: [MatIconModule],
  template: `
    <ul class="mt-1 mb-3 space-y-1 text-xs" aria-live="polite">
      @for (r of rules(); track r.label) {
        <li class="flex items-center gap-1.5 transition-colors" [class]="r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'">
          <mat-icon class="!size-4 !text-[16px]">{{ r.ok ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>{{ r.label }}
        </li>
      }
    </ul>
  `,
})
export class PasswordRules {
  readonly password = input.required<string>();
  protected readonly rules = computed(() => {
    const p = this.password();
    return [
      { label: 'At least 10 characters', ok: p.length >= 10 },
      { label: 'A letter', ok: /[A-Za-z]/.test(p) },
      { label: 'A number', ok: /\d/.test(p) },
    ];
  });
}
