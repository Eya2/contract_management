import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';

export type LiveMessage = { type: 'notification'; title: string } | { type: 'contract'; contractId: string };

const MAX_BACKOFF_MS = 30_000;

/**
 * Server-Sent Events from /api/events: the bell, counters and open pages
 * update the moment something happens instead of waiting for the next poll.
 *
 * Read with fetch rather than EventSource, so the access token travels in the
 * Authorization header and never in a URL. The server ends each stream after a
 * few minutes; we reconnect with the current (refreshed if needed) token.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly auth = inject(AuthService);
  private readonly listeners = new Set<(m: LiveMessage) => void>();
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  /** True while a stream is open; polling only runs as a fallback when it's false. */
  readonly connected = signal(false);

  /** Opens the stream (idempotent) until `stop()`. */
  start() {
    if (this.abort) return;
    this.abort = new AbortController();
    void this.run(this.abort.signal);
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    clearTimeout(this.retryTimer);
    this.connected.set(false);
  }

  /** Calls `fn` for every message until the calling component or service is destroyed. */
  on(fn: (m: LiveMessage) => void, destroyRef = inject(DestroyRef)) {
    this.listeners.add(fn);
    destroyRef.onDestroy(() => this.listeners.delete(fn));
  }

  /**
   * Calls `fn` (at most every 400 ms) when a contract changes; with `contractId`,
   * only for that contract. Bursts, like approving a stage, collapse into one call.
   */
  onContractChange(fn: () => void, contractId?: () => string | undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(timer));
    this.on((m) => {
      if (m.type !== 'contract' || (contractId && m.contractId !== contractId())) return;
      clearTimeout(timer);
      timer = setTimeout(fn, 400);
    }, destroyRef);
  }

  private async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const token = this.auth.accessToken();
        const res = await fetch('/api/events', { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal, cache: 'no-store' });
        if (res.status === 401) {
          if (!(await this.auth.refresh())) return this.stop();
          continue;
        }
        if (!res.ok || !res.body) throw new Error(`Live stream failed (${res.status})`);
        this.connected.set(true);
        const opened = Date.now();
        await this.read(res.body, signal);
        // A stream the server ends normally lasts minutes; one that closes at
        // once (a proxy in the way, a crash loop) backs off like a failure.
        this.failures = Date.now() - opened < 5000 ? this.failures + 1 : 0;
      } catch {
        if (signal.aborted) return;
        this.failures++;
      }
      this.connected.set(false);
      if (signal.aborted) return;
      // A stream that simply ended reconnects at once; failures back off.
      const delay = this.failures ? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures) : 0;
      await new Promise<void>((resolve) => (this.retryTimer = setTimeout(resolve, delay)));
    }
  }

  /** Parses the SSE stream: blocks separated by a blank line, with `event:` and `data:` fields. */
  private async read(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true });
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) this.dispatch(event, data);
      }
    }
  }

  private dispatch(event: string, data: string) {
    let message: LiveMessage;
    try {
      const payload = JSON.parse(data) as Record<string, string>;
      if (event === 'notification') message = { type: 'notification', title: payload['title'] ?? '' };
      else if (event === 'contract' && payload['contractId']) message = { type: 'contract', contractId: payload['contractId'] };
      else return;
    } catch {
      return;
    }
    for (const fn of this.listeners) fn(message);
  }
}
