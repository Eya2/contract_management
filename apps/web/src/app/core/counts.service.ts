import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Api } from './api.service';
import { AuthService } from './auth.service';
import { LiveService } from './live.service';

const POLL_MS = 30_000;

/**
 * Live counters shown in the chrome: unread notifications and approvals
 * waiting for the user. Refreshed as soon as the live stream reports a change,
 * whenever the tab regains focus, and every 30 s only while the stream is down;
 * pages call `refresh()` after an action that changes them.
 */
@Injectable({ providedIn: 'root' })
export class CountsService {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  readonly unread = signal(0);
  readonly pendingApprovals = signal(0);

  private readonly live = inject(LiveService);

  constructor() {
    const timer = setInterval(() => {
      if (!this.live.connected()) void this.refresh();
    }, POLL_MS);
    // Approving a step changes other people's queues: any contract change may move a counter.
    this.live.on((m) => m.type === 'notification' && void this.refresh());
    this.live.onContractChange(() => void this.refresh());
    const onFocus = () => void this.refresh();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    });
  }

  async refresh() {
    if (!this.auth.isLoggedIn()) return;
    try {
      const [unread, pending] = await Promise.all([
        this.api.unreadCount(),
        this.auth.can('approval.decide') ? this.api.pendingApprovals() : Promise.resolve([]),
      ]);
      this.unread.set(unread.unreadCount);
      this.pendingApprovals.set(pending.length);
    } catch {
      /* transient: next tick retries */
    }
  }
}
