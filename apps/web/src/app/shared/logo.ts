import { Component, input } from '@angular/core';

/**
 * The Contract Hub mark: a document with a signature stroke and an amber seal,
 * on an ink gradient. `wordmark` adds the name.
 */
@Component({
  selector: 'cms-logo',
  template: `
    <span class="inline-flex items-center gap-2.5">
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0 drop-shadow-sm">
        <defs>
          <linearGradient id="cms-logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#3d63f0" />
            <stop offset="1" stop-color="#1e308f" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#cms-logo-g)" />
        <path d="M10 8.5h8.5l4 4V23a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 23V10A1.5 1.5 0 0 1 10 8.5Z" fill="#fff" fill-opacity=".95" />
        <path d="M11.5 20.5c1.2-1.6 2.2-2.6 3-2.1.8.5-.6 2.4.4 2.6 1 .2 1.8-1.6 2.7-1.4.6.1.5 1 1.3 1" fill="none" stroke="#2747dc" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="22" cy="22" r="4" fill="#ec9a1c" stroke="#fff" stroke-width="1.5" />
      </svg>
      @if (wordmark()) {
        <span class="text-[15px] leading-none font-semibold tracking-tight text-ink">Contract<span class="text-accent">Hub</span></span>
      }
    </span>
  `,
})
export class Logo {
  readonly size = input(32);
  readonly wordmark = input(true);
}
