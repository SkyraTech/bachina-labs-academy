import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailConfig } from '../../config/email.config.js';
import { EMAIL_PROVIDER } from './email.tokens.js';
import { renderVerificationEmail } from './templates/verification-email.template.js';
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from './types/email.types.js';

/**
 * EmailService — the provider-agnostic facade used by domain services.
 *
 * RegistrationService and EmailVerificationService depend on THIS class only.
 * They never import `nodemailer` or `resend`, never read SMTP/Resend settings,
 * and never construct a transport. Swapping Mailpit for Resend is a
 * configuration change, not a code change, and unit tests substitute a mock for
 * EmailService itself without touching either library.
 *
 * Responsibilities
 * ────────────────
 *   - Resolve the configured EmailProvider once at construction.
 *   - Expose domain-specific send methods (verification now; password reset
 *     later) so callers never assemble raw EmailMessage objects.
 *   - Attach the sender address from configuration — callers supply only the
 *     recipient, which removes any chance of a caller forging the From header.
 *
 * Failure contract
 * ────────────────
 * send*() throws EmailDeliveryError. Callers decide policy: registration
 * swallows it (keeping the account), verification-resend reports a generic
 * success. Neither may surface provider details to an HTTP client.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly configService: ConfigService,
  ) {}

  /** Resolved, validated email configuration. Never log this object. */
  private get config(): EmailConfig {
    return this.configService.getOrThrow<EmailConfig>('email');
  }

  /** Which transport is active — safe for logs and diagnostics. */
  get providerName(): string {
    return this.provider.name;
  }

  /** True when the configured transport will actually emit messages. */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Sends the account verification email.
   *
   * The raw token is passed in, rendered into the body, and then dropped — it
   * is never logged, never placed in the subject, and never returned.
   *
   * @param recipient - verified address the account was registered with
   * @param token - the raw single-use verification token
   * @returns provider correlation id and the provider that handled it
   * @throws EmailDeliveryError when the transport fails
   */
  async sendVerificationEmail(
    recipient: string,
    token: string,
  ): Promise<EmailSendResult> {
    const config = this.config;
    const content = renderVerificationEmail({
      recipient,
      token,
      config,
    });

    const message: EmailMessage = {
      to: recipient,
      from: config.from,
      subject: content.subject,
      html: content.html,
      text: content.text,
      // Correlation only — contains no token and no body content.
      meta: { template: 'account-verification' },
    };

    try {
      return await this.provider.send(message);
    } catch (error: unknown) {
      // Re-throw as-is if already classified; otherwise classify now so the
      // caller always sees a stable error type.
      if (error instanceof EmailDeliveryError) {
        throw error;
      }
      this.logger.error(
        `Verification email failed [provider=${this.provider.name}, code=UNKNOWN]`,
      );
      throw new EmailDeliveryError(
        'UNKNOWN',
        'Email delivery failed.',
        { cause: error },
      );
    }
  }

  /**
   * Verifies transport connectivity. Used by diagnostics, never on a request
   * path — a live SMTP probe would add seconds of latency per call.
   */
  async verifyTransport(): Promise<void> {
    await this.provider.verify();
  }

  /** Releases transport resources. Called by EmailModule on shutdown. */
  async close(): Promise<void> {
    await this.provider.close();
  }
}
