/**
 * Active device session contract matching NestJS ActiveSessionResponseDto.
 */
export interface ActiveSession {
  readonly id: string;
  readonly createdAt: string | Date;
  readonly lastSeenAt: string | Date | null;
  readonly expiresAt: string | Date;
  readonly rememberMe: boolean;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly isCurrent: boolean;
}

/**
 * Response contract for DELETE /api/v1/auth/sessions/:sessionId
 */
export interface RevokeSessionResponse {
  readonly message: string;
  readonly isCurrentSession: boolean;
}

/**
 * Response contract for POST /api/v1/auth/logout-all
 */
export interface LogoutAllResponse {
  readonly message: string;
  readonly revokedCount: number;
}

/**
 * Response contract for POST /api/v1/auth/refresh
 */
export interface RefreshResponse {
  readonly message: string;
}

/**
 * Response contract for POST /api/v1/auth/logout
 */
export interface LogoutResponse {
  readonly message: string;
}

