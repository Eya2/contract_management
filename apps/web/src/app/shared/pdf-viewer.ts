import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { TPipe } from '../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/errors';

/**
 * Shows a PDF from the API in the browser's own viewer. The file is fetched
 * with the user's credentials (the API needs the bearer token, which an
 * <iframe src> can't send) and displayed from a blob: URL, so nothing is
 * downloaded unless the user asks.
 */
@Component({
  selector: 'cms-pdf-viewer',
  imports: [TPipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="flex h-full flex-col overflow-hidden rounded-xl bg-subtle ring-1 ring-line">
      <div class="flex items-center gap-2 border-b border-line bg-card px-3 py-2">
        <mat-icon class="text-rose-500">picture_as_pdf</mat-icon>
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ title() }}</span>
        <div class="flex gap-0.5 rounded-lg bg-subtle p-0.5 text-xs font-semibold" role="radiogroup" [attr.aria-label]="'Document language' | t">
          @for (l of ['en', 'fr']; track l) {
            <button role="radio" [attr.aria-checked]="lang() === l" class="rounded-md px-2 py-1 text-muted uppercase transition-all" [class]="lang() === l ? 'bg-card text-ink shadow-sm' : ''" (click)="lang.set($any(l))">{{ l }}</button>
          }
        </div>
        <button mat-icon-button [matTooltip]="'Download' | t" (click)="download()" [disabled]="!blobUrl()" [attr.aria-label]="'Download PDF' | t"><mat-icon>download</mat-icon></button>
        <button mat-icon-button [matTooltip]="'Open in a new tab' | t" (click)="openTab()" [disabled]="!blobUrl()" [attr.aria-label]="'Open in a new tab' | t"><mat-icon>open_in_new</mat-icon></button>
      </div>
      <div class="relative min-h-0 flex-1">
        @if (safeUrl(); as url) {
          <iframe class="h-full w-full animate-fade border-0 bg-white" [src]="url" [title]="title()"></iframe>
        }
        @if (loading()) {
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-subtle/80 text-sm text-muted">
            <mat-spinner diameter="28" />{{ 'Preparing the document…' | t }}
          </div>
        }
        @if (error()) {
          <div class="absolute inset-0 flex items-center justify-center p-6"><div class="callout tone-danger"><mat-icon>error</mat-icon>{{ error() }}</div></div>
        }
      </div>
    </div>
  `,
  host: { class: 'block' },
})
export class PdfViewer {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  /** API path of the PDF, without the lang parameter. */
  readonly src = input.required<string>();
  readonly title = input('Contract');
  readonly fileName = input('contract.pdf');
  readonly lang = signal<'en' | 'fr'>(document.documentElement.lang === 'fr' ? 'fr' : 'en');

  protected readonly blobUrl = signal<string | null>(null);
  protected readonly safeUrl = signal<SafeResourceUrl | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const url = `${this.src()}${this.src().includes('?') ? '&' : '?'}lang=${this.lang()}`;
      let cancelled = false;
      this.loading.set(true);
      this.error.set(null);
      firstValueFrom(this.http.get(url, { responseType: 'blob' }))
        .then((blob) => {
          if (cancelled) return;
          this.revoke();
          const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
          this.blobUrl.set(objectUrl);
          // #view=FitH: fit the page width in Chrome/Edge/Firefox viewers.
          this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`${objectUrl}#view=FitH`));
        })
        .catch((err) => !cancelled && this.error.set(errorMessage(err)))
        .finally(() => !cancelled && this.loading.set(false));
      onCleanup(() => (cancelled = true));
    });
    inject(DestroyRef).onDestroy(() => this.revoke());
  }

  protected download() {
    const a = Object.assign(document.createElement('a'), { href: this.blobUrl()!, download: this.fileName() });
    a.click();
  }

  protected openTab() {
    window.open(this.blobUrl()!, '_blank', 'noopener');
  }

  private revoke() {
    const current = this.blobUrl();
    if (current) URL.revokeObjectURL(current);
  }
}
