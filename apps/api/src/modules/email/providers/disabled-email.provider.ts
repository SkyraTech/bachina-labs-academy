import { Injectable, Logger } from '@nestjs/common';
import {
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from '../types/email.types.js';

/**
 * DisabledEmailProvider — a deliberate no-op transport.
 *
 * Selected when EMAIL_ENABLED=false. It accepts the message, logs that a send
 * was suppressed, and reports success.
 *
 * Why "success" rather than an error
 * ──────────────────────────────────
 * A hard failure would force registration to report an error in environments
 * where email is intentionally off (CI, some test runs, offline development).
 * Reporting success keeps those flows usable while the suppression log line
 * makes it obvious that no message left the process.
 *
 * It MUST NOT be used in production: EMAIL_ENABLED=false is a development /
 * test setting, and the config layer treats it as an explicit opt-out.
 *
 * Security: the message body is never logged, so a suppressed verification
 * email cannot leak its token into the log stream.
 */
@Injectable()
export class DisabledEmailProvider implements EmailProvider {
  readonly name = 'disabled' as const;

  private readonly logger = new Logger(DisabledEmailProvider.name);

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.logger.warn(
      `Email suppressed [provider=disabled, to=${this.redact(message.to)}, ` +
        `template=${message.meta?.['template'] ?? 'unknown'}]. ` +
        'No message was sent because EMAIL_ENABLED=false.',
    );

    return { messageId: 'disabled-unknown', provider: this.name };
  }

  async verify(): Promise<void> {
    this.logger.debug('Disabled email provider verified (always available).');
  }

  async close(): Promise<void> {
    // No resources to release.
  }

  /**
   * Redacts the recipient to a safe hint (first character + domain).
   * Keeps the suppression log useful without recording full addresses.
   */
  private redact(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) {
      return '[redacted]';
    }
    return `${email[0]}***@${email.slice(atIndex + 1)}`;
  }
}
