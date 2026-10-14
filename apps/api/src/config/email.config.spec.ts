import emailConfig from './email.config.js';

/**
 * Unit tests for the email configuration factory.
 *
 * Pure environment-parsing — no Nest container, no I/O. Each test snapshots
 * and restores process.env so no state leaks between cases or into other files.
 *
 * Tests cover:
 *   1.  Defaults target local Mailpit (smtp, 127.0.0.1:1025, insecure)
 *   2.  Defaults: enabled, 24h TTL, 60s cooldown, localhost base URL
 *   3.  EMAIL_FROM is REQUIRED when email is enabled
 *   4.  EMAIL_FROM is NOT required when email is disabled
 *   5.  RESEND_API_KEY is required when provider=resend and enabled
 *   6.  RESEND_API_KEY is NOT required when provider=smtp
 *   7.  RESEND_API_KEY is NOT required when email is disabled
 *   8.  An unknown EMAIL_PROVIDER is rejected
 *   9.  A malformed APP_BASE_URL is rejected
 *   10. APP_BASE_URL is normalized (trailing slash stripped, origin only)
 *   11. A non-numeric SMTP_PORT is rejected
 *   12. A zero/negative TTL is rejected
 *   13. A non-integer TTL is rejected
 *   14. Custom TTL and cooldown are honoured
 *   15. SMTP_USER/PASS are optional (Mailpit needs none)
 */

const EMAIL_KEYS = [
  'NODE_ENV',
  'EMAIL_ENABLED',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'EMAIL_FROM_ADDRESS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'RESEND_API_KEY',
  'EMAIL_VERIFICATION_TTL_MINUTES',
  'EMAIL_VERIFICATION_COOLDOWN_SECONDS',
  'APP_BASE_URL',
  'APP_PUBLIC_URL',
] as const;

