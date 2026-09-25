import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route params bind straight to component inputs (e.g. `id = input.required<string>()`).
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    // Interceptors (auth token, refresh-on-401, error toasts) are added in the auth step.
    provideHttpClient(withFetch()),
  ],
};
