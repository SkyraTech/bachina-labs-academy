import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap } from 'rxjs';
import { CurrentUser } from '../models';
import { AuthApiService } from './auth-api.service';
import { AuthRefreshService } from './auth-refresh.service';

export type AuthStatus =
  | 'unknown'
  | 'checking'
  | 'authenticated'
  | 'unauthenticated';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly authApi = inject(AuthApiService);
  private readonly authRefresh = inject(AuthRefreshService);

  /** Private writable signals */
  private readonly _status = signal<AuthStatus>('unknown');
  private readonly _currentUser = signal<CurrentUser | null>(null);

  /** Public read-only signals */
  readonly status = this._status.asReadonly();
  readonly currentUser = this._currentUser.asReadonly();

  /** Computed convenience values */
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');
  readonly isChecking = computed(() => this._status() === 'checking');
  readonly isHydrated = computed(
    () => this._status() === 'authenticated' || this._status() === 'unauthenticated'
  );
  readonly isAdmin = computed(() => this._currentUser()?.role === 'ADMIN');
  readonly isAuthor = computed(() => this._currentUser()?.role === 'AUTHOR');

  /** Monotonically increasing epoch to invalidate stale asynchronous results (e.g. late responses after logout) */
  private epoch = 0;

  /** Single shared hydration observable to prevent duplicate /auth/me calls during app startup / guards */
  private hydration$: Observable<boolean> | null = null;

  constructor() {
    this.listenToCrossTabEvents();
  }

  private listenToCrossTabEvents(): void {
    this.authRefresh.authEvents$.subscribe((event) => {
      if (event.type === 'LOGOUT') {
        this.setUnauthenticated();
      }
    });
  }

  /**
   * Set user as authenticated after successful login or profile restoration.
   */
  setAuthenticated(user: CurrentUser): void {
    this.epoch++;
    this._currentUser.set(user);
    this._status.set('authenticated');
  }

  /**
   * Set state as unauthenticated and clear current user safely.
   */
  setUnauthenticated(): void {
    this.epoch++;
    this._currentUser.set(null);
    this._status.set('unauthenticated');
  }

  /**
   * Ensures the session is restored/hydrated from the backend.
   * Safe to call multiple times concurrently; shares one in-flight hydration attempt.
   */
  ensureHydrated(): Observable<boolean> {
    if (this._status() === 'authenticated') {
      return of(true);
    }
    if (this._status() === 'unauthenticated') {
      return of(false);
    }
    if (this.hydration$) {
      return this.hydration$;
    }

    const currentEpoch = ++this.epoch;
    this._status.set('checking');

    this.hydration$ = this.authApi.getCurrentUser().pipe(
      map((user) => {
        if (this.epoch === currentEpoch) {
          this.setAuthenticated(user);
        }
        return true;
      }),
      catchError((error) => {
        // If 401 Unauthorized, attempt refresh once
        if (error?.status === 401) {
          return this.authRefresh.refreshSession().pipe(
            switchMap((refreshed) => {
              if (refreshed) {
                // Retry /auth/me once after successful refresh
                return this.authApi.getCurrentUser().pipe(
                  map((user) => {
                    if (this.epoch === currentEpoch) {
                      this.setAuthenticated(user);
                    }
                    return true;
                  }),
                  catchError(() => {
                    if (this.epoch === currentEpoch) {
                      this.setUnauthenticated();
                    }
                    return of(false);
                  })
                );
              }

              if (this.epoch === currentEpoch) {
                this.setUnauthenticated();
              }
              return of(false);
            }),
            catchError(() => {
              if (this.epoch === currentEpoch) {
                this.setUnauthenticated();
              }
              return of(false);
            })
          );
        }

        // For any other error (network failure, 500, etc.), enter unauthenticated state.
        // Never grant protected access because of network failure.
        if (this.epoch === currentEpoch) {
          this.setUnauthenticated();
        }
        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => {
        this.hydration$ = null;
      })
    );

    return this.hydration$;
  }

  /**
   * Safe logout for current device:
   * 1. Increments epoch immediately to prevent pending responses from reviving state.
   * 2. Calls backend POST /api/v1/auth/logout.
   * 3. Notifies other tabs via BroadcastChannel.
   * 4. Clears local auth state.
   */
  logout(): Observable<{ message: string }> {
    this.epoch++;
    this._currentUser.set(null);
    this._status.set('unauthenticated');
    this.authRefresh.notifyLogout();

    return this.authApi.logout().pipe(
      finalize(() => {
        this._currentUser.set(null);
        this._status.set('unauthenticated');
      })
    );
  }

  /**
   * Safe logout for all devices.
   */
  logoutAll(): Observable<{ message: string; revokedCount: number }> {
    this.epoch++;
    this._currentUser.set(null);
    this._status.set('unauthenticated');
    this.authRefresh.notifyLogout();

    return this.authApi.logoutAll().pipe(
      finalize(() => {
        this._currentUser.set(null);
        this._status.set('unauthenticated');
      })
    );
  }
}
