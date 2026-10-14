import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { EmailConfig } from '../../../config/email.config.js';
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from '../types/email.types.js';

/**
 * ResendEmailProvider — production delivery through the Resend HTTP API.
 *
 * This class is the ONLY place the `resend` package may be imported.
 *
 * Delivery status
 * ───────────────
 * The provider is fully implemented but is NOT exercised against the live
 * Resend API during development: RESEND_API_KEY and the verified Bachina Labs
 * sending domain are supplied later, and all automated tests for this class
 * use a mocked Resend client. Real-world delivery has therefore not been
 * verified and must not be assumed. Local development and all integration
 * testing run through SmtpEmailProvider → Mailpit.
 *
 * Error handling
 * ──────────────
 * Resend does not throw on API failure — it resolves with a discriminated
 * union `{ data, error }`. `error.name` is a closed set of stable codes
 * (validation_error, invalid_api_key, rate_limit_exceeded, ...), which makes
 * classification exact rather than heuristic. Those names are mapped onto our
 * own EmailDeliveryErrorCode union and never returned to HTTP clients.
 *
 * Auth/config errors (invalid_api_key, missing_api_key, restricted_api_key)
 * are logged at `error` level because they indicate a deployment misconfiguration
 * that will silently block every send — exactly the failure mode that must not
 * be hidden behind the registration flow's "delivery failed but user kept"
 * behaviour.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider, OnModuleDestroy {
  readonly name = 'resend' as const;

  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<EmailConfig>('email');
    const { apiKey } = config.resend;

    if (apiKey === '') {
      // Defensive: email.config.ts already enforces this at load time. A second
      // guard here means a miswired provider can never be constructed with an
      // empty key and "succeed" by sending to nowhere.
      throw new Error(
        'ResendEmailProvider requires RESEND_API_KEY to be configured.',
      );
    }

    this.client = new Resend(apiKey);
    this.logger.log('Resend provider configured.');
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Awaited<ReturnType<Resend['emails']['send']>>;

    try {
      response = await this.client.emails.send({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (error: unknown) {
      // Transport-level failure (DNS, TLS, offline). Resend normally resolves
      // rather than throws, so reaching here means the request never completed.
      this.logger.warn('Resend transport error before a response was received.');
      throw new EmailDeliveryError('CONNECTION_FAILED', 'Resend request failed.', {
        cause: error,
      });
    }

    if (response.error !== null) {
      const { name, statusCode } = response.error;
      const code = this.classify(name);

      // Log the stable error name and status only. `response.error.message`
      // can echo request details, so it is deliberately not logged or thrown.
      if (code === 'PROVIDER_REJECTED' && this.isAuthError(name)) {
        this.logger.error(
          `Resend rejected the request for an authentication reason [name=${name}, status=${String(statusCode)}]. ` +
            'Check RESEND_API_KEY and the verified sending domain.',
        );
      } else {
        this.logger.warn(
          `Resend delivery failed [name=${name}, code=${code}, status=${String(statusCode)}]`,
        );
      }

      throw new EmailDeliveryError(
        code,
        'Email delivery failed through the Resend provider.',
      );
    }

    const messageId = response.data?.id ?? 'resend-unknown';
    this.logger.log(
      `Resend delivery accepted [provider=resend, messageId=${messageId}]`,
    );

    return { messageId, provider: this.name };
  }

  /**
   * Resend has no cheap dedicated connectivity probe that is safe to run
   * eagerly, so verification is a no-op success. The first real send surfaces
   * misconfiguration through the classified error path above.
   */
  async verify(): Promise<void> {
    this.logger.debug('Resend provider verification skipped (no probe available).');
  }

  async close(): Promise<void> {
    // The Resend client holds no long-lived sockets or pools to release.
    this.logger.debug('Resend provider closed.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** True for errors that indicate a credentials/domain misconfiguration. */
  private isAuthError(name: string): boolean {
    return (
      name === 'invalid_api_key' ||
      name === 'missing_api_key' ||
      name === 'restricted_api_key' ||
      name === 'invalid_from_address'
    );
  }

  /** Maps a Resend error name onto our stable classification union. */
  private classify(name: string): EmailDeliveryError['code'] {
    switch (name) {
      case 'invalid_api_key':
      case 'missing_api_key':
      case 'restricted_api_key':
      case 'invalid_from_address':
      case 'validation_error':
      case 'invalid_parameter':
      case 'missing_required_field':
      case 'invalid_attachment':
        return 'PROVIDER_REJECTED';

      case 'rate_limit_exceeded':
      case 'monthly_quota_exceeded':
      case 'daily_quota_exceeded':
      case 'internal_server_error':
      case 'application_error':
      case 'security_error':
        return 'PROVIDER_UNAVAILABLE';

      default:
        return 'UNKNOWN';
    }
  }
}
