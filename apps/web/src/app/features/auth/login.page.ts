import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';

/** Seeded demo accounts (see README), for trying each role quickly. */
const DEMO = [
  { email: 'sales@contracthub.dev', label: 'Sami · Employee, Sales' },
  { email: 'sales.manager@contracthub.dev', label: 'Sarah · Manager, Sales' },
  { email: 'legal@contracthub.dev', label: 'Leila · Legal' },
  { email: 'finance@contracthub.dev', label: 'Farah · Finance' },
  { email: 'admin@contracthub.dev', label: 'Alex · Admin' },
];

@Component({
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4">
      <div class="w-full max-w-md">
        <div class="mb-8 text-center">
          <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">C</div>
          <h1 class="text-2xl font-bold text-ink">Sign in to Contract Hub</h1>
          <p class="mt-1 text-sm text-muted">Draft, approve and sign contracts in one place.</p>
        </div>
        <form class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200" (ngSubmit)="submit()">
          <mat-form-field class="w-full">
            <mat-label>Email</mat-label>
            <input matInput type="email" name="email" autocomplete="username" [(ngModel)]="email" required />
          </mat-form-field>
          <mat-form-field class="w-full">
            <mat-label>Password</mat-label>
            <input matInput type="password" name="password" autocomplete="current-password" [(ngModel)]="password" required />
          </mat-form-field>
          @if (error()) {
            <p class="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{{ error() }}</p>
          }
          <button mat-flat-button class="w-full" type="submit" [disabled]="busy() || !email() || !password()">
            @if (busy()) {
              <mat-spinner diameter="18" class="mr-2 inline-block" />
            }
            Sign in
          </button>
        </form>
        <div class="mt-6 rounded-2xl bg-white/70 p-4 ring-1 ring-slate-200">
          <p class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Demo accounts · password Demo1234!</p>
          <div class="flex flex-wrap gap-2">
            @for (d of demo; track d.email) {
              <button type="button" class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-brand-100 hover:text-brand-700" (click)="useDemo(d.email)">
                {{ d.label }}
              </button>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly returnUrl = input<string>();
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly demo = DEMO;

  protected useDemo(email: string) {
    this.email.set(email);
    this.password.set('Demo1234!');
    void this.submit();
  }

  protected async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email(), this.password());
      await this.router.navigateByUrl(this.returnUrl() || '/');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
