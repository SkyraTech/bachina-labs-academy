import { Injectable, Logger } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type {
  CreateSessionInput,
  RevocationReason,
  RotateRefreshTokenInput,
  RotateRefreshTokenResult,
  SafeSession,
} from './types/session.types';

@Injectable()
export class SessionsRepository {
  private readonly logger = new Logger(SessionsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a newly established session record.
   */
  async createSession(input: CreateSessionInput): Promise<UserSession> {
    this.logger.debug(`createSession: userId=${input.userId}`);
    return await this.prisma.userSession.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        rememberMe: input.rememberMe,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }

  /**
   * Looks up a session by its unique UUID.
   */
  async findById(id: string): Promise<UserSession | null> {
    return await this.prisma.userSession.findUnique({
      where: { id },
    });
  }

  /**
   * Looks up a session by the SHA-256 hash of its refresh token.
   */
  async findByRefreshTokenHash(refreshTokenHash: string): Promise<UserSession | null> {
    return await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
    });
  }

  /**
   * Finds an active (unrevoked and unexpired) session by ID.
   */
  async findActiveById(id: string, now: Date): Promise<UserSession | null> {
    return await this.prisma.userSession.findFirst({
      where: {
        id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  /**
   * Performs an atomic compare-and-swap (CAS) refresh-token rotation.
   *
   * Replaces the stored hash only if the session is unrevoked, unexpired,
   * and matches currentRefreshTokenHash. If 0 rows are updated, the reason
   * is classified to detect token-theft replays.
   */
  async rotateRefreshToken(
    input: RotateRefreshTokenInput,
  ): Promise<RotateRefreshTokenResult> {
    const { sessionId, currentRefreshTokenHash, newRefreshTokenHash, newExpiresAt, now } =
      input;

    const updated = await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        refreshTokenHash: currentRefreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        lastSeenAt: now,
        ...(newExpiresAt ? { expiresAt: newExpiresAt } : {}),
      },
    });

    if (updated.count === 1) {
      const session = await this.prisma.userSession.findUnique({
        where: { id: sessionId },
      });
      return { success: true, session: session ?? undefined };
    }

    // Determine specific failure reason without exposing data
    const existing = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!existing) {
      return { success: false, reason: 'SESSION_NOT_FOUND' };
    }

    if (existing.revokedAt !== null) {
      return { success: false, reason: 'SESSION_REVOKED', session: existing };
    }

    if (existing.expiresAt <= now) {
      return { success: false, reason: 'SESSION_EXPIRED', session: existing };
    }

    if (existing.refreshTokenHash !== currentRefreshTokenHash) {
      return { success: false, reason: 'TOKEN_MISMATCH', session: existing };
    }

    return { success: false, reason: 'SESSION_REVOKED', session: existing };
  }

  /**
   * Updates last_seen_at with bounded write frequency.
   * Only updates if lastSeenAt is null or older than minIntervalMs (default 60s),
   * avoiding database write amplification on high-frequency authenticated requests.
   */
  async touchLastSeen(
    id: string,
    now: Date,
    minIntervalMs = 60_000,
  ): Promise<boolean> {
    const threshold = new Date(now.getTime() - minIntervalMs);
    const result = await this.prisma.userSession.updateMany({
      where: {
        id,
        revokedAt: null,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
      },
      data: { lastSeenAt: now },
    });

    return result.count > 0;
  }

  /**
   * Revokes a single session by setting revoked_at and an optional reason.
   */
  async revokeSession(
    id: string,
    revokedAt: Date,
    reason?: RevocationReason,
  ): Promise<boolean> {
    this.logger.debug(`revokeSession: id=${id}, reason=${reason ?? 'USER_LOGOUT'}`);
    const result = await this.prisma.userSession.updateMany({
      where: { id, revokedAt: null },
      data: {
        revokedAt,
        revocationReason: reason ?? 'USER_LOGOUT',
      },
    });

    return result.count > 0;
  }

  /**
   * Revokes all active sessions for a user (e.g. "Logout All Devices"),
   * optionally excluding a designated current session.
   */
  async revokeAllUserSessions(
    userId: string,
    revokedAt: Date,
    reason?: RevocationReason,
    exceptSessionId?: string,
  ): Promise<number> {
    this.logger.debug(`revokeAllUserSessions: userId=${userId}`);
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: {
        revokedAt,
        revocationReason: reason ?? 'USER_LOGOUT_ALL',
      },
    });

    return result.count;
  }

  /**
   * Atomically revokes a specific session belonging to a specific user.
   * Ensures the session belongs to userId and has not already been revoked.
   * Avoids vulnerable read-then-write race conditions.
   */
  async revokeUserSession(
    sessionId: string,
    userId: string,
    revokedAt: Date = new Date(),
    reason: RevocationReason = 'USER_LOGOUT',
  ): Promise<boolean> {
    this.logger.debug(
      `revokeUserSession: sessionId=${sessionId}, userId=${userId}, reason=${reason}`,
    );
    const result = await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt,
        revocationReason: reason,
      },
    });

    return result.count > 0;
  }

  /**
   * Lists all active (unrevoked and unexpired) sessions for a user,
   * ordered by most recent activity (lastSeenAt desc, createdAt desc).
   * Guarantees refresh_token_hash is never selected or exposed.
   */
  async listActiveUserSessions(
    userId: string,
    now: Date = new Date(),
  ): Promise<SafeSession[]> {
    return await this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: [
        { lastSeenAt: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        userId: true,
        rememberMe: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ipAddress: true,
      },
    });
  }

  /**
   * Lists all sessions belonging to a user, selecting only safe columns
   * and deliberately omitting the refresh_token_hash.
   */
  async listUserSessions(userId: string): Promise<SafeSession[]> {
    return await this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        rememberMe: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ipAddress: true,
      },
    });
  }

  /**
   * Purges expired or revoked sessions older than the specified retention date.
   */
  async deleteExpiredSessions(olderThan: Date): Promise<number> {
    const result = await this.prisma.userSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: olderThan } },
          { revokedAt: { lt: olderThan } },
        ],
      },
    });

    return result.count;
  }
}
