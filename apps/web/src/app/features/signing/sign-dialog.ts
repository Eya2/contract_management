import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { previewContract } from '../../shared/pdf-preview-dialog';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import type { SignaturePayload } from '../../core/models';
import { SignForm } from './sign-form';

export interface SignDialogData {
  contractId: string;
  title: string;
  versionNumber: number;
  contentHash: string;
  signerName: string;
}

@Component({
  imports: [TPipe, MatDialogModule, MatButtonModule, MatIconModule, SignForm],
  template: `
    <h2 mat-dialog-title>{{ 'Sign “{title}”' | t: { title: data.title } }}</h2>
    <mat-dialog-content>
      <div class="callout tone-info mb-4">
        <mat-icon>description</mat-icon>
        <span class="flex-1">{{ 'You are signing version {n}, the version that was approved.' | t: { n: data.versionNumber } }}</span>
        <button mat-button (click)="read()">{{ 'Read it' | t }}</button>
      </div>
      @if (error()) {
        <p class="mb-3 callout tone-danger" role="alert">{{ error() }}</p>
      }
      <cms-sign-form [contentHash]="data.contentHash" [defaultName]="data.signerName" [busy]="busy()" (signed)="sign($event)">
        <button mat-button mat-dialog-close>{{ 'Cancel' | t }}</button>
      </cms-sign-form>
    </mat-dialog-content>
  `,
})
export class SignDialog {
  protected readonly data = inject<SignDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SignDialog, boolean>);
  private readonly api = inject(Api);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly dialog = inject(MatDialog);

  protected read() {
    previewContract(this.dialog, { id: this.data.contractId, referenceNumber: '', title: this.data.title }, this.data.versionNumber);
  }

  protected async sign(payload: SignaturePayload) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.sign(this.data.contractId, payload);
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
