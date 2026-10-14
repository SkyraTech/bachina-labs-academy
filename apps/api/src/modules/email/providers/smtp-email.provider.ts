import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailConfig } from '../../../config/email.config.js';
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from '../types/email.types.js';

/**
 * SmtpEmailProvider — delivers mail through any SMTP relay.
 *
 * Local development target is Mailpit, listening on 127.0.0.1:1025 with a web
 * interface at http://localhost:8025. Mailpit is a capture server: messages are
 * stored locally and are NOT relayed to real inboxes, so development never
 * sends mail to a real recipient. No authentication is required for Mailpit,
 * hence SMTP_USER/SMTP_PASS remain empty by default.
 *
 * This class is the ONLY place `nodemailer` may be imported.
 *
 * Failure classification
 * ──────────────────────
 * Nodemailer surfaces a heterogeneous error set (ECONNREFUSED, ETIMEDOUT,
 * ECONNECTION, EAUTH, plus provider-specific SMTP reply codes). Rather than
 * propagate those — which can embed hostnames and server banners — they are
 * mapped onto the stable EmailDeliveryErrorCode union. The original error is
 * retained as `cause` for local debugging but is never returned to clients.
 *
 * Retry policy: none. Silent retries inside a provider mask delivery failures
 * from the caller and can produce duplicate verification emails, which would
 * undermine the single-use token guarantee. Retries belong to an explicit,
 * audited layer if they are ever needed.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnModuleDestroy {
  readonly name = 'smtp' as const;

  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transporter: Transporter;
  private closed = false;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<EmailConfig>('email');
    const { smtp, from } = config;

    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      // STARTTLS is requested opportunistically. Mailpit offers no TLS, so
      // `requireTLS` is deliberately NOT set — it would break local capture.
      ignoreTLS: !smtp.secure && smtp.host === '127.0.0.1',
      ...(smtp.user !== ''
        ? { auth: { user: smtp.user, pass: smtp.pass } }
        : {}),
      // Bound the time a hung relay can stall a request thread.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    this.logger.log(
      `SMTP provider configured for ${smtp.host}:${smtp.port} ` +
        `(secure=${String(smtp.secure)}, auth=${String(smtp.user !== '')}, from=${from})`,
    );
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.closed) {
      throw new EmailDeliveryError(
        'PROVIDER_UNAVAILABLE',
        'SMTP transport has been closed.',
      );
    }

    try {
      const info = await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      // nodemailer returns a string messageId; guard against an empty value so
      // callers always receive a usable correlation id.
      const messageId =
        typeof info.messageId === 'string' && info.messageId !== ''
          ? info.messageId
          : 'smtp-unknown';

      this.logger.log(
        `SMTP delivery accepted [provider=smtp, messageId=${messageId}]`,
      );

      return { messageId, provider: this.name };
    } catch (error: unknown) {
      const code = this.classify(error);

      // Log the classified code plus the nodemailer code only — never the
      // error message, which may include the recipient or server banner.
      this.logger.warn(
        `SMTP delivery failed [code=${code}, smtpCode=${this.smtpCodeOf(error)}]`,
      );

      throw new EmailDeliveryError(
        code,
        'Email delivery failed through the SMTP transport.',
        { cause: error },
      );
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (error: unknown) {
      throw new EmailDeliveryError(
        this.classify(error),
        'SMTP transport verification failed.',
        { cause: error },
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    try {
      this.transporter.close();
    } catch {
      // Closing a never-connected transport can throw; that is not actionable.
      this.logger.debug('SMTP transport closed with a non-fatal error.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /**
   * Maps a raw nodemailer error onto the stable classification union.
   * Deliberately conservative: anything unrecognised becomes UNKNOWN rather
   * than being passed through, so new error shapes cannot leak by default.
   */
  private classify(error: unknown): EmailDeliveryError['code'] {
    const code = this.smtpCodeOf(error);

    switch (code) {
      case 'ECONNREFUSED':
      case 'ECONNRESET':
      case 'ETIMEDOUT':
      case 'ESOCKET':
      case 'ECONNECTION':
      case 'EDNS':
        return 'CONNECTION_FAILED';

      case 'EAUTH':
        return 'PROVIDER_REJECTED';

      // 4xx SMTP replies are permanent rejections (bad sender, policy).
      // 421/450/451/452 are transient but still provider-side.
      case 'EENVELOPE':
      case 'EMESSAGE':
        return 'PROVIDER_REJECTED';

      default:
        break;
    }

    // Numeric SMTP reply codes arrive as strings on some paths.
    if (typeof code === 'string' && /^[45]\d\d$/.test(code)) {
      return code.startsWith('4') ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED';
    }

    return 'UNKNOWN';
  }

  /** Extracts a nodemailer `code` property without trusting its shape. */
  private smtpCodeOf(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }
    const candidate = (error as { code?: unknown }).code;
    return typeof candidate === 'string' ? candidate : undefined;
  }
}
