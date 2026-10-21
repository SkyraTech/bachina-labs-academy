import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject, firstValueFrom, from, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { AuthApiService } from './auth-api.service';

export interface AuthBroadcastEvent {
  type: 'REFRESH_SUCCESS' | 'REFRESH_FAILED' | 'LOGOUT';
  timestamp: number;
}

const REFRESH_LOCK_NAME = 'academy_auth_refresh_lock';
const BROADCAST_CHANNEL_NAME = 'academy_auth_channel';

@Injectable({ providedIn: 'root' })
export class AuthRefreshService {
  private readonly authApi = inject(AuthApiService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private inFlightRefresh$: Observable<boolean> | null = null;

  private broadcastChannel: BroadcastChannel | null = null;
  private readonly authEventsSubject = new Subject<AuthBroadcastEvent>();
  readonly authEvents$ = this.authEventsSubject.asObservable();

  constructor() {
    this.initBroadcastChannel();
  }

  private initBroadcastChannel(): void {
    if (this.isBrowser && typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.broadcastChannel.onmessage = (event: MessageEvent<AuthBroadcastEvent>) => {
          if (event.data && typeof event.data === 'object' && event.data.type) {
            this.authEventsSubject.next(event.data);
          }
        };
      } catch {
        this.broadcastChannel = null;
      }
    }
  }

  /**
   * Broadcast an event to other tabs (never contains credentials/tokens).
   */
  broadcastEvent(event: AuthBroadcastEvent): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(event);
      } catch {
        // BroadcastChannel post error safely ignored
      }
    }
  }

  /**
   * Single-flight refresh token coordination.
   * Returns an Observable<boolean> indicating whether the session was successfully refreshed.
   * Concurrent calls in the same tab share the exact same in-flight Observable.
   * Cross-tab coordination uses Web Locks when available to prevent race conditions during cookie rotation.
   */
  refreshSession(): Observable<boolean> {
    if (this.inFlightRefresh$) {
      return this.inFlightRefresh$;
    }

    this.inFlightRefresh$ = this.executeCoordinatedRefresh().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => {
        this.inFlightRefresh$ = null;
      })
    );

    return this.inFlightRefresh$;
  }

  private executeCoordinatedRefresh(): Observable<boolean> {
    // If Web Locks API is available in browser, coordinate across tabs
    if (
      this.isBrowser &&
      typeof navigator !== 'undefined' &&
      navigator.locks &&
      typeof navigator.locks.request === 'function'
    ) {
      return from(
        navigator.locks.request(REFRESH_LOCK_NAME, async () => {
          // After acquiring the lock, determine whether the browser's current cookies
          // now support a valid authenticated request (e.g. another tab held the lock
          // and rotated the credentials while we were queued).
          try {
            await firstValueFrom(this.authApi.getCurrentUser());
            // Current credentials are valid! Reuse without rotating again.
            return true;
          } catch {
            // Access credentials remain invalid. Proceed to perform refresh rotation.
          }

          try {
            return await firstValueFrom(this.executeApiRefresh$());
          } catch {
            return false;
          }
        })
      ).pipe(
        catchError(() => of(false))
      );
    }

    // Fallback for browsers without Web Locks API:
    // In-tab single-flight coordination is guaranteed via inFlightRefresh$ and RxJS shareReplay.
    // However, cross-tab mutual exclusion cannot be enforced by the browser platform without Web Locks.
    return this.executeApiRefresh$();
  }

  private executeApiRefresh$(): Observable<boolean> {
    return this.authApi.refresh().pipe(
      map(() => true),
      tap(() => {
        this.broadcastEvent({ type: 'REFRESH_SUCCESS', timestamp: Date.now() });
      }),
      catchError(() => {
        this.broadcastEvent({ type: 'REFRESH_FAILED', timestamp: Date.now() });
        return of(false);
      })
    );
  }

  /**
   * Notify other tabs of logout.
   */
  notifyLogout(): void {
    this.broadcastEvent({ type: 'LOGOUT', timestamp: Date.now() });
  }

  /**
   * For testing or reset purposes.
   */
  resetState(): void {
    this.inFlightRefresh$ = null;
  }
}
