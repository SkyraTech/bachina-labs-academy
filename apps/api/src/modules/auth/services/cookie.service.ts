import { Injectable, Inject } from '@nestjs/common';
import type { Response } from 'express';
import type { ConfigType } from '@nestjs/config';
import jwtConfig from '../../../config/jwt.config';

export const ACCESS_COOKIE_NAME = 'academy_access';
export const REFRESH_COOKIE_NAME = 'academy_refresh';
export const ACCESS_COOKIE_PATH = '/';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface SetAuthCookiesParams {
  accessToken: string;
  refreshToken: string;
  rememberMe: boolean;
  sessionExpiresAt: Date;
}

@Injectable()
export class CookieService {
  constructor(
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  /**
   * Sets the short-lived access JWT and opaque refresh token in separate HttpOnly cookies.
   */
  setAuthCookies(res: Response, params: SetAuthCookiesParams): void {
    const { accessToken, refreshToken, rememberMe, sessionExpiresAt } = params;
    const now = Date.now();

    // 1. Access Token Cookie (15m, bounded by remaining session lifetime)
    const accessTtlMs = this.config.accessTtlSeconds * 1000;
    const remainingSessionMs = Math.max(0, sessionExpiresAt.getTime() - now);
    const effectiveAccessMaxAge = Math.min(accessTtlMs, remainingSessionMs);

    res.cookie(ACCESS_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      path: ACCESS_COOKIE_PATH,
      domain: this.config.cookieDomain,
      maxAge: effectiveAccessMaxAge,
    });

    // 2. Refresh Token Cookie
    // If rememberMe = true: persistent cookie bounded by remaining session lifetime
    // If rememberMe = false: browser session cookie (no maxAge/expires on cookie)
    if (rememberMe) {
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
        httpOnly: true,
        secure: this.config.cookieSecure,
        sameSite: this.config.cookieSameSite,
        path: REFRESH_COOKIE_PATH,
        domain: this.config.cookieDomain,
        maxAge: remainingSessionMs,
      });
    } else {
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
        httpOnly: true,
        secure: this.config.cookieSecure,
        sameSite: this.config.cookieSameSite,
        path: REFRESH_COOKIE_PATH,
        domain: this.config.cookieDomain,
      });
    }
  }

  /**
   * Clears both access and refresh cookies.
   */
  clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      path: ACCESS_COOKIE_PATH,
      domain: this.config.cookieDomain,
    });

    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      path: REFRESH_COOKIE_PATH,
      domain: this.config.cookieDomain,
    });
  }
}
