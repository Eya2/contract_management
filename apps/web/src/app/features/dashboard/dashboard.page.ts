import { Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ContractStatus } from '@cms/shared';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CountUp } from '../../shared/count-up';
import { EmptyState } from '../../shared/empty-state';
import { date, daysUntil, humanize, money } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { StatusBadge } from '../../shared/status-badge';

const BAR: Record<string, string> = {
  DRAFT: 'bg-slate-400',
  SUBMITTED: 'bg-sky-500',
  UNDER_REVIEW: 'bg-amber-500',
  APPROVED: 'bg-emerald-400',
  REJECTED: 'bg-rose-500',
  SIGNED: 'bg-teal-500',
  ACTIVE: 'bg-emerald-600',
  EXPIRED: 'bg-orange-500',
  RENEWED: 'bg-violet-500',
  TERMINATED: 'bg-zinc-500',
};

@Component({
  imports: [RouterLink, MatButtonModule, MatIconModule, StatusBadge, PageHeader, CountUp, Skeleton, EmptyState],
  template: `
    <cms-page-header [eyebrow]="today" [title]="'Good ' + greeting() + ', ' + (auth.user()?.firstName ?? '')" subtitle="Here is what needs your attention today.">
      @if (auth.can('contract.create')) {
        <a mat-flat-button routerLink="/contracts/new"><mat-icon>add</mat-icon>New contract</a>
      }
    </cms-page-header>

    @if (data.error()) {
      <div class="callout tone-danger"><mat-icon>error</mat-icon>Could not load the dashboard.</div>
    }

    <section class="grid grid-cols-2 gap-4 xl:grid-cols-4">
      @for (card of cards(); track card.label; let i = $index) {
        <a [routerLink]="card.link" [queryParams]="card.query" class="card card-interactive stagger group relative overflow-hidden p-5" [style.--i]="i">
          <div class="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-100" [class]="card.glow"></div>
          <div class="relative flex items-start justify-between">
            <span class="text-sm font-medium text-muted">{{ card.label }}</span>
            <span class="flex size-10 items-center justify-center rounded-xl" [class]="card.tone"><mat-icon>{{ card.icon }}</mat-icon></span>
          </div>
          <p class="relative mt-4 text-4xl font-semibold tracking-tight text-ink tabular-nums" [cmsCountUp]="card.value"></p>
          <p class="relative mt-1 flex items-center gap-1 text-xs text-muted">
            {{ card.hint }}<mat-icon class="!size-3.5 !text-[14px] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100">arrow_forward</mat-icon>
          </p>
        </a>
      } @empty {
        @for (i of [0, 1, 2, 3]; track i) {
          <div class="card h-36 p-5"><div class="skeleton h-3 w-1/2"></div><div class="skeleton mt-6 h-8 w-1/3"></div></div>
        }
      }
    </section>

    <div class="mt-6 grid gap-6 xl:grid-cols-3">
      <section class="card stagger overflow-hidden xl:col-span-2" style="--i: 4">
        <header class="flex items-center justify-between border-b border-line-soft px-5 py-4">
          <h2 class="font-semibold">Recently updated</h2>
          <a routerLink="/contracts" class="text-sm font-medium text-accent hover:underline">View all</a>
        </header>
        @if (data.isLoading() && !data.value()) {
          <cms-skeleton [rows]="5" />
        }
        <ul class="divide-y divide-line-soft">
          @for (c of data.value()?.recent; track c.id; let i = $index) {
            <li class="stagger" [style.--i]="i + 5">
              <a [routerLink]="['/contracts', c.id]" class="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-subtle">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted"><mat-icon>{{ typeIcon(c.type) }}</mat-icon></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-ink">{{ c.title }}</p>
                  <p class="truncate text-xs text-muted">{{ c.referenceNumber }} · {{ c.counterparty.name }}</p>
                </div>
                <span class="hidden text-sm text-body tabular-nums sm:block">{{ money(c.value, c.currency) }}</span>
                <cms-status [status]="c.status" />
              </a>
            </li>
          } @empty {
            @if (!data.isLoading()) {
              <cms-empty icon="description" title="No contracts yet" text="Create your first contract to get started." />
            }
          }
        </ul>
      </section>

      <div class="space-y-6">
        <section class="card stagger p-5" style="--i: 5">
          <h2 class="font-semibold">Portfolio</h2>
          <p class="text-xs text-muted">{{ total() }} contracts you can see</p>
          <div class="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-subtle" role="img" [attr.aria-label]="'Status distribution of ' + total() + ' contracts'">
            @for (s of distribution(); track s.status) {
              <div class="h-full origin-left animate-[rise_0.6s_ease-out_both] transition-all first:rounded-l-full last:rounded-r-full" [style.width.%]="s.pct" [class]="s.bar" [title]="s.label + ': ' + s.count"></div>
            }
          </div>
          <ul class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            @for (s of distribution(); track s.status) {
              <li>
                <a routerLink="/contracts" [queryParams]="{ status: s.status }" class="flex items-center gap-2 rounded-md hover:text-ink">
                  <span class="size-2 rounded-full" [class]="s.bar"></span>
                  <span class="flex-1 text-muted">{{ s.label }}</span>
                  <span class="font-medium text-ink tabular-nums">{{ s.count }}</span>
                </a>
              </li>
            }
          </ul>
        </section>

        <section class="card stagger overflow-hidden" style="--i: 6">
          <header class="flex items-center gap-2 border-b border-line-soft px-5 py-4">
            <mat-icon class="text-seal-500">event_upcoming</mat-icon>
            <h2 class="font-semibold">Ending in {{ data.value()?.expiryWindowDays ?? 30 }} days</h2>
          </header>
          <ul class="divide-y divide-line-soft">
            @for (c of data.value()?.expiringSoon; track c.id) {
              <li>
                <a [routerLink]="['/contracts', c.id]" class="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-ink">{{ c.title }}</p>
                    <p class="text-xs text-muted">{{ c.autoRenew ? 'Renews automatically' : 'Needs a renewal decision' }}</p>
                  </div>
                  <span class="rounded-lg px-2 py-1 text-xs font-semibold tabular-nums" [class]="urgency(c.endDate)">{{ daysLabel(c.endDate) }}</span>
                </a>
              </li>
            } @empty {
              <li class="px-5 py-8 text-center text-sm text-muted">Nothing ends soon.</li>
            }
          </ul>
        </section>
      </div>
    </div>
  `,
})
export class DashboardPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  protected readonly data = resource({ loader: () => this.api.dashboard() });
  protected readonly money = money;
  protected readonly date = date;
  protected readonly today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  });

  protected readonly cards = computed(() => {
    const c = this.data.value()?.counts;
    if (!c) return [];
    return [
      { label: 'My drafts', value: c.myDrafts, hint: 'Drafts and revisions', icon: 'edit_note', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-400/10 dark:text-slate-300', glow: 'bg-slate-400/20', link: '/contracts', query: { status: 'DRAFT,REJECTED' } },
      { label: 'To approve', value: c.pendingMyApproval, hint: 'Waiting for your decision', icon: 'fact_check', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300', glow: 'bg-amber-400/25', link: '/approvals', query: {} },
      { label: 'To sign', value: c.awaitingMySignature, hint: 'Your signature is needed', icon: 'draw', tone: 'bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300', glow: 'bg-brand-400/25', link: '/contracts', query: { status: 'APPROVED' } },
      { label: 'Ending soon', value: c.expiringSoon, hint: 'In the next 30 days', icon: 'event_upcoming', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300', glow: 'bg-orange-400/25', link: '/contracts', query: { status: 'ACTIVE', sort: 'endDate', order: 'asc' } },
    ];
  });

  protected readonly total = computed(() => Object.values(this.data.value()?.counts.byStatus ?? {}).reduce((a, b) => a + (b ?? 0), 0));

  protected readonly distribution = computed(() => {
    const byStatus = this.data.value()?.counts.byStatus ?? {};
    const total = this.total() || 1;
    return Object.values(ContractStatus)
      .filter((s) => byStatus[s])
      .map((s) => ({ status: s, label: humanize(s), count: byStatus[s]!, pct: (byStatus[s]! / total) * 100, bar: BAR[s] }));
  });

  protected typeIcon(type: string) {
    return { VENDOR: 'storefront', CLIENT: 'handshake', NDA: 'shield_lock', EMPLOYMENT: 'badge' }[type] ?? 'description';
  }

  protected daysLabel(end: string | null) {
    const d = daysUntil(end);
    return d === null ? '—' : d <= 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`;
  }

  protected urgency(end: string | null) {
    const d = daysUntil(end) ?? 99;
    if (d <= 7) return 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300';
    if (d <= 14) return 'bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300';
    return 'bg-subtle text-body';
  }
}
