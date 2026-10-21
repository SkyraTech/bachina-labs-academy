import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { AuthRefreshService } from './auth-refresh.service';
import { AuthApiService } from './auth-api.service';
import { CurrentUser } from '../models';

describe('AuthRefreshService', () => {
  let service: AuthRefreshService;
  let authApiMock: {
    refresh: ReturnType<typeof vi.fn>;
    getCurrentUser: ReturnType<typeof vi.fn>;
  };

  const mockUser: CurrentUser = {
    id: 'user-1',
    email: 'author@skyra-tech.com',
    role: 'AUTHOR',
    status: 'ACTIVE',
    emailVerifiedAt: '2026-10-15T00:00:00Z',
  };

  beforeEach(() => {
    authApiMock = {
      refresh: vi.fn(),
      getCurrentUser: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AuthRefreshService,
        { provide: AuthApiService, useValue: authApiMock },
      ],
    });

    service = TestBed.inject(AuthRefreshService);
  });

  afterEach(() => {
    // Ensure navigator.locks is cleaned up if modified
    delete (navigator as unknown as { locks?: unknown }).locks;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should perform single-flight refresh for concurrent calls in the same tab', async () => {
    const refreshSubject = new Subject<{ message: string }>();
    authApiMock.refresh.mockReturnValue(refreshSubject.asObservable());

    let result1: boolean | undefined;
    let result2: boolean | undefined;

    service.refreshSession().subscribe((res) => (result1 = res));
    service.refreshSession().subscribe((res) => (result2 = res));

    // Only one call to backend refresh should have happened
    expect(authApiMock.refresh).toHaveBeenCalledTimes(1);

    refreshSubject.next({ message: 'Token refreshed successfully.' });
    refreshSubject.complete();

    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });

  it('should return false and handle error when refresh fails', async () => {
    authApiMock.refresh.mockReturnValue(throwError(() => new Error('401 Unauthorized')));

    let result: boolean | undefined;
    service.refreshSession().subscribe((res) => (result = res));

    expect(authApiMock.refresh).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('should allow a new refresh request after the previous one finishes', async () => {
    authApiMock.refresh.mockReturnValue(of({ message: 'Refreshed' }));

    let result1: boolean | undefined;
    service.refreshSession().subscribe((res) => (result1 = res));
    expect(result1).toBe(true);
    expect(authApiMock.refresh).toHaveBeenCalledTimes(1);

    let result2: boolean | undefined;
    service.refreshSession().subscribe((res) => (result2 = res));
    expect(result2).toBe(true);
    expect(authApiMock.refresh).toHaveBeenCalledTimes(2);
  });

  it('should broadcast logout without any credentials or tokens', () => {
    const broadcastSpy = vi.spyOn(service, 'broadcastEvent');
    service.notifyLogout();
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LOGOUT',
        timestamp: expect.any(Number),
      })
    );
  });

  it('should use Web Locks and reuse credentials without rotating if another tab already refreshed', async () => {
    const fakeLockRequest = vi.fn().mockImplementation(async (_lockName: string, callback: () => Promise<boolean>) => {
      return await callback();
    });

    Object.defineProperty(navigator, 'locks', {
      value: { request: fakeLockRequest },
      configurable: true,
      writable: true,
    });

    // Another tab rotated cookies, so getCurrentUser succeeds!
    authApiMock.getCurrentUser.mockReturnValue(of(mockUser));

    let result: boolean | undefined;
    service.refreshSession().subscribe((res) => (result = res));

    // Wait for promise resolution
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(fakeLockRequest).toHaveBeenCalledWith('academy_auth_refresh_lock', expect.any(Function));
    expect(authApiMock.getCurrentUser).toHaveBeenCalledTimes(1);
    // Because cookies were already valid, refresh was NOT rotated again!
    expect(authApiMock.refresh).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should use Web Locks and rotate refresh token if current cookies remain invalid', async () => {
    const fakeLockRequest = vi.fn().mockImplementation(async (_lockName: string, callback: () => Promise<boolean>) => {
      return await callback();
    });

    Object.defineProperty(navigator, 'locks', {
      value: { request: fakeLockRequest },
      configurable: true,
      writable: true,
    });

    // getCurrentUser fails with 401
    authApiMock.getCurrentUser.mockReturnValue(throwError(() => ({ status: 401, message: 'Expired' })));
    // Then refresh succeeds
    authApiMock.refresh.mockReturnValue(of({ message: 'Refreshed' }));

    let result: boolean | undefined;
    service.refreshSession().subscribe((res) => (result = res));

    // Wait for promise resolution
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(fakeLockRequest).toHaveBeenCalledWith('academy_auth_refresh_lock', expect.any(Function));
    expect(authApiMock.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(authApiMock.refresh).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('should return false when both getCurrentUser and refresh fail under Web Lock', async () => {
    const fakeLockRequest = vi.fn().mockImplementation(async (_lockName: string, callback: () => Promise<boolean>) => {
      return await callback();
    });

    Object.defineProperty(navigator, 'locks', {
      value: { request: fakeLockRequest },
      configurable: true,
      writable: true,
    });

    authApiMock.getCurrentUser.mockReturnValue(throwError(() => ({ status: 401 })));
    authApiMock.refresh.mockReturnValue(throwError(() => ({ status: 401, message: 'Revoked' })));

    let result: boolean | undefined;
    service.refreshSession().subscribe((res) => (result = res));

    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(result).toBe(false);
  });
});
