/**
 * Email subsystem contracts.
 *
 * These types are the ONLY surface that domain services (registration,
 * verification, and later password reset) are allowed to depend on.
 * Neither `nodemailer` nor `resend` may be imported outside `providers/`.
 *
 * Layering
 * ────────
 *   RegistrationService / EmailVerificationService
 *        │  depends on EmailService (this contract)
 *        ▼
 *   EmailService  ── selects ──▶  EmailProvider (interface below)
 *                                    ├── SmtpEmailProvider     (nodemailer → Mailpit in dev)
 *                                    ├── ResendEmailProvider   (Resend HTTP API)
 *                                    └── DisabledEmailProvider (no-op, EMAIL_ENABLED=false)
 *
 * Security rules
 * ──────────────
 *   - EmailMessage carries the rendered body. Callers MUST NOT place raw
 *     verification tokens in the subject line: subjects are commonly written
 *     to provider logs, notification previews and OS-level toast text.
 *   - `meta` exists for redacted, non-sensitive correlation only (e.g. a
 *     template key). It MUST NOT carry tokens, hashes or API keys.
 *   - Providers MUST NOT log the message body. Only the recipient (redacted),
 *     template key and the provider message id may be logged.
 */

/** RFC 5321 practical maximum, matching users.email VARCHAR(254). */
export const MAX_EMAIL_LENGTH = 254;

/** A single rendered message, ready for a provider to hand to a transport. */
export interface EmailMessage {
  /** Recipient address. Exactly one recipient per call by design. */
  readonly to: string;
  /** Sender address, resolved from EMAIL_FROM by the service. */
  readonly from: string;
  /** Short, non-sensitive subject. MUST NOT contain tokens or secrets. */
  readonly subject: string;
  /** HTML alternative. Providers must HTML-escape interpolated values. */
  readonly html: string;
  /** Plain-text alternative, also used as the fallback body. */
  readonly text: string;
  /** Optional non-sensitive correlation hint, e.g. template key. */
  readonly meta?: Readonly<Record<string, string>>;
}

/**
 * Provider-agnostic delivery result.
 *
 * Deliberately does NOT expose the raw provider response: those differ per
 * provider (SMTP `messageId` vs Resend `id`) and some embed server details.
 * A stable, minimal shape keeps logging safe and provider-agnostic.
 */
export interface EmailSendResult {
  /** Opaque, non-secret correlation id for support/observability. */
  readonly messageId: string;
  /** Which provider actually handled the send. */
  readonly provider: EmailProviderName;
}

export const EMAIL_PROVIDERS = ['smtp', 'resend', 'disabled'] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

/**
 * Thrown by a provider when delivery fails for a reason that is safe to
 * classify but not safe to expose.
 *
 * The `code` is a stable, low-cardinality machine reason used for metrics and
 * log grouping. It is NEVER returned to HTTP clients — see
 * EmailVerificationService, which maps any failure to a generic message so
 * that provider status cannot be used as an enumeration oracle.
 */
export class EmailDeliveryError extends Error {
  constructor(
    public readonly code: EmailDeliveryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'EmailDeliveryError';
  }
}

export const EMAIL_DELIVERY_ERROR_CODES = [
  /** Transport could not be reached (Mailpit not running, DNS, timeout). */
  'CONNECTION_FAILED',
  /** Provider rejected the message (bad sender, unverified domain, 4xx). */
  'PROVIDER_REJECTED',
  /** Provider errored internally or rate-limited us (5xx / 429). */
  'PROVIDER_UNAVAILABLE',
  /** The message was structurally invalid before reaching the provider. */
  'INVALID_MESSAGE',
  /** Anything not classifiable above. */
  'UNKNOWN',
] as const;

export type EmailDeliveryErrorCode = (typeof EMAIL_DELIVERY_ERROR_CODES)[number];

/**
 * A concrete mail transport.
 *
 * Implementations are constructed by EmailModule from validated configuration
 * and are responsible ONLY for translating EmailMessage into provider calls.
 * They must not contain business logic, template rendering, retries that mask
 * failures, or token handling.
 */
export interface EmailProvider {
  readonly name: EmailProviderName;

  /**
   * Delivers one message.
   *
   * @throws EmailDeliveryError on any failure, with a classified code.
   *   Never throws a raw provider error — those can embed credentials,
   *   connection strings or the message body.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;

  /**
   * Verifies connectivity/config without sending.
   * Used by the health/diagnostics surface, never on the request path.
   */
  verify(): Promise<void>;

  /** Releases underlying resources (pools, sockets). */
  close(): Promise<void>;
}
