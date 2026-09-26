import { Component, inject, resource, signal } from '@angular/core';
import { TPipe, t } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';
import type { NotificationPrefs } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { LangSwitch } from '../../layout/lang-switch';
import { ThemeSwitch } from '../../layout/theme-switch';
import { Avatar } from '../../shared/avatar';
import { humanize } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { PasswordRules, passwordOk } from '../../shared/password-rules';

@Component({
  imports: [TPipe, FormsModule, MatButtonModule, MatCheckboxModule, MatSlideToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, PageHeader, Avatar, PasswordRules, ThemeSwitch, LangSwitch],
  template: `
    <cms-page-header [title]="'Account settings' | t" [subtitle]="'Your profile, password and preferences.' | t" />

    <div class="grid max-w-4xl gap-6">
      <section class="card stagger grid gap-6 p-6 md:grid-cols-[14rem_1fr]" style="--i: 0">
        <div>
          <h2 class="font-semibold">{{ 'Profile' | t }}</h2>
          <p class="mt-1 text-sm text-muted">{{ 'How colleagues see you on approvals and signatures.' | t }}</p>
        </div>
        <form (ngSubmit)="saveProfile()">
          <div class="mb-5 flex items-center gap-4">
            <cms-avatar [name]="firstName() + ' ' + lastName()" [size]="56" />
            <div class="text-sm">
              <p class="font-medium text-ink">{{ auth.user()?.email }}</p>
              <p class="text-muted">{{ humanize(auth.user()?.role ?? '') }} · {{ auth.user()?.department?.name }}</p>
              <p class="mt-1 text-xs text-faint">{{ 'Email, role and department are managed by an admin.' | t }}</p>
            </div>
          </div>
          <div class="grid gap-x-4 sm:grid-cols-2">
            <mat-form-field><mat-label>{{ 'First name' | t }}</mat-label><input matInput name="fn" [(ngModel)]="firstName" required /></mat-form-field>
            <mat-form-field><mat-label>{{ 'Last name' | t }}</mat-label><input matInput name="ln" [(ngModel)]="lastName" required /></mat-form-field>
          </div>
          <button mat-flat-button [disabled]="savingProfile() || !firstName().trim() || !lastName().trim()">{{ 'Save profile' | t }}</button>
        </form>
      </section>

      <section class="card stagger grid gap-6 p-6 md:grid-cols-[14rem_1fr]" style="--i: 1">
        <div>
          <h2 class="font-semibold">{{ 'Password' | t }}</h2>
          <p class="mt-1 text-sm text-muted">{{ 'Changing it signs you out on every other device.' | t }}</p>
        </div>
        <form (ngSubmit)="changePassword()">
          <mat-form-field class="w-full"><mat-label>{{ 'Current password' | t }}</mat-label><input matInput type="password" name="cur" autocomplete="current-password" [(ngModel)]="current" required /></mat-form-field>
          <mat-form-field class="w-full" subscriptSizing="dynamic"><mat-label>{{ 'New password' | t }}</mat-label><input matInput type="password" name="new" autocomplete="new-password" [(ngModel)]="next" required /></mat-form-field>
          <cms-password-rules [password]="next()" />
          <mat-form-field class="w-full">
            <mat-label>{{ 'Confirm new password' | t }}</mat-label>
            <input matInput type="password" name="confirm" autocomplete="new-password" [(ngModel)]="confirm" required />
            @if (confirm() && confirm() !== next()) {
              <mat-hint class="!text-rose-600">{{ 'The passwords don’t match' | t }}</mat-hint>
            }
          </mat-form-field>
          @if (passwordError()) {
            <div class="callout tone-danger mb-4" role="alert"><mat-icon>error</mat-icon>{{ passwordError() }}</div>
          }
          <button mat-flat-button [disabled]="savingPassword() || !current() || !passwordOk(next()) || next() !== confirm()">{{ 'Change password' | t }}</button>
        </form>
      </section>

      <section class="card stagger grid gap-6 p-6 md:grid-cols-[14rem_1fr]" style="--i: 2">
        <div>
          <h2 id="notif-heading" class="font-semibold">{{ 'Notifications' | t }}</h2>
          <p class="mt-1 text-sm text-muted">{{ 'Choose how you hear about each event. Changes are saved right away.' | t }}</p>
        </div>
        <div class="min-w-0">
          @if (prefs.error()) {
            <div class="callout tone-danger"><mat-icon>error</mat-icon>{{ 'Could not load your notification settings.' | t }}</div>
          } @else if (prefs.value(); as p) {
            <table class="w-full text-sm" aria-labelledby="notif-heading">
              <thead>
                <tr class="border-b border-line text-xs text-muted">
                  <th class="py-2 pr-3 text-left font-medium">{{ 'Event' | t }}</th>
                  <th class="w-20 py-2 text-center font-medium">{{ 'In the app' | t }}</th>
                  <th class="w-20 py-2 text-center font-medium">{{ 'Email' | t }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-soft">
                @for (e of events; track e.type) {
                  <tr>
                    <td class="py-2 pr-3">
                      <span class="flex items-center gap-2 text-ink"><mat-icon class="!size-[18px] shrink-0 !text-[18px] text-faint">{{ e.icon }}</mat-icon>{{ e.label | t }}</span>
                    </td>
                    <td class="text-center">
                      <mat-checkbox [checked]="p.prefs[e.type]?.inApp ?? true" (change)="setChannel(e.type, 'inApp', $event.checked)" [aria-label]="('In the app' | t) + ': ' + (e.label | t)" />
                    </td>
                    <td class="text-center">
                      <mat-checkbox [checked]="p.prefs[e.type]?.email ?? true" (change)="setChannel(e.type, 'email', $event.checked)" [aria-label]="('Email' | t) + ': ' + (e.label | t)" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="mt-5 flex items-start gap-3 rounded-xl bg-subtle p-4">
              <mat-slide-toggle [checked]="p.dailyDigest" (change)="setDigest($event.checked)" [aria-label]="'Daily summary email' | t" />
              <div class="text-sm">
                <p class="font-medium text-ink">{{ 'Daily summary email' | t }}</p>
                <p class="text-muted">{{ 'Every morning: approvals and signatures waiting for you, contracts ending this week and the day’s notifications. Not sent when there is nothing to report.' | t }}</p>
              </div>
            </div>
          } @else {
            <p class="text-sm text-muted">{{ 'Loading…' | t }}</p>
          }
        </div>
      </section>

      <section class="card stagger grid gap-6 p-6 md:grid-cols-[14rem_1fr]" style="--i: 3">
        <div>
          <h2 class="font-semibold">{{ 'Appearance' | t }}</h2>
          <p class="mt-1 text-sm text-muted">{{ 'Saved on this device.' | t }}</p>
        </div>
        <div class="flex max-w-sm flex-col gap-3"><div><p class="mb-1 text-xs text-muted">{{ 'Theme' | t }}</p><cms-theme-switch /></div><div class="max-w-40"><p class="mb-1 text-xs text-muted">{{ 'Language' | t }}</p><cms-lang-switch /></div></div>
      </section>
    </div>
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly firstName = signal(this.auth.user()?.firstName ?? '');
  protected readonly lastName = signal(this.auth.user()?.lastName ?? '');
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly confirm = signal('');
  protected readonly savingProfile = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly humanize = humanize;
  protected readonly passwordOk = passwordOk;

  protected readonly prefs = resource({ loader: () => this.api.notificationPrefs() });
  protected readonly events = [
    { type: 'APPROVAL_REQUESTED', label: 'A contract needs my approval', icon: 'fact_check' },
    { type: 'APPROVAL_ESCALATED', label: 'An overdue approval is escalated to me', icon: 'priority_high' },
    { type: 'APPROVAL_GRANTED', label: 'A step of my contract is approved', icon: 'thumb_up' },
    { type: 'CONTRACT_APPROVED', label: 'My contract is fully approved', icon: 'verified' },
    { type: 'CONTRACT_REJECTED', label: 'My contract is rejected', icon: 'block' },
    { type: 'SIGNATURE_REQUESTED', label: 'A contract is waiting for my signature', icon: 'draw' },
    { type: 'CONTRACT_SIGNED', label: 'A contract is signed', icon: 'handshake' },
    { type: 'CONTRACT_EXPIRING', label: 'Renewal reminders and end of term', icon: 'event_upcoming' },
    { type: 'COMMENT_ADDED', label: 'Someone comments on my contract', icon: 'add_comment' },
    { type: 'COMMENT_REPLY', label: 'Someone replies in a discussion I’m in', icon: 'forum' },
    { type: 'COMMENT_MENTION', label: 'Someone mentions me', icon: 'alternate_email' },
  ];

  protected setChannel(type: string, channel: 'email' | 'inApp', on: boolean) {
    const p = this.prefs.value()!;
    const current = p.prefs[type] ?? { email: true, inApp: true };
    void this.savePrefs({ ...p, prefs: { ...p.prefs, [type]: { ...current, [channel]: on } } });
  }

  protected setDigest(on: boolean) {
    void this.savePrefs({ ...this.prefs.value()!, dailyDigest: on });
  }

  /** Optimistic: shows the change at once, puts it back if saving fails. */
  private async savePrefs(next: NotificationPrefs) {
    const previous = this.prefs.value()!;
    this.prefs.set(next);
    try {
      this.prefs.set(await this.api.saveNotificationPrefs(next));
      this.toast.success(t('Notification settings saved'));
    } catch (err) {
      this.prefs.set(previous);
      this.toast.error(err);
    }
  }

  protected async saveProfile() {
    this.savingProfile.set(true);
    try {
      this.auth.setProfile(await this.api.updateProfile({ firstName: this.firstName().trim(), lastName: this.lastName().trim() }));
      this.toast.success(t('Profile saved'));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.savingProfile.set(false);
    }
  }

  protected async changePassword() {
    this.savingPassword.set(true);
    this.passwordError.set(null);
    try {
      await this.api.changePassword(this.current(), this.next());
      this.current.set('');
      this.next.set('');
      this.confirm.set('');
      this.toast.success(t('Password changed. Other devices were signed out.'));
    } catch (err) {
      this.passwordError.set(errorMessage(err));
    } finally {
      this.savingPassword.set(false);
    }
  }
}
