import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { errorMessage } from './errors';

@Injectable({ providedIn: 'root' })
export class Toast {
  private readonly snack = inject(MatSnackBar);

  success(message: string) {
    this.snack.open(message, 'OK', { duration: 3500 });
  }

  error(err: unknown) {
    this.snack.open(errorMessage(err), 'Dismiss', { duration: 7000, panelClass: 'toast-error' });
  }
}
