import { Component, inject, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Api } from '../../core/api.service';
import { Toast } from '../../core/toast.service';
import { EmptyState } from '../../shared/empty-state';
import { ago, dateTime } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';

const STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  COMPLETED: { label: 'Sent', cls: 'text-emerald-600 dark:text-emerald-400', icon: 'check_circle' },
  PENDING: { label: 'Queued', cls: 'text-amber-600 dark:text-amber-400', icon: 'schedule' },
  RUNNING: { label: 'Sending', cls: 'text-sky-600 dark:text-sky-400', icon: 'sync' },
  FAILED: { label: 'Failed', cls: 'text-rose-600 dark:text-rose-400', icon: 'error' },
};

/** Where did the emails go? The outbox, with errors and a retry button. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, PageHeader, Skeleton, EmptyState],
  template: `
    <cms-page-header eyebrow="Administration" title="Email delivery" subtitle="Every email the app sends (approvals, signing links, reminders, password resets) and what happened to it.">
      <button mat-stroked-button (click)="data.reload()"><mat-icon>refresh</mat-icon>Refresh</button>
      <button mat-flat-button [disabled]="busy() || !((data.value()?.counts?.FAILED ?? 0) + (data.value()?.counts?.PENDING ?? 0))" (click)="retry()"><mat-icon>send</mat-icon>Retry failed &amp; queued</button>
    </cms-page-header>

    @if (data.value(); as d) {
      <div class="mb-6 grid gap-4 md:grid-cols-4">
        <section class="card stagger p-5 md:col-span-2">
          <div class="flex items-start gap-3">
            <span class="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"><mat-icon>dns</mat-icon></span>
            <div class="min-w-0 flex-1">
              <p class="text-xs text-muted">Mail server</p>
              <p class="font-mono text-sm font-medium text-ink">{{ d.smtp.host }}:{{ d.smtp.port }}</p>
              <p class="mt-1 text-xs text-muted">
                @if (d.smtp.authenticated) {
                  Real delivery (authenticated SMTP).
                } @else if (d.smtp.host === 'localhost') {
                  Local test inbox (Mailpit). Emails appear at <a class="text-accent underline" href="http://localhost:8025" target="_blank" rel="noopener">localhost:8025</a> and never reach real people.
                } @else {
                  SMTP without authentication.
                }
              </p>
            </div>
          </div>
        </section>
        @for (s of ['COMPLETED', 'FAILED']; track s; let i = $index) {
          <section class="card stagger p-5" [style.--i]="i + 1">
            <p class="flex items-center gap-1.5 text-sm text-muted"><mat-icon class="!size-4 !text-[16px]" [class]="status[s]!.cls">{{ status[s]!.icon }}</mat-icon>{{ status[s]!.label }}</p>
            <p class="mt-2 text-3xl font-semibold text-ink tabular-nums">{{ count(s) }}</p>
            @if (s === 'FAILED' && d.counts.PENDING) {
              <p class="mt-1 text-xs text-muted">{{ d.counts.PENDING }} queued</p>
            }
          </section>
        }
      </div>

      <div class="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-subtle p-1 sm:w-fit">
        @for (f of filters; track f.value) {
          <button class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted transition-all" [class]="filter() === f.value ? '!bg-card !text-ink shadow-sm ring-1 ring-line' : ''" (click)="filter.set(f.value)">{{ f.label }}</button>
        }
      </div>

      <div class="card overflow-hidden">
        <ul class="divide-y divide-line-soft">
          @for (j of d.items; track j.id; let i = $index) {
            <li class="stagger flex flex-wrap items-start gap-4 px-5 py-3.5" [style.--i]="i">
              <mat-icon class="mt-0.5" [class]="status[j.status]!.cls" [matTooltip]="status[j.status]!.label">{{ status[j.status]!.icon }}</mat-icon>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-ink">{{ j.subject }}</p>
                <p class="text-xs text-muted">to {{ j.to }} · {{ ago(j.createdAt) }}</p>
                @if (j.lastError) {
                  <p class="mt-1 rounded-md bg-rose-50 px-2 py-1 font-mono text-[11px] text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">{{ j.lastError }}</p>
                }
              </div>
              <div class="text-right text-xs text-muted">
                @if (j.status === 'COMPLETED') {
                  <p>Sent {{ dateTime(j.completedAt) }}</p>
                } @else if (j.status === 'PENDING') {
                  <p>Next try {{ dateTime(j.runAt) }}</p>
                }
                <p>Attempt {{ j.attempts }}/{{ j.maxAttempts }}</p>
              </div>
            </li>
          } @empty {
            <cms-empty icon="outgoing_mail" title="No emails here" />
          }
        </ul>
      </div>
    } @else {
      <div class="card"><cms-skeleton /></div>
    }
  `,
})
export class EmailsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly filter = signal<string | undefined>(undefined);
  protected readonly data = resource({ params: () => ({ f: this.filter() }), loader: ({ params }) => this.api.emails(params.f) });
  protected readonly busy = signal(false);
  protected readonly status = STATUS;
  protected readonly ago = ago;
  protected readonly dateTime = dateTime;
  protected readonly filters = [
    { value: undefined, label: 'All' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'PENDING', label: 'Queued' },
    { value: 'COMPLETED', label: 'Sent' },
  ];

  protected count(status: string) {
    return (this.data.value()?.counts as Record<string, number> | undefined)?.[status] ?? 0;
  }

  protected async retry() {
    this.busy.set(true);
    try {
      const { retried } = await this.api.retryEmails();
      this.toast.success(`${retried} email${retried === 1 ? '' : 's'} queued again`);
      setTimeout(() => this.data.reload(), 6000);
      this.data.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
