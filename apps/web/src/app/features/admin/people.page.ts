import { Component, computed, inject, resource, signal } from '@angular/core';
import { TPipe, t } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { Role } from '@cms/shared';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { AdminUser, DepartmentOverview } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { EmptyState } from '../../shared/empty-state';
import { ago, humanize } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { DepartmentDialog } from './department-dialog';
import { UserDialog, type UserDialogData } from './user-dialog';

const ROLE_TONE: Record<string, string> = {
  ADMIN: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/25',
  LEGAL: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25',
  MANAGER: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25',
  FINANCE: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25',
  EMPLOYEE: 'bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/20',
};

@Component({
  imports: [TPipe, FormsModule, MatButtonModule, MatIconModule, MatMenuModule, MatSelectModule, MatTabsModule, PageHeader, Avatar, Skeleton, EmptyState],
  template: `
    <cms-page-header [eyebrow]="'Administration' | t" [title]="'People & teams' | t" [subtitle]="'Who can sign in, what they can do, and who leads each department.' | t">
      <button mat-stroked-button (click)="newDepartment()"><mat-icon>add_business</mat-icon>{{ 'New department' | t }}</button>
      <button mat-flat-button (click)="edit(null)"><mat-icon>person_add</mat-icon>{{ 'Add person' | t }}</button>
    </cms-page-header>

    <mat-tab-group animationDuration="200ms" mat-stretch-tabs="false">
      <mat-tab [label]="('People' | t) + ' (' + (users.value()?.length ?? '…') + ')'">
        <div class="mt-5 mb-4 flex flex-wrap gap-3">
          <div class="relative min-w-60 flex-1 sm:max-w-sm">
            <mat-icon class="pointer-events-none absolute top-1/2 left-3 !size-5 -translate-y-1/2 !text-[20px] text-faint">search</mat-icon>
            <input [(ngModel)]="query" [placeholder]="'Search name or email' | t" [attr.aria-label]="'Search people' | t" class="h-10 w-full rounded-xl bg-card pr-3 pl-10 text-sm text-ink ring-1 ring-line outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--accent)]" />
          </div>
          <div class="flex gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
            @for (r of ['', ...roles]; track r) {
              <button class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted transition-all" [class]="roleFilter() === r ? '!bg-card !text-ink shadow-sm ring-1 ring-line' : ''" (click)="roleFilter.set(r)">{{ r ? humanize(r) : ('All' | t) }}</button>
            }
          </div>
        </div>
        <div class="card overflow-hidden">
          @if (users.isLoading() && !users.value()) {
            <cms-skeleton [rows]="6" />
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-line bg-subtle/60 text-xs text-muted">
                  <tr><th class="py-3 pr-4 pl-5 font-medium">{{ 'Person' | t }}</th><th class="px-4 font-medium">{{ 'Role' | t }}</th><th class="px-4 font-medium">{{ 'Department' | t }}</th><th class="px-4 font-medium">{{ 'Last sign-in' | t }}</th><th class="px-4 font-medium">{{ 'Status' | t }}</th><th></th></tr>
                </thead>
                <tbody class="divide-y divide-line-soft">
                  @for (u of filtered(); track u.id; let i = $index) {
                    <tr class="stagger transition-colors hover:bg-subtle/60" [style.--i]="i" [class.opacity-60]="!u.isActive">
                      <td class="py-3 pr-4 pl-5">
                        <div class="flex items-center gap-3">
                          <cms-avatar [name]="u.firstName + ' ' + u.lastName" [size]="34" />
                          <div class="min-w-0">
                            <p class="font-medium text-ink">{{ u.firstName }} {{ u.lastName }} @if (u.id === selfId) {<span class="text-xs font-normal text-accent">{{ '(you)' | t }}</span>}</p>
                            <p class="truncate text-xs text-muted">{{ u.email }}</p>
                          </div>
                        </div>
                      </td>
                      <td class="px-4"><span class="rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset" [class]="roleTone[u.role]">{{ humanize(u.role) }}</span></td>
                      <td class="px-4 text-body">
                        {{ u.department.name }}
                        @if (u.headOf) {
                          <span class="ml-1 rounded bg-seal-500/15 px-1.5 py-0.5 text-[11px] font-medium text-seal-600 dark:text-seal-400">{{ 'Head' | t }}</span>
                        }
                      </td>
                      <td class="px-4 text-muted">{{ u.lastLoginAt ? ago(u.lastLoginAt) : ('Never' | t) }}</td>
                      <td class="px-4">
                        <span class="inline-flex items-center gap-1.5 text-xs font-medium" [class]="u.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-faint'">
                          <span class="size-1.5 rounded-full bg-current"></span>{{ (u.isActive ? 'Active' : 'Inactive') | t }}
                        </span>
                      </td>
                      <td class="pr-3 text-right"><button mat-icon-button (click)="edit(u)" [attr.aria-label]="('Edit' | t) + ' ' + u.firstName"><mat-icon>edit</mat-icon></button></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6"><cms-empty icon="person_search" [title]="'Nobody matches' | t" [text]="'Try another name or role.' | t" /></td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </mat-tab>

      <mat-tab [label]="('Departments' | t) + ' (' + (departments.value()?.length ?? '…') + ')'">
        <div class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (d of departments.value(); track d.id; let i = $index) {
            <section class="card stagger p-5" [style.--i]="i">
              <div class="flex items-start justify-between">
                <div>
                  <h3 class="font-semibold">{{ d.name }}</h3>
                  <p class="font-mono text-xs text-muted">{{ d.code }}</p>
                </div>
                <span class="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"><mat-icon>apartment</mat-icon></span>
              </div>
              <div class="mt-4 flex gap-6 text-sm">
                <div><p class="text-2xl font-semibold text-ink tabular-nums">{{ d._count.members }}</p><p class="text-xs text-muted">{{ 'people' | t }}</p></div>
                <div><p class="text-2xl font-semibold text-ink tabular-nums">{{ d._count.contracts }}</p><p class="text-xs text-muted">{{ 'contracts' | t }}</p></div>
              </div>
              <div class="mt-4 border-t border-line-soft pt-4">
                <p class="mb-1 text-xs text-muted">{{ 'Head (receives escalations first)' | t }}</p>
                <mat-select class="!text-sm" [value]="d.head?.id ?? null" (selectionChange)="setHead(d, $event.value)" [attr.aria-label]="'Head of {name}' | t: { name: d.name }" [placeholder]="'No head' | t">
                  <mat-option [value]="null">{{ 'No head' | t }}</mat-option>
                  @for (u of membersOf(d.id); track u.id) {
                    <mat-option [value]="u.id">{{ u.firstName }} {{ u.lastName }} · {{ humanize(u.role) }}</mat-option>
                  }
                </mat-select>
              </div>
            </section>
          }
        </div>
      </mat-tab>
    </mat-tab-group>
  `,
})
export class PeoplePage {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);
  protected readonly selfId = inject(AuthService).user()?.id ?? '';
  protected readonly users = resource({ loader: () => this.api.users({}) });
  protected readonly departments = resource({ loader: () => this.api.departmentsOverview() });
  protected readonly roles = Object.values(Role);
  protected readonly roleTone = ROLE_TONE;
  protected readonly humanize = humanize;
  protected readonly ago = ago;
  protected query = '';
  protected readonly roleFilter = signal('');

  protected filtered() {
    const q = this.query.trim().toLowerCase();
    return (this.users.value() ?? []).filter(
      (u) => (!this.roleFilter() || u.role === this.roleFilter()) && (!q || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q)),
    );
  }

  protected readonly members = computed(() => this.users.value()?.filter((u) => u.isActive) ?? []);
  protected membersOf(deptId: string) {
    return this.members().filter((u) => u.department.id === deptId);
  }

  protected edit(user: AdminUser | null) {
    const data: UserDialogData = { user, departments: this.departments.value() ?? [], selfId: this.selfId };
    this.dialog
      .open(UserDialog, { data, width: '560px' })
      .afterClosed()
      .subscribe((saved) => {
        if (!saved) return;
        this.toast.success(t(user ? 'Changes saved' : 'Person added'));
        this.users.reload();
        this.departments.reload();
      });
  }

  protected async setHead(d: DepartmentOverview, userId: string | null) {
    try {
      await this.api.setDepartmentHead(d.id, userId);
      this.toast.success(t(userId ? 'Department head updated' : 'Head removed'));
      this.departments.reload();
      this.users.reload();
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected newDepartment() {
    this.dialog
      .open(DepartmentDialog, { width: '440px' })
      .afterClosed()
      .subscribe((created) => {
        if (!created) return;
        this.toast.success(t('Department created'));
        this.departments.reload();
      });
  }
}
