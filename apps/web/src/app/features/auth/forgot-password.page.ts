import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import { AuthCard } from './auth-card';

@Component({
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, AuthCard],
  template: `
    @if (!sent()) {
      <cms-auth-card title="Forgot your password?" subtitle="Enter your work email and we'll send you a link to choose a new one.">
        <form (ngSubmit)="submit()">
          <mat-form-field class="w-full">
            <mat-label>Work email</mat-label>
            <mat-icon matPrefix class="!mr-2 text-faint">mail</mat-icon>
            <input matInput type="email" name="email" autocomplete="username" [(ngModel)]="email" required />
          </mat-form-field>
          @if (error()) {
            <div class="callout tone-danger mb-4" role="alert"><mat-icon>error</mat-icon>{{ error() }}</div>
          }
          <button mat-flat-button class="!h-11 w-full" [disabled]="busy() || !email().includes('@')">{{ busy() ? 'Sending…' : 'Send reset link' }}</button>
        </form>
        <a routerLink="/login" class="mt-6 flex items-center justify-center gap-1 text-sm font-medium text-accent hover:underline">
          <mat-icon class="!size-4 !text-[16px]">arrow_back</mat-icon>Back to sign in
        </a>
      </cms-auth-card>
    } @else {
      <cms-auth-card title="Check your inbox">
        <div class="flex flex-col items-center text-center">
          <span class="mb-4 flex size-16 animate-pop items-center justify-center rounded-full bg-accent-soft text-accent-ink"><mat-icon class="!size-8 !text-[32px]">mark_email_read</mat-icon></span>
          <p class="text-sm text-body">If an account exists for <b class="text-ink">{{ email() }}</b>, a reset link is on its way. It's valid for one hour.</p>
          <p class="mt-3 text-xs text-muted">Nothing after a few minutes? Check your spam folder, or try again.</p>
          <div class="mt-6 flex gap-2">
            <button mat-stroked-button (click)="sent.set(false)">Try another email</button>
            <a mat-flat-button routerLink="/login">Back to sign in</a>
          </div>
        </div>
      </cms-auth-card>
    }
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(Api);
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.forgotPassword(this.email().trim());
      this.sent.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
