import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Role } from '@cms/shared';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import type { AdminUser, Department } from '../../core/models';
import { humanize } from '../../shared/format';
import { PasswordRules, passwordOk } from '../../shared/password-rules';

export interface UserDialogData {
  user: AdminUser | null;
  departments: Department[];
  selfId: string;
}

const ROLE_HINT: Record<string, string> = {
  ADMIN: 'Everything, including users and approval policies',
  LEGAL: 'Drafts contracts, reviews them, reads the audit log',
  MANAGER: 'Drafts, approves for their department, signs and terminates',
  FINANCE: 'Reviews and approves; read-only on contract content',
  EMPLOYEE: 'Drafts and submits contracts',
};

/** Create a person, or edit one (role, department, active, password reset). */
@Component({
  imports: [TPipe, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatSlideToggleModule, PasswordRules],
  template: `
    <h2 mat-dialog-title>{{ data.user ? ('Edit {name}' | t: { name: data.user.firstName + ' ' + data.user.lastName }) : ('Add a person' | t) }}</h2>
    <mat-dialog-content class="!pt-2">
      <div class="grid gap-x-4 sm:grid-cols-2">
        <mat-form-field><mat-label>{{ 'First name' | t }}</mat-label><input matInput [(ngModel)]="firstName" required /></mat-form-field>
        <mat-form-field><mat-label>{{ 'Last name' | t }}</mat-label><input matInput [(ngModel)]="lastName" required /></mat-form-field>
      </div>
      <mat-form-field class="w-full">
        <mat-label>{{ 'Work email' | t }}</mat-label>
        <input matInput type="email" [(ngModel)]="email" [disabled]="!!data.user" required />
        @if (data.user) {
          <mat-hint>{{ 'The email is the sign-in identity and can’t change.' | t }}</mat-hint>
        }
      </mat-form-field>
      <div class="grid gap-x-4 sm:grid-cols-2">
        <mat-form-field>
          <mat-label>{{ 'Role' | t }}</mat-label>
          <mat-select [(ngModel)]="role" [disabled]="isSelf">
            @for (r of roles; track r) {
              <mat-option [value]="r">{{ humanize(r) }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ roleHint[role()] | t }}</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'Department' | t }}</mat-label>
          <mat-select [(ngModel)]="departmentId">
            @for (d of data.departments; track d.id) {
              <mat-option [value]="d.id">{{ d.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      @if (data.user) {
        <div class="mt-2 flex items-center justify-between rounded-xl bg-subtle p-3">
          <div>
            <p class="text-sm font-medium text-ink">{{ 'Active' | t }}</p>
            <p class="text-xs text-muted">{{ 'Inactive people can’t sign in. Their history stays intact.' | t }}</p>
          </div>
          <mat-slide-toggle [(ngModel)]="isActive" [disabled]="isSelf" [attr.aria-label]="'Active' | t" />
        </div>
        <button mat-button class="mt-3" (click)="resetPassword.set(!resetPassword())"><mat-icon>key</mat-icon>{{ (resetPassword() ? 'Keep the current password' : 'Set a new password') | t }}</button>
      }
      @if (!data.user || resetPassword()) {
        <mat-form-field class="mt-2 w-full" subscriptSizing="dynamic">
          <mat-label>{{ (data.user ? 'New password' : 'Initial password') | t }}</mat-label>
          <input matInput type="text" autocomplete="off" [(ngModel)]="password" />
          <button mat-icon-button matSuffix type="button" (click)="generate()" [attr.aria-label]="'Generate a password' | t"><mat-icon>casino</mat-icon></button>
        </mat-form-field>
        <cms-password-rules [password]="password()" />
        <p class="text-xs text-muted">{{ 'Share it securely; they can change it in Account settings.' | t }}</p>
      }
      @if (error()) {
        <div class="callout tone-danger mt-3" role="alert"><mat-icon>error</mat-icon>{{ error() }}</div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'Cancel' | t }}</button>
      <button mat-flat-button [disabled]="busy() || !valid()" (click)="save()">{{ (data.user ? 'Save changes' : 'Add person') | t }}</button>
    </mat-dialog-actions>
  `,
})
export class UserDialog {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<UserDialog, boolean>);
  private readonly api = inject(Api);
  protected readonly roles = Object.values(Role);
  protected readonly roleHint = ROLE_HINT;
  protected readonly humanize = humanize;
  protected readonly isSelf = this.data.user?.id === this.data.selfId;

  protected readonly firstName = signal(this.data.user?.firstName ?? '');
  protected readonly lastName = signal(this.data.user?.lastName ?? '');
  protected readonly email = signal(this.data.user?.email ?? '');
  protected readonly role = signal<string>(this.data.user?.role ?? 'EMPLOYEE');
  protected readonly departmentId = signal(this.data.user?.department.id ?? this.data.departments[0]?.id ?? '');
  protected readonly isActive = signal(this.data.user?.isActive ?? true);
  protected readonly resetPassword = signal(false);
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected valid() {
    const needsPassword = !this.data.user || this.resetPassword();
    return !!this.firstName().trim() && !!this.lastName().trim() && /.+@.+\..+/.test(this.email()) && !!this.departmentId() && (!needsPassword || passwordOk(this.password()));
  }

  /** A readable random password: four words would be nicer, but this meets the rules without a word list. */
  protected generate() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    let p = Array.from(bytes, (b) => chars[b % chars.length]).join('');
    p = p.slice(0, 5) + '-' + p.slice(5, 10) + '-' + p.slice(10) + (crypto.getRandomValues(new Uint8Array(1))[0]! % 10);
    this.password.set(p);
  }

  protected async save() {
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.data.user) {
        const u = this.data.user;
        const body: Record<string, unknown> = {};
        if (this.firstName().trim() !== u.firstName) body['firstName'] = this.firstName().trim();
        if (this.lastName().trim() !== u.lastName) body['lastName'] = this.lastName().trim();
        if (this.role() !== u.role) body['role'] = this.role();
        if (this.departmentId() !== u.department.id) body['departmentId'] = this.departmentId();
        if (this.isActive() !== u.isActive) body['isActive'] = this.isActive();
        if (this.resetPassword()) body['password'] = this.password();
        if (Object.keys(body).length) await this.api.updateUser(u.id, body);
      } else {
        await this.api.createUser({
          firstName: this.firstName().trim(),
          lastName: this.lastName().trim(),
          email: this.email().trim(),
          role: this.role(),
          departmentId: this.departmentId(),
          password: this.password(),
        });
      }
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
