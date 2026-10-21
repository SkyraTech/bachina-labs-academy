import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  UrlTree,
} from '@angular/router';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { AuthStateService } from '../services/auth-state.service';
import { sanitizeReturnUrl } from './auth.guard';

/**
 * Functional guard for public guest-only routes like /login and /register.
 * Allows unauthenticated visitors.
 * Redirects authenticated users to their role-appropriate workspace (/author or /admin).
 */
export const guestGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot
): Observable<boolean | UrlTree> => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  return authState.ensureHydrated().pipe(
    map((isAuthenticated) => {
      if (!isAuthenticated) {
        return true;
      }

      const user = authState.currentUser();
      const returnUrl = sanitizeReturnUrl(route.queryParamMap.get('returnUrl'));

      // If safe returnUrl was provided and is not a guest route, use it if role-compatible
      if (returnUrl && !returnUrl.startsWith('/login') && !returnUrl.startsWith('/register')) {
        if (returnUrl.startsWith('/admin') && user?.role === 'ADMIN') {
          return router.parseUrl(returnUrl);
        }
        if (returnUrl.startsWith('/author') && user?.role === 'AUTHOR') {
          return router.parseUrl(returnUrl);
        }
        if (returnUrl.startsWith('/account')) {
          return router.parseUrl(returnUrl);
        }
      }

      // Default role landing
      if (user?.role === 'ADMIN') {
        return router.createUrlTree(['/admin']);
      }
      return router.createUrlTree(['/author']);
    })
  );
};
