import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';

export interface GeneratedRefreshToken {
  rawToken: string;
  tokenHash: string;
}

@Injectable()
export class RefreshTokenService {
  /**
   * Generates a cryptographically secure opaque refresh token (32 random bytes,
   * base64url-encoded, 43 characters) and computes its SHA-256 hex digest (64 chars).
   */
  generateRefreshToken(): GeneratedRefreshToken {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashRefreshToken(rawToken);
    return { rawToken, tokenHash };
  }

  /**
   * Computes the SHA-256 hexadecimal hash of a candidate raw refresh token.
   * Exactly 64 characters, lowercase.
   */
  hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
}
