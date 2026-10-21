import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface AbuseCheckResult {
  blocked: boolean;
  retryAfterSeconds: number;
}

interface AttemptRecord {
  failures: number;
  firstFailureTime: number;
  lastFailureTime: number;
  blockedUntil: number | null;
}

/**
 * AuthAbuseService — In-memory, privacy-preserving anti-automation and failed-login abuse tracking.
 *
 * Security Architecture:
 * 1. Distinguishes high-frequency request rate limits from failed authentication attempts.
 * 2. Uses client IP and privacy-preserving account-identifier digests (SHA-256 HMAC of normalized email).
 * 3. Never stores or logs raw email addresses in abuse keys or memory.
 * 4. Resets failure counters upon successful authentication, avoiding false lockouts for legitimate users.
 * 5. Bounded in-memory store with periodic cleanup of stale records.
 */
@Injectable()
export class AuthAbuseService {
  private readonly logger = new Logger(AuthAbuseService.name);

  // Configuration
  private readonly maxFailures = 5; // 5 failed attempts
  private readonly windowMs = 15 * 60 * 1000; // 15-minute sliding window
  private readonly lockoutDurationMs = 15 * 60 * 1000; // 15-minute cooldown
  private readonly maxTrackedEntries = 10_000; // Bound memory footprint

  private readonly ipAttempts = new Map<string, AttemptRecord>();
  private readonly emailDigestAttempts = new Map<string, AttemptRecord>();

  /**
   * Generates a privacy-preserving SHA-256 digest of normalized email + pepper.
   */
  hashEmailIdentifier(email: string): string {
    const normalized = email.trim().toLowerCase();
    const pepper = process.env['TOKEN_HASH_PEPPER'] || 'academy-auth-abuse-pepper';
    return crypto
      .createHash('sha256')
      .update(`${normalized}:${pepper}`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Checks if an inbound login attempt is blocked due to excessive prior failures.
   */
  checkLoginAllowed(clientIp: string, email: string): AbuseCheckResult {
    const now = Date.now();
    this.sweepStaleEntries(now);

    const emailDigest = this.hashEmailIdentifier(email);

    // Check IP block
    const ipRecord = this.ipAttempts.get(clientIp);
    if (ipRecord && ipRecord.blockedUntil && ipRecord.blockedUntil > now) {
      const remainingSeconds = Math.ceil((ipRecord.blockedUntil - now) / 1000);
      return { blocked: true, retryAfterSeconds: Math.max(remainingSeconds, 1) };
    }

    // Check Email digest block
    const emailRecord = this.emailDigestAttempts.get(emailDigest);
    if (emailRecord && emailRecord.blockedUntil && emailRecord.blockedUntil > now) {
      const remainingSeconds = Math.ceil((emailRecord.blockedUntil - now) / 1000);
      return { blocked: true, retryAfterSeconds: Math.max(remainingSeconds, 1) };
    }

    return { blocked: false, retryAfterSeconds: 0 };
  }

  /**
   * Records a failed login attempt for the given IP and email identifier.
   */
  recordFailedAttempt(clientIp: string, email: string): void {
    const now = Date.now();
    const emailDigest = this.hashEmailIdentifier(email);

    this.recordFailureForMap(this.ipAttempts, clientIp, now);
    this.recordFailureForMap(this.emailDigestAttempts, emailDigest, now);
  }

  /**
   * Resets failure counters upon successful authentication.
   */
  recordSuccessfulLogin(clientIp: string, email: string): void {
    const emailDigest = this.hashEmailIdentifier(email);
    this.ipAttempts.delete(clientIp);
    this.emailDigestAttempts.delete(emailDigest);
  }

  /**
   * Clears all tracked state (used for testing).
   */
  resetAll(): void {
    this.ipAttempts.clear();
    this.emailDigestAttempts.clear();
  }

  private recordFailureForMap(
    map: Map<string, AttemptRecord>,
    key: string,
    now: number,
  ): void {
    // Evict oldest entries if map grows beyond safety threshold
    if (map.size >= this.maxTrackedEntries) {
      const firstKey = map.keys().next().value;
      if (firstKey) map.delete(firstKey);
    }

    const existing = map.get(key);
    if (!existing || now - existing.firstFailureTime > this.windowMs) {
      map.set(key, {
        failures: 1,
        firstFailureTime: now,
        lastFailureTime: now,
        blockedUntil: null,
      });
      return;
    }

    existing.failures += 1;
    existing.lastFailureTime = now;

    if (existing.failures >= this.maxFailures) {
      existing.blockedUntil = now + this.lockoutDurationMs;
      this.logger.warn(
        `Authentication failure threshold reached for identifier [keyPrefix=${key.slice(0, 6)}...]. Cooldown applied.`,
      );
    }
  }

  private sweepStaleEntries(now: number): void {
    for (const [key, record] of this.ipAttempts.entries()) {
      if (
        (!record.blockedUntil || record.blockedUntil <= now) &&
        now - record.lastFailureTime > this.windowMs
      ) {
        this.ipAttempts.delete(key);
      }
    }
    for (const [key, record] of this.emailDigestAttempts.entries()) {
      if (
        (!record.blockedUntil || record.blockedUntil <= now) &&
        now - record.lastFailureTime > this.windowMs
      ) {
        this.emailDigestAttempts.delete(key);
      }
    }
  }
}
