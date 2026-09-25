import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
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
  imports: [MatDialogModule, MatButtonModule, SignForm],
  template: `
    <h2 mat-dialog-title>Sign “{{ data.title }}”</h2>
    <mat-dialog-content>
      <p class="mb-4 text-sm text-slate-600">You are signing version {{ data.versionNumber }}, the version that was approved.</p>
      @if (error()) {
        <p class="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700" role="alert">{{ error() }}</p>
      }
      <cms-sign-form [contentHash]="data.contentHash" [defaultName]="data.signerName" [busy]="busy()" (signed)="sign($event)">
        <button mat-button mat-dialog-close>Cancel</button>
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
