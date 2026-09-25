import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Endpoints that must not carry the bearer token or trigger a refresh. */
const PUBLIC = [/^\/api\/auth\/(login|refresh|logout)$/, /^\/api\/signing\//];

/**
 * Adds `Authorization: Bearer …` to API calls. On a 401 it refreshes the
 * session once and replays the request; if the refresh fails too, the user is
 * sent to the login page.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (!req.url.startsWith('/api/') || PUBLIC.some((p) => p.test(req.url))) return next(req);

  const withToken = () => {
    const token = auth.accessToken();
    return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  };

  return next(withToken()).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            void auth.expire();
            return throwError(() => err);
          }
          return next(withToken());
        }),
      );
    }),
  );
};
