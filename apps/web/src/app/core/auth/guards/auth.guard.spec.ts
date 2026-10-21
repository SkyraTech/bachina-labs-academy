import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of, firstValueFrom, Observable } from 'rxjs';
import { authGuard, sanitizeReturnUrl } from './auth.guard';
import { AuthStateService } from '../services/auth-state.service';

describe('authGuard', () => {
  let authStateMock: {
    ensureHydrated: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(() => {
    authStateMock = {
      ensureHydrated: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStateService, useValue: authStateMock },
        {
          provide: Router,
          useValue: {
            createUrlTree: vi.fn((commands, extras) => ({ commands, extras } as unknown as UrlTree)),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  describe('sanitizeReturnUrl', () => {
    it('should permit valid relative paths', () => {
      expect(sanitizeReturnUrl('/author/articles')).toBe('/author/articles');
      expect(sanitizeReturnUrl('/account/security')).toBe('/account/security');
    });

    it('should reject external and malicious URLs', () => {
      expect(sanitizeReturnUrl('https://evil.com')).toBeNull();
      expect(sanitizeReturnUrl('http://evil.com')).toBeNull();
      expect(sanitizeReturnUrl('//evil.com')).toBeNull();
      expect(sanitizeReturnUrl('/\\evil.com')).toBeNull();
      expect(sanitizeReturnUrl(null)).toBeNull();
      expect(sanitizeReturnUrl('')).toBeNull();
    });
  });

  it('should allow access if user is authenticated', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        authGuard({} as ActivatedRouteSnapshot, { url: '/author' } as RouterStateSnapshot) as Observable<boolean | UrlTree>
      )
    );

    expect(result).toBe(true);
  });

  it('should redirect unauthenticated user to /login with returnUrl', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(false));

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        authGuard({} as ActivatedRouteSnapshot, { url: '/author/articles' } as RouterStateSnapshot) as Observable<boolean | UrlTree>
      )
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/author/articles' },
    });
    expect(result).toEqual({
      commands: ['/login'],
      extras: { queryParams: { returnUrl: '/author/articles' } },
    });
  });

  it('should not include returnUrl if path is / or /login', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(false));

    await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        authGuard({} as ActivatedRouteSnapshot, { url: '/' } as RouterStateSnapshot) as Observable<boolean | UrlTree>
      )
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: undefined,
    });
  });
});
