import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';

/**
 * Angular application configuration.
 *
 * Providers added here are available throughout the application.
 * Feature-specific providers should be added in feature route configs.
 *
 * ThemeService is providedIn: 'root' — no explicit registration needed.
 * Auth/entitlement providers will be added in Phase 3.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch()),
  ],
};
