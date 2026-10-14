import type { EmailConfig } from '../../../config/email.config.js';

/**
 * Verification email templates.
 *
 * Rendering lives here, not in providers, so the same HTML/text pair is used
 * by every transport (Mailpit in development, Resend in production).
 *
 * Security rules
 * ──────────────
 *   - The verification URL contains the RAW token. It is interpolated into the
 *     HTML body only — never the subject, never a log line, never the `meta`
 *     correlation record.
 *   - All interpolated values are HTML-escaped. The token is base64url, which
 *     is already safe, but escaping is applied anyway so a future template
 *     change cannot introduce an injection path.
 *   - The link uses the configured APP_BASE_URL rather than a request-derived
 *     host, so a spoofed Host header cannot redirect the verification click.
 *   - No tracking pixels, no external assets, no remote images.
 */

/** Escapes a value for safe interpolation into HTML text nodes/attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Builds the absolute verification link that the user clicks. */
export function buildVerificationUrl(
  baseUrl: string,
  token: string,
): string {
  const origin = baseUrl.replace(/\/+$/, '');
  return `${origin}/verify-email?token=${encodeURIComponent(token)}`;
}

/** Renders a human-readable duration such as "24 hours". */
function formatExpiry(ttlMinutes: number): string {
  if (ttlMinutes % 1440 === 0) {
    const days = ttlMinutes / 1440;
    return days === 1 ? '24 hours' : `${String(days)} days`;
  }
  if (ttlMinutes % 60 === 0) {
    const hours = ttlMinutes / 60;
    return hours === 1 ? '1 hour' : `${String(hours)} hours`;
  }
  return ttlMinutes === 1 ? '1 minute' : `${String(ttlMinutes)} minutes`;
}

export interface VerificationEmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface VerificationEmailInput {
  readonly recipient: string;
  readonly token: string;
  readonly config: EmailConfig;
  /** Optional: the address the account was registered with, for clarity. */
  readonly emailHint?: string;
}

/**
 * Renders the verification email for both HTML and plain-text clients.
 *
 * @param input - recipient, raw verification token and resolved config
 * @returns subject, html and text bodies
 */
export function renderVerificationEmail(
  input: VerificationEmailInput,
): VerificationEmailContent {
  const { token, config } = input;
  const url = buildVerificationUrl(config.appBaseUrl, token);
  const expiry = formatExpiry(config.verification.ttlMinutes);
  const safeUrl = escapeHtml(url);
  const safeExpiry = escapeHtml(expiry);
  const safeExpiryMinutes = escapeHtml(String(config.verification.ttlMinutes));

  const subject = 'Verify your email address';

  const text = [
    'Verify your email address',
    '',
    'Welcome to Bachina Labs Academy.',
    '',
    'Confirm this address to activate your account:',
    url,
    '',
    `This link expires in ${expiry} (${safeExpiryMinutes} minutes).`,
    'It can be used only once.',
    '',
    'If you did not create this account you can ignore this message.',
    'No account changes will occur until the link is opened.',
    '',
    '— Skyra Tech on behalf of Bachina Labs',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Verify your email address</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fff7ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff7ed;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#f97316;">Bachina Labs Academy</p>
                <h1 style="margin:0;font-size:22px;line-height:1.3;color:#20242b;">Verify your email address</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">
                  Welcome. Confirm this address to activate your account.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                  <tr>
                    <td align="center" style="background-color:#f97316;border-radius:8px;">
                      <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                        Verify my email
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#64748b;">
                  This link expires in ${safeExpiry} and can be used only once.
                </p>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#64748b;">
                  If the button does not work, paste this address into your browser:
                </p>
                <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;">
                  <a href="${safeUrl}" style="color:#c2410c;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
                  If you did not create this account you can ignore this message.
                  No account changes will occur until the link is opened.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">
                  Skyra Tech on behalf of Bachina Labs
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
