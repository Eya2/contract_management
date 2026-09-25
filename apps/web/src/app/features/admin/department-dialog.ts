import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';

@Component({
  imports: [TPipe, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ 'New department' | t }}</h2>
    <mat-dialog-content class="!pt-2">
      <mat-form-field class="w-full">
        <mat-label>{{ 'Name' | t }}</mat-label>
        <input matInput [ngModel]="name()" (ngModelChange)="setName($event)" cdkFocusInitial />
      </mat-form-field>
      <mat-form-field class="w-full">
        <mat-label>{{ 'Short code' | t }}</mat-label>
        <input matInput [ngModel]="code()" (ngModelChange)="code.set($event.toUpperCase()); codeTouched = true" maxlength="16" />
        <mat-hint>{{ '2–16 letters or digits, shown in lists (e.g. MKT)' | t }}</mat-hint>
      </mat-form-field>
      @if (error()) {
        <div class="callout tone-danger mt-3" role="alert"><mat-icon>error</mat-icon>{{ error() }}</div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'Cancel' | t }}</button>
      <button mat-flat-button [disabled]="busy() || name().trim().length < 2 || !validCode()" (click)="save()">{{ 'Create' | t }}</button>
    </mat-dialog-actions>
  `,
})
export class DepartmentDialog {
  private readonly api = inject(Api);
  private readonly ref = inject(MatDialogRef<DepartmentDialog, boolean>);
  protected readonly name = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected codeTouched = false;

  protected validCode() {
    return /^[A-Z0-9]{2,16}$/.test(this.code());
  }

  /** Suggests a code from the name until the user types their own. */
  protected setName(v: string) {
    this.name.set(v);
    if (!this.codeTouched) this.code.set(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase());
  }

  protected async save() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.createDepartment({ name: this.name().trim(), code: this.code() });
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
