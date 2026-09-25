import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Profile } from './models';

interface Session {
  accessToken: string;
}

/**
 * Holds the session. The access token lives only in memory (a signal), never in
 * localStorage, so an XSS bug can't read a long-lived credential from storage.
 * The refresh token is an httpOnly cookie the browser sends to /api/auth only.
 * On page load `restore()` trades that cookie for a fresh access token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly token = signal<string | null>(null);
  readonly user = signal<Profile | null>(null);
  readonly isLoggedIn = computed(() => this.user() !== null);

  /** A refresh in flight, shared so concurrent 401s trigger only one refresh. */
  private refreshing: Promise<boolean> | null = null;

  accessToken(): string | null {
    return this.token();
  }

  /** After the user edits their own profile. */
  setProfile(profile: Profile) {
    this.user.set(profile);
  }

  can(permission: string): boolean {
    return this.user()?.permissions.includes(permission) ?? false;
  }

  async login(email: string, password: string): Promise<void> {
    const session = await firstValueFrom(this.http.post<Session>('/api/auth/login', { email, password }));
    this.token.set(session.accessToken);
    await this.loadProfile();
  }

  /** Called once at startup: resumes the session if the refresh cookie is still valid. */
  async restore(): Promise<void> {
    if (await this.refresh()) await this.loadProfile().catch(() => this.clear());
  }

  /** Rotates the refresh cookie and gets a new access token. Returns false if the session is over. */
  refresh(): Promise<boolean> {
    this.refreshing ??= firstValueFrom(this.http.post<Session>('/api/auth/refresh', {}))
      .then((s) => {
        this.token.set(s.accessToken);
        return true;
      })
      .catch(() => {
        this.clear();
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {})).catch(() => undefined);
    this.clear();
    await this.router.navigateByUrl('/login');
  }

  /** The session ended underneath us (refresh failed): back to the login page. */
  async expire(): Promise<void> {
    this.clear();
    await this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  private async loadProfile() {
    this.user.set(await firstValueFrom(this.http.get<Profile>('/api/auth/me')));
  }

  private clear() {
    this.token.set(null);
    this.user.set(null);
  }
}
