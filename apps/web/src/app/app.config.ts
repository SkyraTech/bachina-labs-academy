import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';

/**
 * Angular application configuration.
 *
 * Configured according to modern Angular 22 standards:
 * - Completely zoneless runtime via provideZonelessChangeDetection()
 * - Fetch-based modern HttpClient
 * - View transitions & input binding on router
 * - Light/dark/system theme synchronization via [data-theme="dark"]
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch()),
  ],
};
