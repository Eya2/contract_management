import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <div class="flex min-h-[60vh] animate-rise flex-col items-center justify-center text-center">
      <p class="text-7xl font-bold tracking-tighter text-accent/20">404</p>
      <h1 class="mt-2 text-2xl font-semibold">This page doesn't exist</h1>
      <p class="mt-2 max-w-sm text-sm text-muted">The link may be outdated, or the page was moved. Let's get you back on track.</p>
      <div class="mt-6 flex gap-2">
        <a mat-stroked-button routerLink="/contracts"><mat-icon>description</mat-icon>Contracts</a>
        <a mat-flat-button routerLink="/"><mat-icon>home</mat-icon>Dashboard</a>
      </div>
    </div>
  `,
})
export class NotFoundPage {}
