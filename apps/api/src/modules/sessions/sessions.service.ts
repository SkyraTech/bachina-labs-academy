import { Injectable, Logger } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import { SessionsRepository } from './sessions.repository';
import type {
  CreateSessionInput,
  RevocationReason,
  RotateFailureReason,
  RotateRefreshTokenResult,
  SafeSession,
} from './types/session.types';

export const DEFAULT_SESSION_TTL_HOURS = 24;
export const REMEMBER_ME_SESSION_TTL_DAYS = 30;

export interface RotateSessionTokenParams {
  sessionId: string;
  currentRefreshTokenHash: string;
  newRefreshTokenHash: string;
  now?: Date;
}

export interface RotateSessionTokenOutput {
  success: boolean;
  session?: SafeSession;
  replayDetected?: boolean;
  reason?: RotateFailureReason;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly sessionsRepository: SessionsRepository) {}

  /**
   * Calculates absolute session expiration date depending on Remember Me flag.
   * - rememberMe = false: 24 hours
   * - rememberMe = true: 30 days
   */
  calculateExpiry(rememberMe: boolean, fromDate: Date = new Date()): Date {
    const expiresAt = new Date(fromDate.getTime());
    if (rememberMe) {
      expiresAt.setDate(expiresAt.getDate() + REMEMBER_ME_SESSION_TTL_DAYS);
    } else {
      expiresAt.setHours(expiresAt.getHours() + DEFAULT_SESSION_TTL_HOURS);
    }
    return expiresAt;
  }

  /**
   * Creates and persists a new user session with computed absolute expiry.
   * Returns a SafeSession view omitting the token hash.
   */
  async createSession(
    params: Omit<CreateSessionInput, 'expiresAt'> & { now?: Date },
  ): Promise<SafeSession> {
    const now = params.now ?? new Date();
    const expiresAt = this.calculateExpiry(params.rememberMe, now);

    const record = await this.sessionsRepository.createSession({
      userId: params.userId,
      refreshTokenHash: params.refreshTokenHash,
      rememberMe: params.rememberMe,
      expiresAt,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
    });

    return this.toSafeSession(record);
  }

  /**
   * Validates that a session exists, is not revoked, and has not expired.
   * Also updates last_seen_at with bounded write frequency.
   */
  async validateSession(
    sessionId: string,
    now: Date = new Date(),
  ): Promise<SafeSession | null> {
    const session = await this.sessionsRepository.findById(sessionId);

    if (!session) {
      return null;
    }

    if (session.revokedAt !== null) {
      return null;
    }

    if (session.expiresAt <= now) {
      return null;
    }

    // Record activity timestamp (frequency-throttled at repository level)
    await this.sessionsRepository.touchLastSeen(sessionId, now);

    return this.toSafeSession(session);
  }

  /**
   * Performs an atomic refresh-token rotation.
   *
   * If a previous or unexpected token hash is presented for an active session,
   * detects potential token replay, terminates the compromised session
   * immediately, and returns replayDetected = true.
   */
  async rotateSessionToken(
    params: RotateSessionTokenParams,
  ): Promise<RotateSessionTokenOutput> {
    const now = params.now ?? new Date();

    const result: RotateRefreshTokenResult =
      await this.sessionsRepository.rotateRefreshToken({
        sessionId: params.sessionId,
        currentRefreshTokenHash: params.currentRefreshTokenHash,
        newRefreshTokenHash: params.newRefreshTokenHash,
        now,
      });

    if (result.success && result.session) {
      return {
        success: true,
        session: this.toSafeSession(result.session),
      };
    }

    if (result.reason === 'TOKEN_MISMATCH') {
      this.logger.debug(
        `Stale or mismatched refresh token presented for session ${params.sessionId}. Rejecting rotation attempt.`,
      );
      return { success: false, replayDetected: false, reason: 'TOKEN_MISMATCH' };
    }

    return { success: false, replayDetected: false, reason: result.reason };
  }

  /**
   * Revokes a single session (e.g. standard user logout).
   */
  async revokeSession(
    sessionId: string,
    reason: RevocationReason = 'USER_LOGOUT',
    now: Date = new Date(),
  ): Promise<boolean> {
    return await this.sessionsRepository.revokeSession(sessionId, now, reason);
  }

  /**
   * Revokes all active sessions for a user (e.g. security reset or "Logout All").
   */
  async revokeAllUserSessions(
    userId: string,
    reason: RevocationReason = 'USER_LOGOUT_ALL',
    exceptSessionId?: string,
    now: Date = new Date(),
  ): Promise<number> {
    return await this.sessionsRepository.revokeAllUserSessions(
      userId,
      now,
      reason,
      exceptSessionId,
    );
  }

  /**
   * Revokes a single session owned by a specific user.
   * Returns true if a session was revoked, false if not found/unowned/already revoked.
   */
  async revokeUserSession(
    sessionId: string,
    userId: string,
    reason: RevocationReason = 'USER_LOGOUT',
    now: Date = new Date(),
  ): Promise<boolean> {
    return await this.sessionsRepository.revokeUserSession(
      sessionId,
      userId,
      now,
      reason,
    );
  }

  /**
   * Lists only active (unrevoked and unexpired) sessions for a user,
   * enriched with isCurrent flag comparing against the current session ID.
   */
  async listActiveUserSessions(
    userId: string,
    currentSessionId?: string,
    now: Date = new Date(),
  ): Promise<SafeSession[]> {
    const sessions = await this.sessionsRepository.listActiveUserSessions(
      userId,
      now,
    );

    return sessions.map((s) => ({
      ...s,
      isCurrent: currentSessionId ? s.id === currentSessionId : false,
    }));
  }

  /**
   * Lists all sessions for a user, enriched with isCurrent flag if requested.
   */
  async listUserSessions(
    userId: string,
    currentSessionId?: string,
  ): Promise<SafeSession[]> {
    const sessions = await this.sessionsRepository.listUserSessions(userId);

    return sessions.map((s) => ({
      ...s,
      isCurrent: currentSessionId ? s.id === currentSessionId : undefined,
    }));
  }

  /**
   * Maps an internal database UserSession record to the SafeSession projection,
   * guaranteeing the refresh_token_hash is never leaked.
   */
  toSafeSession(session: UserSession, isCurrent?: boolean): SafeSession {
    return {
      id: session.id,
      userId: session.userId,
      rememberMe: session.rememberMe,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      isCurrent,
    };
  }
}
