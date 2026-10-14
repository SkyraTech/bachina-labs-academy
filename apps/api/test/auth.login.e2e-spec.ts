import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../src/modules/auth/services/cookie.service.js';

interface CookieData {
  value: string;
  raw: string;
  httpOnly: boolean;
  sameSite?: string;
  path?: string;
  maxAge?: number;
}

function parseCookies(setCookieHeaders?: string | string[]): Record<string, CookieData> {
  const result: Record<string, CookieData> = {};
  if (!setCookieHeaders) return result;

  const headerList = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  for (const str of headerList) {
    const parts = str.split(';').map((p) => p.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx === -1) continue;
    const name = nameVal.slice(0, eqIdx);
    const value = nameVal.slice(eqIdx + 1);

    const cookie: CookieData = {
      value,
      raw: str,
      httpOnly: false,
    };

    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower === 'httponly') {
        cookie.httpOnly = true;
      } else if (lower.startsWith('path=')) {
        cookie.path = attr.slice(5);
      } else if (lower.startsWith('samesite=')) {
        cookie.sameSite = attr.slice(9);
      } else if (lower.startsWith('max-age=')) {
        cookie.maxAge = parseInt(attr.slice(8), 10);
      }
    }

    result[name] = cookie;
  }

  return result;
}

describe('POST /api/v1/auth/login, /refresh, /me (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testUserPassword = 'SecurePassword123!';
  let verifiedUserId: string;
  const verifiedUserEmail = `login-verified-${Date.now()}@skyra-tech.com`;

  const unverifiedUserEmail = `login-unverified-${Date.now()}@skyra-tech.com`;
  const suspendedUserEmail = `login-suspended-${Date.now()}@skyra-tech.com`;
  const disabledUserEmail = `login-disabled-${Date.now()}@skyra-tech.com`;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getStorageToken())
      .useValue({
        increment: vi.fn().mockResolvedValue({
          totalHits: 0,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    // Replicate main.ts middleware and setup
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: ['/health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);

    // Hash password using argon2id
    const passwordHash = await argon2.hash(testUserPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // 1. Verified active user
    const user1 = await prisma.user.create({
      data: {
        email: verifiedUserEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    verifiedUserId = user1.id;
    createdUserIds.push(user1.id);

    // 2. Unverified active user
    const user2 = await prisma.user.create({
      data: {
        email: unverifiedUserEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: null,
      },
    });
    createdUserIds.push(user2.id);

    // 3. Suspended user
    const user3 = await prisma.user.create({
      data: {
        email: suspendedUserEmail,
        passwordHash,
        status: 'SUSPENDED',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(user3.id);

    // 4. Disabled user
    const user4 = await prisma.user.create({
      data: {
        email: disabledUserEmail,
        passwordHash,
        status: 'DISABLED',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(user4.id);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await app.close();
  });

  // ── Login Endpoint Tests ──────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('1. successfully authenticates a verified ACTIVE user and sets HttpOnly cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
          rememberMe: false,
        });

      expect(res.status).toBe(200);

      // Verify safe response body
      expect(res.body).toEqual({
        message: 'Login successful.',
        user: {
          id: verifiedUserId,
          email: verifiedUserEmail,
          role: 'AUTHOR',
          status: 'ACTIVE',
          emailVerifiedAt: '2026-10-14T12:00:00.000Z',
        },
      });

      // Confirm credentials NOT exposed in body
      expect(res.body.password).toBeUndefined();
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.token).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();

      // Verify cookies
      const cookies = parseCookies(res.headers['set-cookie']);
      expect(cookies[ACCESS_COOKIE_NAME]).toBeDefined();
      expect(cookies[ACCESS_COOKIE_NAME].httpOnly).toBe(true);
      expect(cookies[ACCESS_COOKIE_NAME].path).toBe('/');
      expect(cookies[ACCESS_COOKIE_NAME].sameSite?.toLowerCase()).toBe('lax');

      expect(cookies[REFRESH_COOKIE_NAME]).toBeDefined();
      expect(cookies[REFRESH_COOKIE_NAME].httpOnly).toBe(true);
      expect(cookies[REFRESH_COOKIE_NAME].path).toBe('/api/v1/auth');
      expect(cookies[REFRESH_COOKIE_NAME].sameSite?.toLowerCase()).toBe('lax');
      // rememberMe: false -> browser-session cookie (no max-age)
      expect(cookies[REFRESH_COOKIE_NAME].maxAge).toBeUndefined();

      // Check PostgreSQL session record
      const session = await prisma.userSession.findFirst({
        where: { userId: verifiedUserId },
        orderBy: { createdAt: 'desc' },
      });
      expect(session).not.toBeNull();
      expect(session?.rememberMe).toBe(false);
      expect(session?.revokedAt).toBeNull();
      expect(session?.refreshTokenHash).toHaveLength(64); // SHA-256 hex
    });

    it('2. sets persistent refresh cookie and 30-day session when rememberMe is true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
          rememberMe: true,
        });

      expect(res.status).toBe(200);

      const cookies = parseCookies(res.headers['set-cookie']);
      expect(cookies[REFRESH_COOKIE_NAME]).toBeDefined();
      // Persistent cookie has max-age ~30 days (2,592,000s)
      expect(cookies[REFRESH_COOKIE_NAME].maxAge).toBeGreaterThan(2500000);

      const session = await prisma.userSession.findFirst({
        where: { userId: verifiedUserId },
        orderBy: { createdAt: 'desc' },
      });
      expect(session?.rememberMe).toBe(true);
      const daysUntilExpiry =
        (session!.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(daysUntilExpiry).toBeGreaterThan(28);
    });

    it('3. rejects incorrect password with generic 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password.');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('4. rejects unknown email with the same generic 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: 'unknown-account@skyra-tech.com',
          password: testUserPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password.');
    });

    it('5. rejects unverified account with 401 Email verification required', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: unverifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Please verify your email address before logging in.');
    });

    it('6. rejects suspended account with 401 Account is not active', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: suspendedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Your account is not active. Please contact support.');
    });

    it('7. rejects disabled account with 401 Account is not active', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: disabledUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Your account is not active. Please contact support.');
    });

    it('8. rejects request with extra non-whitelisted fields (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
          role: 'ADMIN',
        });

      expect(res.status).toBe(400);
    });
  });

  // ── Protected Route & Current User (GET /api/v1/auth/me) ──────────────────

  describe('GET /api/v1/auth/me', () => {
    it('1. returns current user profile when valid access cookie is present', async () => {
      // First login to obtain valid cookies
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      const cookies = parseCookies(loginRes.headers['set-cookie']);
      const accessCookie = `${ACCESS_COOKIE_NAME}=${cookies[ACCESS_COOKIE_NAME].value}`;

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [accessCookie]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: verifiedUserId,
        email: verifiedUserEmail,
        role: 'AUTHOR',
        status: 'ACTIVE',
        emailVerifiedAt: '2026-10-14T12:00:00.000Z',
      });
    });

    it('2. returns 401 Unauthorized when access cookie is missing', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required.');
    });

    it('3. returns 401 Unauthorized when access token has invalid signature', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [`${ACCESS_COOKIE_NAME}=invalid.jwt.token`]);

      expect(res.status).toBe(401);
    });

    it('4. returns 401 Unauthorized when session is revoked in database', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      const cookies = parseCookies(loginRes.headers['set-cookie']);
      const accessCookie = `${ACCESS_COOKIE_NAME}=${cookies[ACCESS_COOKIE_NAME].value}`;

      // Revoke the session in PostgreSQL directly
      await prisma.userSession.updateMany({
        where: { userId: verifiedUserId },
        data: { revokedAt: new Date(), revocationReason: 'TEST_REVOKED' },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [accessCookie]);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Session has expired or was revoked.');
    });

    it('5. rejects requests that supply only an Authorization Bearer header (cookie-only requirement)', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      const cookies = parseCookies(loginRes.headers['set-cookie']);
      const accessToken = cookies[ACCESS_COOKIE_NAME].value;

      // Supply Bearer header with valid token, but omit cookie
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required.');
    });
  });

  // ── Refresh Endpoint Tests (POST /api/v1/auth/refresh) ────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('1. rotates refresh token and issues new access and refresh cookies', async () => {
      // 1. Login
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      const loginCookies = parseCookies(loginRes.headers['set-cookie']);
      const initialRefreshToken = loginCookies[REFRESH_COOKIE_NAME].value;
      const initialRefreshCookie = `${REFRESH_COOKIE_NAME}=${initialRefreshToken}`;

      // 2. Refresh with allowed Origin
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [initialRefreshCookie]);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body).toEqual({
        message: 'Session refreshed successfully.',
      });

      const newCookies = parseCookies(refreshRes.headers['set-cookie']);
      expect(newCookies[ACCESS_COOKIE_NAME]).toBeDefined();
      expect(newCookies[REFRESH_COOKIE_NAME]).toBeDefined();

      const newRefreshToken = newCookies[REFRESH_COOKIE_NAME].value;
      // Confirm token was rotated to a new value
      expect(newRefreshToken).not.toBe(initialRefreshToken);

      // 3. Old refresh token is rejected on subsequent reuse
      const reuseRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [initialRefreshCookie]);

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.message).toBe('Invalid or expired refresh token.');

      // 4. New refresh token succeeds
      const subsequentRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [`${REFRESH_COOKIE_NAME}=${newRefreshToken}`]);

      expect(subsequentRefresh.status).toBe(200);
    });

    it('2. returns 401 when refresh cookie is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:4200');

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication refresh token is required.');
    });

    it('3. handles concurrent refresh requests with single-winner guarantee', async () => {
      // Login
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      const cookies = parseCookies(loginRes.headers['set-cookie']);
      const refreshCookie = `${REFRESH_COOKIE_NAME}=${cookies[REFRESH_COOKIE_NAME].value}`;

      // Launch two concurrent refresh requests presenting the EXACT same refresh token
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Origin', 'http://localhost:4200')
          .set('Cookie', [refreshCookie]),
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Origin', 'http://localhost:4200')
          .set('Cookie', [refreshCookie]),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      // Exactly one succeeds (200), one fails safely (401)
      expect(statuses).toEqual([200, 401]);

      // Confirm winning session was NOT revoked
      const winningRes = resA.status === 200 ? resA : resB;
      const winningCookies = parseCookies(winningRes.headers['set-cookie']);
      const winningAccessToken = winningCookies[ACCESS_COOKIE_NAME].value;

      // The winning session can still access protected resources
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [`${ACCESS_COOKIE_NAME}=${winningAccessToken}`]);

      expect(meRes.status).toBe(200);
      expect(meRes.body.id).toBe(verifiedUserId);
    });
  });

  // ── Origin & CSRF Protection ──────────────────────────────────────────────

  describe('Origin Protection', () => {
    it('1. rejects state-changing requests from untrusted origins with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://malicious-website.com')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Origin not allowed.');
    });

    it('2. accepts state-changing requests from allowed frontend origins', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(200);
    });

    it('3. rejects sensitive state-changing requests when Origin, Sec-Fetch-Site, and Referer are missing without client header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Missing Origin or client identity for state-changing request.');
    });

    it('4. rejects sensitive state-changing requests even if arbitrary client headers like X-Requested-With are supplied', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'curl')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Missing Origin or client identity for state-changing request.');
    });

    it('5. rejects missing-Origin requests when X-Client-Platform or X-API-Client are supplied', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Client-Platform', 'iOS')
        .set('X-API-Client', 'PostmanRuntime')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Missing Origin or client identity for state-changing request.');
    });

    it('6. rejects requests with Sec-Fetch-Site: cross-site and missing or untrusted Origin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Sec-Fetch-Site', 'cross-site')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Cross-site request blocked.');
    });

    it('7. rejects malformed Origin header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'not-a-valid-url')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Malformed Origin header.');
    });

    it('8. rejects contradictory Sec-Fetch-Site and Origin headers', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Host', 'localhost:3000')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Contradictory Origin and Fetch Metadata headers.');
    });

    it('9. rejects refresh mutation when Origin, Sec-Fetch-Site, and Referer are missing', async () => {
      // Obtain valid refresh token
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .send({
          email: verifiedUserEmail,
          password: testUserPassword,
        });

      const cookies = parseCookies(loginRes.headers['set-cookie']);
      const refreshCookie = `${REFRESH_COOKIE_NAME}=${cookies[REFRESH_COOKIE_NAME].value}`;

      // Refresh request without Origin or non-browser client header
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [refreshCookie]);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Missing Origin or client identity for state-changing request.');
    });
  });

  // ── Public Endpoints Exemption ────────────────────────────────────────────

  describe('Public Route Accessibility', () => {
    it('allows GET /health without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
    });

    it('allows GET /api/v1 without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Bachina Labs Academy API');
    });
  });
});
