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
import { PrismaService } from '../../../database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditActorFactory } from '../../audit/types/audit-event.types.js';
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
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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
      this.logger.log(
        `Revoking current session: ${sessionIdToRevoke} [action=auth.session.revoke, outcome=success]`,
      );
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
    this.logger.log(
      `Revoking all sessions for user: ${currentUser.id} [action=auth.session.revoke_all, outcome=success]`,
    );

    const revokedCount = await this.prisma.$transaction(async (tx) => {
      const count = await this.sessionsService.revokeAllUserSessions(
        currentUser.id,
        'USER_LOGOUT_ALL',
        undefined,
        new Date(),
        tx,
      );

      if (count > 0) {
        await this.auditService.recordTransactional(tx, {
          action: 'auth.session.revoked_all',
          actor: AuditActorFactory.fromAuthenticatedPrincipal(currentUser),
          resourceType: 'SESSION',
          resourceId: null, // Privacy Option A: null for bulk
          outcome: 'SUCCESS',
          metadata: {
            revocationReason: 'LOGOUT_ALL',
            sessionsCount: count,
          },
        });
      }

      return count;
    });

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

    await this.prisma.$transaction(async (tx) => {
      const revoked = await this.sessionsService.revokeUserSession(
        sessionId,
        currentUser.id,
        'USER_LOGOUT',
        new Date(),
        tx,
      );

      if (!revoked) {
        throw new NotFoundException('Session not found.');
      }

      await this.auditService.recordTransactional(tx, {
        action: 'auth.session.revoked',
        actor: AuditActorFactory.fromAuthenticatedPrincipal(currentUser),
        resourceType: 'SESSION',
        resourceId: sessionId, // Privacy Option A: actual session UUID
        outcome: 'SUCCESS',
        metadata: {
          revocationReason: 'USER_INITIATED',
        },
      });
    });

    if (isCurrentSession) {
      this.cookieService.clearAuthCookies(res);
    }

    return {
      message: 'Session revoked successfully.',
      isCurrentSession,
    };
  }
}
