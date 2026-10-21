import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { LoginComponent, sanitizeRedirectUrl } from './login.component';
import { AuthApiService, AuthStateService } from '../../../core';
import { ToastService } from '../../../shared/ui';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let router: Router;
  let authApiSpy: {
    login: ReturnType<typeof vi.fn>;
  };
  let authStateSpy: {
    setAuthenticated: ReturnType<typeof vi.fn>;
  };
  let toastSpy: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApiSpy = {
      login: vi.fn(),
    };
    authStateSpy = {
      setAuthenticated: vi.fn(),
    };
    toastSpy = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApiService, useValue: authApiSpy },
        { provide: AuthStateService, useValue: authStateSpy },
        { provide: ToastService, useValue: toastSpy },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockImplementation(() => Promise.resolve(true));

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the login component with configured fields defaulting rememberMe to false', () => {
    expect(component).toBeTruthy();
    expect(component.fields.length).toBe(3);
    expect(component.fields[0].name).toBe('email');
    expect(component.fields[1].name).toBe('password');
    expect(component.fields[2].name).toBe('rememberMe');
    expect(component.fields[2].defaultValue).toBe(false);
  });

  it('should authenticate valid credentials and navigate to safe destination', () => {
    authApiSpy.login.mockReturnValue(
      of({
        message: 'Login successful.',
        user: {
          id: 'user-uuid-1',
          email: 'author@skyra-tech.com',
          role: 'AUTHOR',
          status: 'ACTIVE',
          emailVerifiedAt: '2026-10-15T00:00:00Z',
        },
      }),
    );

    component.onSubmit({
      email: 'author@skyra-tech.com',
      password: 'valid-password-1234',
      rememberMe: true,
    });

    expect(authApiSpy.login).toHaveBeenCalledWith({
      email: 'author@skyra-tech.com',
      password: 'valid-password-1234',
      rememberMe: true,
    });
    expect(component.submitting()).toBe(false);
    expect(authStateSpy.setAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'author@skyra-tech.com', role: 'AUTHOR' })
    );
    expect(toastSpy.success).toHaveBeenCalledWith('Welcome back, author@skyra-tech.com');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/author');
  });

  it('should redirect ADMIN users to /admin by default', () => {
    authApiSpy.login.mockReturnValue(
      of({
        message: 'Login successful.',
        user: {
          id: 'admin-uuid-1',
          email: 'admin@skyra-tech.com',
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerifiedAt: '2026-10-15T00:00:00Z',
        },
      }),
    );

    component.onSubmit({
      email: 'admin@skyra-tech.com',
      password: 'admin-password-1234',
      rememberMe: false,
    });

    expect(authStateSpy.setAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@skyra-tech.com', role: 'ADMIN' })
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin');
  });

  it('should display friendly error on 401 invalid credentials', () => {
    const errorResponse = new HttpErrorResponse({
      status: 401,
      error: { message: 'Invalid email or password.' },
    });
    authApiSpy.login.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit({
      email: 'wrong@skyra-tech.com',
      password: 'bad-password',
      rememberMe: false,
    });

    expect(component.submitting()).toBe(false);
    expect(component.serverError()).toContain('Invalid email address or password');
    expect(component.unverifiedEmail()).toBeNull();
  });

  it('should guide unverified user to resend verification link when error message indicates unverified email', () => {
    const errorResponse = new HttpErrorResponse({
      status: 401,
      error: { message: 'Please verify your email address before logging in.' },
    });
    authApiSpy.login.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit({
      email: 'unverified@skyra-tech.com',
      password: 'valid-password-1234',
      rememberMe: false,
    });

    expect(component.unverifiedEmail()).toBe('unverified@skyra-tech.com');
    expect(component.serverError()).toContain('email address has not been verified yet');

    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.unverified-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Resend verification email to unverified@skyra-tech.com');
  });

  it('should display rate-limiting error on 429 response', () => {
    const errorResponse = new HttpErrorResponse({
      status: 429,
      error: { message: 'Too Many Requests' },
    });
    authApiSpy.login.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit({
      email: 'author@skyra-tech.com',
      password: 'valid-password-1234',
      rememberMe: false,
    });

    expect(component.serverError()).toContain('Too many login attempts');
  });

  it('should prevent duplicate submission while already submitting', () => {
    component.submitting.set(true);
    component.onSubmit({
      email: 'author@skyra-tech.com',
      password: 'valid-password-1234',
      rememberMe: false,
    });

    expect(authApiSpy.login).not.toHaveBeenCalled();
  });

  describe('sanitizeRedirectUrl', () => {
    it('should allow valid relative paths', () => {
      expect(sanitizeRedirectUrl('/author')).toBe('/author');
      expect(sanitizeRedirectUrl('/author/articles/new')).toBe('/author/articles/new');
      expect(sanitizeRedirectUrl('/articles/intro-to-angular')).toBe('/articles/intro-to-angular');
    });

    it('should reject open-redirects and absolute URLs', () => {
      expect(sanitizeRedirectUrl('https://evil.com')).toBe('/author');
      expect(sanitizeRedirectUrl('http://attacker.org')).toBe('/author');
      expect(sanitizeRedirectUrl('//evil.com/phishing')).toBe('/author');
      expect(sanitizeRedirectUrl('javascript:alert(1)')).toBe('/author');
    });

    it('should reject redirect loops back to auth pages', () => {
      expect(sanitizeRedirectUrl('/login')).toBe('/author');
      expect(sanitizeRedirectUrl('/register')).toBe('/author');
      expect(sanitizeRedirectUrl('/verify-email')).toBe('/author');
      expect(sanitizeRedirectUrl('/resend-verification')).toBe('/author');
    });

    it('should return fallback for null or empty string', () => {
      expect(sanitizeRedirectUrl(null)).toBe('/author');
      expect(sanitizeRedirectUrl(undefined)).toBe('/author');
      expect(sanitizeRedirectUrl('')).toBe('/author');
      expect(sanitizeRedirectUrl('   ')).toBe('/author');
    });
  });
});