describe('emailConfig', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot the keys this factory reads, then clear them for a clean slate.
    for (const key of EMAIL_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of EMAIL_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  /** The config factory returns the namespace object directly. */
  const load = () => emailConfig() as ReturnType<typeof emailConfig>;

  // ── Defaults ───────────────────────────────────────────────────────────────

  describe('defaults', () => {
    it('targets local Mailpit over plain SMTP', () => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
      const config = load();

      expect(config.provider).toBe('smtp');
      expect(config.smtp.host).toBe('127.0.0.1');
      expect(config.smtp.port).toBe(1025);
      expect(config.smtp.secure).toBe(false);
    });

    it('enables email with a 24h TTL and 60s cooldown by default', () => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
      const config = load();

      expect(config.enabled).toBe(true);
      expect(config.verification.ttlMinutes).toBe(1440);
      expect(config.verification.cooldownSeconds).toBe(60);
    });

    it('defaults APP_BASE_URL to the Angular dev server', () => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
      const config = load();

      expect(config.appBaseUrl).toBe('http://localhost:4200');
    });

    // Mailpit needs no credentials, so both must default to empty rather than
    // forcing every developer to invent values.
    it('leaves SMTP credentials empty by default', () => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
      const config = load();

      expect(config.smtp.user).toBe('');
      expect(config.smtp.pass).toBe('');
    });
  });

  // ── Required values ────────────────────────────────────────────────────────

  describe('required values', () => {
    it('requires EMAIL_FROM when email is enabled', () => {
      expect(() => load()).toThrow(/EMAIL_FROM is required/);
    });

    it('does not require EMAIL_FROM when email is disabled', () => {
      process.env['EMAIL_ENABLED'] = 'false';
      expect(() => load()).not.toThrow();
    });

    it('requires RESEND_API_KEY when provider=resend', () => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
      process.env['EMAIL_PROVIDER'] = 'resend';

      expect(() => load()).toThrow(/RESEND_API_KEY is required/);
    });

    it('does not require RESEND_API_KEY for smtp', () => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
      process.env['EMAIL_PROVIDER'] = 'smtp';

      expect(() => load()).not.toThrow();
    });

    // A disabled provider must not demand credentials it will never use — this
    // is what lets CI and offline development run without a Resend account.
    it('does not require RESEND_API_KEY when email is disabled', () => {
      process.env['EMAIL_ENABLED'] = 'false';
      process.env['EMAIL_PROVIDER'] = 'resend';

      expect(() => load()).not.toThrow();
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  describe('validation', () => {
    beforeEach(() => {
      process.env['EMAIL_FROM'] = 'hello@skyra-tech.com';
    });

    it('rejects an unknown EMAIL_PROVIDER', () => {
      process.env['EMAIL_PROVIDER'] = 'sendgrid';

      expect(() => load()).toThrow(/EMAIL_PROVIDER must be one of/);
    });

    it('rejects a malformed APP_BASE_URL', () => {
      process.env['APP_BASE_URL'] = 'not a url';

      expect(() => load()).toThrow(/APP_BASE_URL/);
    });

    it('rejects a non-http APP_BASE_URL', () => {
      process.env['APP_BASE_URL'] = 'ftp://example.com';

      expect(() => load()).toThrow(/APP_BASE_URL/);
    });

    it('normalizes APP_BASE_URL to its origin without a trailing slash', () => {
      process.env['APP_BASE_URL'] = 'https://academy.example.com/some/path/';

      expect(load().appBaseUrl).toBe('https://academy.example.com');
    });

    it('rejects a non-numeric SMTP_PORT', () => {
      process.env['SMTP_PORT'] = 'twenty-five';

      expect(() => load()).toThrow(/SMTP_PORT must be a positive integer/);
    });

    // A silently-reverted TTL would silently shorten the verification window —
    // a security-relevant setting, so it must fail loudly instead.
    it('rejects a zero TTL', () => {
      process.env['EMAIL_VERIFICATION_TTL_MINUTES'] = '0';

      expect(() => load()).toThrow(/EMAIL_VERIFICATION_TTL_MINUTES/);
    });

    it('rejects a negative cooldown', () => {
      process.env['EMAIL_VERIFICATION_COOLDOWN_SECONDS'] = '-5';

      expect(() => load()).toThrow(/EMAIL_VERIFICATION_COOLDOWN_SECONDS/);
    });

    it('rejects a non-integer TTL', () => {
      process.env['EMAIL_VERIFICATION_TTL_MINUTES'] = '1440.5';

      expect(() => load()).toThrow(/EMAIL_VERIFICATION_TTL_MINUTES/);
    });

    it('honours a custom TTL and cooldown', () => {
      process.env['EMAIL_VERIFICATION_TTL_MINUTES'] = '720';
      process.env['EMAIL_VERIFICATION_COOLDOWN_SECONDS'] = '120';

      const config = load();
      expect(config.verification.ttlMinutes).toBe(720);
      expect(config.verification.cooldownSeconds).toBe(120);
    });

    it('parses SMTP_SECURE explicitly', () => {
      process.env['SMTP_SECURE'] = 'true';
      expect(load().smtp.secure).toBe(true);

      process.env['SMTP_SECURE'] = 'false';
      expect(load().smtp.secure).toBe(false);
    });

    it('treats an unrecognised boolean as false rather than enabling a transport', () => {
      process.env['SMTP_SECURE'] = 'yes-please';
      expect(load().smtp.secure).toBe(false);
    });

    it('accepts EMAIL_PROVIDER=mailpit as an alias for smtp', () => {
      process.env['EMAIL_PROVIDER'] = 'mailpit';
      const config = load();
      expect(config.provider).toBe('smtp');
    });

    it('accepts EMAIL_FROM_ADDRESS as an alias for EMAIL_FROM', () => {
      delete process.env['EMAIL_FROM'];
      process.env['EMAIL_FROM_ADDRESS'] = 'alias@skyra-tech.com';
      const config = load();
      expect(config.from).toBe('alias@skyra-tech.com');
    });

    it('accepts APP_PUBLIC_URL as an alias for APP_BASE_URL', () => {
      process.env['APP_PUBLIC_URL'] = 'https://portal.skyra-tech.com';
      const config = load();
      expect(config.appBaseUrl).toBe('https://portal.skyra-tech.com');
    });

    it('rejects local Mailpit host when NODE_ENV=production', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['EMAIL_PROVIDER'] = 'smtp';
      process.env['SMTP_HOST'] = '127.0.0.1';
      expect(() => load()).toThrow(/Production configuration cannot use local Mailpit SMTP/);
    });
  });
});
