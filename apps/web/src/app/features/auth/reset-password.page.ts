import { Component, inject, input, resource, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import { PasswordRules, passwordOk } from '../../shared/password-rules';
import { AuthCard } from './auth-card';

/** Where the emailed link lands: /reset-password?token=… */
@Component({
  imports: [TPipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, AuthCard, PasswordRules],
  template: `
    @if (check.isLoading()) {
      <cms-auth-card [title]="'Checking your link…' | t"><mat-spinner diameter="28" class="mx-auto" /></cms-auth-card>
    } @else if (done()) {
      <cms-auth-card [title]="'Password updated' | t">
        <div class="flex flex-col items-center text-center">
          <span class="mb-4 flex size-16 animate-pop items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"><mat-icon class="!size-8 !text-[32px]">check</mat-icon></span>
          <p class="text-sm text-body">{{ 'You can now sign in with your new password. For your security, every other session was signed out.' | t }}</p>
          <a mat-flat-button routerLink="/login" class="mt-6">{{ 'Sign in' | t }}</a>
        </div>
      </cms-auth-card>
    } @else if (!check.value()?.valid) {
      <cms-auth-card [title]="'This link has expired' | t">
        <p class="text-sm text-body">{{ 'Reset links work once and for one hour. Request a new one to continue.' | t }}</p>
        <a mat-flat-button routerLink="/forgot-password" class="mt-6 w-full">{{ 'Send a new link' | t }}</a>
      </cms-auth-card>
    } @else {
      <cms-auth-card [title]="'Choose a new password' | t" [subtitle]="'Pick something you don’t use anywhere else.' | t">
        <form (ngSubmit)="submit()">
          <mat-form-field class="w-full" subscriptSizing="dynamic">
            <mat-label>{{ 'New password' | t }}</mat-label>
            <input matInput [type]="show() ? 'text' : 'password'" name="p1" autocomplete="new-password" [(ngModel)]="password" required />
            <button mat-icon-button matSuffix type="button" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Hide password' : 'Show password'">
              <mat-icon>{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
          </mat-form-field>
          <cms-password-rules [password]="password()" />
          <mat-form-field class="w-full">
            <mat-label>{{ 'Confirm new password' | t }}</mat-label>
            <input matInput [type]="show() ? 'text' : 'password'" name="p2" autocomplete="new-password" [(ngModel)]="confirm" required />
            @if (confirm() && confirm() !== password()) {
              <mat-hint class="!text-rose-600">{{ 'The passwords don’t match' | t }}</mat-hint>
            }
          </mat-form-field>
          @if (error()) {
            <div class="callout tone-danger mb-4" role="alert"><mat-icon>error</mat-icon>{{ error() }}</div>
          }
          <button mat-flat-button class="!h-11 w-full" [disabled]="busy() || !passwordOk(password()) || password() !== confirm()">
            {{ (busy() ? 'Saving…' : 'Update password') | t }}
          </button>
        </form>
      </cms-auth-card>
    }
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(Api);
  readonly token = input<string>('');
  protected readonly check = resource({
    params: () => this.token(),
    loader: ({ params }) => (/^[A-Za-z0-9_-]{43}$/.test(params) ? this.api.checkResetToken(params) : Promise.resolve({ valid: false })),
  });
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly passwordOk = passwordOk;

  protected async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.resetPassword(this.token(), this.password());
      this.done.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
