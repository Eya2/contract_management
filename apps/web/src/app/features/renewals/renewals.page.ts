import { Component, computed, inject, input, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { LiveService } from '../../core/live.service';
import { TPipe, lang, locale, t } from '../../core/i18n';
import type { RenewalEntry, RenewalRisk } from '../../core/models';
import { EmptyState } from '../../shared/empty-state';
import { KeyNav } from '../../shared/key-nav';
import { date, daysUntil, fullName, money } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { StatusBadge } from '../../shared/status-badge';
import { TYPE_ICON } from '../contracts/contracts-list.page';

const DAY = 86_400_000;

/** Most urgent first; also the order of the legend. */
const RISKS: { key: RenewalRisk; label: string; hint: string; icon: string; chip: string; dot: string }[] = [
  {
    key: 'overdue',
    label: 'Overdue',
    hint: 'Ended with no renewal in force',
    icon: 'error',
    chip: 'bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/30',
    dot: 'bg-rose-500',
  },
  {
    key: 'decision',
    label: 'Needs a decision',
    hint: 'Ends without renewal unless someone acts',
    icon: 'priority_high',
    chip: 'bg-amber-50 text-amber-900 ring-amber-600/25 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30',
    dot: 'bg-amber-500',
  },
  {
    key: 'in-progress',
    label: 'Renewal in progress',
    hint: 'A renewal exists but is not signed yet',
    icon: 'pending',
    chip: 'bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/30',
    dot: 'bg-sky-500',
  },
  {
    key: 'auto',
    label: 'Renews automatically',
    hint: 'A new term starts the next day on the same terms',
    icon: 'autorenew',
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/30',
    dot: 'bg-emerald-500',
  },
  {
    key: 'covered',
    label: 'Covered by a renewal',
    hint: 'The next term is already signed',
    icon: 'task_alt',
    chip: 'bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-400/30',
    dot: 'bg-violet-500',
  },
];
const RISK = Object.fromEntries(RISKS.map((r) => [r.key, r])) as Record<RenewalRisk, (typeof RISKS)[number]>;
const RANK = Object.fromEntries(RISKS.map((r, i) => [r.key, i])) as Record<RenewalRisk, number>;

interface Cell {
  iso: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  items: RenewalEntry[];
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Month view of contract end dates, colour-coded by how much attention each
 * needs. The month, the selected day and the risk filter live in the URL
 * (?month=2026-10&day=2026-10-20&risk=decision), so a view can be shared.
 * Dates are UTC calendar days, like the contract dates themselves.
 */
@Component({
  imports: [KeyNav, TPipe, RouterLink, MatButtonModule, MatIconModule, MatTooltipModule, PageHeader, Skeleton, EmptyState, StatusBadge],
  template: `
    <cms-page-header [title]="'Renewals' | t" [subtitle]="'End dates and renewals of the contracts you can see, month by month.' | t">
      <div class="flex items-center gap-1 rounded-xl bg-card p-1 ring-1 ring-line">
        <button mat-icon-button (click)="go(-1)" [attr.aria-label]="'Previous month' | t" [matTooltip]="'Previous month' | t"><mat-icon>chevron_left</mat-icon></button>
        <h2 class="min-w-40 text-center text-base font-semibold capitalize" aria-live="polite">{{ monthLabel() }}</h2>
        <button mat-icon-button (click)="go(1)" [attr.aria-label]="'Next month' | t" [matTooltip]="'Next month' | t"><mat-icon>chevron_right</mat-icon></button>
      </div>
      <button mat-stroked-button (click)="goToday()" [disabled]="isCurrentMonth()">{{ 'Today' | t }}</button>
    </cms-page-header>

    <!-- Legend, doubling as a filter -->
    <div class="mb-4 flex flex-wrap gap-2" role="group" [attr.aria-label]="'Filter by risk' | t">
      @for (r of risks; track r.key) {
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-all ring-inset"
          [class]="shown(r.key) ? r.chip : 'bg-card text-muted ring-line opacity-60 hover:opacity-100'"
          [attr.aria-pressed]="riskFilter() === r.key"
          [matTooltip]="r.hint | t"
          (click)="toggleRisk(r.key)"
        >
          <span class="size-2 rounded-full" [class]="r.dot"></span>{{ r.label | t }}
          <span class="rounded-full bg-black/5 px-1.5 text-xs tabular-nums dark:bg-white/10">{{ counts()[r.key] }}</span>
        </button>
      }
      @if (riskFilter()) {
        <button mat-button (click)="toggleRisk(riskFilter()!)"><mat-icon>filter_alt_off</mat-icon>{{ 'Show all' | t }}</button>
      }
    </div>

    <div class="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <!-- Month grid -->
      <section class="card overflow-hidden" [attr.aria-label]="monthLabel()">
        @if (entries.isLoading() && !entries.value()) {
          <cms-skeleton [rows]="6" />
        } @else {
          <div class="grid grid-cols-7 border-b border-line bg-subtle/60 text-center text-xs font-medium text-muted" aria-hidden="true">
            @for (w of weekdays(); track $index) {
              <div class="py-2">{{ w }}</div>
            }
          </div>
          <p id="calendar-keys" class="sr-only">{{ 'Use the arrow keys to move between days and Enter to list what ends that day.' | t }}</p>
          <div class="grid grid-cols-7" [attr.aria-busy]="entries.isLoading()" cmsKeyNav="7" aria-describedby="calendar-keys">
            @for (cell of cells(); track cell.iso) {
              <button
                type="button"
                data-nav-item
                [attr.data-nav-default]="cell.iso === (day() ?? todayIso) || null"
                class="group relative flex min-h-16 flex-col gap-1 border-r border-b border-line-soft p-1.5 text-left transition-colors outline-none nth-[7n]:border-r-0 hover:bg-subtle/70 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:min-h-28 sm:p-2"
                [class.bg-subtle]="!cell.inMonth"
                [class.!bg-accent-soft]="cell.iso === day()"
                [attr.aria-pressed]="cell.iso === day()"
                [attr.aria-label]="cellLabel(cell)"
                (click)="selectDay(cell.iso)"
              >
                <span
                  class="flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums"
                  [class]="cell.today ? 'bg-accent !text-white' : cell.inMonth ? 'text-ink' : 'text-faint'"
                  >{{ cell.day }}</span
                >
                <!-- Chips on larger screens, dots on phones -->
                <span class="hidden flex-col gap-1 sm:flex">
                  @for (c of cell.items.slice(0, 3); track c.id) {
                    <span class="truncate rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium ring-1 ring-inset" [class]="info[c.risk].chip">{{ c.counterparty.name }}</span>
                  }
                  @if (cell.items.length > 3) {
                    <span class="px-1 text-[11px] font-medium text-muted">{{ '+{n} more' | t: { n: cell.items.length - 3 } }}</span>
                  }
                </span>
                <span class="flex flex-wrap gap-1 sm:hidden">
                  @for (c of cell.items; track c.id) {
                    <span class="size-2 rounded-full" [class]="info[c.risk].dot"></span>
                  }
                </span>
              </button>
            }
          </div>
        }
      </section>

      <!-- Agenda: the selected day, or the whole month -->
      <section class="card flex max-h-[44rem] flex-col overflow-hidden" aria-live="polite">
        <header class="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 class="text-base font-semibold">{{ day() ? longDate(day()!) : ('This month' | t) }}</h2>
            <p class="text-xs text-muted">{{ '{n} contracts ending' | t: { n: agenda().length } }}</p>
          </div>
          @if (day()) {
            <button mat-button (click)="selectDay(null)">{{ 'Whole month' | t }}</button>
          }
        </header>
        @if (!agenda().length) {
          <cms-empty icon="event_available" [title]="'Nothing ends here' | t" [text]="(riskFilter() ? 'No contract with this risk in this period.' : 'No contract you can see ends in this period.') | t" />
        } @else {
          <ul class="flex-1 divide-y divide-line-soft overflow-y-auto">
            @for (c of agenda(); track c.id; let i = $index) {
              <li class="stagger" [style.--i]="i">
                <a [routerLink]="['/contracts', c.id]" class="flex gap-3 px-5 py-3 transition-colors hover:bg-subtle/70">
                  <span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset" [class]="info[c.risk].chip">
                    <mat-icon class="!size-5 !text-[20px]">{{ info[c.risk].icon }}</mat-icon>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <mat-icon class="!size-4 shrink-0 !text-[16px] text-faint">{{ typeIcon[c.type] }}</mat-icon>
                      <span class="truncate text-sm font-medium text-ink">{{ c.title }}</span>
                    </span>
                    <span class="block truncate text-xs text-muted">{{ c.referenceNumber }} · {{ c.counterparty.name }} · {{ money(c.value, c.currency) }}</span>
                    <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span class="font-medium" [class]="c.risk === 'overdue' ? 'text-rose-600 dark:text-rose-300' : 'text-body'">{{ when(c) }}</span>
                      <span class="text-faint">·</span>
                      <span class="text-muted">{{ info[c.risk].label | t }}</span>
                      @if (c.renewedBy) {
                        <span class="text-faint">·</span><span class="text-muted">{{ c.renewedBy.referenceNumber }}</span>
                        <cms-status [status]="c.renewedBy.status" />
                      }
                    </span>
                    <span class="mt-0.5 block text-xs text-faint">{{ 'Owner' | t }}: {{ fullName(c.owner) }} · {{ c.department.name }}</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class RenewalsPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  /** Query params, bound by the router. */
  readonly month = input<string>();
  readonly day = input<string>();
  readonly risk = input<string>();

  protected readonly risks = RISKS;
  protected readonly info = RISK;
  protected readonly typeIcon = TYPE_ICON;
  protected readonly money = money;
  protected readonly fullName = fullName;

  protected readonly todayIso = isoDay(Date.now());

  /** First day of the shown month (UTC ms). */
  private readonly monthStart = computed(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(this.month() ?? '');
    const now = new Date();
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  });

  /** The grid always starts on a Monday and shows whole weeks. */
  private readonly range = computed(() => {
    const start = new Date(this.monthStart());
    const end = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0);
    const from = this.monthStart() - ((start.getUTCDay() + 6) % 7) * DAY;
    const to = end + ((7 - new Date(end).getUTCDay()) % 7) * DAY;
    return { from, to, monthEnd: end };
  });

  protected readonly entries = resource({
    params: () => ({ from: isoDay(this.range().from), to: isoDay(this.range().to) }),
    loader: ({ params }) => this.api.renewalCalendar(params.from, params.to),
  });

  constructor() {
    inject(LiveService).onContractChange(() => this.entries.reload());
  }


  protected readonly riskFilter = computed(() => (RISKS.some((r) => r.key === this.risk()) ? (this.risk() as RenewalRisk) : null));
  protected readonly shown = (r: RenewalRisk) => !this.riskFilter() || this.riskFilter() === r;

  private readonly visible = computed(() =>
    (this.entries.value() ?? []).filter((c) => this.shown(c.risk)).sort((a, b) => a.endDate!.localeCompare(b.endDate!) || RANK[a.risk] - RANK[b.risk]),
  );

  /** Counts for the shown month only (not the padding days of the grid). */
  protected readonly counts = computed(() => {
    const out = Object.fromEntries(RISKS.map((r) => [r.key, 0])) as Record<RenewalRisk, number>;
    const from = isoDay(this.monthStart());
    const to = isoDay(this.range().monthEnd);
    for (const c of this.entries.value() ?? []) {
      const d = c.endDate!.slice(0, 10);
      if (d >= from && d <= to) out[c.risk]++;
    }
    return out;
  });

  protected readonly cells = computed<Cell[]>(() => {
    const byDay = new Map<string, RenewalEntry[]>();
    for (const c of this.visible()) {
      const d = c.endDate!.slice(0, 10);
      byDay.set(d, [...(byDay.get(d) ?? []), c]);
    }
    const month = new Date(this.monthStart()).getUTCMonth();
    const cells: Cell[] = [];
    for (let ms = this.range().from; ms <= this.range().to; ms += DAY) {
      const iso = isoDay(ms);
      const items = (byDay.get(iso) ?? []).sort((a, b) => RANK[a.risk] - RANK[b.risk]);
      cells.push({ iso, day: new Date(ms).getUTCDate(), inMonth: new Date(ms).getUTCMonth() === month, today: iso === this.todayIso, items });
    }
    return cells;
  });

  protected readonly agenda = computed(() => {
    const day = this.day();
    if (day) return this.visible().filter((c) => c.endDate!.startsWith(day));
    const from = isoDay(this.monthStart());
    const to = isoDay(this.range().monthEnd);
    return this.visible().filter((c) => c.endDate!.slice(0, 10) >= from && c.endDate!.slice(0, 10) <= to);
  });

  protected readonly monthLabel = computed(() => {
    lang();
    return new Date(this.monthStart()).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  });

  /** Short weekday names, Monday first (1 Jan 2024 was a Monday). */
  protected readonly weekdays = computed(() => {
    lang();
    return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' }));
  });

  protected readonly isCurrentMonth = computed(() => isoDay(this.monthStart()).slice(0, 7) === this.todayIso.slice(0, 7));

  protected longDate(iso: string) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }

  protected cellLabel(cell: Cell) {
    const d = this.longDate(cell.iso);
    return cell.items.length ? `${d}, ${t('{n} contracts ending', { n: cell.items.length })}` : d;
  }

  protected when(c: RenewalEntry) {
    const n = daysUntil(c.endDate);
    if (n === null) return '';
    if (n === 0) return t('Ends today');
    if (n === 1) return t('Ends tomorrow');
    if (n > 0) return t('Ends in {n} days', { n });
    return t('Ended {n} days ago · {date}', { n: -n, date: date(c.endDate) });
  }

  protected go(delta: number) {
    const d = new Date(this.monthStart());
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
    this.navigate({ month: isoDay(next.getTime()).slice(0, 7), day: undefined });
  }

  protected goToday() {
    this.navigate({ month: undefined, day: undefined });
  }

  protected selectDay(iso: string | null) {
    this.navigate({ day: iso && iso !== this.day() ? iso : undefined, month: iso ? iso.slice(0, 7) : this.month() });
  }

  protected toggleRisk(r: RenewalRisk) {
    this.navigate({ risk: this.riskFilter() === r ? undefined : r });
  }

  private navigate(params: Record<string, string | undefined>) {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
