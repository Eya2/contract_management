import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LangSwitch } from '../../layout/lang-switch';
import { ThemeSwitch } from '../../layout/theme-switch';
import { Logo } from '../../shared/logo';

/** Centered card layout for the small public auth pages (forgot / reset password). */
@Component({
  selector: 'cms-auth-card',
  imports: [RouterLink, Logo, ThemeSwitch, LangSwitch],
  template: `
    <div class="relative flex min-h-screen flex-col bg-canvas px-4 py-6">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(40rem_16rem_at_50%_0%,var(--accent-soft),transparent)]"></div>
      <div class="relative flex items-center justify-between">
        <a routerLink="/login"><cms-logo /></a>
        <div class="flex gap-2"><div class="w-24"><cms-lang-switch /></div><div class="w-36"><cms-theme-switch /></div></div>
      </div>
      <div class="relative mx-auto my-auto w-full max-w-md animate-rise py-10">
        <div class="card p-8">
          <h1 class="text-2xl font-semibold">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="mt-2 text-sm text-muted">{{ subtitle() }}</p>
          }
          <div class="mt-6"><ng-content /></div>
        </div>
      </div>
    </div>
  `,
})
export class AuthCard {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}
