import { Component, inject, signal } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { CountsService } from '../core/counts.service';
import type { AppNotification } from '../core/models';
import { ago } from '../shared/format';

const ICONS: Record<string, string> = {
  APPROVAL_REQUESTED: 'fact_check',
  APPROVAL_GRANTED: 'thumb_up',
  CONTRACT_APPROVED: 'verified',
  CONTRACT_REJECTED: 'block',
  APPROVAL_ESCALATED: 'priority_high',
  SIGNATURE_REQUESTED: 'draw',
  CONTRACT_SIGNED: 'handshake',
  CONTRACT_EXPIRING: 'event_upcoming',
};

/** The bell: unread count (from CountsService) and a menu of the latest notifications. */
@Component({
  selector: 'cms-notification-bell',
  imports: [RouterLink, MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
    <button
      mat-icon-button
      [matMenuTriggerFor]="menu"
      (menuOpened)="load()"
      aria-label="Notifications"
      matTooltip="Notifications"
      [matBadge]="counts.unread() > 99 ? '99+' : counts.unread()"
      [matBadgeHidden]="!counts.unread()"
      matBadgeColor="warn"
    >
      <mat-icon [class.icon-filled]="counts.unread() > 0">notifications</mat-icon>
    </button>
    <mat-menu #menu="matMenu" xPosition="before" class="wide-menu">
      <div class="flex w-[26rem] max-w-full items-center justify-between px-4 pt-2 pb-1" (click)="$event.stopPropagation()">
        <span class="font-semibold text-ink">Notifications</span>
        <button mat-button [disabled]="!counts.unread()" (click)="markAll()">Mark all read</button>
      </div>
      @for (n of items(); track n.id; let i = $index) {
        <button mat-menu-item class="!h-auto !py-2.5" (click)="open(n)">
          <div class="flex w-[23rem] max-w-full gap-3 whitespace-normal">
            <span class="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <mat-icon class="!m-0 !size-[18px] !text-[18px]">{{ icon(n.type) }}</mat-icon>
              @if (!n.readAt) {
                <span class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-seal-500 ring-2 ring-[var(--raised)]"></span>
              }
            </span>
            <div class="min-w-0">
              <p class="text-sm leading-snug text-ink" [class.font-semibold]="!n.readAt">{{ n.title }}</p>
              <p class="mt-0.5 line-clamp-2 text-xs text-muted">{{ n.body }}</p>
              <p class="mt-1 text-[11px] text-faint">{{ ago(n.createdAt) }}</p>
            </div>
          </div>
        </button>
      } @empty {
        <div class="px-4 py-8 text-center">
          <mat-icon class="text-faint">notifications_off</mat-icon>
          <p class="mt-1 text-sm text-muted">{{ loaded() ? 'You are all caught up.' : 'Loading…' }}</p>
        </div>
      }
      <div class="border-t border-line-soft px-2 pt-1">
        <a mat-button routerLink="/notifications" class="!w-full">See all notifications</a>
      </div>
    </mat-menu>
  `,
})
export class NotificationBell {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly counts = inject(CountsService);
  protected readonly items = signal<AppNotification[]>([]);
  protected readonly loaded = signal(false);
  protected readonly ago = ago;

  protected icon(type: string) {
    return ICONS[type] ?? 'notifications';
  }

  protected async load() {
    const res = await this.api.notifications();
    this.items.set(res.items);
    this.counts.unread.set(res.unreadCount);
    this.loaded.set(true);
  }

  protected async open(n: AppNotification) {
    if (!n.readAt) {
      await this.api.markRead(n.id);
      this.counts.unread.update((c) => Math.max(0, c - 1));
    }
    if (n.link) await this.router.navigateByUrl(n.link);
  }

  protected async markAll() {
    await this.api.markAllRead();
    this.counts.unread.set(0);
    this.items.update((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }
}
