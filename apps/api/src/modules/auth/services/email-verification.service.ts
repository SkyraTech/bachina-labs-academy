import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailConfig } from '../../../config/email.config.js';
import { EmailService } from '../../email/email.service.js';
import { EmailDeliveryError } from '../../email/types/email.types.js';
import { UsersService } from '../../users/users.service.js';
import {
  EmailVerificationTokenRepository,
  isActiveTokenConflict,
  isCooldownError,
} from '../repositories/email-verification-token.repository.js';
import { VerificationTokenService } from './verification-token.service.js';
import type {
  IssuedVerificationToken,
  ResendOutcome,
} from '../types/email-verification.types.js';

/**
 * EmailVerificationService — orchestrates the email verification workflow.
 *
 * Workflow
 *   register            → issueVerificationEmail (below) after the user row
 *                         commits; delivery failure never rolls back the account
 *   POST /verify-email  → verifyEmail()
 *   POST /resend-verification → resendVerification()
 *
 * This service owns all verification POLICY: token lifetime, resend cooldown,
 * when to invalidate prior tokens, and what each endpoint is allowed to reveal.
 * The repository owns persistence, the token service owns cryptography, and
 * EmailService owns transport — none of them decide anything.
 *
 * Account enumeration
 * ───────────────────
 * resendVerification() and verifyEmail() never vary their HTTP-visible behaviour
 * on whether an account exists. An unknown address, a verified account, an
 * expired token and a transport outage all collapse to the same generic
 * response, so none of these endpoints can be used to discover registered
 * addresses. The distinct outcome is recorded only in server-side logs.
 *
 * Token secrecy
 * ─────────────
 * The raw token exists in memory only long enough to be hashed and rendered
 * into an email. It is never logged, never returned in a response, and never
 * stored — only its SHA-256 digest reaches the database.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tokenRepository: EmailVerificationTokenRepository,
    private readonly tokenService: VerificationTokenService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  private get config(): EmailConfig {
    return this.configService.getOrThrow<EmailConfig>('email');
  }

  /**
   * Issues a verification token and delivers the email.
   *
   * Called from RegistrationService AFTER the user row is committed. Delivery
   * failure is deliberately non-fatal: the account remains, unverified, and the
   * user recovers through POST /resend-verification. A transient SMTP or Resend
   * outage must never destroy a successfully created account.
   *
   * If token issuance itself fails (database unavailable), that is also
   * swallowed for the same reason — the account exists and resend will retry.
   *
   * @param user - the freshly created, unverified account
   */
  async issueVerificationEmail(user: { id: string; email: string }): Promise<void> {
    try {
      const issued = await this.issueToken(user.id);
      await this.emailService.sendVerificationEmail(user.email, issued.rawToken);

      this.logger.log(
        `Verification email issued [userId=${user.id}, expiresAt=${issued.expiresAt.toISOString()}]`,
      );
    } catch (error: unknown) {
      // Deliberately swallow. The account is already persisted and usable for
      // everything that does not require a verified address. Resend is the
      // designed recovery path.
      this.logger.warn(
        `Verification email issuance failed; account preserved and resend is available [userId=${user.id}, ` +
          `reason=${error instanceof EmailDeliveryError ? error.code : 'ISSUANCE_FAILED'}]`,
      );
    }
  }

  /**
   * Consumes a presented token and marks the account verified.
   *
   * Expiry and single-use are both enforced, and the two writes are one atomic
   * transaction, so a token that succeeds once can never succeed again.
   *
   * @param rawToken - the token exactly as presented by the client
   * @throws BadRequestException — always with the same generic message, whether
   *         the token is unknown, expired or already used. Distinguishing them
   *         would hand an attacker an oracle for validating stolen tokens.
   */
  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashToken(rawToken);
    const token = await this.tokenRepository.findActiveByHash(tokenHash);

    if (token === null) {
      // Covers both "never existed" and "already consumed", because the
      // repository only surfaces unconsumed rows on this path's cousin query.
      this.logger.warn(
        'Verification rejected: token not found or already used [action=auth.email_verification, outcome=failure]',
      );
      throw this.invalidToken();
    }

    if (this.isExpired(token.expiresAt)) {
      this.logger.warn(
        `Verification rejected: token expired [action=auth.email_verification, outcome=failure, tokenId=${token.id}]`,
      );
      throw this.invalidToken();
    }

    const now = new Date();
    const result = await this.tokenRepository.consumeTokenAndVerifyUser(
      token.id,
      token.userId,
      now,
    );

    if (!result.consumed) {
      // Concurrent replay lost the compare-and-swap. Same generic error.
      this.logger.warn(
        `Verification rejected: token already consumed concurrently [action=auth.email_verification, outcome=failure, tokenId=${token.id}]`,
      );
      throw this.invalidToken();
    }

    this.logger.log(
      `Email verified [action=auth.email_verification, outcome=success, userId=${token.userId}, newlyVerified=${String(result.newlyVerified)}]`,
    );
  }

  /**
   * Resends a verification email for an address, if one is warranted.
   *
   * Never reveals whether the account exists or is already verified — the
   * caller's HTTP response is identical in every branch. Outcomes:
   *   unknown address   → 'unknown_email'      (nothing sent)
   *   already verified  → 'already_verified'   (nothing sent)
   *   within cooldown   → 'cooldown_active'    (nothing sent)
   *   transport failure → 'delivery_failed'    (account and token preserved)
   *   otherwise         → 'sent'
   *
   * There is deliberately NO cooldown check here. The cooldown is evaluated
   * inside the issuance transaction, under a row lock on the account, so it
   * cannot be raced by sending two requests at once. This method simply asks
   * for a token and interprets the outcome.
   *
   * @param email - raw address; normalized by UsersService before lookup
   * @returns the internal outcome, for logging only
   */
  async resendVerification(email: string): Promise<ResendOutcome> {
    const user = await this.usersService.findByEmail(email);

    if (user === null) {
      // No account — do not send, and do not disclose that fact.
      this.logger.warn('Resend requested for unknown address [redacted]');
      return 'unknown_email';
    }

    if (user.emailVerifiedAt !== null) {
      this.logger.log(`Resend skipped: already verified [userId=${user.id}]`);
      return 'already_verified';
    }

    if (user.status !== 'ACTIVE') {
      this.logger.warn(
        `Resend skipped: user is not active [userId=${user.id}, status=${user.status}]`,
      );
      return 'user_inactive';
    }

    try {
      const issued = await this.issueToken(user.id);
      await this.emailService.sendVerificationEmail(user.email, issued.rawToken);

      this.logger.log(`Verification email resent [userId=${user.id}]`);
      return 'sent';
    } catch (error: unknown) {
      // Either this request or a concurrent one issued moments ago. Both are
      // the cooldown outcome, NOT a transport failure — reporting a delivery
      // problem that never happened would mislead both logs and clients.
      if (isCooldownError(error) || isActiveTokenConflict(error)) {
        const remainingMs = isCooldownError(error) ? error.remainingMs : 0;
        this.logger.warn(
          `Resend throttled by cooldown [userId=${user.id}, remainingMs=${String(remainingMs)}]`,
        );
        return 'cooldown_active';
      }

      // Transport failure. The token (if issued) stays valid, so a later resend
      // after the cooldown simply retries. Nothing is destroyed.
      this.logger.warn(
        `Resend delivery failed [userId=${user.id}, ` +
          `reason=${error instanceof EmailDeliveryError ? error.code : 'ISSUANCE_FAILED'}]`,
      );
      return 'delivery_failed';
    }
  }

  /**
   * Mints a token, persists its hash, and returns the raw value once.
   *
   * Delegates the entire cooldown decision to the repository's locked
   * transaction: that is the only place where "read the latest issuance" and
   * "insert the replacement" can be made atomic with respect to a concurrent
   * request. This method supplies the clock and the policy duration, and does
   * not pre-check anything, because a check performed here would be advisory
   * at best and trivially racy at worst.
   *
   * @param userId - account UUID
   * @returns the raw token and its expiry
   * @throws CooldownError when the last issuance is inside the window
   * @throws ActiveTokenConflictError on a lost insert race (defence in depth)
   */
  private async issueToken(userId: string): Promise<IssuedVerificationToken> {
    const now = new Date();
    const rawToken = this.tokenService.generateRawToken();
    const tokenHash = this.tokenService.hashToken(rawToken);
    const expiresAt = new Date(
      now.getTime() + this.config.verification.ttlMinutes * 60_000,
    );

    const { record, supersededPrevious } = await this.tokenRepository.issueToken({
      userId,
      tokenHash,
      expiresAt,
      now,
      cooldownSeconds: this.config.verification.cooldownSeconds,
    });

    return {
      rawToken,
      expiresAt: record.expiresAt,
      supersededPrevious,
    };
  }

  /** Evaluates token expiry against the current time. */
  private isExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() <= Date.now();
  }

  /**
   * The single, uniform rejection for every verification failure mode.
   * One message and one status across unknown/expired/used is what denies an
   * attacker the ability to tell a valid-but-stolen token from a garbage one.
   */
  private invalidToken(): BadRequestException {
    return new BadRequestException(
      'This verification link is invalid or has expired.',
    );
  }
}
