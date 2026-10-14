import { describe, it, expect } from 'vitest';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  const service = new RefreshTokenService();

  it('generates random opaque tokens with 64-char SHA-256 hash', () => {
    const { rawToken, tokenHash } = service.generateRefreshToken();

    expect(rawToken).toBeDefined();
    expect(rawToken.length).toBe(43); // 32 bytes in base64url is 43 characters
    expect(tokenHash).toBeDefined();
    expect(tokenHash.length).toBe(64);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Verifying determinism of hashRefreshToken
    expect(service.hashRefreshToken(rawToken)).toBe(tokenHash);
  });

  it('generates unique tokens on each invocation', () => {
    const t1 = service.generateRefreshToken();
    const t2 = service.generateRefreshToken();

    expect(t1.rawToken).not.toBe(t2.rawToken);
    expect(t1.tokenHash).not.toBe(t2.tokenHash);
  });
});
