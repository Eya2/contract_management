import { Component, inject, input, resource, signal } from '@angular/core';
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

/**
 * Where an external signer lands from their email: /sign/:token. No account;
 * the personal link is the credential. Shows the approved contract in full,
 * then lets them sign or decline.
 */
@Component({
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, StatusBadge, SignForm],
  template: `
    <div class="min-h-screen bg-slate-50">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 font-semibold text-ink">
          <span class="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">C</span> Contract Hub · Secure signing
        </div>
      </header>
      <main class="mx-auto max-w-3xl px-4 py-8">
        @if (view.isLoading() && !view.value()) {
          <mat-spinner diameter="32" class="mx-auto" />
        } @else if (view.error()) {
          <div class="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
            <mat-icon class="!size-10 !text-[40px] text-slate-400">link_off</mat-icon>
            <h1 class="mt-2 text-xl font-semibold">This signing link is not valid</h1>
            <p class="mt-1 text-sm text-slate-500">It may have expired. Ask the sender for a new one.</p>
          </div>
        } @else if (view.value(); as v) {
          <p class="text-sm text-slate-500">Hello {{ v.signer.name }},</p>
          <h1 class="mt-1 text-2xl font-bold text-ink">{{ v.version.title }}</h1>
          <p class="mt-1 text-sm text-slate-500">
            {{ v.contract.referenceNumber }} · sent by {{ v.contract.owner.firstName }} {{ v.contract.owner.lastName }} ({{ v.contract.owner.email }})
          </p>

          @if (v.signer.status === 'SIGNED') {
            <div class="mt-6 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-800 ring-1 ring-emerald-200">
              <mat-icon>verified</mat-icon> You signed this contract. Thank you! You can close this page.
            </div>
          } @else if (v.signer.status === 'DECLINED') {
            <div class="mt-6 rounded-xl bg-rose-50 p-4 text-rose-800 ring-1 ring-rose-200">You declined to sign. The sender has been informed.</div>
          } @else if (!v.canSign) {
            <div class="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800 ring-1 ring-amber-200">
              @if (v.contract.status === 'APPROVED') {
                Other parties sign before you. We'll email you when it's your turn.
              } @else {
                This contract is no longer open for signature.
              }
            </div>
          }

          <section class="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <dl class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt class="text-slate-500">Type</dt><dd class="font-medium">{{ humanize(v.version.type) }}</dd></div>
              <div><dt class="text-slate-500">Value</dt><dd class="font-medium">{{ money(v.version.value, v.version.currency) }}</dd></div>
              <div><dt class="text-slate-500">Starts</dt><dd class="font-medium">{{ date(v.version.startDate) }}</dd></div>
              <div><dt class="text-slate-500">Ends</dt><dd class="font-medium">{{ date(v.version.endDate) }}</dd></div>
            </dl>
            @if (v.version.file; as f) {
              <a class="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm hover:bg-slate-100" [href]="'/api/signing/' + token() + '/document'">
                <mat-icon class="text-rose-600">picture_as_pdf</mat-icon>
                <span class="flex-1">{{ f.originalName }}</span><span class="text-slate-500">{{ fileSize(f.sizeBytes) }}</span>
                <mat-icon>download</mat-icon>
              </a>
            }
            @for (c of v.version.clauses; track c.key; let i = $index) {
              <article class="mt-5">
                <h3 class="font-semibold text-ink">{{ i + 1 }}. {{ c.heading }}</h3>
                <p class="mt-1 text-sm leading-relaxed whitespace-pre-line text-slate-700">{{ c.body }}</p>
              </article>
            }
          </section>

          <section class="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 class="mb-3 font-semibold">Signers</h2>
            <ul class="space-y-2 text-sm">
              @for (s of v.signers; track $index) {
                <li class="flex items-center gap-3">
                  <span class="w-6 text-slate-400">{{ s.signingOrder }}.</span>
                  <span class="flex-1">{{ s.name }}</span>
                  @if (s.signedAt) {
                    <span class="text-xs text-slate-500">{{ dateTime(s.signedAt) }}</span>
                  }
                  <cms-status [status]="s.status" />
                </li>
              }
            </ul>
          </section>

          @if (v.canSign) {
            <section class="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-brand-200">
              <h2 class="mb-4 font-semibold">Your signature</h2>
              @if (error()) {
                <p class="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700" role="alert">{{ error() }}</p>
              }
              <cms-sign-form [contentHash]="v.version.contentHash" [defaultName]="v.signer.name" [busy]="busy()" (signed)="sign($event)">
                <button mat-button class="!text-rose-700" (click)="decline()">Decline to sign</button>
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
    const data: PromptData = { title: 'Decline to sign', label: 'Reason (shared with the sender)', confirm: 'Decline', minLength: 3, danger: true };
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
