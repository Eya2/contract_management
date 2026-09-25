import { Component, computed, input, output, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { SignaturePayload } from '../../core/models';
import { SignaturePad } from '../../shared/signature-pad';

/**
 * Captures a signature: typed or drawn, plus explicit consent. Shows the
 * fingerprint of the content being signed; it's sent back with the signature,
 * and the server refuses it if the contract changed in the meantime.
 */
@Component({
  selector: 'cms-sign-form',
  imports: [TPipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, SignaturePad],
  template: `
    <mat-button-toggle-group class="mb-4" [value]="method()" (change)="method.set($event.value)" [attr.aria-label]="'Signature method' | t">
      <mat-button-toggle value="TYPED">{{ 'Type' | t }}</mat-button-toggle>
      <mat-button-toggle value="DRAWN">{{ 'Draw' | t }}</mat-button-toggle>
    </mat-button-toggle-group>

    @if (method() === 'TYPED') {
      <mat-form-field class="w-full">
        <mat-label>{{ 'Your full name' | t }}</mat-label>
        <input matInput [ngModel]="typedName()" (ngModelChange)="typedName.set($event)" autocomplete="name" />
      </mat-form-field>
      @if (typedName().trim()) {
        <p class="mb-4 border-b border-line pb-1 text-3xl text-ink" style="font-family: 'Brush Script MT', 'Segoe Script', cursive">{{ typedName() }}</p>
      }
    } @else {
      <cms-signature-pad (changed)="image.set($event)" />
    }

    <p class="mt-3 rounded-md bg-subtle p-2 font-mono text-[11px] break-all text-muted" [title]="'SHA-256 of the contract content' | t">
      {{ 'Content fingerprint' | t }}: {{ contentHash() }}
    </p>
    <mat-checkbox class="mt-3 block" [checked]="consent()" (change)="consent.set($event.checked)">
      {{ 'I have reviewed this contract and agree to sign it electronically. My electronic signature is legally binding.' | t }}
    </mat-checkbox>
    <div class="mt-4 flex flex-wrap justify-end gap-2">
      <ng-content />
      <button mat-flat-button [disabled]="!ready() || busy()" (click)="submit()">{{ (busy() ? 'Signing…' : 'Sign contract') | t }}</button>
    </div>
  `,
})
export class SignForm {
  readonly contentHash = input.required<string>();
  readonly defaultName = input('');
  readonly busy = input(false);
  readonly signed = output<SignaturePayload>();

  protected readonly method = signal<'TYPED' | 'DRAWN'>('TYPED');
  protected readonly typedName = signal('');
  protected readonly image = signal<string | null>(null);
  protected readonly consent = signal(false);
  protected readonly ready = computed(
    () => this.consent() && (this.method() === 'TYPED' ? this.typedName().trim().length >= 2 : !!this.image()),
  );

  ngOnInit() {
    this.typedName.set(this.defaultName());
  }

  protected submit() {
    this.signed.emit(
      this.method() === 'TYPED'
        ? { contentHash: this.contentHash(), method: 'TYPED', typedName: this.typedName().trim(), consent: true }
        : { contentHash: this.contentHash(), method: 'DRAWN', signatureImage: this.image()!, consent: true },
    );
  }
}
