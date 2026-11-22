import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authRefreshInterceptor } from './core/auth/interceptors/auth-refresh.interceptor';
import { AuthStateService } from './core/auth/services/auth-state.service';

/**
 * Angular application configuration.
 *
 * Configured according to modern Angular 22 standards:
 * - Completely zoneless runtime via provideZonelessChangeDetection()
 * - Initial session restoration via modern provideAppInitializer()
 * - Fetch-based modern HttpClient with auth refresh interceptor
 * - View transitions & input binding on router
 * - Light/dark/system theme synchronization via [data-theme="dark"]
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch(), withInterceptors([authRefreshInterceptor])),
    provideAppInitializer(() => {
      const authState = inject(AuthStateService);
      return authState.ensureHydrated();
    }),
  ],
};
