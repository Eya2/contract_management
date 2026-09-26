import { Component, inject, input, resource, signal } from '@angular/core';
import { TPipe, t } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import type { SignaturePayload } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { date, dateTime, fileSize, humanize, money } from '../../shared/format';
import { PromptDialog, type PromptData } from '../../shared/prompt-dialog';
import { StatusBadge } from '../../shared/status-badge';
import { SignForm } from './sign-form';
import { Logo } from '../../shared/logo';
import { PdfViewer } from '../../shared/pdf-viewer';
import { LangSwitch } from '../../layout/lang-switch';

/**
 * Where an external signer lands from their email: /sign/:token. No account;
 * the personal link is the credential. Shows the approved contract in full,
 * then lets them sign or decline.
 */
@Component({
  imports: [TPipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule, StatusBadge, SignForm, Logo, PdfViewer, LangSwitch],
  template: `
    <div class="min-h-screen bg-canvas">
      <header class="sticky top-0 z-10 border-b border-line bg-card/80 backdrop-blur-xl">
        <div class="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 font-semibold text-ink">
          <cms-logo /><span class="ml-2 flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-muted"><mat-icon class="!size-3.5 !text-[14px]">lock</mat-icon>{{ 'Secure signing' | t }}</span><div class="ml-auto w-24"><cms-lang-switch /></div>
        </div>
      </header>
      <main class="mx-auto max-w-3xl px-4 py-8">
        @if (view.isLoading() && !view.value()) {
          <mat-spinner diameter="32" class="mx-auto" />
        } @else if (view.error()) {
          <div class="rounded-xl bg-card p-8 text-center shadow-sm ring-1 ring-line">
            <mat-icon class="!size-10 !text-[40px] text-faint">link_off</mat-icon>
            <h1 class="mt-2 text-xl font-semibold">{{ 'This signing link is not valid' | t }}</h1>
            <p class="mt-1 text-sm text-muted">{{ 'It may have expired. Ask the sender for a new one.' | t }}</p>
          </div>
        } @else if (view.value(); as v) {
          <p class="text-sm text-muted">{{ 'Hello {name},' | t: { name: v.signer.name } }}</p>
          <h1 class="mt-1 text-2xl font-bold text-ink">{{ v.version.title }}</h1>
          <p class="mt-1 text-sm text-muted">
            {{ v.contract.referenceNumber }} · {{ 'sent by {name} ({email})' | t: { name: v.contract.owner.firstName + ' ' + v.contract.owner.lastName, email: v.contract.owner.email } }}
          </p>

          @if (v.signer.status === 'SIGNED') {
            <div class="mt-6 flex items-center gap-3 callout tone-success">
              <mat-icon>verified</mat-icon> {{ 'You signed this contract. Thank you! You can close this page.' | t }}
            </div>
          } @else if (v.signer.status === 'DECLINED') {
            <div class="mt-6 callout tone-danger">{{ 'You declined to sign. The sender has been informed.' | t }}</div>
          } @else if (!v.canSign) {
            <div class="mt-6 callout tone-warning">
              @if (v.contract.status === 'APPROVED') {
                Other parties sign before you. We'll email you when it's your turn.
              } @else {
                This contract is no longer open for signature.
              }
            </div>
          }

          <section class="mt-6 card p-6">
            <dl class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt class="text-muted">{{ 'Type' | t }}</dt><dd class="font-medium">{{ humanize(v.version.type) }}</dd></div>
              <div><dt class="text-muted">{{ 'Value' | t }}</dt><dd class="font-medium">{{ money(v.version.value, v.version.currency) }}</dd></div>
              <div><dt class="text-muted">{{ 'Starts' | t }}</dt><dd class="font-medium">{{ date(v.version.startDate) }}</dd></div>
              <div><dt class="text-muted">{{ 'Ends' | t }}</dt><dd class="font-medium">{{ date(v.version.endDate) }}</dd></div>
            </dl>
          </section>

          <cms-pdf-viewer class="mt-6 h-[78vh] min-h-[480px]" [src]="'/api/signing/' + token() + '/pdf'" [title]="v.contract.referenceNumber + ' · ' + v.version.title" [fileName]="v.contract.referenceNumber + '.pdf'" />

          <section class="mt-6 card p-6">
            <h2 class="mb-3 font-semibold">{{ 'Signers' | t }}</h2>
            <ul class="space-y-2 text-sm">
              @for (s of v.signers; track $index) {
                <li class="flex items-center gap-3">
                  <span class="w-6 text-faint">{{ s.signingOrder }}.</span>
                  <span class="flex-1">{{ s.name }}</span>
                  @if (s.signedAt) {
                    <span class="text-xs text-muted">{{ dateTime(s.signedAt) }}</span>
                  }
                  <cms-status [status]="s.status" />
                </li>
              }
            </ul>
          </section>

          @if (v.canSign) {
            <section class="mt-6 card p-6 !shadow-[0_0_0_1.5px_var(--accent)]">
              <h2 class="mb-4 font-semibold">{{ 'Your signature' | t }}</h2>
              @if (error()) {
                <p class="mb-3 callout tone-danger" role="alert">{{ error() }}</p>
              }
              <cms-sign-form [contentHash]="v.version.contentHash" [defaultName]="v.signer.name" [busy]="busy()" (signed)="sign($event)">
                <button mat-button class="!text-rose-600 dark:!text-rose-400" (click)="decline()">{{ 'Decline to sign' | t }}</button>
              </cms-sign-form>
            </section>
          }
        }
      </main>
    </div>
  `,
})
export class PublicSignPage {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);
  readonly token = input.required<string>();
  protected readonly view = resource({ params: () => this.token(), loader: ({ params }) => this.api.publicSigning(params) });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly money = money;
  protected readonly date = date;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;
  protected readonly fileSize = fileSize;

  protected async sign(payload: SignaturePayload) {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.view.set(await this.api.publicSign(this.token(), payload));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected decline() {
    const data: PromptData = { title: t('Decline to sign'), label: t('Reason (shared with the sender)'), confirm: t('Decline'), minLength: 3, danger: true };
    this.dialog
      .open(PromptDialog, { data, width: '480px' })
      .afterClosed()
      .subscribe(async (reason?: string) => {
        if (!reason) return;
        try {
          this.view.set(await this.api.publicDecline(this.token(), reason));
        } catch (err) {
          this.toast.error(err);
        }
      });
  }
}
