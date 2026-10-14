import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResendEmailProvider } from './resend-email.provider.js';
import { EmailDeliveryError } from '../types/email.types.js';
import type { EmailMessage } from '../types/email.types.js';
import type { EmailConfig } from '../../../config/email.config.js';

/**
 * Unit tests for ResendEmailProvider — the `resend` SDK is FULLY MOCKED.
 *
 * IMPORTANT: these tests exercise our error CLASSIFICATION and payload mapping
 * against a simulated Resend client. They do NOT contact the Resend API, and
 * they do not constitute verification of real-world delivery. The production
 * API key and the verified Bachina Labs sending domain are supplied later; real
 * Resend delivery remains unverified and must not be assumed from this suite.
 * Local end-to-end delivery is proven separately through Mailpit.
 *
 * Resend does not throw on API failure — it resolves with a discriminated
 * union whose `error.name` is a closed set of stable codes. That is what these
 * tests pin down.
 *
 * Tests cover:
 *   1.  Constructor rejects an empty API key
 *   2.  Successful send returns the Resend id and provider name
 *   3.  Payload includes from, to (as array), subject, html and text
 *   4.  A null error means success even if data.id is missing
 *   5.  invalid_api_key maps to PROVIDER_REJECTED
 *   6.  invalid_from_address maps to PROVIDER_REJECTED
 *   7.  validation_error maps to PROVIDER_REJECTED
 *   8.  rate_limit_exceeded maps to PROVIDER_UNAVAILABLE
 *   9.  monthly_quota_exceeded maps to PROVIDER_UNAVAILABLE
 *   10. internal_server_error maps to PROVIDER_UNAVAILABLE
 *   11. An unrecognised error name maps to UNKNOWN (fail-closed)
 *   12. A thrown transport error maps to CONNECTION_FAILED
 *   13. The thrown error never contains the API key
 *   14. The thrown error never contains Resend's own error message
 */

// ── Resend SDK mock ──────────────────────────────────────────────────────────
// Replaces the module entirely so no HTTP client is constructed and no request
// can escape the test process.

const emailsSendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    readonly emails = { send: emailsSendMock };
    constructor(_key?: string) {}
  },
}));

const MESSAGE: EmailMessage = {
  to: 'alice@example.com',
  from: 'hello@skyra-tech.com',
  subject: 'Verify your email address',
  html: '<p>Verify</p>',
  text: 'Verify',
  meta: { template: 'account-verification' },
};

const CONFIG: EmailConfig = {
  enabled: true,
  provider: 'resend',
  from: 'hello@skyra-tech.com',
  smtp: { host: '127.0.0.1', port: 1025, secure: false, user: '', pass: '' },
  resend: { apiKey: 're_super_secret_key_123' },
  verification: { ttlMinutes: 1440, cooldownSeconds: 60 },
  appBaseUrl: 'http://localhost:4200',
};

function configServiceWith(config: EmailConfig): ConfigService {
  return { getOrThrow: vi.fn().mockReturnValue(config) } as unknown as ConfigService;
}

/** Builds a provider whose SDK responses come from `impl`. */
async function buildProvider(
  impl: () => Promise<unknown>,
  config: EmailConfig = CONFIG,
): Promise<ResendEmailProvider> {
  emailsSendMock.mockImplementation(impl);

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ResendEmailProvider,
      { provide: ConfigService, useValue: configServiceWith(config) },
    ],
  }).compile();

  return moduleRef.get<ResendEmailProvider>(ResendEmailProvider);
}

