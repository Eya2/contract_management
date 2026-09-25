import { Component, DestroyRef, inject, signal } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import type { AppNotification } from '../core/models';
import { ago } from '../shared/format';

const POLL_MS = 30_000;

/**
 * The bell: an unread counter refreshed every 30 s (and when the tab regains
 * focus), and a menu with the latest notifications. Opening one marks it read
 * and follows its link.
 */
@Component({
  selector: 'cms-notification-bell',
  imports: [MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule],
  template: `
    <button
      mat-icon-button
      [matMenuTriggerFor]="menu"
      (menuOpened)="load()"
      aria-label="Notifications"
      [matBadge]="unread() > 99 ? '99+' : unread()"
      matBadgeColor="warn"
      [matBadgeHidden]="!unread()"
    >
      <mat-icon>notifications</mat-icon>
    </button>
    <mat-menu #menu="matMenu" xPosition="before" class="notification-menu">
      <div class="flex w-96 max-w-full items-center justify-between px-4 py-2" (click)="$event.stopPropagation()">
        <span class="font-semibold">Notifications</span>
        <button mat-button [disabled]="!unread()" (click)="markAll()">Mark all read</button>
      </div>
      @for (n of items(); track n.id) {
        <button mat-menu-item class="!h-auto !py-2" (click)="open(n)">
          <div class="flex w-80 gap-3 whitespace-normal">
            <span class="mt-1.5 size-2 shrink-0 rounded-full" [class]="n.readAt ? 'bg-transparent' : 'bg-brand-500'"></span>
            <div class="min-w-0">
              <p class="text-sm leading-snug" [class.font-semibold]="!n.readAt">{{ n.title }}</p>
              <p class="mt-0.5 line-clamp-2 text-xs text-slate-500">{{ n.body }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ ago(n.createdAt) }}</p>
            </div>
          </div>
        </button>
      } @empty {
        <p class="px-4 py-6 text-center text-sm text-slate-500">{{ loaded() ? 'You are all caught up.' : 'Loading…' }}</p>
      }
    </mat-menu>
  `,
})
export class NotificationBell {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly unread = signal(0);
  protected readonly items = signal<AppNotification[]>([]);
  protected readonly loaded = signal(false);
  protected readonly ago = ago;

  constructor() {
    void this.poll();
    const timer = setInterval(() => void this.poll(), POLL_MS);
    const onFocus = () => void this.poll();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    });
  }

  private async poll() {
    try {
      this.unread.set((await this.api.unreadCount()).unreadCount);
    } catch {
      /* transient: try again next tick */
    }
  }

  protected async load() {
    const res = await this.api.notifications();
    this.items.set(res.items);
    this.unread.set(res.unreadCount);
    this.loaded.set(true);
  }

  protected async open(n: AppNotification) {
    if (!n.readAt) {
      await this.api.markRead(n.id);
      this.unread.update((c) => Math.max(0, c - 1));
    }
    if (n.link) await this.router.navigateByUrl(n.link);
  }

  protected async markAll() {
    await this.api.markAllRead();
    this.unread.set(0);
    this.items.update((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }
}
