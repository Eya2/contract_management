import { Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { TranslatedPaginatorIntl } from '../../shared/paginator-intl';
import { Router, RouterLink } from '@angular/router';
import { ContractType } from '@cms/shared';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Avatar } from '../../shared/avatar';
import { EmptyState } from '../../shared/empty-state';
import { date, fullName, humanize, money } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { StatusBadge } from '../../shared/status-badge';

/** Quick views over the lifecycle; each is just a status filter. */
const VIEWS = [
  { label: 'All', status: '' },
  { label: 'Drafts', status: 'DRAFT,REJECTED' },
  { label: 'In review', status: 'SUBMITTED,UNDER_REVIEW' },
  { label: 'Approved', status: 'APPROVED,SIGNED' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Ended', status: 'EXPIRED,RENEWED,TERMINATED' },
];

export const TYPE_ICON: Record<string, string> = { VENDOR: 'storefront', CLIENT: 'handshake', NDA: 'shield_lock', EMPLOYMENT: 'badge' };

/** Filters live in the URL (?q=&status=&type=&sort=&order=&page=), so every view is linkable. */
@Component({
  providers: [{ provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl }],
  imports: [TPipe, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatPaginatorModule, StatusBadge, PageHeader, Avatar, Skeleton, EmptyState],
  template: `
    <cms-page-header [title]="'Contracts' | t" [subtitle]="'{n} contracts you can see' | t: { n: list.value()?.total ?? '…' }">
      <button mat-stroked-button (click)="exportCsv()" [disabled]="!list.value()?.total"><mat-icon>download</mat-icon>{{ 'Export CSV' | t }}</button>
      @if (auth.can('contract.create')) {
        <a mat-flat-button routerLink="/contracts/new"><mat-icon>add</mat-icon>{{ 'New contract' | t }}</a>
      }
    </cms-page-header>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="flex gap-1 overflow-x-auto rounded-xl bg-subtle p-1" role="tablist">
        @for (v of views; track v.label) {
          <button
            role="tab"
            [attr.aria-selected]="(status() ?? '') === v.status"
            class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted transition-all hover:text-ink"
            [class]="(status() ?? '') === v.status ? '!bg-card !text-ink shadow-sm ring-1 ring-line' : ''"
            (click)="apply({ status: v.status })"
          >
            {{ v.label | t }}
          </button>
        }
      </div>
      <div class="relative min-w-56 flex-1 sm:max-w-xs">
        <mat-icon class="pointer-events-none absolute top-1/2 left-3 !size-5 -translate-y-1/2 !text-[20px] text-faint">search</mat-icon>
        <input
          [ngModel]="search()"
          (ngModelChange)="search.set($event)"
          (keyup.enter)="apply({ q: search() })"
          (blur)="apply({ q: search() })"
          [placeholder]="'Filter by title, reference…' | t"
          [attr.aria-label]="'Filter contracts' | t"
          class="h-9 w-full rounded-xl bg-card pr-3 pl-10 text-sm text-ink ring-1 ring-line outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>
      <button mat-stroked-button [matMenuTriggerFor]="typeMenu">
        <mat-icon>category</mat-icon>{{ types().length ? humanize(types()[0]!) + (types().length > 1 ? ' +' + (types().length - 1) : '') : ('All types' | t) }}
      </button>
      <mat-menu #typeMenu="matMenu">
        <button mat-menu-item (click)="apply({ type: '' })">{{ 'All types' | t }}</button>
        @for (t of allTypes; track t) {
          <button mat-menu-item (click)="apply({ type: t })"><mat-icon>{{ typeIcon[t] }}</mat-icon>{{ humanize(t) }}</button>
        }
      </mat-menu>
      @if (q() || status() || type()) {
        <button mat-button (click)="clear()"><mat-icon>filter_alt_off</mat-icon>{{ 'Clear' | t }}</button>
      }
    </div>

    <div class="card overflow-hidden">
      @if (list.isLoading() && !list.value()) {
        <cms-skeleton [rows]="6" />
      } @else if (!list.value()?.items?.length) {
        <cms-empty icon="search_off" [title]="(list.error() ? 'Could not load contracts' : 'No contracts match') | t" [text]="'Try another view or clear the filters.' | t">
          @if (q() || status() || type()) {
            <button mat-stroked-button (click)="clear()">{{ 'Clear filters' | t }}</button>
          }
        </cms-empty>
      } @else {
        <!-- Table on larger screens -->
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-line bg-subtle/60 text-xs font-medium text-muted">
              <tr>
                @for (col of columns; track col.key) {
                  <th class="px-4 py-3 font-medium whitespace-nowrap first:pl-5" [class.text-right]="col.key === 'value'">
                    @if (col.sortable) {
                      <button class="inline-flex items-center gap-1 hover:text-ink" (click)="sortBy(col.key)">
                        {{ col.label | t }}
                        <mat-icon class="!size-4 !text-[16px] transition-transform" [class.opacity-0]="sort() !== col.key" [class.rotate-180]="order() === 'asc'">arrow_downward</mat-icon>
                      </button>
                    } @else {
                      {{ col.label | t }}
                    }
                  </th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-line-soft">
              @for (c of list.value()!.items; track c.id; let i = $index) {
                <tr class="stagger group cursor-pointer transition-colors hover:bg-subtle/70" [style.--i]="i" [routerLink]="['/contracts', c.id]">
                  <td class="min-w-64 py-3 pr-4 pl-5">
                    <div class="flex items-center gap-3">
                      <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent-ink">
                        <mat-icon class="!size-5 !text-[20px]">{{ typeIcon[c.type] }}</mat-icon>
                      </span>
                      <div class="min-w-0">
                        <a [routerLink]="['/contracts', c.id]" class="block truncate font-medium text-ink">{{ c.title }}</a>
                        <p class="text-xs text-muted">{{ c.referenceNumber }} · v{{ c.currentVersionNumber }} · {{ humanize(c.type) }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-body">{{ c.counterparty.name }}</td>
                  <td class="px-4 py-3 text-right font-medium text-ink tabular-nums">{{ money(c.value, c.currency) }}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-body">
                    {{ date(c.endDate) }}
                    @if (c.autoRenew) {
                      <mat-icon class="!size-4 align-middle !text-[16px] text-faint" [title]="'Renews automatically' | t">autorenew</mat-icon>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <cms-avatar [name]="fullName(c.owner)" [size]="26" />
                      <span class="leading-tight"><span class="block text-body">{{ fullName(c.owner) }}</span><span class="text-xs text-muted">{{ c.department.name }}</span></span>
                    </div>
                  </td>
                  <td class="px-4 py-3"><cms-status [status]="c.status" /></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <!-- Cards on phones -->
        <ul class="divide-y divide-line-soft md:hidden">
          @for (c of list.value()!.items; track c.id; let i = $index) {
            <li class="stagger" [style.--i]="i">
              <a [routerLink]="['/contracts', c.id]" class="flex items-start gap-3 p-4">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted"><mat-icon>{{ typeIcon[c.type] }}</mat-icon></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-ink">{{ c.title }}</p>
                  <p class="truncate text-xs text-muted">{{ c.counterparty.name }} · {{ money(c.value, c.currency) }}</p>
                  <div class="mt-2"><cms-status [status]="c.status" /></div>
                </div>
              </a>
            </li>
          }
        </ul>
      }
      <mat-paginator
        class="border-t border-line-soft !bg-transparent"
        [length]="list.value()?.total ?? 0"
        [pageIndex]="pageNumber() - 1"
        [pageSize]="20"
        [hidePageSize]="true"
        (page)="onPage($event)"
      />
    </div>
  `,
})
export class ContractsListPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  // Query params, bound by the router.
  readonly q = input<string>();
  readonly status = input<string>();
  readonly type = input<string>();
  readonly sort = input<string>('updatedAt');
  readonly order = input<'asc' | 'desc'>('desc');
  readonly page = input<string>();

  protected readonly search = linkedSignal(() => this.q() ?? '');
  protected readonly statuses = computed(() => this.status()?.split(',').filter(Boolean) ?? []);
  protected readonly types = computed(() => this.type()?.split(',').filter(Boolean) ?? []);
  protected readonly pageNumber = computed(() => Number(this.page() ?? 1));

  protected readonly list = resource({
    params: () => ({
      q: this.q(),
      status: this.statuses(),
      type: this.types(),
      sort: this.sort() ?? 'updatedAt',
      order: this.order() ?? 'desc',
      page: this.pageNumber(),
      pageSize: 20,
    }),
    loader: ({ params }) => this.api.contracts(params),
  });

  protected readonly views = VIEWS;
  protected readonly allTypes = Object.values(ContractType);
  protected readonly typeIcon = TYPE_ICON;
  protected readonly columns = [
    { key: 'title', label: 'Contract', sortable: true },
    { key: 'counterparty', label: 'Counterparty', sortable: false },
    { key: 'value', label: 'Value', sortable: true },
    { key: 'endDate', label: 'Ends', sortable: true },
    { key: 'owner', label: 'Owner', sortable: false },
    { key: 'status', label: 'Status', sortable: false },
  ];
  protected readonly humanize = humanize;
  protected readonly money = money;
  protected readonly date = date;
  protected readonly fullName = fullName;

  protected apply(change: Record<string, string | number | undefined>) {
    const params = { ...change };
    for (const k of Object.keys(params)) if (params[k] === '') params[k] = undefined;
    if (!('page' in change)) params['page'] = undefined;
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }

  protected sortBy(key: string) {
    const order = this.sort() === key && this.order() === 'desc' ? 'asc' : 'desc';
    this.apply({ sort: key, order });
  }

  protected onPage(e: PageEvent) {
    this.apply({ page: e.pageIndex + 1 });
  }

  /** Downloads the current view (same filters and sort), not just the visible page. */
  protected exportCsv() {
    void this.api.exportContracts({ q: this.q(), status: this.statuses(), type: this.types(), sort: this.sort() ?? 'updatedAt', order: this.order() ?? 'desc' });
  }

  protected clear() {
    void this.router.navigate([], { queryParams: {} });
  }
}
