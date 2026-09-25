import { Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { ContractStatus, ContractType } from '@cms/shared';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { date, fullName, humanize, money } from '../../shared/format';
import { StatusBadge } from '../../shared/status-badge';

/** Filters live in the URL (?q=&status=&type=&sort=&order=&page=), so every view is linkable. */
@Component({
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatPaginatorModule, StatusBadge],
  template: `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-ink">Contracts</h1>
        <p class="text-sm text-muted">{{ list.value()?.total ?? '…' }} contracts you can see</p>
      </div>
      @if (auth.can('contract.create')) {
        <a mat-flat-button routerLink="/contracts/new"><mat-icon>add</mat-icon>New contract</a>
      }
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <mat-form-field subscriptSizing="dynamic" class="w-full sm:w-72">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Search title, reference, counterparty</mat-label>
        <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)" (keyup.enter)="apply({ q: search() })" (blur)="apply({ q: search() })" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="w-full sm:w-56">
        <mat-label>Status</mat-label>
        <mat-select multiple [ngModel]="statuses()" (ngModelChange)="apply({ status: $event.join(',') })">
          @for (s of allStatuses; track s) {
            <mat-option [value]="s">{{ humanize(s) }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="w-full sm:w-44">
        <mat-label>Type</mat-label>
        <mat-select multiple [ngModel]="types()" (ngModelChange)="apply({ type: $event.join(',') })">
          @for (t of allTypes; track t) {
            <mat-option [value]="t">{{ humanize(t) }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (q() || status() || type()) {
        <button mat-button (click)="clear()"><mat-icon>close</mat-icon>Clear filters</button>
      }
    </div>

    <div class="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              @for (col of columns; track col.key) {
                <th class="px-4 py-3 whitespace-nowrap" [class.text-right]="col.key === 'value'">
                  @if (col.sortable) {
                    <button class="inline-flex items-center gap-1 uppercase hover:text-ink" (click)="sortBy(col.key)">
                      {{ col.label }}
                      @if (sort() === col.key) {
                        <mat-icon class="!size-4 !text-[16px]">{{ order() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
                      }
                    </button>
                  } @else {
                    {{ col.label }}
                  }
                </th>
              }
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            @for (c of list.value()?.items; track c.id) {
              <tr class="cursor-pointer hover:bg-slate-50" [routerLink]="['/contracts', c.id]">
                <td class="min-w-56 px-4 py-3">
                  <a [routerLink]="['/contracts', c.id]" class="font-medium text-ink hover:text-brand-700">{{ c.title }}</a>
                  <p class="text-xs text-slate-500">{{ c.referenceNumber }} · v{{ c.currentVersionNumber }}</p>
                </td>
                <td class="px-4 py-3 text-slate-700">{{ c.counterparty.name }}</td>
                <td class="px-4 py-3 text-slate-600">{{ humanize(c.type) }}</td>
                <td class="px-4 py-3 text-right text-slate-700 tabular-nums">{{ money(c.value, c.currency) }}</td>
                <td class="px-4 py-3 whitespace-nowrap text-slate-600">{{ date(c.endDate) }}</td>
                <td class="px-4 py-3 text-slate-600">{{ fullName(c.owner) }}<p class="text-xs text-slate-400">{{ c.department.name }}</p></td>
                <td class="px-4 py-3"><cms-status [status]="c.status" /></td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="px-4 py-12 text-center text-slate-500">
                  {{ list.isLoading() ? 'Loading…' : list.error() ? 'Could not load contracts.' : 'No contracts match these filters.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <mat-paginator
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

  protected readonly allStatuses = Object.values(ContractStatus);
  protected readonly allTypes = Object.values(ContractType);
  protected readonly columns = [
    { key: 'title', label: 'Contract', sortable: true },
    { key: 'counterparty', label: 'Counterparty', sortable: false },
    { key: 'type', label: 'Type', sortable: false },
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

  protected clear() {
    void this.router.navigate([], { queryParams: {} });
  }
}
