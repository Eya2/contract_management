import { Component, inject, input, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';
import { LangSwitch } from '../../layout/lang-switch';
import { ThemeSwitch } from '../../layout/theme-switch';
import { Logo } from '../../shared/logo';

@Component({
  imports: [TPipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, Logo, ThemeSwitch, LangSwitch],
  styles: `
    .sig {
      stroke-dasharray: 260;
      stroke-dashoffset: 260;
      animation: draw 2.4s 0.6s cubic-bezier(0.65, 0, 0.35, 1) forwards;
    }
    .seal {
      animation: pop 0.5s 2.8s cubic-bezier(0.22, 1, 0.36, 1) both;
      transform-origin: center;
      transform-box: fill-box;
    }
    .float {
      animation: float 7s ease-in-out infinite;
    }
    @keyframes draw {
      to { stroke-dashoffset: 0; }
    }
    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(-2deg); }
      50% { transform: translateY(-10px) rotate(-1deg); }
    }
  `,
  template: `
    <div class="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <!-- Brand panel -->
      <section class="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col">
        <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_20%_-10%,#3d63f055,transparent),radial-gradient(40rem_30rem_at_110%_110%,#ec9a1c33,transparent)]"></div>
        <div class="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:40px_40px]"></div>

        <div class="relative"><cms-logo class="[&_span.text-ink]:!text-white [&_.text-accent]:!text-brand-300" /></div>

        <div class="relative my-auto max-w-lg">
          <h2 class="animate-rise text-4xl leading-tight font-semibold !text-white">{{ 'Agreements, approved.' | t }}<br /><span class="text-brand-300">{{ 'Signed. Renewed. On time.' | t }}</span></h2>
          <p class="stagger mt-4 text-base text-brand-100/80" style="--i: 2">
            {{ 'Draft contracts, route them through the right approvers, collect legally binding e-signatures and never miss a renewal.' | t }}
          </p>

          <!-- A contract being signed -->
          <div class="float relative mt-10 w-80 rounded-2xl bg-white p-5 text-slate-800 shadow-2xl shadow-black/40">
            <div class="mb-3 flex items-center justify-between">
              <span class="text-xs font-semibold tracking-wide text-slate-400">{{ 'CTR-2027-00042' | t }}</span>
              <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20">{{ 'Approved' | t }}</span>
            </div>
            <p class="font-semibold">{{ 'Master services agreement' | t }}</p>
            <div class="mt-3 space-y-1.5">
              <div class="h-1.5 w-full rounded bg-slate-100"></div>
              <div class="h-1.5 w-11/12 rounded bg-slate-100"></div>
              <div class="h-1.5 w-4/5 rounded bg-slate-100"></div>
            </div>
            <svg viewBox="0 0 280 70" class="mt-4 w-full">
              <path class="sig" d="M10 50c18-26 32-40 44-34 14 7-10 36 6 38 16 2 26-30 40-26 10 3 6 20 18 20 16 0 20-22 36-20 12 2 8 16 22 14 14-2 30-10 44-6" fill="none" stroke="#2747dc" stroke-width="2.6" stroke-linecap="round" />
              <line x1="8" y1="62" x2="272" y2="62" stroke="#e2e8f0" stroke-width="1.5" />
              <g class="seal"><circle cx="250" cy="24" r="16" fill="#ec9a1c" /><path d="M243 24l5 5 9-10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></g>
            </svg>
          </div>
        </div>

        <ul class="relative grid grid-cols-3 gap-6 text-sm text-brand-100/80">
          @for (f of features; track f.icon; let i = $index) {
            <li class="stagger" [style.--i]="i + 4">
              <mat-icon class="mb-2 text-seal-400">{{ f.icon }}</mat-icon>
              <p class="font-medium text-white">{{ f.title | t }}</p>
              <p class="text-xs">{{ f.text | t }}</p>
            </li>
          }
        </ul>
      </section>

      <!-- Sign-in -->
      <section class="flex flex-col px-6 py-8 sm:px-12">
        <div class="flex items-center justify-between">
          <cms-logo class="lg:invisible" />
          <div class="flex gap-2"><div class="w-24"><cms-lang-switch /></div><div class="w-36"><cms-theme-switch /></div></div>
        </div>
        <div class="mx-auto my-auto w-full max-w-sm animate-rise py-10">
          <h1 class="text-3xl font-semibold">{{ 'Welcome back' | t }}</h1>
          <p class="mt-2 text-sm text-muted">{{ 'Sign in to your workspace.' | t }}</p>

          <form class="mt-8 space-y-1" (ngSubmit)="submit()">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'Work email' | t }}</mat-label>
              <mat-icon matPrefix class="!mr-2 text-faint">mail</mat-icon>
              <input matInput type="email" name="email" autocomplete="username" [(ngModel)]="email" required />
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'Password' | t }}</mat-label>
              <mat-icon matPrefix class="!mr-2 text-faint">lock</mat-icon>
              <input matInput [type]="showPassword() ? 'text' : 'password'" name="password" autocomplete="current-password" [(ngModel)]="password" required />
              <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())" [attr.aria-label]="(showPassword() ? 'Hide password' : 'Show password') | t">
                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>
            <div class="-mt-2 mb-4 flex items-center justify-between">
              <mat-checkbox name="remember" [(ngModel)]="remember" class="-ml-2.5">{{ 'Keep me signed in' | t }}</mat-checkbox>
              <a routerLink="/forgot-password" [queryParams]="{}" class="text-sm font-medium text-accent hover:underline">{{ 'Forgot password?' | t }}</a>
            </div>
            @if (error()) {
              <div class="callout tone-danger mb-4 animate-rise" role="alert"><mat-icon class="!size-5 !text-[20px]">error</mat-icon>{{ error() }}</div>
            }
            <button mat-flat-button class="!h-11 w-full" type="submit" [disabled]="busy() || !email() || !password()">
              @if (busy()) {
                <mat-spinner diameter="18" class="!mr-2 inline-block" />
              }
              {{ 'Sign in' | t }}
            </button>
          </form>
        </div>
      </section>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly returnUrl = input<string>();
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly remember = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly features = [
    { icon: 'account_tree', title: 'Smart approvals', text: 'Conditional, parallel, escalated.' },
    { icon: 'draw', title: 'E-signature', text: 'Evidence for every signature.' },
    { icon: 'event_repeat', title: 'Renewals', text: 'Reminders at 30, 7 and 1 days.' },
  ];

  protected async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email(), this.password(), this.remember());
      await this.router.navigateByUrl(this.returnUrl() || '/');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
