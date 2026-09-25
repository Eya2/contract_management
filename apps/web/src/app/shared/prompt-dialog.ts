import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface PromptData {
  title: string;
  message?: string;
  label: string;
  confirm: string;
  /** Minimum length; 0 makes the text optional. */
  minLength: number;
  danger?: boolean;
}

/** Asks for a short text (a comment, a reason) before a workflow action. Closes with the text, or undefined. */
@Component({
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.message) {
        <p class="mb-4 text-sm text-body">{{ data.message }}</p>
      }
      <mat-form-field class="w-full">
        <mat-label>{{ data.label }}</mat-label>
        <textarea matInput rows="3" [(ngModel)]="text" cdkFocusInitial [required]="data.minLength > 0"></textarea>
        @if (data.minLength > 0) {
          <mat-hint>Required</mat-hint>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        [class.danger]="data.danger"
        [disabled]="text().trim().length < data.minLength"
        (click)="ref.close(text().trim())"
      >
        {{ data.confirm }}
      </button>
    </mat-dialog-actions>
  `,
})
export class PromptDialog {
  protected readonly data = inject<PromptData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<PromptDialog, string>);
  protected readonly text = signal('');
}
