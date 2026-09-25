import { Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ContractStatus } from '@cms/shared';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { date, money } from '../../shared/format';
import { StatusBadge } from '../../shared/status-badge';

@Component({
  imports: [RouterLink, MatButtonModule, MatIconModule, StatusBadge],
  template: `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-ink">Good {{ greeting() }}, {{ auth.user()?.firstName }}</h1>
        <p class="text-sm text-muted">Here is what needs your attention.</p>
      </div>
      @if (auth.can('contract.create')) {
        <a mat-flat-button routerLink="/contracts/new"><mat-icon>add</mat-icon>New contract</a>
      }
    </div>

    @if (data.error()) {
      <p class="rounded-lg bg-rose-50 p-4 text-rose-700">Could not load the dashboard.</p>
    }
    @if (data.value(); as d) {
      <section class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        @for (card of cards(); track card.label) {
          <a [routerLink]="card.link" [queryParams]="card.query" class="group rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-300">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-500">{{ card.label }}</span>
              <span class="flex size-9 items-center justify-center rounded-lg" [class]="card.tone"><mat-icon class="!text-[20px]">{{ card.icon }}</mat-icon></span>
            </div>
            <p class="mt-3 text-3xl font-semibold text-ink tabular-nums">{{ card.value }}</p>
          </a>
        }
      </section>

      <section class="mt-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-4 font-semibold text-ink">Contracts by status</h2>
        <div class="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" [attr.aria-label]="'Status distribution, ' + totalContracts() + ' contracts'">
          @for (s of distribution(); track s.status) {
            <div [style.width.%]="s.pct" [class]="s.bar" [title]="s.status + ': ' + s.count"></div>
          }
        </div>
        <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          @for (s of distribution(); track s.status) {
            <a routerLink="/contracts" [queryParams]="{ status: s.status }" class="flex items-center gap-2 hover:underline">
              <span class="size-2.5 rounded-full" [class]="s.bar"></span>
              <span class="text-slate-600">{{ s.label }}</span>
              <span class="font-medium tabular-nums">{{ s.count }}</span>
            </a>
          } @empty {
            <span class="text-slate-500">No contracts yet.</span>
          }
        </div>
      </section>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <section class="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 class="border-b border-slate-100 px-5 py-4 font-semibold text-ink">Recently updated</h2>
          <ul class="divide-y divide-slate-100">
            @for (c of d.recent; track c.id) {
              <li>
                <a [routerLink]="['/contracts', c.id]" class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium text-ink">{{ c.title }}</p>
                    <p class="text-xs text-slate-500">{{ c.referenceNumber }} · {{ c.counterparty.name }}</p>
                  </div>
                  <span class="text-sm text-slate-600 tabular-nums">{{ money(c.value, c.currency) }}</span>
                  <cms-status [status]="c.status" />
                </a>
              </li>
            } @empty {
              <li class="px-5 py-8 text-center text-sm text-slate-500">Nothing here yet.</li>
            }
          </ul>
        </section>
        <section class="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 class="border-b border-slate-100 px-5 py-4 font-semibold text-ink">Expiring in the next {{ d.expiryWindowDays }} days</h2>
          <ul class="divide-y divide-slate-100">
            @for (c of d.expiringSoon; track c.id) {
              <li>
                <a [routerLink]="['/contracts', c.id]" class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium text-ink">{{ c.title }}</p>
                    <p class="text-xs text-slate-500">{{ c.counterparty.name }}</p>
                  </div>
                  <span class="text-sm font-medium text-orange-700">{{ date(c.endDate) }}</span>
                </a>
              </li>
            } @empty {
              <li class="px-5 py-8 text-center text-sm text-slate-500">No active contract ends soon.</li>
            }
          </ul>
        </section>
      </div>
    }
  `,
})
export class DashboardPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  protected readonly data = resource({ loader: () => this.api.dashboard() });
  protected readonly money = money;
  protected readonly date = date;

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  });

  protected readonly cards = computed(() => {
    const c = this.data.value()?.counts;
    if (!c) return [];
    return [
      { label: 'My drafts', value: c.myDrafts, icon: 'edit_note', tone: 'bg-slate-100 text-slate-600', link: '/contracts', query: { status: 'DRAFT,REJECTED' } },
      { label: 'Awaiting my approval', value: c.pendingMyApproval, icon: 'fact_check', tone: 'bg-amber-100 text-amber-700', link: '/approvals', query: {} },
      { label: 'Awaiting my signature', value: c.awaitingMySignature, icon: 'draw', tone: 'bg-teal-100 text-teal-700', link: '/contracts', query: { status: 'APPROVED' } },
      { label: 'Expiring soon', value: c.expiringSoon, icon: 'event_busy', tone: 'bg-orange-100 text-orange-700', link: '/contracts', query: { status: 'ACTIVE', sort: 'endDate', order: 'asc' } },
    ];
  });

  protected readonly totalContracts = computed(() =>
    Object.values(this.data.value()?.counts.byStatus ?? {}).reduce((a, b) => a + (b ?? 0), 0),
  );

  protected readonly distribution = computed(() => {
    const byStatus = this.data.value()?.counts.byStatus ?? {};
    const total = this.totalContracts() || 1;
    return Object.values(ContractStatus)
      .filter((s) => byStatus[s])
      .map((s) => ({ status: s, label: s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' '), count: byStatus[s]!, pct: (byStatus[s]! / total) * 100, bar: BAR[s] }));
  });
}

const BAR: Record<string, string> = {
  DRAFT: 'bg-slate-400',
  SUBMITTED: 'bg-sky-400',
  UNDER_REVIEW: 'bg-amber-400',
  APPROVED: 'bg-emerald-500',
  REJECTED: 'bg-rose-500',
  SIGNED: 'bg-teal-500',
  ACTIVE: 'bg-green-600',
  EXPIRED: 'bg-orange-400',
  RENEWED: 'bg-indigo-400',
  TERMINATED: 'bg-zinc-500',
};
