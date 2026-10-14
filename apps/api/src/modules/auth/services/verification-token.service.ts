import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * VerificationTokenService — generates and hashes verification tokens.
 *
 * Pure, stateless, and dependency-free so it is trivially unit-testable.
 * It performs no database access and sends no email; orchestration lives in
 * EmailVerificationService.
 *
 * Token format
 * ────────────
 *   32 cryptographically random bytes → base64url → 43-character string.
 *   256 bits of entropy. base64url is URL-safe (no '+', '/', '='), so the raw
 *   token survives being embedded in a verification link, an email client's
 *   URL rewriting, and copy/paste without percent-encoding surprises.
 *
 * Storage format
 * ──────────────
 *   SHA-256 of the raw token, hex-encoded (64 characters), stored in
 *   email_verification_tokens.token_hash.
 *
 *   Why SHA-256 rather than Argon2id (used for passwords)?
 *     - The token is 256 bits of uniform randomness supplied by this service,
 *       not user-chosen. It has no dictionary and no exploitable structure, so
 *       there is nothing for a slow KDF to defend against — a single guess has
 *       probability ~2^-256.
 *     - Verification must look up the row by hash. A slow, salted KDF produces
 *       a different digest per row and cannot be used as a lookup key without
 *       scanning every row. SHA-256 is deterministic and therefore supports the
 *       unique index lookup in O(log n).
 *     - Speed is safe here precisely because the input is high-entropy. This
 *       reasoning does NOT transfer to passwords, which is why passwords keep
 *       Argon2id in PasswordHashingService.
 *   A database leak yields only unsalted SHA-256 digests of 256-bit secrets,
 *   which are not reversible and not brute-forceable.
 *
 * Constant-time comparison
 * ────────────────────────
 *   compareHashes() exists for the rare caller that holds both values in
 *   process. The primary path uses the database unique index on token_hash for
 *   lookup, so comparison normally happens server-side in the index. The method
 *   is provided so a future path (e.g. an in-memory cache) does not have to
 *   reach for a naive `===` on secrets.
 */
@Injectable()
export class VerificationTokenService {
  /** Number of random bytes in a raw verification token. */
  private static readonly TOKEN_BYTES = 32;

  /**
   * Generates a fresh raw verification token.
   *
   * @returns base64url token, 43 characters, 256 bits of entropy
   */
  generateRawToken(): string {
    return randomBytes(VerificationTokenService.TOKEN_BYTES).toString('base64url');
  }

  /**
   * Hashes a raw token for storage and lookup.
   *
   * @param rawToken - the base64url token issued to the user
   * @returns lowercase hex SHA-256 digest (64 characters)
   */
  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  /**
   * Constant-time comparison of two hex digests.
   *
   * Guards against timing side channels when comparing secrets in process.
   * Returns false — rather than throwing — for digests of differing length or
   * non-hex input, so a malformed value can never be mistaken for a match.
   *
   * @param expected - the stored digest
   * @param candidate - the digest under test
   * @returns true only when both digests are identical
   */
  compareHashes(expected: string, candidate: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const candidateBuffer = Buffer.from(candidate, 'hex');

    if (
      expectedBuffer.length === 0 ||
      expectedBuffer.length !== candidateBuffer.length
    ) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, candidateBuffer);
  }
}
