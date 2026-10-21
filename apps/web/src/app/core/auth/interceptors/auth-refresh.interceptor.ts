import {
  HttpContextToken,
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, of, switchMap, throwError } from 'rxjs';
import { AuthRefreshService } from '../services/auth-refresh.service';
import { AuthStateService } from '../services/auth-state.service';

/**
 * Context token to explicitly bypass refresh token interceptor.
 */
export const SKIP_AUTH_REFRESH = new HttpContextToken<boolean>(() => false);

/**
 * Context token tracking whether this request has already been retried after refresh.
 */
export const AUTH_REFRESH_RETRIED = new HttpContextToken<boolean>(() => false);

/**
 * List of auth endpoint patterns that must never trigger token refresh.
 */
const EXCLUDED_AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/refresh',
  '/auth/logout',
  '/auth/logout-all',
  '/auth/me',
];

/**
 * Determines whether a given request is eligible for token refresh on 401.
 */
function isEligibleForRefresh(req: HttpRequest<unknown>): boolean {
  if (req.context.get(SKIP_AUTH_REFRESH) || req.context.get(AUTH_REFRESH_RETRIED)) {
    return false;
  }

  // Must only intercept API requests
  if (!req.url.includes('/api/')) {
    return false;
  }

  // Check excluded endpoints
  const isExcluded = EXCLUDED_AUTH_ENDPOINTS.some((endpoint) => req.url.includes(endpoint));
  if (isExcluded) {
    return false;
  }

  // Idempotency safety: only automatically retry safe read requests (GET, HEAD, OPTIONS)
  const isSafeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  return isSafeMethod;
}

/**
 * Modern Angular functional HTTP interceptor coordinating single-flight token refresh
 * and safe request retry for 401 Unauthorized responses.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authRefresh = inject(AuthRefreshService);
  const authState = inject(AuthStateService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && isEligibleForRefresh(req)) {
        return authRefresh.refreshSession().pipe(
          catchError(() => of(false)),
          switchMap((refreshed) => {
            if (refreshed) {
              const retriedReq = req.clone({
                context: req.context.set(AUTH_REFRESH_RETRIED, true),
              });
              return next(retriedReq);
            }

            // Refresh failed — transition state to unauthenticated and propagate 401
            authState.setUnauthenticated();
            return throwError(() => error);
          })
        );
      }

      return throwError(() => error);
    })
  );
};
