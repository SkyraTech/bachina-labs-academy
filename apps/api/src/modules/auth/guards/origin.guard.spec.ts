import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, vi } from 'vitest';
import { OriginGuard } from './origin.guard';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../services/cookie.service';

describe('OriginGuard', () => {
  function createGuard(allowedOrigins: string[] = ['http://localhost:4200']): OriginGuard {
    const configService = {
      get: vi.fn().mockReturnValue(allowedOrigins),
    } as unknown as ConfigService;
    return new OriginGuard(configService);
  }

  function createMockContext(
    method: string,
    options: {
      headers?: Record<string, string>;
      url?: string;
      cookies?: Record<string, string>;
    } = {},
  ): ExecutionContext {
    const request = {
      method,
      url: options.url ?? '/api/v1/auth/login',
      headers: {
        host: 'localhost:3000',
        ...options.headers,
      },
      cookies: options.cookies ?? {},
    };

    return {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  }

  describe('Safe HTTP methods', () => {
    it('allows GET, HEAD, and OPTIONS regardless of headers', () => {
      const guard = createGuard();
      expect(
        guard.canActivate(createMockContext('GET', { headers: { origin: 'http://malicious.com' } })),
      ).toBe(true);
      expect(
        guard.canActivate(createMockContext('HEAD', { headers: { origin: 'http://malicious.com' } })),
      ).toBe(true);
      expect(
        guard.canActivate(createMockContext('OPTIONS', { headers: { origin: 'http://malicious.com' } })),
      ).toBe(true);
    });
  });

  describe('Origin header validation', () => {
    it('allows configured frontend origin', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(
        guard.canActivate(createMockContext('POST', { headers: { origin: 'http://localhost:4200' } })),
      ).toBe(true);
    });

    it('allows same-origin matching host (e.g. Swagger UI or reverse proxy)', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(
        guard.canActivate(createMockContext('POST', { headers: { origin: 'http://localhost:3000' } })),
      ).toBe(true);
    });

    it('rejects untrusted origin with 403 Forbidden', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(() =>
        guard.canActivate(createMockContext('POST', { headers: { origin: 'http://evil.com' } })),
      ).toThrow(new ForbiddenException('Origin not allowed.'));
    });

    it('rejects null origin from sandboxed iframe', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(createMockContext('POST', { headers: { origin: 'null' } })),
      ).toThrow(new ForbiddenException('Invalid or untrusted origin.'));
    });

    it('rejects malformed origin strings', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(createMockContext('POST', { headers: { origin: 'not-a-valid-url' } })),
      ).toThrow(new ForbiddenException('Malformed Origin header.'));
    });

    it('rejects unsupported protocol (e.g. file: or javascript:)', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(createMockContext('POST', { headers: { origin: 'file:///etc/passwd' } })),
      ).toThrow(new ForbiddenException('Origin protocol not allowed.'));
    });
  });

  describe('Contradictory Origin and Fetch Metadata headers', () => {
    it('rejects Sec-Fetch-Site: same-origin when Origin is different from Host', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            headers: {
              origin: 'http://localhost:4200',
              'sec-fetch-site': 'same-origin',
              host: 'localhost:3000',
            },
          }),
        ),
      ).toThrow(new ForbiddenException('Contradictory Origin and Fetch Metadata headers.'));
    });

    it('rejects Sec-Fetch-Site: cross-site when Origin is identical to Host', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            headers: {
              origin: 'http://localhost:3000',
              'sec-fetch-site': 'cross-site',
              host: 'localhost:3000',
            },
          }),
        ),
      ).toThrow(new ForbiddenException('Contradictory Origin and Fetch Metadata headers.'));
    });
  });

  describe('Missing Origin with Fetch Metadata', () => {
    it('rejects Sec-Fetch-Site: cross-site when Origin is missing', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(createMockContext('POST', { headers: { 'sec-fetch-site': 'cross-site' } })),
      ).toThrow(new ForbiddenException('Cross-site request blocked.'));
    });

    it('allows Sec-Fetch-Site: same-origin without referer', () => {
      const guard = createGuard();
      expect(
        guard.canActivate(createMockContext('POST', { headers: { 'sec-fetch-site': 'same-origin' } })),
      ).toBe(true);
    });

    it('allows Sec-Fetch-Site: same-origin with trusted Referer', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(
        guard.canActivate(
          createMockContext('POST', {
            headers: {
              'sec-fetch-site': 'same-origin',
              referer: 'http://localhost:3000/api/docs',
            },
          }),
        ),
      ).toBe(true);
    });

    it('rejects Sec-Fetch-Site: same-origin with untrusted Referer', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            headers: {
              'sec-fetch-site': 'same-origin',
              referer: 'http://evil.com/phishing',
            },
          }),
        ),
      ).toThrow(new ForbiddenException('Untrusted referer header.'));
    });

    it('rejects Sec-Fetch-Site: none with navigate mode', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            headers: {
              'sec-fetch-site': 'none',
              'sec-fetch-mode': 'navigate',
            },
          }),
        ),
      ).toThrow(new ForbiddenException('Navigational state-changing request blocked.'));
    });
  });

  describe('Missing Origin and Missing Fetch Metadata', () => {
    it('validates Referer when present and allows if trusted', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(
        guard.canActivate(
          createMockContext('POST', {
            headers: { referer: 'http://localhost:4200/login' },
          }),
        ),
      ).toBe(true);
    });

    it('rejects when Referer is untrusted', () => {
      const guard = createGuard(['http://localhost:4200']);
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            headers: { referer: 'http://evil.com/exploit' },
          }),
        ),
      ).toThrow(new ForbiddenException('Untrusted referer header.'));
    });

    it('rejects sensitive login request when Origin, Sec-Fetch-Site, and Referer are all missing and no client header is provided', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            url: '/api/v1/auth/login',
            headers: {},
          }),
        ),
      ).toThrow(
        new ForbiddenException('Missing Origin or client identity for state-changing request.'),
      );
    });

    it('rejects sensitive refresh request when Origin, Sec-Fetch-Site, and Referer are all missing and no client header is provided', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            url: '/api/v1/auth/refresh',
            headers: {},
            cookies: { [REFRESH_COOKIE_NAME]: 'some-refresh-token' },
          }),
        ),
      ).toThrow(
        new ForbiddenException('Missing Origin or client identity for state-changing request.'),
      );
    });

    it('rejects cookie-authenticated mutation when Origin, Sec-Fetch-Site, and Referer are missing and no client header is provided', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            url: '/api/v1/articles',
            headers: {},
            cookies: { [ACCESS_COOKIE_NAME]: 'some-access-jwt' },
          }),
        ),
      ).toThrow(
        new ForbiddenException('Missing Origin or client identity for state-changing request.'),
      );
    });

    it('rejects missing-Origin request even when arbitrary client headers like X-Requested-With are supplied', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            url: '/api/v1/auth/login',
            headers: { 'x-requested-with': 'XMLHttpRequest' },
          }),
        ),
      ).toThrow(
        new ForbiddenException('Missing Origin or client identity for state-changing request.'),
      );
    });

    it('rejects missing-Origin request when X-Client-Platform or X-API-Client are supplied', () => {
      const guard = createGuard();
      expect(() =>
        guard.canActivate(
          createMockContext('POST', {
            url: '/api/v1/auth/login',
            headers: { 'x-client-platform': 'mobile', 'x-api-client': 'postman' },
          }),
        ),
      ).toThrow(
        new ForbiddenException('Missing Origin or client identity for state-changing request.'),
      );
    });

    it('allows non-sensitive, unauthenticated route without cookies when headers are missing', () => {
      const guard = createGuard();
      expect(
        guard.canActivate(
          createMockContext('POST', {
            url: '/api/v1/auth/register',
            headers: {},
            cookies: {},
          }),
        ),
      ).toBe(true);
    });
  });
});
