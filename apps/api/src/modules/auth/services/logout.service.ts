import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionsRepository } from '../../sessions/sessions.repository.js';
import { SessionsService } from '../../sessions/sessions.service.js';
import { JwtTokenService } from './jwt-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import {
  CookieService,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from './cookie.service.js';
import type { AuthenticatedUser } from '../types/jwt.types.js';
import type { LogoutResponseDto } from '../dto/logout-response.dto.js';
import type { LogoutAllResponseDto } from '../dto/logout-all-response.dto.js';
import type { ActiveSessionResponseDto } from '../dto/active-session-response.dto.js';
import type { RevokeSessionResponseDto } from '../dto/revoke-session-response.dto.js';

@Injectable()
export class LogoutService {
  private readonly logger = new Logger(LogoutService.name);

  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly sessionsService: SessionsService,
    private readonly jwtTokenService: JwtTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly cookieService: CookieService,
  ) {}

  /**
   * Ends the session on the current device.
   *
   * Critical Requirements:
   * 1. Works when access JWT is expired or missing, provided the refresh cookie identifies a valid session.
   * 2. Validates opaque refresh token hash against an active, unexpired PostgreSQL session.
   * 3. Revokes only the identified current session.
   * 4. Clears both authentication cookies.
   * 5. Handles repeated logout requests idempotently without leaking internals.
   * 6. Never accepts a session ID or user ID from an untrusted request body.
   */
  async logout(req: Request, res: Response): Promise<LogoutResponseDto> {
    let sessionIdToRevoke: string | null = null;

    // 1. Attempt identification via access JWT cookie
    const accessToken = req.cookies?.[ACCESS_COOKIE_NAME];
    if (accessToken && typeof accessToken === 'string') {
      try {
        const payload = await this.jwtTokenService.verifyAccessToken(accessToken);
        const session = await this.sessionsRepository.findById(payload.sid);
        if (session && session.revokedAt === null) {
          sessionIdToRevoke = session.id;
        }
      } catch {
        // Access token expired, malformed, or signature invalid; proceed to refresh cookie fallback
      }
    }

    // 2. Fallback: attempt identification via refresh cookie if access token did not resolve
    if (!sessionIdToRevoke) {
      const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (rawRefreshToken && typeof rawRefreshToken === 'string') {
        const tokenHash = this.refreshTokenService.hashRefreshToken(rawRefreshToken);
        const session = await this.sessionsRepository.findByRefreshTokenHash(tokenHash);
        const now = new Date();
        if (session && session.revokedAt === null && session.expiresAt > now) {
          sessionIdToRevoke = session.id;
        }
      }
    }

    // 3. If an active session was authoritatively identified, revoke it
    if (sessionIdToRevoke) {
      this.logger.debug(`Revoking current session: ${sessionIdToRevoke}`);
      await this.sessionsService.revokeSession(sessionIdToRevoke, 'USER_LOGOUT');
    }

    // 4. Always clear both authentication cookies using centralized paths
    this.cookieService.clearAuthCookies(res);

    return {
      message: 'Logged out successfully.',
    };
  }

  /**
   * Revokes all active sessions for the authenticated user across every device and browser.
   */
  async logoutAll(
    currentUser: AuthenticatedUser,
    res: Response,
  ): Promise<LogoutAllResponseDto> {
    this.logger.debug(`Revoking all sessions for user: ${currentUser.id}`);

    const revokedCount = await this.sessionsService.revokeAllUserSessions(
      currentUser.id,
      'USER_LOGOUT_ALL',
    );

    // Clear current browser cookies
    this.cookieService.clearAuthCookies(res);

    return {
      message: 'All sessions logged out successfully.',
      revokedCount,
    };
  }

  /**
   * Returns a safe list of active device sessions for the authenticated user.
   */
  async getActiveSessions(
    currentUser: AuthenticatedUser,
  ): Promise<ActiveSessionResponseDto[]> {
    const sessions = await this.sessionsService.listActiveUserSessions(
      currentUser.id,
      currentUser.sessionId,
    );

    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      isCurrent: Boolean(session.isCurrent),
    }));
  }

  /**
   * Allows a user to revoke one of their active device sessions.
   *
   * Requirements:
   * 1. Atomic database revocation matching both sessionId and userId.
   * 2. Non-enumerating 404 response for nonexistent, foreign, or already-revoked sessions.
   * 3. Clears cookies if and only if the revoked session is the current browser session.
   */
  async revokeSession(
    sessionId: string,
    currentUser: AuthenticatedUser,
    res: Response,
  ): Promise<RevokeSessionResponseDto> {
    const isCurrentSession = sessionId === currentUser.sessionId;

    const revoked = await this.sessionsService.revokeUserSession(
      sessionId,
      currentUser.id,
      'USER_LOGOUT',
    );

    if (!revoked) {
      throw new NotFoundException('Session not found.');
    }

    if (isCurrentSession) {
      this.cookieService.clearAuthCookies(res);
    }

    return {
      message: 'Session revoked successfully.',
      isCurrentSession,
    };
  }
}
