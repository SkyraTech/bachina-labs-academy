import { Module, Global, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailConfig } from '../../config/email.config.js';
import { DisabledEmailProvider } from './providers/disabled-email.provider.js';
import { ResendEmailProvider } from './providers/resend-email.provider.js';
import { SmtpEmailProvider } from './providers/smtp-email.provider.js';
import { EmailService } from './email.service.js';
import { EMAIL_PROVIDER } from './email.tokens.js';
import type { EmailProvider } from './types/email.types.js';

/**
 * EmailModule — owns transactional email delivery for the whole API.
 *
 * Marked @Global so any future domain module (auth, notifications, admin)
 * can inject EmailService without re-importing this module, matching how
 * DatabaseModule exposes PrismaService.
 *
 * Provider selection
 * ──────────────────
 *   EMAIL_ENABLED=false            → DisabledEmailProvider (no-op)
 *   EMAIL_PROVIDER=smtp (default)  → SmtpEmailProvider     (Mailpit on 127.0.0.1:1025)
 *   EMAIL_PROVIDER=resend          → ResendEmailProvider   (production)
 *
 * Selection happens here and nowhere else. Domain services receive the
 * EmailService facade and are structurally unable to depend on a specific
 * vendor library.
 *
 * Note on tests: unit tests substitute a mock for EmailService, so
 * no test constructs a real transport unless it is specifically testing one.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): EmailProvider => {
        const config = configService.getOrThrow<EmailConfig>('email');

        if (!config.enabled) {
          return new DisabledEmailProvider();
        }

        switch (config.provider) {
          case 'resend':
            return new ResendEmailProvider(configService);
          case 'smtp':
          default:
            return new SmtpEmailProvider(configService);
        }
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule implements OnModuleDestroy {
  constructor(private readonly emailService: EmailService) {}

  /**
   * Closes the transport when the application shuts down.
   * The providers also implement OnModuleDestroy, but they are created inside
   * a useFactory rather than by the Nest container, so Nest will not invoke
   * their lifecycle hooks — this explicit teardown covers that gap.
   */
  async onModuleDestroy(): Promise<void> {
    await this.emailService.close();
  }
}
