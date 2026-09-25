import { Component, inject, signal } from '@angular/core';
import { TPipe, t } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';
import { Toast } from '../../core/toast.service';
import { ThemeSwitch } from '../../layout/theme-switch';
import { Avatar } from '../../shared/avatar';
import { humanize } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { PasswordRules, passwordOk } from '../../shared/password-rules';

@Component({
  imports: [TPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, PageHeader, Avatar, PasswordRules, ThemeSwitch],
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
          <h2 class="font-semibold">{{ 'Appearance' | t }}</h2>
          <p class="mt-1 text-sm text-muted">{{ 'Saved on this device.' | t }}</p>
        </div>
        <div class="max-w-xs"><cms-theme-switch /></div>
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
