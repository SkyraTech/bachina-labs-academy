import {
  buildVerificationUrl,
  renderVerificationEmail,
} from './verification-email.template.js';
import type { EmailConfig } from '../../../config/email.config.js';

/**
 * Unit tests for the verification email template.
 *
 * Pure string rendering — no I/O. These pin down the security rules the template
 * is responsible for, since a template is where an injection or a token leak is
 * easiest to introduce and hardest to notice in review.
 *
 * Tests cover:
 *   1.  The link is built from APP_BASE_URL, not a request host
 *   2.  The token is present in both the HTML and text bodies
 *   3.  The token is NOT in the subject
 *   4.  A hostile APP_BASE_URL value is HTML-escaped in the href
 *   5.  The link is token-URL-encoded
 *   6.  Trailing slashes on the base URL are not duplicated
 *   7.  Expiry is rendered from the configured TTL
 *   8.  1440 minutes renders as "24 hours"
 *   9.  A non-day/hour TTL renders as minutes
 *   10. Both HTML and text bodies are produced
 *   11. No remote assets or tracking pixels are referenced
 */

const BASE_CONFIG: EmailConfig = {
  enabled: true,
  provider: 'smtp',
  from: 'hello@skyra-tech.com',
  smtp: { host: '127.0.0.1', port: 1025, secure: false, user: '', pass: '' },
  resend: { apiKey: '' },
  verification: { ttlMinutes: 1440, cooldownSeconds: 60 },
  appBaseUrl: 'http://localhost:4200',
};

const TOKEN = 'AbC_-123'.padEnd(43, 'x');

describe('verification email template', () => {
  // ── Link construction ──────────────────────────────────────────────────────

  describe('buildVerificationUrl', () => {
    it('builds the link from the configured base URL', () => {
      expect(buildVerificationUrl('http://localhost:4200', 'tok')).toBe(
        'http://localhost:4200/verify-email?token=tok',
      );
    });

    // Without this, a base of "https://x/" would yield "https://x//verify-email".
    it('does not duplicate the slash when the base has a trailing slash', () => {
      expect(buildVerificationUrl('https://academy.example.com/', 'tok')).toBe(
        'https://academy.example.com/verify-email?token=tok',
      );
    });

    it('striips multiple trailing slashes', () => {
      expect(buildVerificationUrl('https://academy.example.com///', 'tok')).toBe(
        'https://academy.example.com/verify-email?token=tok',
      );
    });

    // A raw token can contain base64url characters that are safe unencoded, but
    // any future token format must still survive the round trip.
    it('URL-encodes the token', () => {
      expect(buildVerificationUrl('http://localhost:4200', 'a+b/c=d')).toContain(
        'token=a%2Bb%2Fc%3D',
      );
    });
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  describe('renderVerificationEmail', () => {
    const render = (overrides: Partial<EmailConfig> = {}) =>
      renderVerificationEmail({
        recipient: 'alice@example.com',
        token: TOKEN,
        config: { ...BASE_CONFIG, ...overrides },
      });

    it('produces both an HTML and a text body', () => {
      const content = render();
      expect(content.html).toContain('<html');
      expect(content.text.length).toBeGreaterThan(0);
    });

    // The token is the credential. If it vanished from the body the email would
    // be useless, so assert presence explicitly.
    it('embeds the token in the HTML body', () => {
      expect(render().html).toContain(TOKEN);
    });

    it('embeds the token in the text body', () => {
      expect(render().text).toContain(TOKEN);
    });

    // Subjects are written to provider logs and OS notification previews, so a
    // token there would leak through a channel that never shows the body.
    it('never places the token in the subject', () => {
      expect(render().subject).not.toContain(TOKEN);
    });

    it('keeps the subject non-sensitive and generic', () => {
      expect(render().subject).toBe('Verify your email address');
    });

    // The href is an attribute context. An unescaped quote in the base URL
    // would allow attribute breakout and arbitrary HTML injection.
    it('HTML-escapes the base URL inside the href', () => {
      const content = render({
        appBaseUrl: 'http://localhost:4200/?x="><script>alert(1)</script>',
      });

      expect(content.html).not.toContain('<script>alert(1)</script>');
      expect(content.html).toContain('&lt;script&gt;');
    });

    // The link must derive from configuration, never from a request-derived
    // Host header, or a spoofed header would redirect the verification click.
    it('builds the link from APP_BASE_URL', () => {
      const content = render({ appBaseUrl: 'https://academy.example.com' });
      expect(content.html).toContain('https://academy.example.com/verify-email');
      expect(content.text).toContain('https://academy.example.com/verify-email');
    });

    it('renders the expiry from the configured TTL', () => {
      expect(render().text).toContain('expires in 24 hours');
    });

    it('renders hour-based TTLs as hours', () => {
      const content = render({ verification: { ttlMinutes: 720, cooldownSeconds: 60 } });
      expect(content.text).toContain('12 hours');
    });

    // Covers TTLs that are neither whole days nor whole hours.
    it('renders minute-based TTLs as minutes', () => {
      const content = render({
        verification: { ttlMinutes: 90, cooldownSeconds: 60 },
      });
      expect(content.text).toContain('90 minutes');
    });

    it('states that the link is single-use', () => {
      expect(render().text).toContain('only once');
    });

    // Tracking pixels and remote images would leak recipient activity to a
    // third party and break in privacy-focused clients.
    it('references no remote assets or tracking pixels', () => {
      const content = render();

      expect(content.html).not.toMatch(/<img/i);
      expect(content.html).not.toMatch(/https?:\/\/(?!localhost)/i);
    });

    it('addresses a neutral greeting rather than leaking account details', () => {
      const content = render();
      // No user name, no password, no account status in the mail.
      expect(content.text).not.toMatch(/password/i);
    });
  });
});
