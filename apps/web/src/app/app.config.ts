import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter, TitleStrategy, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService } from './core/auth.service';
import { ThemeService } from './core/theme.service';
import { TranslatedTitleStrategy } from './core/i18n-providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route params and query params bind straight to component inputs (e.g. `id = input.required<string>()`).
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // <mat-icon> renders Material Symbols (bundled by the material-symbols package).
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
    }),
    // Outlined fields read better on cards than Material's filled grey boxes.
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    // Browser tab titles follow the interface language.
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideAppInitializer(() => {
      inject(ThemeService);
    }),
    // Resume the session from the refresh cookie before the first route guard runs.
    provideAppInitializer(() => inject(AuthService).restore()),
  ],
};
