import { HttpErrorResponse } from '@angular/common/http';
import { t } from './i18n';
import type { ApiError } from './models';

/** A readable message for any failed API call, including field-level validation errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    // 0: no response at all; 502–504: the dev proxy or a gateway couldn't reach the API.
    if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
      return t('Cannot reach the server right now. Please try again in a moment.');
    }
    const body = err.error as ApiError | null;
    const fields = body?.error?.details?.fieldErrors;
    if (fields && Object.keys(fields).length) {
      return Object.entries(fields)
        .map(([f, msgs]) => `${f}: ${msgs.join(', ')}`)
        .join(' · ');
    }
    return body?.error?.message ?? t('Request failed ({n})', { n: err.status });
  }
  return err instanceof Error ? err.message : t('Something went wrong');
}
