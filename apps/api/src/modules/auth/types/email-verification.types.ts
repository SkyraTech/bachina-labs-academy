/**
 * Email verification domain types.
 *
 * These types describe the verification token lifecycle without exposing
 * credential material. The raw token exists only in memory between generation
 * and email rendering — it is never stored, logged, or returned over HTTP.
 */

/** Outcome of issuing a new verification token for a known user. */
export interface IssuedVerificationToken {
  /**
   * The raw, single-use token. Must be rendered into the verification email
   * immediately and then discarded. NEVER log, persist, or return this value.
   */
  readonly rawToken: string;
  /** Absolute expiry timestamp (UTC, millisecond precision). */
  readonly expiresAt: Date;
  /** True when a previous unconsumed token was invalidated by this issuance. */
  readonly supersededPrevious: boolean;
}

/**
 * A stored token projection.
 *
 * Deliberately omits `tokenHash`: callers that only need lifecycle metadata
 * (cooldown checks, expiry inspection) must not receive the hash, which limits
 * the blast radius of a careless log line or an accidental return value.
 */
export interface VerificationTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

/** How a verification attempt concluded. Values are stable and low-cardinality. */
export type VerificationFailureReason =
  /** No token row matched the presented value. */
  | 'token_not_found'
  /** The token was already consumed by a prior successful verification. */
  | 'token_already_used'
  /** The token's expiry timestamp is in the past. */
  | 'token_expired';

/** Successful verification detail, for logging only — never serialized. */
export interface VerificationSuccess {
  readonly tokenId: string;
  readonly userId: string;
  /** True when the account's emailVerifiedAt was null and is now set. */
  readonly newlyVerified: boolean;
}

/**
 * Internal outcome of a resend request.
 *
 * Used for log grouping and metrics ONLY. The HTTP layer deliberately collapses
 * every one of these into the same generic response so that an attacker cannot
 * distinguish "account exists" from "account does not exist" — which would turn
 * the endpoint into an account-enumeration oracle.
 */
export type ResendOutcome =
  /** A new token was issued and the email was handed to the transport. */
  | 'sent'
  /** No account matched the address. */
  | 'unknown_email'
  /** The account already has a verified email. */
  | 'already_verified'
  /** The account is disabled or suspended; nothing was sent. */
  | 'user_inactive'
  /** A token was issued within the cooldown window; nothing was sent. */
  | 'cooldown_active'
  /** A token was issued but the transport failed. Account is preserved. */
  | 'delivery_failed';

/**
 * Verified-time configuration for expiry and cooldown decisions.
 *
 * Injected as a clock so tests can control time deterministically instead of
 * sleeping. Production supplies `() => new Date()`.
 */
export type Clock = () => Date;
