import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { AuthStateService } from './auth-state.service';
import { AuthApiService } from './auth-api.service';
import { AuthRefreshService } from './auth-refresh.service';
import { CurrentUser } from '../models';

describe('AuthStateService', () => {
  let service: AuthStateService;
  let authApiMock: {
    getCurrentUser: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    logoutAll: ReturnType<typeof vi.fn>;
  };
  let authRefreshMock: {
    refreshSession: ReturnType<typeof vi.fn>;
    notifyLogout: ReturnType<typeof vi.fn>;
    authEvents$: Subject<{ type: string; timestamp: number }>;
  };

  const mockAuthor: CurrentUser = {
    id: 'user-1',
    email: 'author@skyra-tech.com',
    role: 'AUTHOR',
    status: 'ACTIVE',
    emailVerifiedAt: '2026-10-15T00:00:00Z',
  };

  const mockAdmin: CurrentUser = {
    id: 'admin-1',
    email: 'admin@skyra-tech.com',
    role: 'ADMIN',
    status: 'ACTIVE',
    emailVerifiedAt: '2026-10-15T00:00:00Z',
  };

  beforeEach(() => {
    authApiMock = {
      getCurrentUser: vi.fn(),
      logout: vi.fn().mockReturnValue(of({ message: 'Logged out.' })),
      logoutAll: vi.fn().mockReturnValue(of({ message: 'All sessions revoked.', revokedCount: 2 })),
    };

    authRefreshMock = {
      refreshSession: vi.fn(),
      notifyLogout: vi.fn(),
      authEvents$: new Subject<{ type: string; timestamp: number }>(),
    };

    TestBed.configureTestingModule({
      providers: [
        AuthStateService,
        { provide: AuthApiService, useValue: authApiMock },
        { provide: AuthRefreshService, useValue: authRefreshMock },
      ],
    });

    service = TestBed.inject(AuthStateService);
  });

  it('1. should have initial unknown state and null user', () => {
    expect(service.status()).toBe('unknown');
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.isAdmin()).toBe(false);
    expect(service.isAuthor()).toBe(false);
    expect(service.isChecking()).toBe(false);
  });

  it('2. should set authenticated state and role signals correctly', () => {
    service.setAuthenticated(mockAuthor);
    expect(service.status()).toBe('authenticated');
    expect(service.currentUser()).toEqual(mockAuthor);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isAuthor()).toBe(true);
    expect(service.isAdmin()).toBe(false);

    service.setAuthenticated(mockAdmin);
    expect(service.isAdmin()).toBe(true);
    expect(service.isAuthor()).toBe(false);
  });

  it('3. should set unauthenticated state safely', () => {
    service.setAuthenticated(mockAuthor);
    service.setUnauthenticated();
    expect(service.status()).toBe('unauthenticated');
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('4. should restore session via ensureHydrated() when /auth/me succeeds', () => {
    authApiMock.getCurrentUser.mockReturnValue(of(mockAuthor));

    let result: boolean | undefined;
    service.ensureHydrated().subscribe((res) => (result = res));

    expect(result).toBe(true);
    expect(service.status()).toBe('authenticated');
    expect(service.currentUser()).toEqual(mockAuthor);
  });

  it('5. should share one in-flight hydration call for concurrent callers', () => {
    const userSubject = new Subject<CurrentUser>();
    authApiMock.getCurrentUser.mockReturnValue(userSubject.asObservable());

    let res1: boolean | undefined;
    let res2: boolean | undefined;

    service.ensureHydrated().subscribe((res) => (res1 = res));
    service.ensureHydrated().subscribe((res) => (res2 = res));

    expect(authApiMock.getCurrentUser).toHaveBeenCalledTimes(1);

    userSubject.next(mockAuthor);
    userSubject.complete();

    expect(res1).toBe(true);
    expect(res2).toBe(true);
  });

  it('6. should attempt refresh when /auth/me returns 401, and recover when refresh succeeds', () => {
    // First /auth/me returns 401
    authApiMock.getCurrentUser.mockReturnValueOnce(
      throwError(() => ({ status: 401, message: 'Unauthorized' }))
    );
    // Refresh succeeds
    authRefreshMock.refreshSession.mockReturnValue(of(true));
    // Second /auth/me returns user
    authApiMock.getCurrentUser.mockReturnValueOnce(of(mockAuthor));

    let result: boolean | undefined;
    service.ensureHydrated().subscribe((res) => (result = res));

    expect(authRefreshMock.refreshSession).toHaveBeenCalledTimes(1);
    expect(authApiMock.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(result).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser()).toEqual(mockAuthor);
  });

  it('7. should transition to unauthenticated when refresh fails on 401', () => {
    authApiMock.getCurrentUser.mockReturnValueOnce(
      throwError(() => ({ status: 401, message: 'Unauthorized' }))
    );
    authRefreshMock.refreshSession.mockReturnValue(of(false));

    let result: boolean | undefined;
    service.ensureHydrated().subscribe((res) => (result = res));

    expect(authRefreshMock.refreshSession).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
    expect(service.status()).toBe('unauthenticated');
    expect(service.currentUser()).toBeNull();
  });

  it('8. should transition to unauthenticated on network failure (never grant access)', () => {
    authApiMock.getCurrentUser.mockReturnValue(
      throwError(() => new Error('Network error or server unreachable'))
    );

    let result: boolean | undefined;
    service.ensureHydrated().subscribe((res) => (result = res));

    expect(result).toBe(false);
    expect(service.status()).toBe('unauthenticated');
    expect(service.isAuthenticated()).toBe(false);
  });

  it('9. should protect against stale /auth/me responses arriving after logout (epoch protection)', () => {
    const delayedUserSubject = new Subject<CurrentUser>();
    authApiMock.getCurrentUser.mockReturnValue(delayedUserSubject.asObservable());

    // App starts hydration
    service.ensureHydrated().subscribe();
    expect(service.isChecking()).toBe(true);

    // User logs out before response arrives
    service.logout().subscribe();
    expect(service.status()).toBe('unauthenticated');

    // Late response arrives from the server
    delayedUserSubject.next(mockAuthor);
    delayedUserSubject.complete();

    // Must NOT have restored the user!
    expect(service.status()).toBe('unauthenticated');
    expect(service.currentUser()).toBeNull();
  });

  it('10. should perform logout, notify other tabs, and clear state', () => {
    service.setAuthenticated(mockAuthor);

    let res: { message: string } | undefined;
    service.logout().subscribe((r) => (res = r));

    expect(authApiMock.logout).toHaveBeenCalledTimes(1);
    expect(authRefreshMock.notifyLogout).toHaveBeenCalledTimes(1);
    expect(service.status()).toBe('unauthenticated');
    expect(service.currentUser()).toBeNull();
    expect(res?.message).toBe('Logged out.');
  });

  it('11. should perform logoutAll, notify other tabs, and clear state', () => {
    service.setAuthenticated(mockAuthor);

    let res: { message: string; revokedCount: number } | undefined;
    service.logoutAll().subscribe((r) => (res = r));

    expect(authApiMock.logoutAll).toHaveBeenCalledTimes(1);
    expect(authRefreshMock.notifyLogout).toHaveBeenCalledTimes(1);
    expect(service.status()).toBe('unauthenticated');
    expect(service.currentUser()).toBeNull();
    expect(res?.revokedCount).toBe(2);
  });

  it('12. should clear local state when a LOGOUT event is received from another tab', () => {
    service.setAuthenticated(mockAuthor);
    expect(service.isAuthenticated()).toBe(true);

    authRefreshMock.authEvents$.next({ type: 'LOGOUT', timestamp: Date.now() });

    expect(service.status()).toBe('unauthenticated');
    expect(service.currentUser()).toBeNull();
  });
});