describe('ResendEmailProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Construction ───────────────────────────────────────────────────────────

  describe('construction', () => {
    it('rejects an empty API key rather than sending to nowhere', () => {
      expect(
        () =>
          new ResendEmailProvider(
            configServiceWith({ ...CONFIG, resend: { apiKey: '' } }),
          ),
      ).toThrow(/RESEND_API_KEY/);
    });
  });

  // ── Successful delivery ────────────────────────────────────────────────────

  describe('successful send', () => {
    it('returns the Resend message id and provider name', async () => {
      const provider = await buildProvider(async () => ({
        data: { id: 'resend-msg-123' },
        error: null,
      }));

      const result = await provider.send(MESSAGE);

      expect(result).toEqual({
        messageId: 'resend-msg-123',
        provider: 'resend',
      });
    });

    it('maps the EmailMessage onto the Resend payload', async () => {
      const provider = await buildProvider(async () => ({
        data: { id: 'resend-msg-123' },
        error: null,
      }));

      await provider.send(MESSAGE);

      const payload = emailsSendMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.from).toBe('hello@skyra-tech.com');
      // Resend expects an array of recipients.
      expect(payload.to).toEqual(['alice@example.com']);
      expect(payload.subject).toBe('Verify your email address');
      expect(payload.html).toBe('<p>Verify</p>');
      expect(payload.text).toBe('Verify');
    });

    // A missing id must not produce an empty correlation id in logs.
    it('falls back to a placeholder when data.id is absent', async () => {
      const provider = await buildProvider(async () => ({
        data: {},
        error: null,
      }));

      const result = await provider.send(MESSAGE);

      expect(result.messageId).toBe('resend-unknown');
      expect(result.messageId.length).toBeGreaterThan(0);
    });
  });

  // ── Error classification ───────────────────────────────────────────────────

  describe('error classification', () => {
    const cases = [
      ['invalid_api_key', 'PROVIDER_REJECTED'],
      ['missing_api_key', 'PROVIDER_REJECTED'],
      ['restricted_api_key', 'PROVIDER_REJECTED'],
      ['invalid_from_address', 'PROVIDER_REJECTED'],
      ['validation_error', 'PROVIDER_REJECTED'],
      ['invalid_parameter', 'PROVIDER_REJECTED'],
      ['missing_required_field', 'PROVIDER_REJECTED'],
      ['rate_limit_exceeded', 'PROVIDER_UNAVAILABLE'],
      ['monthly_quota_exceeded', 'PROVIDER_UNAVAILABLE'],
      ['daily_quota_exceeded', 'PROVIDER_UNAVAILABLE'],
      ['internal_server_error', 'PROVIDER_UNAVAILABLE'],
      ['application_error', 'PROVIDER_UNAVAILABLE'],
      ['security_error', 'PROVIDER_UNAVAILABLE'],
      // Fail-closed: anything unrecognised must not be passed through, or a new
      // Resend error shape could leak details by default.
      ['some_future_unknown_code', 'UNKNOWN'],
    ] as const;

    it.each(cases)('maps "%s" to %s', async (resendName, expectedCode) => {
      const provider = await buildProvider(async () => ({
        data: null,
        error: { name: resendName, statusCode: 400, message: 'resend detail' },
      }));

      const result = provider.send(MESSAGE);

      await expect(result).rejects.toBeInstanceOf(EmailDeliveryError);
      await expect(result).rejects.toMatchObject({ code: expectedCode });
    });

    // Resend resolving rather than throwing is the normal failure path, so the
    // provider must inspect the union rather than rely on try/catch alone.
    it('does not mistake a resolved error response for success', async () => {
      const provider = await buildProvider(async () => ({
        data: null,
        error: { name: 'validation_error', statusCode: 422, message: 'nope' },
      }));

      await expect(provider.send(MESSAGE)).rejects.toThrow(EmailDeliveryError);
    });
  });

  // ── Transport-level failure ────────────────────────────────────────────────

  describe('transport failure', () => {
    it('maps a thrown error to CONNECTION_FAILED', async () => {
      const provider = await buildProvider(async () => {
        throw new TypeError('fetch failed');
      });

      const result = provider.send(MESSAGE);

      await expect(result).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    });
  });

  // ── Secret hygiene ─────────────────────────────────────────────────────────

  describe('secret hygiene', () => {
    it('never includes the API key in the thrown error', async () => {
      const provider = await buildProvider(async () => ({
        data: null,
        error: {
          name: 'invalid_api_key',
          statusCode: 401,
          message: 'API key is invalid: re_super_secret_key_123',
        },
      }));

      const error = await provider.send(MESSAGE).catch((e: unknown) => e);

      expect(JSON.stringify(error)).not.toContain('re_super_secret_key_123');
    });

    // Resend's own message can echo request details, so it must not travel
    // outward where it could reach logs or an HTTP response.
    it("never includes Resend's own error message in the thrown error", async () => {
      const provider = await buildProvider(async () => ({
        data: null,
        error: {
          name: 'validation_error',
          statusCode: 422,
          message: 'The to field must be a valid email address for bob@example.com',
        },
      }));

      const error = await provider.send(MESSAGE).catch((e: unknown) => e);

      expect(JSON.stringify(error)).not.toContain('bob@example.com');
      expect(JSON.stringify(error)).not.toContain('The to field must be');
    });
  });
});
