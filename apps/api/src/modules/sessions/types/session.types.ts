import type { UserSession } from '@prisma/client';

export type RevocationReason =
  | 'USER_LOGOUT'
  | 'USER_LOGOUT_ALL'
  | 'ROTATION_REPLAY_DETECTED'
  | 'ADMIN_ACTION'
  | 'PASSWORD_CHANGED';

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  rememberMe: boolean;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface RotateRefreshTokenInput {
  sessionId: string;
  currentRefreshTokenHash: string;
  newRefreshTokenHash: string;
  newExpiresAt?: Date;
  now: Date;
}

export type RotateFailureReason =
  | 'SESSION_NOT_FOUND'
  | 'TOKEN_MISMATCH'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED';

export interface RotateRefreshTokenResult {
  success: boolean;
  reason?: RotateFailureReason;
  session?: UserSession;
}

/**
 * SafeSession represents the public/safe projection of a session record,
 * strictly excluding the internal refresh_token_hash.
 */
export interface SafeSession {
  id: string;
  userId: string;
  rememberMe: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent?: boolean;
}
