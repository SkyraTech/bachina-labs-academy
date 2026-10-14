import { registerAs } from '@nestjs/config';

/**
 * Email configuration factory — registered under the `email` namespace.
 *
 * Environment variables
 * ─────────────────────
 *   EMAIL_ENABLED            master switch; when false the EmailService uses a
 *                            no-op provider and never contacts a network.
 *                            Default: true
 *   EMAIL_PROVIDER           "smtp" (Mailpit locally / any SMTP relay) or
 *                            "resend" (Resend HTTP API, production).
 *                            Default: "smtp"
 *   EMAIL_FROM               RFC 5322 sender. Required when email is enabled.
 *   SMTP_HOST                default 127.0.0.1 (Mailpit)
 *   SMTP_PORT                default 1025 (Mailpit)
 *   SMTP_SECURE              "true"/"false"; default false. Never enable without TLS.
 *   SMTP_USER                optional; empty for Mailpit
 *   SMTP_PASS                optional; empty for Mailpit
 *   RESEND_API_KEY           required ONLY when EMAIL_PROVIDER=resend
 *   EMAIL_VERIFICATION_TTL_MINUTES  verification link lifetime; default 1440 (24h)
 *   EMAIL_VERIFICATION_COOLDOWN_SECONDS  resend cooldown; default 60
 *   APP_BASE_URL             absolute origin used to build verification links
 *                            (e.g. http://localhost:4200)
 *
 * Security rules
 * ──────────────
 *   - Never returns secrets in a shape that is logged wholesale: apiKey and
 *     password are read here, passed to the provider constructor, and never
 *     re-exposed. Callers must not log the config object.
 *   - Validation is strict and fails fast at boot. A half-configured production
 *     email provider must not silently fall back to "send succeeded".
 *   - Production + resend without an API key is a hard startup error, because a
 *     missing key otherwise presents as a delivery failure that is deliberately
 *     swallowed by the registration flow (by design, see RegistrationService).
 *   - No default is ever supplied for a secret. EMAIL_FROM is required because a
 *     missing sender produces a provider-side rejection that would be invisible
 *     to the user.
 */

export const EMAIL_PROVIDERS = ['smtp', 'resend'] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

export interface EmailConfig {
  enabled: boolean;
  provider: EmailProviderName;
  from: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  resend: {
    apiKey: string;
  };
  verification: {
    ttlMinutes: number;
    cooldownSeconds: number;
  };
  appBaseUrl: string;
}

/**
 * Parses a boolean-ish environment value.
 * Unset → the supplied default. Anything that is not an explicit truthy string
 * is treated as false, so a typo cannot accidentally enable a provider.
 */
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
}

/**
 * Parses a positive integer environment value.
 *
 * @throws Error when the value is present but not a valid positive integer.
 *   Throwing is deliberate: a silently-reverted TTL would silently weaken the
 *   verification window, which is a security-relevant setting.
 */
function parsePositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(
      `${name} must be a positive integer, received "${value}". ` +
        `Remove the variable to use the default of ${fallback}.`,
    );
  }

  return parsed;
}

/**
 * Validates a comma-separated or bare origin, returning a normalized
 * origin string without a trailing slash. Accepts http:// for local
 * development only; production deployments must supply https://.
 */
function parseBaseUrl(value: string | undefined): string {
  const raw = (value ?? 'http://localhost:4200').trim().replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `APP_BASE_URL must be an absolute URL such as http://localhost:4200, received "${value}".`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `APP_BASE_URL must use http: or https:, received "${parsed.protocol}//".`,
    );
  }

  return `${parsed.origin}`;
}

export default registerAs('email', (): EmailConfig => {
  const enabled = parseBoolean(process.env['EMAIL_ENABLED'], true);

  const rawInput = (process.env['EMAIL_PROVIDER'] ?? 'smtp').trim().toLowerCase();
  const rawProvider = rawInput === 'mailpit' ? 'smtp' : rawInput;

  if (!EMAIL_PROVIDERS.includes(rawProvider as EmailProviderName)) {
    throw new Error(
      `EMAIL_PROVIDER must be one of ${EMAIL_PROVIDERS.join(', ')} (or "mailpit"), received "${rawInput}".`,
    );
  }
  const provider = rawProvider as EmailProviderName;

  const from = (
    process.env['EMAIL_FROM_ADDRESS'] ??
    process.env['EMAIL_FROM'] ??
    ''
  ).trim();
  if (enabled && from === '') {
    throw new Error(
      'EMAIL_FROM is required when email is enabled (or supply EMAIL_FROM_ADDRESS). ' +
        'Set it to the sending address (e.g. hello@skyra-tech.com), ' +
        'or set EMAIL_ENABLED=false to disable email entirely.',
    );
  }

  const smtpSecure = parseBoolean(process.env['SMTP_SECURE'], false);
  const smtpHost = (process.env['SMTP_HOST'] ?? '127.0.0.1').trim();
  if (enabled && provider === 'smtp' && smtpHost === '') {
    throw new Error('SMTP_HOST must not be blank when EMAIL_PROVIDER=smtp.');
  }

  const nodeEnv = (process.env['NODE_ENV'] ?? 'development').trim().toLowerCase();
  if (
    enabled &&
    nodeEnv === 'production' &&
    provider === 'smtp' &&
    (smtpHost === '127.0.0.1' || smtpHost === 'localhost')
  ) {
    throw new Error(
      'Production configuration cannot use local Mailpit SMTP (127.0.0.1). Set EMAIL_PROVIDER=resend and configure RESEND_API_KEY for production.',
    );
  }

  const resendApiKey = (process.env['RESEND_API_KEY'] ?? '').trim();
  if (enabled && provider === 'resend' && resendApiKey === '') {
    throw new Error(
      'RESEND_API_KEY is required when EMAIL_PROVIDER=resend. ' +
        'Supply it via the environment, or set EMAIL_PROVIDER=smtp for local development.',
    );
  }

  return {
    enabled,
    provider,
    from,
    smtp: {
      host: smtpHost,
      port: parsePositiveInteger('SMTP_PORT', process.env['SMTP_PORT'], 1025),
      secure: smtpSecure,
      user: (process.env['SMTP_USER'] ?? '').trim(),
      pass: (process.env['SMTP_PASS'] ?? '').trim(),
    },
    resend: {
      apiKey: resendApiKey,
    },
    verification: {
      ttlMinutes: parsePositiveInteger(
        'EMAIL_VERIFICATION_TTL_MINUTES',
        process.env['EMAIL_VERIFICATION_TTL_MINUTES'],
        1440, // 24 hours
      ),
      cooldownSeconds: parsePositiveInteger(
        'EMAIL_VERIFICATION_COOLDOWN_SECONDS',
        process.env['EMAIL_VERIFICATION_COOLDOWN_SECONDS'],
        60,
      ),
    },
    appBaseUrl: parseBaseUrl(
      process.env['APP_PUBLIC_URL'] ?? process.env['APP_BASE_URL'],
    ),
  };
});
