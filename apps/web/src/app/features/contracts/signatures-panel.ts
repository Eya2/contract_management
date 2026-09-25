import { Component, computed, inject, input, output, resource } from '@angular/core';
import { TPipe, t } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { ContractDetail } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { dateTime } from '../../shared/format';
import { previewContract } from '../../shared/pdf-preview-dialog';
import { PromptDialog, type PromptData } from '../../shared/prompt-dialog';
import { StatusBadge } from '../../shared/status-badge';
import { SignDialog, type SignDialogData } from '../signing/sign-dialog';
import { SignersDialog } from '../signing/signers-dialog';

/** Signers of the approved version, their evidence, and the sign / choose-signers actions. */
@Component({
  selector: 'cms-signatures-panel',
  imports: [TPipe, MatButtonModule, MatIconModule, StatusBadge],
  template: `
    @if (!info.value()?.contentHash) {
      <p class="py-10 text-center text-sm text-muted">{{ 'Signatures are collected once the contract is approved.' | t }}</p>
    } @else {
      @let i = info.value()!;
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <p class="text-sm text-body">{{ 'Signing version {n} · fingerprint' | t: { n: i.versionNumber } }} <span class="font-mono text-xs">{{ i.contentHash!.slice(0, 16) }}…</span></p>
        <span class="flex-1"></span>
        <button mat-button (click)="preview()"><mat-icon>visibility</mat-icon>{{ (allSigned() ? 'View signed contract' : 'Preview') | t }}</button>
        @if (me(); as m) {
          @if (m.canSign) {
            <button mat-stroked-button class="!text-rose-600 dark:!text-rose-400" (click)="decline()">{{ 'Decline' | t }}</button>
            <button mat-flat-button (click)="sign()"><mat-icon>draw</mat-icon>{{ 'Sign now' | t }}</button>
          }
        }
        @if (canChooseSigners()) {
          <button mat-stroked-button (click)="chooseSigners()"><mat-icon>group</mat-icon>{{ (i.signers.length ? 'Change signers' : 'Choose signers') | t }}</button>
        }
      </div>
      <div class="overflow-hidden card">
        <ul class="divide-y divide-line-soft">
          @for (s of i.signers; track s.id) {
            <li class="flex flex-wrap items-start gap-4 px-5 py-4">
              <span class="mt-1 flex size-7 items-center justify-center rounded-full bg-subtle-strong text-xs font-semibold text-body">{{ s.signingOrder }}</span>
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">{{ s.name }} @if (s.isMe) {<span class="text-xs text-accent">{{ '(you)' | t }}</span>}</p>
                <p class="text-xs text-muted">{{ s.email }} · {{ (s.userId ? 'internal' : 'external') | t }}</p>
                @if (s.status === 'SIGNED') {
                  <div class="mt-2 rounded-lg bg-subtle p-3 text-xs text-body">
                    @if (s.method === 'TYPED') {
                      <p class="mb-1 text-2xl text-ink" style="font-family: 'Brush Script MT', 'Segoe Script', cursive">{{ s.typedSignature }}</p>
                    } @else {
                      <p class="mb-1 flex items-center gap-1"><mat-icon class="!size-4 !text-[16px]">gesture</mat-icon> {{ 'Drawn signature on file' | t }}</p>
                    }
                    <p>{{ 'Signed {date} from {ip}' | t: { date: dateTime(s.signedAt), ip: s.ipAddress ?? ('unknown IP' | t) } }}</p>
                    <p class="font-mono break-all">{{ 'Content hash' | t }} {{ s.signedContentHash }}</p>
                  </div>
                }
                @if (s.declineReason) {
                  <p class="mt-2 text-sm text-rose-700 dark:text-rose-300">{{ 'Declined: {reason}' | t: { reason: s.declineReason } }}</p>
                }
              </div>
              <cms-status [status]="s.status" />
            </li>
          } @empty {
            <li class="px-5 py-8 text-center text-sm text-muted">{{ 'No signers yet.' | t }}</li>
          }
        </ul>
      </div>
    }
  `,
})
export class SignaturesPanel {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);
  readonly contract = input.required<ContractDetail>();
  readonly changed = output<void>();

  protected readonly info = resource({
    params: () => ({ id: this.contract().id, status: this.contract().status }),
    loader: ({ params }) => this.api.signers(params.id),
  });
  protected readonly me = computed(() => this.info.value()?.signers.find((s) => s.isMe));
  protected readonly canChooseSigners = computed(() => {
    const c = this.contract();
    const user = this.auth.user();
    const anySigned = this.info.value()?.signers.some((s) => s.status === 'SIGNED');
    return c.status === 'APPROVED' && !anySigned && (user?.role === 'ADMIN' || c.owner.id === user?.id);
  });
  protected readonly dateTime = dateTime;

  protected readonly allSigned = computed(() => {
    const list = this.info.value()?.signers ?? [];
    return list.length > 0 && list.every((s) => s.status === 'SIGNED');
  });

  protected preview() {
    previewContract(this.dialog, this.contract(), this.info.value()!.versionNumber!);
  }

  protected chooseSigners() {
    this.dialog
      .open(SignersDialog, { data: { contractId: this.contract().id, current: this.info.value()?.signers ?? [] }, width: '720px' })
      .afterClosed()
      .subscribe((saved) => {
        if (!saved) return;
        this.toast.success(t('Signature requests sent'));
        this.info.reload();
      });
  }

  protected sign() {
    const i = this.info.value()!;
    const data: SignDialogData = {
      contractId: this.contract().id,
      title: this.contract().title,
      versionNumber: i.versionNumber!,
      contentHash: i.contentHash!,
      signerName: this.me()!.name,
    };
    this.dialog
      .open(SignDialog, { data, width: '560px' })
      .afterClosed()
      .subscribe((signed) => {
        if (!signed) return;
        this.toast.success(t('Signed'));
        this.changed.emit();
      });
  }

  protected decline() {
    const data: PromptData = { title: t('Decline to sign'), message: t('The contract goes back to draft for renegotiation.'), label: t('Reason'), confirm: t('Decline'), minLength: 3, danger: true };
    this.dialog
      .open(PromptDialog, { data, width: '480px' })
      .afterClosed()
      .subscribe(async (reason?: string) => {
        if (!reason) return;
        try {
          await this.api.declineSignature(this.contract().id, reason);
          this.changed.emit();
        } catch (err) {
          this.toast.error(err);
        }
      });
  }
}
