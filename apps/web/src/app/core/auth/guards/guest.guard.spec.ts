import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of, firstValueFrom, Observable } from 'rxjs';
import { guestGuard } from './guest.guard';
import { AuthStateService } from '../services/auth-state.service';
import { CurrentUser } from '../models';

describe('guestGuard', () => {
  let authStateMock: {
    ensureHydrated: ReturnType<typeof vi.fn>;
    currentUser: ReturnType<typeof vi.fn>;
  };
  let router: Router;

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
    authStateMock = {
      ensureHydrated: vi.fn(),
      currentUser: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStateService, useValue: authStateMock },
        {
          provide: Router,
          useValue: {
            createUrlTree: vi.fn((commands) => ({ commands } as unknown as UrlTree)),
            parseUrl: vi.fn((url) => ({ url } as unknown as UrlTree)),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('should allow unauthenticated visitors', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(false));

    const route = {
      queryParamMap: convertToParamMap({}),
    } as unknown as ActivatedRouteSnapshot;

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guestGuard(route, {} as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(result).toBe(true);
  });

  it('should redirect authenticated AUTHOR to /author', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAuthor);

    const route = {
      queryParamMap: convertToParamMap({}),
    } as unknown as ActivatedRouteSnapshot;

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guestGuard(route, {} as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/author']);
    expect(result).toEqual({ commands: ['/author'] });
  });

  it('should redirect authenticated ADMIN to /admin', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAdmin);

    const route = {
      queryParamMap: convertToParamMap({}),
    } as unknown as ActivatedRouteSnapshot;

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guestGuard(route, {} as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/admin']);
    expect(result).toEqual({ commands: ['/admin'] });
  });

  it('should redirect to safe permitted returnUrl if compatible with role', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAuthor);

    const route = {
      queryParamMap: convertToParamMap({ returnUrl: '/account/security' }),
    } as unknown as ActivatedRouteSnapshot;

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guestGuard(route, {} as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(router.parseUrl).toHaveBeenCalledWith('/account/security');
    expect(result).toEqual({ url: '/account/security' });
  });
});
