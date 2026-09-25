import { HttpErrorResponse } from '@angular/common/http';
import type { ApiError } from './models';

/** A readable message for any failed API call, including field-level validation errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Is the API running?';
    const body = err.error as ApiError | null;
    const fields = body?.error?.details?.fieldErrors;
    if (fields && Object.keys(fields).length) {
      return Object.entries(fields)
        .map(([f, msgs]) => `${f}: ${msgs.join(', ')}`)
        .join(' · ');
    }
    return body?.error?.message ?? `Request failed (${err.status})`;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
