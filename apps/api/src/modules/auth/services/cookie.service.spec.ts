import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import {
  CookieService,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE_PATH,
} from './cookie.service';

describe('CookieService', () => {
  let service: CookieService;
  let mockRes: {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };

  const mockConfig = {
    privateKey: '',
    publicKey: '',
    issuer: '',
    audience: '',
    accessTtlSeconds: 900,
    sessionDefaultTtlHours: 24,
    sessionRememberTtlDays: 30,
    cookieSecure: true,
    cookieSameSite: 'lax' as const,
    cookieDomain: 'example.com',
  };

  beforeEach(() => {
    service = new CookieService(mockConfig);
    mockRes = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };
  });

  it('sets access cookie and persistent refresh cookie when rememberMe is true', () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    service.setAuthCookies(mockRes as unknown as Response, {
      accessToken: 'jwt-token',
      refreshToken: 'opaque-refresh-token',
      rememberMe: true,
      sessionExpiresAt: expiresAt,
    });

    expect(mockRes.cookie).toHaveBeenCalledTimes(2);

    // Access cookie
    expect(mockRes.cookie).toHaveBeenCalledWith(
      ACCESS_COOKIE_NAME,
      'jwt-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: ACCESS_COOKIE_PATH,
        domain: 'example.com',
        maxAge: 900 * 1000,
      }),
    );

    // Refresh cookie (with persistent maxAge)
    expect(mockRes.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'opaque-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
        domain: 'example.com',
        maxAge: expect.any(Number),
      }),
    );
  });

  it('omits maxAge on refresh cookie when rememberMe is false (browser session)', () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    service.setAuthCookies(mockRes as unknown as Response, {
      accessToken: 'jwt-token',
      refreshToken: 'opaque-refresh-token',
      rememberMe: false,
      sessionExpiresAt: expiresAt,
    });

    // Check refresh cookie call options — maxAge should be undefined
    const refreshCall = mockRes.cookie.mock.calls.find(
      (c) => c[0] === REFRESH_COOKIE_NAME,
    );
    expect(refreshCall).toBeDefined();
    expect(refreshCall![2].maxAge).toBeUndefined();
    expect(refreshCall![2].expires).toBeUndefined();
  });

  it('clears cookies with matching path and domain attributes', () => {
    service.clearAuthCookies(mockRes as unknown as Response);

    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      ACCESS_COOKIE_NAME,
      expect.objectContaining({
        path: ACCESS_COOKIE_PATH,
        domain: 'example.com',
      }),
    );
    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.objectContaining({
        path: REFRESH_COOKIE_PATH,
        domain: 'example.com',
      }),
    );
  });
});
