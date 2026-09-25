import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { TPipe, locale, t } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { Api } from '../../core/api.service';
import { CountsService } from '../../core/counts.service';
import type { AppNotification } from '../../core/models';
import { EmptyState } from '../../shared/empty-state';
import { ago, dateTime } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';

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

/** Every notification, grouped by day, with "unread only" and paging. */
@Component({
  imports: [TPipe, MatButtonModule, MatIconModule, PageHeader, EmptyState, Skeleton],
  template: `
    <cms-page-header [title]="'Notifications' | t" [subtitle]="counts.unread() ? ('{n} unread' | t: { n: counts.unread() }) : ('You are all caught up' | t)">
      <div class="flex gap-1 rounded-xl bg-subtle p-1">
        @for (f of ['all', 'unread']; track f) {
          <button class="rounded-lg px-3 py-1.5 text-sm font-medium capitalize text-muted transition-all" [class]="filter() === f ? '!bg-card !text-ink shadow-sm ring-1 ring-line' : ''" (click)="filter.set($any(f))">{{ (f === 'all' ? 'All' : 'Unread') | t }}</button>
        }
      </div>
      <button mat-stroked-button [disabled]="!counts.unread()" (click)="markAll()"><mat-icon>done_all</mat-icon>{{ 'Mark all read' | t }}</button>
    </cms-page-header>

    <div class="card max-w-3xl overflow-hidden">
      @if (loading() && !items().length) {
        <cms-skeleton [rows]="6" />
      }
      @for (group of groups(); track group.label) {
        <p class="border-b border-line-soft bg-subtle/60 px-5 py-2 text-xs font-semibold tracking-wide text-muted uppercase">{{ group.label }}</p>
        <ul class="divide-y divide-line-soft">
          @for (n of group.items; track n.id; let i = $index) {
            <li class="stagger" [style.--i]="i">
              <button class="flex w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-subtle" (click)="open(n)">
                <span class="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                  <mat-icon class="!size-5 !text-[20px]">{{ icon(n.type) }}</mat-icon>
                  @if (!n.readAt) {
                    <span class="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-seal-500 ring-2 ring-[var(--card)]"></span>
                  }
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm text-ink" [class.font-semibold]="!n.readAt">{{ n.title }}</span>
                  <span class="mt-0.5 block text-sm text-muted">{{ n.body }}</span>
                  <span class="mt-1 block text-xs text-faint" [title]="dateTime(n.createdAt)">{{ ago(n.createdAt) }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      } @empty {
        @if (!loading()) {
          <cms-empty icon="notifications_off" [title]="(filter() === 'unread' ? 'No unread notifications' : 'No notifications yet') | t" [text]="'Approvals, signatures and renewals will show up here.' | t" />
        }
      }
      @if (hasMore()) {
        <div class="border-t border-line-soft p-3 text-center"><button mat-button [disabled]="loading()" (click)="load(true)">{{ 'Load older' | t }}</button></div>
      }
    </div>
  `,
})
export class NotificationsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly counts = inject(CountsService);
  protected readonly items = signal<AppNotification[]>([]);
  protected readonly loading = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly filter = signal<'all' | 'unread'>('all');
  protected readonly ago = ago;
  protected readonly dateTime = dateTime;

  protected readonly groups = computed(() => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86_400_000).toDateString();
    const map = new Map<string, AppNotification[]>();
    for (const n of this.items()) {
      if (this.filter() === 'unread' && n.readAt) continue;
      const d = new Date(n.createdAt).toDateString();
      const label = d === today ? t('Today') : d === yesterday ? t('Yesterday') : new Date(n.createdAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
      map.set(label, [...(map.get(label) ?? []), n]);
    }
    return [...map].map(([label, items]) => ({ label, items }));
  });

  ngOnInit() {
    void this.load();
  }

  protected async load(more = false) {
    this.loading.set(true);
    try {
      const before = more ? this.items().at(-1)?.id : undefined;
      const res = await this.api.allNotifications(before);
      this.items.update((list) => (more ? [...list, ...res.items] : res.items));
      this.hasMore.set(res.items.length === 30);
      this.counts.unread.set(res.unreadCount);
    } finally {
      this.loading.set(false);
    }
  }

  protected icon(type: string) {
    return ICONS[type] ?? 'notifications';
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
