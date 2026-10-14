import type { UserRole, UserStatus } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  iss: string;
  aud: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  sessionId: string;
}
