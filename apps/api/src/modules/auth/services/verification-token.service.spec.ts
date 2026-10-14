import { VerificationTokenService } from './verification-token.service.js';

/**
 * Unit tests for VerificationTokenService.
 *
 * Pure functions — no database, no mocking, no I/O.
 * Tests cover:
 *   1.  Generated token is base64url and exactly 43 characters
 *   2.  Generated token is URL-safe (no '+', '/', '=')
 *   3.  Two generated tokens differ (uniqueness)
 *   4.  hashToken returns lowercase hex SHA-256 (64 chars)
 *   5.  hashToken is deterministic for the same input
 *   6.  hashToken differs for different inputs
 *   7.  hashToken is NOT the raw token (no plaintext storage)
 *   8.  Known SHA-256 vector matches
 *   9.  compareHashes returns true for identical digests
 *   10. compareHashes returns false for different digests
 *   11. compareHashes returns false for length mismatch (no throw)
 *   12. compareHashes returns false for empty/non-hex input (no throw)
 *   13. A generated token round-trips through hash + compare
 */

describe('VerificationTokenService', () => {
  let service: VerificationTokenService;

  // base64url of 32 bytes is ceil(32 / 3) * 4 minus padding = 43 characters.
  const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
  const HEX_64 = /^[0-9a-f]{64}$/;

  beforeEach(() => {
    service = new VerificationTokenService();
  });

  // ── Token generation ────────────────────────────────────────────────────────

  describe('generateRawToken', () => {
    it('produces a 43-character base64url token', () => {
      const token = service.generateRawToken();
      expect(token).toMatch(BASE64URL_43);
    });

    it('produces a URL-safe token with no base64 padding or expansion chars', () => {
      const token = service.generateRawToken();
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');
      expect(token).not.toContain(' ');
    });

    it('produces a unique token on every call', () => {
      const tokens = new Set(
        Array.from({ length: 1000 }, () => service.generateRawToken()),
      );
      // 1000 draws from a 256-bit space; a collision here would mean a broken
      // CSPRNG, not bad luck.
      expect(tokens.size).toBe(1000);
    });

    it('does not encode any predictable sequence', () => {
      // Two consecutive calls must not be related by a simple transform.
      const a = service.generateRawToken();
      const b = service.generateRawToken();
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });
  });

  // ── Token hashing ───────────────────────────────────────────────────────────

  describe('hashToken', () => {
    it('returns a 64-character lowercase hex digest', () => {
      const hash = service.hashToken(service.generateRawToken());
      expect(hash).toMatch(HEX_64);
    });

    it('is deterministic for the same input', () => {
      const token = 'same-token-value';
      expect(service.hashToken(token)).toBe(service.hashToken(token));
    });

    it('produces different digests for different inputs', () => {
      expect(service.hashToken('token-one')).not.toBe(
        service.hashToken('token-two'),
      );
    });

    it('never returns the raw token', () => {
      const token = service.generateRawToken();
      const hash = service.hashToken(token);
      expect(hash).not.toBe(token);
      expect(hash).not.toContain(token);
    });

    // Published SHA-256("abc") — anchors the implementation to a known vector
    // so a silent algorithm swap cannot pass unnoticed.
    it('matches the published SHA-256 vector for "abc"', () => {
      expect(service.hashToken('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is case-sensitive on the raw token', () => {
      expect(service.hashToken('AbC')).not.toBe(service.hashToken('abc'));
    });
  });

  // ── Constant-time comparison ────────────────────────────────────────────────

  describe('compareHashes', () => {
    it('returns true for identical digests', () => {
      const hash = service.hashToken('a-token');
      expect(service.compareHashes(hash, hash)).toBe(true);
    });

    it('returns false for different digests of equal length', () => {
      const a = service.hashToken('token-a');
      const b = service.hashToken('token-b');
      expect(service.compareHashes(a, b)).toBe(false);
    });

    // Guarding against a throw matters: a length mismatch is attacker-controlled
    // input, and an exception here would become a 500 oracle.
    it('returns false rather than throwing on a length mismatch', () => {
      const hash = service.hashToken('a-token');
      expect(() => service.compareHashes(hash, hash.slice(0, 32))).not.toThrow();
      expect(service.compareHashes(hash, hash.slice(0, 32))).toBe(false);
    });

    it('returns false rather than throwing on empty input', () => {
      expect(service.compareHashes('', '')).toBe(false);
    });

    it('returns false rather than throwing on non-hex input', () => {
      const hash = service.hashToken('a-token');
      expect(service.compareHashes(hash, 'not-hex-at-all')).toBe(false);
    });
  });

  // ── End-to-end round trip ───────────────────────────────────────────────────

  describe('round trip', () => {
    it('a generated token hashes and compares back to its own digest', () => {
      const raw = service.generateRawToken();
      const stored = service.hashToken(raw);

      // Simulates verification: hash the presented token, compare to stored.
      expect(service.compareHashes(stored, service.hashToken(raw))).toBe(true);
    });

    it('a different token does not match the stored digest', () => {
      const stored = service.hashToken(service.generateRawToken());
      const presented = service.generateRawToken();

      expect(service.compareHashes(stored, service.hashToken(presented))).toBe(
        false,
      );
    });
  });
});
