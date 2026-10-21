import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of, firstValueFrom, Observable } from 'rxjs';
import { roleGuard } from './role.guard';
import { AuthStateService } from '../services/auth-state.service';
import { CurrentUser } from '../models';

describe('roleGuard', () => {
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
            createUrlTree: vi.fn((commands, extras) => ({ commands, extras } as unknown as UrlTree)),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('1. should redirect unauthenticated users to /login with returnUrl', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(false));

    const guard = roleGuard(['AUTHOR']);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/author' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/author' },
    });
    expect(result).toEqual({
      commands: ['/login'],
      extras: { queryParams: { returnUrl: '/author' } },
    });
  });

  it('2. should permit AUTHOR accessing AUTHOR routes', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAuthor);

    const guard = roleGuard(['AUTHOR']);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/author' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(result).toBe(true);
  });

  it('3. should deny AUTHOR accessing ADMIN routes and redirect to /author', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAuthor);

    const guard = roleGuard(['ADMIN']);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/author']);
    expect(result).toEqual({ commands: ['/author'], extras: undefined });
  });

  it('4. should permit ADMIN accessing ADMIN routes', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAdmin);

    const guard = roleGuard(['ADMIN']);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(result).toBe(true);
  });

  it('5. should deny ADMIN accessing AUTHOR-only routes and redirect to /admin', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    authStateMock.currentUser.mockReturnValue(mockAdmin);

    const guard = roleGuard(['AUTHOR']);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/author' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/admin']);
    expect(result).toEqual({ commands: ['/admin'], extras: undefined });
  });

  it('6. should permit either AUTHOR or ADMIN when route allows both (e.g. account security)', async () => {
    authStateMock.ensureHydrated.mockReturnValue(of(true));
    const guard = roleGuard(['AUTHOR', 'ADMIN']);

    authStateMock.currentUser.mockReturnValue(mockAuthor);
    const authorRes = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/account/security' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );
    expect(authorRes).toBe(true);

    authStateMock.currentUser.mockReturnValue(mockAdmin);
    const adminRes = await TestBed.runInInjectionContext(() =>
      firstValueFrom(guard({} as ActivatedRouteSnapshot, { url: '/account/security' } as RouterStateSnapshot) as Observable<boolean | UrlTree>)
    );
    expect(adminRes).toBe(true);
  });
});
