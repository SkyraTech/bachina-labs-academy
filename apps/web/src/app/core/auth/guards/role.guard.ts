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
import { sanitizeReturnUrl } from './auth.guard';
import { UserRole } from '../models';

/**
 * Functional guard factory that enforces specific role permissions.
 * ADMIN does not automatically inherit AUTHOR privileges.
 * AUTHOR does not have ADMIN privileges.
 */
export function roleGuard(allowedRoles: UserRole[]): CanActivateFn {
  return (
    _route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> => {
    const authState = inject(AuthStateService);
    const router = inject(Router);

    return authState.ensureHydrated().pipe(
      map((isAuthenticated) => {
        if (!isAuthenticated) {
          const returnUrl = sanitizeReturnUrl(state.url);
          const queryParams = returnUrl ? { returnUrl } : undefined;
          return router.createUrlTree(['/login'], { queryParams });
        }

        const user = authState.currentUser();
        const role = user?.role as UserRole | undefined;

        if (role && allowedRoles.includes(role)) {
          return true;
        }

        // Insufficient permissions: redirect to authorized home for their role
        if (role === 'ADMIN') {
          return router.createUrlTree(['/admin']);
        }
        if (role === 'AUTHOR') {
          return router.createUrlTree(['/author']);
        }

        return router.createUrlTree(['/']);
      })
    );
  };
}
