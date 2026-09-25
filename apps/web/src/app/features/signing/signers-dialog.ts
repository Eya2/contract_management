import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, type SignerInput } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import type { Signer, SignerCandidate } from '../../core/models';
import { humanize } from '../../shared/format';

interface Row {
  kind: 'internal' | 'external';
  userId: string | null;
  name: string;
  email: string;
  signingOrder: number;
}

/**
 * Chooses who signs: colleagues allowed to sign (by account) and external
 * parties (by email; they get a personal link). Same order = sign in parallel.
 */
@Component({
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Signers</h2>
    <mat-dialog-content class="!max-w-2xl">
      <p class="mb-4 text-sm text-body">
        Lower numbers sign first; people with the same number sign in any order. External signers receive a personal link by email.
      </p>
      @for (r of rows(); track $index; let i = $index) {
        <div class="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
          <mat-form-field subscriptSizing="dynamic" class="w-20">
            <mat-label>Order</mat-label>
            <input matInput type="number" min="1" max="10" [(ngModel)]="r.signingOrder" [name]="'o' + i" />
          </mat-form-field>
          @if (r.kind === 'internal') {
            <mat-form-field subscriptSizing="dynamic" class="min-w-60 flex-1">
              <mat-label>Colleague</mat-label>
              <mat-select [(ngModel)]="r.userId" [name]="'u' + i">
                @for (c of candidates(); track c.id) {
                  <mat-option [value]="c.id">{{ c.firstName }} {{ c.lastName }} · {{ humanize(c.role) }}, {{ c.department.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          } @else {
            <mat-form-field subscriptSizing="dynamic" class="flex-1">
              <mat-label>Name</mat-label>
              <input matInput [(ngModel)]="r.name" [name]="'n' + i" />
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic" class="flex-1">
              <mat-label>Email</mat-label>
              <input matInput type="email" [(ngModel)]="r.email" [name]="'e' + i" />
            </mat-form-field>
          }
          <button mat-icon-button (click)="remove(i)" aria-label="Remove signer"><mat-icon>delete</mat-icon></button>
        </div>
      }
      <div class="mt-3 flex gap-2">
        <button mat-stroked-button (click)="add('internal')"><mat-icon>person_add</mat-icon>Colleague</button>
        <button mat-stroked-button (click)="add('external')"><mat-icon>alternate_email</mat-icon>External signer</button>
      </div>
      @if (error()) {
        <p class="mt-3 callout tone-danger" role="alert">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="busy() || !valid()" (click)="save()">Send for signature</button>
    </mat-dialog-actions>
  `,
})
export class SignersDialog implements OnInit {
  private readonly data = inject<{ contractId: string; current: Signer[]; counterpartyEmail?: string | null }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SignersDialog, boolean>);
  private readonly api = inject(Api);
  protected readonly candidates = signal<SignerCandidate[]>([]);
  protected readonly rows = signal<Row[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly humanize = humanize;

  async ngOnInit() {
    this.rows.set(
      this.data.current.length
        ? this.data.current.map((s) => ({ kind: s.userId ? 'internal' : 'external', userId: s.userId, name: s.name, email: s.email, signingOrder: s.signingOrder }))
        : [
            { kind: 'internal', userId: null, name: '', email: '', signingOrder: 1 },
            { kind: 'external', userId: null, name: '', email: this.data.counterpartyEmail ?? '', signingOrder: 2 },
          ],
    );
    try {
      this.candidates.set(await this.api.signerCandidates());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected add(kind: Row['kind']) {
    const order = Math.max(1, ...this.rows().map((r) => r.signingOrder));
    this.rows.update((rows) => [...rows, { kind, userId: null, name: '', email: '', signingOrder: order }]);
  }

  protected remove(i: number) {
    this.rows.update((rows) => rows.filter((_, j) => j !== i));
  }

  protected valid() {
    return (
      this.rows().length > 0 &&
      this.rows().every((r) => (r.kind === 'internal' ? !!r.userId : r.name.trim().length >= 2 && /.+@.+\..+/.test(r.email)))
    );
  }

  protected async save() {
    this.busy.set(true);
    this.error.set(null);
    const signers: SignerInput[] = this.rows().map((r) =>
      r.kind === 'internal'
        ? { userId: r.userId!, signingOrder: Number(r.signingOrder) || 1 }
        : { name: r.name.trim(), email: r.email.trim(), signingOrder: Number(r.signingOrder) || 1 },
    );
    try {
      await this.api.setSigners(this.data.contractId, signers);
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
