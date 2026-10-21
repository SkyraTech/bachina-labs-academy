import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { AuthStateService } from '../services/auth-state.service';

/**
 * Sanitizes returnUrl to ensure it is a safe local relative path.
 * Prevents open-redirect attacks.
 */
export function sanitizeReturnUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.includes('\\') &&
    !trimmed.toLowerCase().startsWith('/\\')
  ) {
    return trimmed;
  }
  return null;
}

/**
 * Functional guard requiring authenticated session.
 * Waits for hydration. If unauthenticated, redirects to /login with safe returnUrl.
 */
export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): Observable<boolean | UrlTree> => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  return authState.ensureHydrated().pipe(
    map((isAuthenticated) => {
      if (isAuthenticated) {
        return true;
      }

      const returnUrl = sanitizeReturnUrl(state.url);
      const queryParams = returnUrl && returnUrl !== '/' && returnUrl !== '/login'
        ? { returnUrl }
        : undefined;

      return router.createUrlTree(['/login'], { queryParams });
    })
  );
};
