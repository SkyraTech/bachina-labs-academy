import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService, ConfigModule, registerAs } from '@nestjs/config';
import { EmailService } from './email.service.js';
import { DisabledEmailProvider } from './providers/disabled-email.provider.js';
import { SmtpEmailProvider } from './providers/smtp-email.provider.js';
import { EmailModule } from './email.module.js';
import { EMAIL_PROVIDER } from './email.tokens.js';
import {
  EmailDeliveryError,
  type EmailProvider,
  type EmailMessage,
  type EmailSendResult,
} from './types/email.types.js';
import type { EmailConfig } from '../../config/email.config.js';

/**
 * Unit tests for EmailService and provider selection.
 *
 * The concrete transports are NOT constructed with real sockets or clients:
 * SmtpEmailProvider would attempt an SMTP handshake and ResendEmailProvider
 * would build an HTTP client. Both are replaced with an in-memory fake here.
 * Real Mailpit delivery is exercised by the e2e suite, and Resend is never
 * contacted from tests at all (see resend-email.provider.spec.ts).
 *
 * Tests cover:
 *   1.  Sends include the configured From address
 *   2.  Sends include the recipient and rendered bodies
 *   3.  The raw token reaches the body but the meta record stays clean
 *   4.  A provider EmailDeliveryError propagates unchanged
 *   5.  A non-delivery error is wrapped as EmailDeliveryError
 *   6.  providerName reflects the selected transport
 *   7.  isEnabled tracks the EMAIL_ENABLED flag
 *   8.  EmailModule selects Disabled when EMAIL_ENABLED=false
 *   9.  EmailModule selects SMTP for provider=smtp
 *   10. EmailModule selects Resend for provider=resend
 */

/** In-memory provider that records messages and can be made to fail. */
class FakeProvider implements EmailProvider {
  readonly name = 'smtp' as const;
  sent: EmailMessage[] = [];
  failWith: Error | null = null;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failWith !== null) {
      throw this.failWith;
    }
    this.sent.push(message);
    return { messageId: 'fake-id', provider: this.name };
  }

  async verify(): Promise<void> {}
  async close(): Promise<void> {}
}

const BASE_CONFIG: EmailConfig = {
  enabled: true,
  provider: 'smtp',
  from: 'hello@skyra-tech.com',
  smtp: { host: '127.0.0.1', port: 1025, secure: false, user: '', pass: '' },
  resend: { apiKey: 're_test_key' },
  verification: { ttlMinutes: 1440, cooldownSeconds: 60 },
  appBaseUrl: 'http://localhost:4200',
};

describe('EmailService', () => {
  let provider: FakeProvider;
  let emailService: EmailService;
  let configServiceMock: { getOrThrow: ReturnType<typeof vi.fn> };

  const RAW_TOKEN = 't'.repeat(43);

  beforeEach(async () => {
    provider = new FakeProvider();
    configServiceMock = {
      getOrThrow: vi.fn().mockReturnValue(BASE_CONFIG),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: EMAIL_PROVIDER, useValue: provider },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    emailService = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends with the configured From address', async () => {
    await emailService.sendVerificationEmail('alice@example.com', RAW_TOKEN);

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.from).toBe('hello@skyra-tech.com');
  });

  it('sends to the recipient with subject and both bodies', async () => {
    await emailService.sendVerificationEmail('alice@example.com', RAW_TOKEN);

    const message = provider.sent[0];
    expect(message?.to).toBe('alice@example.com');
    expect(message?.subject).toBe('Verify your email address');
    expect(message?.html).toContain('<html');
    expect(message?.text.length).toBeGreaterThan(0);
  });

  // If the token ever landed in `meta`, a provider or logging layer that dumps
  // correlation metadata would leak a usable verification link.
  it('puts the token in the body but never in the meta record', async () => {
    await emailService.sendVerificationEmail('alice@example.com', RAW_TOKEN);

    const message = provider.sent[0];
    expect(message?.html).toContain(RAW_TOKEN);
    expect(message?.text).toContain(RAW_TOKEN);
    expect(JSON.stringify(message?.meta ?? {})).not.toContain(RAW_TOKEN);
    // Subject must stay token-free too — subjects land in provider logs and
    // OS notification previews.
    expect(message?.subject).not.toContain(RAW_TOKEN);
  });

  it('propagates a provider EmailDeliveryError unchanged', async () => {
    const original = new EmailDeliveryError('CONNECTION_FAILED', 'SMTP down');
    provider.failWith = original;

    await expect(
      emailService.sendVerificationEmail('alice@example.com', RAW_TOKEN),
    ).rejects.toBe(original);
  });

  // A transport that throws a raw library error must never surface it: those
  // can embed hostnames, credentials or the message body.
  it('wraps a non-delivery error as EmailDeliveryError', async () => {
    provider.failWith = new Error('ECONNREFUSED 127.0.0.1:1025 secret-detail');

    const result = emailService.sendVerificationEmail(
      'alice@example.com',
      RAW_TOKEN,
    );

    await expect(result).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(result).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('exposes the selected provider name', () => {
    expect(emailService.providerName).toBe('smtp');
  });

  it('reports isEnabled from configuration', () => {
    expect(emailService.isEnabled).toBe(true);

    configServiceMock.getOrThrow.mockReturnValue({
      ...BASE_CONFIG,
      enabled: false,
    });
    expect(emailService.isEnabled).toBe(false);
  });
});

describe('EmailModule provider selection', () => {
  // Mirrors production: AppModule registers ConfigModule.forRoot({ isGlobal: true }),
  // which is what makes ConfigService visible to EmailModule's factory. A
  // non-global ConfigService in the test module would be hidden by module
  // encapsulation and fail to inject.
  const buildProvider = async (config: EmailConfig): Promise<EmailProvider> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [registerAs('email', () => config)],
        }),
        EmailModule,
      ],
    }).compile();

    return moduleRef.get<EmailProvider>(EMAIL_PROVIDER);
  };

  it('selects DisabledEmailProvider when EMAIL_ENABLED=false', async () => {
    const provider = await buildProvider({ ...BASE_CONFIG, enabled: false });
    expect(provider).toBeInstanceOf(DisabledEmailProvider);
  });

  it('selects SmtpEmailProvider for provider=smtp', async () => {
    const provider = await buildProvider({
      ...BASE_CONFIG,
      enabled: true,
      provider: 'smtp',
    });
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });

  // Constructed here only to prove selection wiring. No network call is made —
  // see resend-email.provider.spec.ts, which mocks the Resend client entirely.
  it('selects ResendEmailProvider for provider=resend', async () => {
    const provider = await buildProvider({
      ...BASE_CONFIG,
      enabled: true,
      provider: 'resend',
    });
    expect(provider.name).toBe('resend');
  });
});
