import { Component, computed, inject, signal } from '@angular/core';
import { TPipe } from '../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { CountsService } from '../core/counts.service';
import { Avatar } from '../shared/avatar';
import { humanize } from '../shared/format';
import { Logo } from '../shared/logo';
import { NotificationBell } from './notification-bell';
import { LangSwitch } from './lang-switch';
import { ThemeSwitch } from './theme-switch';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
  badge?: () => number;
}

/** Signed-in layout: sidebar navigation (a drawer on small screens) and a top bar. */
@Component({
  selector: 'cms-shell',
  imports: [TPipe, 
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    NotificationBell,
    ThemeSwitch,
    LangSwitch,
    Logo,
    Avatar,
  ],
  template: `
    <div class="min-h-screen lg:pl-[17rem]">
      <!-- Mobile backdrop -->
      @if (drawerOpen()) {
        <div class="fixed inset-0 z-30 animate-fade bg-[rgb(8_12_26/0.45)] backdrop-blur-[2px] lg:hidden" (click)="drawerOpen.set(false)"></div>
      }

      <aside
        class="fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col border-r border-line bg-card transition-transform duration-300 ease-[var(--ease-spring)] lg:translate-x-0"
        [class.-translate-x-full]="!drawerOpen()"
        [attr.aria-label]="'Main navigation' | t"
      >
        <div class="flex h-16 items-center justify-between px-5">
          <a routerLink="/" (click)="drawerOpen.set(false)"><cms-logo /></a>
          <button mat-icon-button class="lg:!hidden" (click)="drawerOpen.set(false)" [attr.aria-label]="'Close menu' | t"><mat-icon>close</mat-icon></button>
        </div>

        @if (auth.can('contract.create')) {
          <div class="px-4 pb-2">
            <a mat-flat-button routerLink="/contracts/new" class="!w-full" (click)="drawerOpen.set(false)"><mat-icon>add</mat-icon>{{ 'New contract' | t }}</a>
          </div>
        }

        <nav class="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          @for (group of groups(); track group.label) {
            <div>
              <p class="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">{{ group.label | t }}</p>
              @for (item of group.items; track item.path) {
                <a
                  [routerLink]="item.path"
                  routerLinkActive="!bg-accent-soft !text-accent-ink [&_.mat-icon]:!text-accent"
                  [routerLinkActiveOptions]="{ exact: !!item.exact }"
                  (click)="drawerOpen.set(false)"
                  class="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-body transition-colors hover:bg-subtle hover:text-ink"
                >
                  <mat-icon class="!size-5 !text-[20px] text-muted transition-colors group-hover:text-ink">{{ item.icon }}</mat-icon>
                  <span class="flex-1">{{ item.label | t }}</span>
                  @if (item.badge && item.badge() > 0) {
                    <span class="min-w-5 animate-pop rounded-full bg-seal-500 px-1.5 text-center text-[11px] leading-5 font-semibold text-white">{{ item.badge() }}</span>
                  }
                </a>
              }
            </div>
          }
        </nav>

        <div class="space-y-3 border-t border-line p-4">
          <div class="grid grid-cols-[1fr_5.5rem] gap-2"><cms-theme-switch /><cms-lang-switch /></div>
          <button [matMenuTriggerFor]="userMenu" class="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-subtle">
            <cms-avatar [name]="name()" [size]="36" />
            <span class="min-w-0 flex-1 leading-tight">
              <span class="block truncate text-sm font-medium text-ink">{{ name() }}</span>
              <span class="block truncate text-xs text-muted">{{ role() }} · {{ auth.user()?.department?.name }}</span>
            </span>
            <mat-icon class="!size-5 !text-[20px] text-faint">unfold_more</mat-icon>
          </button>
          <mat-menu #userMenu="matMenu" yPosition="above">
            <div class="px-4 py-2 text-sm">
              <p class="font-medium text-ink">{{ auth.user()?.email }}</p>
              <p class="text-muted">{{ role() }} · {{ auth.user()?.department?.name }}</p>
            </div>
            <mat-divider />
            <a mat-menu-item routerLink="/settings" (click)="drawerOpen.set(false)"><mat-icon>manage_accounts</mat-icon>{{ 'Account settings' | t }}</a>
            <a mat-menu-item routerLink="/notifications" (click)="drawerOpen.set(false)"><mat-icon>notifications</mat-icon>{{ 'Notifications' | t }}</a>
            <mat-divider />
            <button mat-menu-item (click)="auth.logout()"><mat-icon>logout</mat-icon>{{ 'Sign out' | t }}</button>
          </mat-menu>
        </div>
      </aside>

      <header class="sticky top-0 z-20 border-b border-line/70 bg-canvas/80 backdrop-blur-xl">
        <div class="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button mat-icon-button class="lg:!hidden" (click)="drawerOpen.set(true)" [attr.aria-label]="'Open menu' | t"><mat-icon>menu</mat-icon></button>
          <a routerLink="/" class="lg:hidden"><cms-logo [wordmark]="false" [size]="28" /></a>
          <form class="relative ml-auto w-full max-w-md lg:ml-0" (ngSubmit)="search()" role="search">
            <mat-icon class="pointer-events-none absolute top-1/2 left-3 !size-5 -translate-y-1/2 !text-[20px] text-faint">search</mat-icon>
            <input
              name="q"
              [(ngModel)]="query"
              [placeholder]="'Search contracts, references, counterparties…' | t"
              class="h-10 w-full rounded-xl border-0 bg-card pr-3 pl-10 text-sm text-ink ring-1 ring-line transition-shadow outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--accent)]"
            />
          </form>
          <div class="flex items-center gap-1 lg:ml-auto">
            <cms-notification-bell />
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <router-outlet />
      </main>
    </div>
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  private readonly counts = inject(CountsService);
  private readonly router = inject(Router);
  protected readonly drawerOpen = signal(false);
  protected query = '';

  protected readonly name = computed(() => {
    const u = this.auth.user();
    return u ? `${u.firstName} ${u.lastName}` : '';
  });
  protected readonly role = computed(() => humanize(this.auth.user()?.role ?? ''));

  protected readonly groups = computed(() => {
    const workspace: NavItem[] = [
      { path: '/', label: 'Dashboard', icon: 'space_dashboard', exact: true },
      { path: '/contracts', label: 'Contracts', icon: 'description' },
    ];
    if (this.auth.can('approval.decide')) {
      workspace.push({ path: '/approvals', label: 'Approvals', icon: 'fact_check', badge: () => this.counts.pendingApprovals() });
    }
    const groups = [{ label: 'Workspace', items: workspace }];
    const admin: NavItem[] = [];
    if (this.auth.can('user.manage')) admin.push({ path: '/admin/people', label: 'People & teams', icon: 'group' });
    if (this.auth.can('workflow.manage')) {
      admin.push({ path: '/admin/policies', label: 'Approval policies', icon: 'account_tree' });
      admin.push({ path: '/admin/emails', label: 'Email delivery', icon: 'outgoing_mail' });
    }
    if (this.auth.can('audit.read')) admin.push({ path: '/admin/audit', label: 'Audit log', icon: 'policy' });
    if (admin.length) groups.push({ label: 'Administration', items: admin });
    return groups;
  });

  constructor() {
    void this.counts.refresh();
    // Keep the counters fresh after navigating (e.g. back from approving something).
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) void this.counts.refresh();
    });
  }

  protected search() {
    const q = this.query.trim();
    void this.router.navigate(['/contracts'], { queryParams: q ? { q } : {} });
    this.query = '';
  }
}
