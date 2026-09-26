import { Component, computed, inject, linkedSignal, resource } from '@angular/core';
import { TPipe, locale, t } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ContractStatus } from '@cms/shared';
import { Api } from '../../core/api.service';
import { LiveService } from '../../core/live.service';
import { AuthService } from '../../core/auth.service';
import { BarChart, type ChartSeries } from '../../shared/bar-chart';
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
  imports: [TPipe, RouterLink, BarChart, MatButtonModule, MatIconModule, StatusBadge, PageHeader, CountUp, Skeleton, EmptyState],
  template: `
    <cms-page-header [eyebrow]="today()" [title]="'Good ' + greeting() + ', {name}' | t: { name: auth.user()?.firstName ?? '' }" [subtitle]="'Here is what needs your attention today.' | t">
      @if (auth.can('contract.create')) {
        <a mat-flat-button routerLink="/contracts/new"><mat-icon>add</mat-icon>{{ 'New contract' | t }}</a>
      }
    </cms-page-header>

    @if (data.error()) {
      <div class="callout tone-danger"><mat-icon>error</mat-icon>{{ 'Could not load the dashboard.' | t }}</div>
    }

    <section class="grid grid-cols-2 gap-4 xl:grid-cols-4">
      @for (card of cards(); track card.label; let i = $index) {
        <a [routerLink]="card.link" [queryParams]="card.query" class="card card-interactive stagger group relative overflow-hidden p-5" [style.--i]="i">
          <div class="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-100" [class]="card.glow"></div>
          <div class="relative flex items-start justify-between">
            <span class="text-sm font-medium text-muted">{{ card.label | t }}</span>
            <span class="flex size-10 items-center justify-center rounded-xl" [class]="card.tone"><mat-icon>{{ card.icon }}</mat-icon></span>
          </div>
          <p class="relative mt-4 text-4xl font-semibold tracking-tight text-ink tabular-nums" [cmsCountUp]="card.value"></p>
          <p class="relative mt-1 flex items-center gap-1 text-xs text-muted">
            {{ card.hint | t }}<mat-icon class="!size-3.5 !text-[14px] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100">arrow_forward</mat-icon>
          </p>
        </a>
      } @empty {
        @for (i of [0, 1, 2, 3]; track i) {
          <div class="card h-36 p-5"><div class="skeleton h-3 w-1/2"></div><div class="skeleton mt-6 h-8 w-1/3"></div></div>
        }
      }
    </section>

    <!-- Charts -->
    @if (insights.value(); as ins) {
      <section class="mt-8" [attr.aria-label]="'Insights' | t">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">{{ 'Insights' | t }}</h2>
          @if (ins.currencies.length > 1) {
            <div class="flex gap-1 rounded-xl bg-subtle p-1" role="radiogroup" [attr.aria-label]="'Currency' | t">
              @for (c of ins.currencies; track c) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="currency() === c"
                  class="rounded-lg px-3 py-1 text-xs font-semibold text-muted transition-all hover:text-ink"
                  [class]="currency() === c ? '!bg-card !text-ink shadow-sm ring-1 ring-line' : ''"
                  (click)="currency.set(c)"
                >
                  {{ c }}
                </button>
              }
            </div>
          }
        </div>
        <div class="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <article class="card stagger p-5" style="--i: 4">
            <h3 class="font-semibold">{{ 'Value signed per month' | t }}</h3>
            <p class="mb-5 text-xs text-muted">{{ 'Last 12 months, in {c}' | t: { c: currency() } }} · {{ 'total {v}' | t: { v: fmt(signedTotal()) } }}</p>
            <cms-bar-chart [labels]="monthLabels(ins.signedValue.months)" [series]="signedSeries()" [format]="fmt" [axisFormat]="compact" [caption]="'Value signed per month' | t" [labelHeader]="'Month' | t" />
          </article>
          <article class="card stagger p-5" style="--i: 5">
            <h3 class="font-semibold">{{ 'Upcoming renewal value' | t }}</h3>
            <p class="mb-5 text-xs text-muted">{{ 'Ending in the next 6 months, in {c}' | t: { c: currency() } }} · {{ 'total {v}' | t: { v: fmt(renewalTotal()) } }}</p>
            <cms-bar-chart [labels]="monthLabels(ins.upcomingRenewals.months)" [series]="renewalSeries()" [format]="fmt" [axisFormat]="compact" [caption]="'Upcoming renewal value' | t" [labelHeader]="'Month' | t" />
          </article>
          <article class="card stagger p-5 lg:col-span-2 xl:col-span-1" style="--i: 6">
            <h3 class="font-semibold">{{ 'Average approval time' | t }}</h3>
            <p class="mb-5 text-xs text-muted">{{ 'From submission to final approval, last 12 months' | t }}</p>
            @if (ins.approvalTime.length) {
              <ul class="space-y-3">
                @for (d of ins.approvalTime; track d.department; let i = $index) {
                  <li class="text-sm">
                    <div class="mb-1 flex items-baseline justify-between gap-2">
                      <span class="truncate text-body">{{ d.department }}</span>
                      <span class="shrink-0 font-medium text-ink tabular-nums">{{ duration(d.avgHours) }}<span class="ml-1 text-xs font-normal text-faint">· {{ '{n} approved' | t: { n: d.count } }}</span></span>
                    </div>
                    <div class="h-2 overflow-hidden rounded-full bg-subtle">
                      <div class="h-full origin-left animate-[rise_0.6s_ease-out_both] rounded-full bg-brand-500" [style.width.%]="(d.avgHours / maxHours()) * 100 || 1" [style.animation-delay.ms]="i * 60"></div>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <p class="py-8 text-center text-sm text-muted">{{ 'No completed approvals yet.' | t }}</p>
            }
          </article>
        </div>
      </section>
    }

    <div class="mt-8 grid gap-6 xl:grid-cols-3">
      <section class="card stagger overflow-hidden xl:col-span-2" style="--i: 7">
        <header class="flex items-center justify-between border-b border-line-soft px-5 py-4">
          <h2 class="font-semibold">{{ 'Recently updated' | t }}</h2>
          <a routerLink="/contracts" class="text-sm font-medium text-accent hover:underline">{{ 'View all' | t }}</a>
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
              <cms-empty icon="description" [title]="'No contracts yet' | t" [text]="'Create your first contract to get started.' | t" />
            }
          }
        </ul>
      </section>

      <div class="space-y-6">
        <section class="card stagger p-5" style="--i: 8">
          <h2 class="font-semibold">{{ 'Portfolio' | t }}</h2>
          <p class="text-xs text-muted">{{ '{n} contracts you can see' | t: { n: total() } }}</p>
          <div class="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-subtle" role="img" [attr.aria-label]="'Status distribution of {n} contracts' | t: { n: total() }">
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

        <section class="card stagger overflow-hidden" style="--i: 9">
          <header class="flex items-center gap-2 border-b border-line-soft px-5 py-4">
            <mat-icon class="text-seal-500">event_upcoming</mat-icon>
            <h2 class="font-semibold">{{ 'Ending in {n} days' | t: { n: data.value()?.expiryWindowDays ?? 30 } }}</h2>
          </header>
          <ul class="divide-y divide-line-soft">
            @for (c of data.value()?.expiringSoon; track c.id) {
              <li>
                <a [routerLink]="['/contracts', c.id]" class="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-ink">{{ c.title }}</p>
                    <p class="text-xs text-muted">{{ (c.autoRenew ? 'Renews automatically' : 'Needs a renewal decision') | t }}</p>
                  </div>
                  <span class="rounded-lg px-2 py-1 text-xs font-semibold tabular-nums" [class]="urgency(c.endDate)">{{ daysLabel(c.endDate) }}</span>
                </a>
              </li>
            } @empty {
              <li class="px-5 py-8 text-center text-sm text-muted">{{ 'Nothing ends soon.' | t }}</li>
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

  protected readonly insights = resource({ loader: () => this.api.insights() });

  constructor() {
    inject(LiveService).onContractChange(() => {
      this.data.reload();
      this.insights.reload();
    });
  }

  /** The value charts show one currency at a time (no exchange rates); the most used by default. */
  protected readonly currency = linkedSignal<string[] | undefined, string>({
    source: () => this.insights.value()?.currencies,
    computation: (list, previous) => (previous && list?.includes(previous.value) ? previous.value : (list?.[0] ?? 'EUR')),
  });

  protected readonly signedSeries = computed<ChartSeries[]>(() => {
    const ins = this.insights.value();
    const values = ins?.signedValue.series[this.currency()] ?? ins?.signedValue.months.map(() => 0) ?? [];
    return [{ key: 'signed', label: t('Signed'), color: 'bg-brand-500', values }];
  });
  protected readonly signedTotal = computed(() => this.signedSeries()[0]!.values.reduce((a, b) => a + b, 0));

  protected readonly renewalSeries = computed<ChartSeries[]>(() => {
    const ins = this.insights.value();
    const zeros = ins?.upcomingRenewals.months.map(() => 0) ?? [];
    const s = ins?.upcomingRenewals.series[this.currency()];
    return [
      { key: 'decision', label: t('Needs a decision'), color: 'bg-amber-500', values: s?.decision ?? zeros },
      { key: 'in-progress', label: t('Renewal in progress'), color: 'bg-sky-500', values: s?.['in-progress'] ?? zeros },
      { key: 'auto', label: t('Renews automatically'), color: 'bg-emerald-500', values: s?.auto ?? zeros },
    ];
  });
  protected readonly renewalTotal = computed(() => this.renewalSeries().reduce((sum, s) => sum + s.values.reduce((a, b) => a + b, 0), 0));
  protected readonly maxHours = computed(() => Math.max(1, ...(this.insights.value()?.approvalTime.map((d) => d.avgHours) ?? [])));

  protected readonly fmt = (n: number) => money(String(n), this.currency()).replace(/[.,]00(?=\D*$)/, '');
  protected readonly compact = (n: number) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  protected monthLabels(months: string[]) {
    return months.map((m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' }));
  }

  /** "5 h", "3.5 days". */
  protected duration(hours: number) {
    if (hours < 24) return t('{n} h', { n: Math.round(hours) });
    const days = Math.round((hours / 24) * 10) / 10;
    return t('{n} days', { n: days.toLocaleString(locale()) });
  }

  protected readonly money = money;
  protected readonly date = date;
  protected readonly today = computed(() => new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }));

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
    return d === null ? '—' : d <= 0 ? t('Today') : d === 1 ? t('1 day') : t('{n} days', { n: d });
  }

  protected urgency(end: string | null) {
    const d = daysUntil(end) ?? 99;
    if (d <= 7) return 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300';
    if (d <= 14) return 'bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300';
    return 'bg-subtle text-body';
  }
}
