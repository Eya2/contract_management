import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Api } from './api.service';
import { AuthService } from './auth.service';

const POLL_MS = 30_000;

/**
 * Live counters shown in the chrome: unread notifications and approvals
 * waiting for the user. Polled every 30 s and whenever the tab regains focus;
 * pages call `refresh()` after an action that changes them.
 */
@Injectable({ providedIn: 'root' })
export class CountsService {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  readonly unread = signal(0);
  readonly pendingApprovals = signal(0);

  constructor() {
    const timer = setInterval(() => void this.refresh(), POLL_MS);
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
