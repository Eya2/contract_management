import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { humanize } from '../shared/format';
import { NotificationBell } from './notification-bell';

/** Signed-in layout: top bar with navigation, the bell and the user menu. */
@Component({
  selector: 'cms-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule, MatDividerModule, NotificationBell],
  template: `
    <header class="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <a routerLink="/" class="flex items-center gap-2 font-semibold text-ink">
          <span class="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <mat-icon class="!size-5 !text-[20px]">description</mat-icon>
          </span>
          <span class="hidden sm:inline">Contract Hub</span>
        </a>
        <nav class="flex gap-1 overflow-x-auto text-sm">
          @for (item of nav(); track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="!bg-brand-50 !text-brand-700"
              [routerLinkActiveOptions]="{ exact: item.path === '/' }"
              class="rounded-md px-3 py-1.5 font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100"
              >{{ item.label }}</a
            >
          }
        </nav>
        <div class="ml-auto flex items-center gap-1">
          <cms-notification-bell />
          <button mat-button [matMenuTriggerFor]="userMenu" class="!px-2">
            <span class="flex items-center gap-2">
              <span class="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{{ initials() }}</span>
              <span class="hidden text-left leading-tight md:block">
                <span class="block text-sm font-medium text-ink">{{ auth.user()?.firstName }} {{ auth.user()?.lastName }}</span>
                <span class="block text-xs text-slate-500">{{ role() }} · {{ auth.user()?.department?.name }}</span>
              </span>
            </span>
          </button>
          <mat-menu #userMenu="matMenu" xPosition="before">
            <div class="px-4 py-2 text-sm">
              <p class="font-medium">{{ auth.user()?.email }}</p>
              <p class="text-slate-500">{{ role() }} · {{ auth.user()?.department?.name }}</p>
            </div>
            <mat-divider />
            <button mat-menu-item (click)="auth.logout()"><mat-icon>logout</mat-icon>Sign out</button>
          </mat-menu>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <router-outlet />
    </main>
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly initials = computed(() => {
    const u = this.auth.user();
    return u ? `${u.firstName[0]}${u.lastName[0]}` : '';
  });
  protected readonly role = computed(() => humanize(this.auth.user()?.role ?? ''));
  protected readonly nav = computed(() => [
    { path: '/', label: 'Dashboard' },
    { path: '/contracts', label: 'Contracts' },
    ...(this.auth.can('approval.decide') ? [{ path: '/approvals', label: 'Approvals' }] : []),
  ]);
}
