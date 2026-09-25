import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { ContractStatus } from '@cms/shared';

/**
 * Temporary placeholder that proves the stack is wired up (Material theme,
 * Tailwind utilities, @cms/shared import). Replaced by the real dashboard later.
 */
@Component({
  selector: 'cms-dashboard-page',
  imports: [MatButtonModule, MatChipsModule],
  template: `
    <main class="mx-auto max-w-4xl px-6 py-16">
      <p class="text-sm font-semibold tracking-wide text-brand-600 uppercase">Contract Hub</p>
      <h1 class="mt-2 text-3xl font-bold text-ink">Stack is up and running</h1>
      <p class="mt-3 text-muted">Angular Material + Tailwind + shared domain types.</p>
      <mat-chip-set class="mt-6 block">
        @for (status of statuses; track status) {
          <mat-chip>{{ status }}</mat-chip>
        }
      </mat-chip-set>
      <button mat-flat-button class="mt-8">Primary action</button>
    </main>
  `,
})
export class DashboardPage {
  protected readonly statuses = Object.values(ContractStatus);
}
