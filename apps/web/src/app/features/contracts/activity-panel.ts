import { Component, inject, input, resource } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { Api } from '../../core/api.service';
import { dateTime, fullName, humanize } from '../../shared/format';
import { StatusBadge } from '../../shared/status-badge';

/** The business timeline for everyone, plus the security audit trail for Legal and Admin. */
@Component({
  selector: 'cms-activity-panel',
  imports: [StatusBadge],
  template: `
    <div class="grid gap-6 lg:grid-cols-2">
      <section class="card p-5">
        <h3 class="mb-4 font-semibold">Status timeline</h3>
        <ol class="space-y-4">
          @for (t of timeline.value(); track t.id) {
            <li class="flex gap-3">
              <span class="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500"></span>
              <div class="text-sm">
                <p class="flex flex-wrap items-center gap-2">
                  @if (t.fromStatus) {
                    <cms-status [status]="t.fromStatus" /> →
                  }
                  <cms-status [status]="t.toStatus" />
                </p>
                <p class="mt-1 text-xs text-muted">{{ fullName(t.actor) }} · {{ dateTime(t.createdAt) }}</p>
                @if (t.reason) {
                  <p class="mt-1 text-body">{{ t.reason }}</p>
                }
              </div>
            </li>
          }
        </ol>
      </section>

      @if (canAudit) {
        <section class="card p-5">
          <h3 class="mb-4 font-semibold">Audit trail <span class="text-xs font-normal text-muted">(append-only)</span></h3>
          <ul class="divide-y divide-line-soft text-sm">
            @for (e of audit.value()?.items; track e.id) {
              <li class="py-2">
                <p><span class="font-medium">{{ humanize(e.action) }}</span><span class="text-muted">&nbsp;by {{ fullName(e.user) }}</span></p>
                <p class="text-xs text-muted">{{ dateTime(e.createdAt) }}{{ e.ipAddress ? ' · ' + e.ipAddress : '' }}</p>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class ActivityPanel {
  private readonly api = inject(Api);
  readonly contractId = input.required<string>();
  /** Bumped by the parent after any change, so the lists reload. */
  readonly revision = input(0);
  protected readonly canAudit = inject(AuthService).can('audit.read');
  protected readonly timeline = resource({
    params: () => ({ id: this.contractId(), r: this.revision() }),
    loader: ({ params }) => this.api.timeline(params.id),
  });
  protected readonly audit = resource({
    params: () => (this.canAudit ? { id: this.contractId(), r: this.revision() } : undefined),
    loader: ({ params }) => this.api.contractAudit(params.id),
  });
  protected readonly fullName = fullName;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;
}
