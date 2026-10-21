import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthApiService } from './auth-api.service';
import { API_BASE_URL } from '../../api/api-config';
import {
  CurrentUser,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
  ActiveSession,
} from '../models';

describe('AuthApiService', () => {
  let service: AuthApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });

    service = TestBed.inject(AuthApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should post to /api/v1/auth/register with credentials', () => {
    const request: RegisterRequest = {
      email: 'newauthor@skyra-tech.com',
      password: 'correct-horse-battery-staple',
    };
    const mockResponse: RegisterResponse = {
      id: 'user-uuid-1',
      email: 'newauthor@skyra-tech.com',
      role: 'AUTHOR',
      status: 'ACTIVE',
      emailVerifiedAt: null,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    };

    let actual: RegisterResponse | undefined;
    service.register(request).subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    expect(req.request.withCredentials).toBe(true);

    req.flush(mockResponse);
    expect(actual).toEqual(mockResponse);
  });

  it('should post to /api/v1/auth/login with credentials and rememberMe', () => {
    const request: LoginRequest = {
      email: 'author@skyra-tech.com',
      password: 'correct-horse-battery-staple',
      rememberMe: true,
    };
    const mockResponse: LoginResponse = {
      message: 'Login successful.',
      user: {
        id: 'user-uuid-1',
        email: 'author@skyra-tech.com',
        role: 'AUTHOR',
        status: 'ACTIVE',
        emailVerifiedAt: '2026-10-15T00:00:00Z',
      },
    };

    let actual: LoginResponse | undefined;
    service.login(request).subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    expect(req.request.withCredentials).toBe(true);

    req.flush(mockResponse);
    expect(actual).toEqual(mockResponse);
  });

  it('should post to /api/v1/auth/verify-email with single-use token', () => {
    const request: VerifyEmailRequest = {
      token: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abCdE',
    };
    const mockResponse: VerifyEmailResponse = {
      verified: true,
      message: 'Your email address has been verified.',
    };

    let actual: VerifyEmailResponse | undefined;
    service.verifyEmail(request).subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/verify-email');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    expect(req.request.withCredentials).toBe(true);

    req.flush(mockResponse);
    expect(actual).toEqual(mockResponse);
  });

  it('should post to /api/v1/auth/resend-verification with email', () => {
    const request: ResendVerificationRequest = {
      email: 'author@skyra-tech.com',
    };
    const mockResponse: ResendVerificationResponse = {
      status: 202,
      message: 'If an account exists for that address, a verification email has been sent.',
    };

    let actual: ResendVerificationResponse | undefined;
    service.resendVerification(request).subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/resend-verification');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    expect(req.request.withCredentials).toBe(true);

    req.flush(mockResponse);
    expect(actual).toEqual(mockResponse);
  });

  it('should get /api/v1/auth/me with credentials', () => {
    const mockUser: CurrentUser = {
      id: 'user-uuid-1',
      email: 'author@skyra-tech.com',
      role: 'AUTHOR',
      status: 'ACTIVE',
      emailVerifiedAt: '2026-10-15T00:00:00Z',
    };

    let actual: CurrentUser | undefined;
    service.getCurrentUser().subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(true);

    req.flush(mockUser);
    expect(actual).toEqual(mockUser);
  });

  it('should post to /api/v1/auth/logout with credentials', () => {
    let actual: { message: string } | undefined;
    service.logout().subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);

    req.flush({ message: 'Logged out successfully.' });
    expect(actual?.message).toBe('Logged out successfully.');
  });

  it('should post to /api/v1/auth/refresh with credentials', () => {
    let actual: { message: string } | undefined;
    service.refresh().subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    expect(req.request.withCredentials).toBe(true);

    req.flush({ message: 'Token refreshed successfully.' });
    expect(actual?.message).toBe('Token refreshed successfully.');
  });

  it('should post to /api/v1/auth/logout-all with credentials', () => {
    let actual: { message: string; revokedCount: number } | undefined;
    service.logoutAll().subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/logout-all');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    expect(req.request.withCredentials).toBe(true);

    req.flush({ message: 'All sessions revoked.', revokedCount: 3 });
    expect(actual?.message).toBe('All sessions revoked.');
    expect(actual?.revokedCount).toBe(3);
  });

  it('should get /api/v1/auth/sessions with credentials', () => {
    const mockSessions: ActiveSession[] = [
      {
        id: 'sess-1',
        createdAt: '2026-10-15T00:00:00Z',
        lastSeenAt: '2026-10-15T01:00:00Z',
        expiresAt: '2026-10-16T00:00:00Z',
        rememberMe: false,
        userAgent: 'Mozilla/5.0 Chrome',
        ipAddress: '127.0.0.1',
        isCurrent: true,
      },
    ];

    let actual: ActiveSession[] | undefined;
    service.getSessions().subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/sessions');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(true);

    req.flush(mockSessions);
    expect(actual).toEqual(mockSessions);
  });

  it('should delete /api/v1/auth/sessions/:sessionId with credentials', () => {
    let actual: { message: string; isCurrentSession: boolean } | undefined;
    service.revokeSession('sess-1').subscribe((res) => (actual = res));

    const req = httpMock.expectOne('/api/v1/auth/sessions/sess-1');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.withCredentials).toBe(true);

    req.flush({ message: 'Session revoked successfully.', isCurrentSession: false });
    expect(actual?.message).toBe('Session revoked successfully.');
    expect(actual?.isCurrentSession).toBe(false);
  });
});
