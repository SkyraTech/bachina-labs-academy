import { describe, it, expect } from 'vitest';
import { LogSanitizer } from './log-sanitizer';

describe('LogSanitizer', () => {
  describe('Primitive and basic values', () => {
    it('returns null and undefined as-is', () => {
      expect(LogSanitizer.sanitize(null)).toBeNull();
      expect(LogSanitizer.sanitize(undefined)).toBeUndefined();
    });

    it('returns numbers and booleans as-is', () => {
      expect(LogSanitizer.sanitize(42)).toBe(42);
      expect(LogSanitizer.sanitize(true)).toBe(true);
      expect(LogSanitizer.sanitize(false)).toBe(false);
    });

    it('converts BigInt to string safely', () => {
      expect(LogSanitizer.sanitize(BigInt(123456789))).toBe('123456789');
    });

    it('converts Date to ISO string', () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      expect(LogSanitizer.sanitize(now)).toBe('2026-10-16T12:00:00.000Z');
    });
  });

  describe('Sensitive key redaction (including Academy cookies and substring matching)', () => {
    it('redacts sensitive keys regardless of casing, including academy_access and academy_refresh', () => {
      const input = {
        password: 'superSecretPassword123!',
        PASSWORD: 'superSecretPassword123!',
        PasswordHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$dGVzdGhhc2g',
        newPassword: 'MyNewPassword!',
        currentPassword: 'MyOldPassword!',
        authorization: 'Bearer secret_token_here',
        Cookie: 'academy_access=jwt.token.here; academy_refresh=opaque_token_here',
        'set-cookie': 'academy_access=abc; Path=/',
        academy_access: 'jwt_access_canary_999',
        academy_refresh: 'opaque_refresh_canary_999',
        accessToken: 'jwt_value_123',
        refreshToken: 'opaque_refresh_val',
        verificationToken: 'secure_verification_val',
        tokenSecret: 'hmac_pepper_secret',
        apiKey: 'sk_live_123456789',
        resend_api_key: 're_abcdef123456',
        database_password: 'CANARY_DB_PASS_456',
        user_token: 'CANARY_TOKEN_789',
        stripe_api_key: 'CANARY_API_KEY_000',
        username: 'john.doe@example.com',
        role: 'AUTHOR',
      };

      const result = LogSanitizer.sanitize(input) as Record<string, unknown>;

      expect(result['password']).toBe('[REDACTED]');
      expect(result['PASSWORD']).toBe('[REDACTED]');
      expect(result['PasswordHash']).toBe('[REDACTED]');
      expect(result['newPassword']).toBe('[REDACTED]');
      expect(result['currentPassword']).toBe('[REDACTED]');
      expect(result['authorization']).toBe('[REDACTED]');
      expect(result['Cookie']).toBe('[REDACTED]');
      expect(result['set-cookie']).toBe('[REDACTED]');
      expect(result['academy_access']).toBe('[REDACTED]');
      expect(result['academy_refresh']).toBe('[REDACTED]');
      expect(result['accessToken']).toBe('[REDACTED]');
      expect(result['refreshToken']).toBe('[REDACTED]');
      expect(result['verificationToken']).toBe('[REDACTED]');
      expect(result['tokenSecret']).toBe('[REDACTED]');
      expect(result['apiKey']).toBe('[REDACTED]');
      expect(result['resend_api_key']).toBe('[REDACTED]');
      expect(result['database_password']).toBe('[REDACTED]');
      expect(result['user_token']).toBe('[REDACTED]');
      expect(result['stripe_api_key']).toBe('[REDACTED]');
      // Non-sensitive fields preserved
      expect(result['username']).toBe('john.doe@example.com');
      expect(result['role']).toBe('AUTHOR');
    });

    it('redacts sensitive keys in nested objects and arrays', () => {
      const input = {
        meta: {
          user: {
            id: '123-uuid',
            password: 'secretPassword',
            security: {
              apiKey: 'key_value',
              academy_access: 'nested_cookie_token',
            },
          },
        },
        tokens: [
          { token: 'token1', valid: true },
          { token: 'token2', valid: false },
        ],
      };

      const result = LogSanitizer.sanitize(input) as any;

      expect(result.meta.user.id).toBe('123-uuid');
      expect(result.meta.user.password).toBe('[REDACTED]');
      expect(result.meta.user.security.apiKey).toBe('[REDACTED]');
      expect(result.meta.user.security.academy_access).toBe('[REDACTED]');
      expect(result.tokens[0].token).toBe('[REDACTED]');
      expect(result.tokens[0].valid).toBe(true);
      expect(result.tokens[1].token).toBe('[REDACTED]');
      expect(result.tokens[1].valid).toBe(false);
    });
  });

  describe('String-level token, cookie, and key-value redaction', () => {
    it('redacts Bearer tokens embedded in string messages', () => {
      const msg = 'Incoming request with header: Bearer ya29.a0AfH6SMAxyz123...';
      const sanitized = LogSanitizer.sanitizeString(msg);
      expect(sanitized).toBe('Incoming request with header: Bearer [REDACTED]');
    });

    it('redacts raw JWT strings embedded in messages', () => {
      const jwt =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature_part_here';
      const msg = `User logged in with token ${jwt} from web`;
      const sanitized = LogSanitizer.sanitizeString(msg);
      expect(sanitized).toContain('[REDACTED_JWT]');
      expect(sanitized).not.toContain('eyJhbGci');
    });

    it('redacts Argon2id hashes embedded in messages', () => {
      const hash =
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXJhbmRvbXNhbHQ$7fN71N+9u0yJtZ7K6vM9aB4P8q3e2W1x5z7y9A';
      const msg = `Password hash generated: ${hash}`;
      const sanitized = LogSanitizer.sanitizeString(msg);
      expect(sanitized).toBe('Password hash generated: [REDACTED_HASH]');
      expect(sanitized).not.toContain('7fN71N');
    });

    it('redacts academy_access and academy_refresh cookies embedded in strings', () => {
      const cookieStr =
        'Cookie header: academy_access=CANARY_ACCESS_SECRET_123; academy_refresh=CANARY_REFRESH_SECRET_456; theme=dark';
      const sanitized = LogSanitizer.sanitizeString(cookieStr);
      expect(sanitized).toContain('academy_access=[REDACTED]');
      expect(sanitized).toContain('academy_refresh=[REDACTED]');
      expect(sanitized).not.toContain('CANARY_ACCESS_SECRET_123');
      expect(sanitized).not.toContain('CANARY_REFRESH_SECRET_456');
      expect(sanitized).toContain('theme=dark');
    });

    it('redacts key-value pairs matching sensitive terms inside string messages', () => {
      const msg = 'Connection failed with secret=CANARY_UNUSUAL_SECRET_999 at host localhost';
      const sanitized = LogSanitizer.sanitizeString(msg);
      expect(sanitized).toBe('Connection failed with secret=[REDACTED] at host localhost');
      expect(sanitized).not.toContain('CANARY_UNUSUAL_SECRET_999');
    });
  });

  describe('URL and Referer sanitization', () => {
    it('strips query parameters from relative URLs', () => {
      expect(LogSanitizer.sanitizeUrl('/api/v1/auth/verify-email?token=secret123&foo=bar')).toBe(
        '/api/v1/auth/verify-email',
      );
      expect(LogSanitizer.sanitizeUrl('/api/v1/users')).toBe('/api/v1/users');
    });

    it('strips query parameters from absolute URLs', () => {
      expect(
        LogSanitizer.sanitizeUrl('https://academy.bachinalabs.com/verify?token=secret123'),
      ).toBe('https://academy.bachinalabs.com/verify');
    });

    it('extracts origin only from Referer headers, discarding paths and query params', () => {
      expect(
        LogSanitizer.sanitizeReferer('https://academy.bachinalabs.com/checkout?discount=100&ref=partner'),
      ).toBe('https://academy.bachinalabs.com');
      expect(
        LogSanitizer.sanitizeReferer('http://localhost:4200/dashboard/articles/edit?draftId=xyz'),
      ).toBe('http://localhost:4200');
    });

    it('handles malformed Referer headers safely', () => {
      expect(LogSanitizer.sanitizeReferer('not-a-valid-url')).toBe('[MALFORMED_REFERER]');
      expect(LogSanitizer.sanitizeReferer('')).toBe('');
      expect(LogSanitizer.sanitizeReferer(undefined)).toBe('');
    });
  });

  describe('Circular references and depth bounds', () => {
    it('handles circular references without crashing or stack overflow', () => {
      const obj: any = { name: 'circular-test' };
      obj.self = obj;

      const result = LogSanitizer.sanitize(obj) as any;
      expect(result.name).toBe('circular-test');
      expect(result.self).toBe('[CIRCULAR]');
    });

    it('bounds recursion when depth exceeds max depth limit', () => {
      let current: any = { level: 0 };
      const root = current;
      for (let i = 1; i <= 10; i++) {
        current.child = { level: i };
        current = current.child;
      }

      const result = LogSanitizer.sanitize(root) as any;
      let depth = 0;
      let node = result;
      while (node && typeof node === 'object' && node.child) {
        depth++;
        node = node.child;
      }

      expect(node).toBe('[DEPTH_EXCEEDED]');
      expect(depth).toBe(6);
    });
  });

  describe('Error normalization & Production Mode Safety', () => {
    it('normalizes standard Error objects and sanitizes key-value secrets in development', () => {
      const error = new Error('Database connection failed with password=superSecret');
      const normalized = LogSanitizer.normalizeError(error, false);

      expect(normalized.type).toBe('Error');
      expect(normalized.message).toBe('Database connection failed with password=[REDACTED]');
      expect(normalized.stack_trace).toBeDefined();
    });

    it('masks messages and suppresses stack traces in production mode for 5xx safety', () => {
      const error = new Error('Fatal internal leak: CANARY_UNUSUAL_SECRET_888');
      const normalized = LogSanitizer.normalizeError(error, true);

      expect(normalized.type).toBe('Error');
      expect(normalized.message).toBe('An internal server error occurred.');
      expect(normalized.stack_trace).toBeUndefined();
      expect(normalized.message).not.toContain('CANARY_UNUSUAL_SECRET_888');
    });

    it('handles non-Error objects safely without dumping entire arbitrary objects', () => {
      const normalized = LogSanitizer.normalizeError({ message: 'Custom failure with token=secretVal', code: 500 }, false);
      expect(normalized.type).toBe('UnknownError');
      expect(normalized.message).toBe('Custom failure with token=[REDACTED]');
    });

    it('handles primitive thrown values', () => {
      const normalized = LogSanitizer.normalizeError('Fatal string error', false);
      expect(normalized.type).toBe('UnknownError');
      expect(normalized.message).toBe('Fatal string error');
    });

    it('handles symbol and function values in sanitize', () => {
      const sym = Symbol('token-sym');
      const fn = () => 'test-fn';
      expect(LogSanitizer.sanitize(sym)).toBe('Symbol(token-sym)');
      expect(LogSanitizer.sanitize(fn)).toContain('test-fn');
    });

    it('handles sanitizeUrl edge cases with empty string and catch block', () => {
      expect(LogSanitizer.sanitizeUrl('')).toBe('');
      expect(LogSanitizer.sanitizeUrl(null as any)).toBe('');
      expect(LogSanitizer.sanitizeUrl('http://[invalid-ipv6/?param=123')).toBe('http://[invalid-ipv6/');
    });

    it('handles sanitizeString edge cases with empty string and non-string', () => {
      expect(LogSanitizer.sanitizeString('')).toBe('');
      expect(LogSanitizer.sanitizeString(null as any)).toBeNull();
    });

    it('handles object with stack but no name in normalizeError', () => {
      const customErr = { stack: 'at something (file.ts:1:1)' };
      const res = LogSanitizer.normalizeError(customErr, false);
      expect(res.type).toBe('UnknownError');
      expect(res.stack_trace).toBe('at something (file.ts:1:1)');
    });
  });
});
