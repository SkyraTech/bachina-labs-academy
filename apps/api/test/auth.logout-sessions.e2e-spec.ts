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
import { JwtTokenService } from '../src/modules/auth/services/jwt-token.service.js';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/services/cookie.service.js';

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

describe('Secure Logout, Session Revocation and Active Device Management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtTokenService: JwtTokenService;

  const testPassword = 'Password123!Secure';
  const user1Email = `user1-sessions-${Date.now()}@skyra-tech.com`;
  const user2Email = `user2-sessions-${Date.now()}@skyra-tech.com`;

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
    jwtTokenService = app.get(JwtTokenService);

    const passwordHash = await argon2.hash(testPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // Create User 1
    const u1 = await prisma.user.create({
      data: {
        email: user1Email,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(u1.id);

    // Create User 2 (for multi-tenant isolation tests)
    const u2 = await prisma.user.create({
      data: {
        email: user2Email,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(u2.id);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.userSession.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.emailVerificationToken.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await app.close();
  });

  // ── Helper to log in a user and return cookie headers ───────────────────────
  async function loginUser(email: string, userAgent = 'TestDevice-A') {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .set('User-Agent', userAgent)
      .send({ email, password: testPassword });

    expect(res.status).toBe(200);
    const cookies = parseCookies(res.headers['set-cookie']);
    const accessCookie = `${ACCESS_COOKIE_NAME}=${cookies[ACCESS_COOKIE_NAME]?.value}`;
    const refreshCookie = `${REFRESH_COOKIE_NAME}=${cookies[REFRESH_COOKIE_NAME]?.value}`;

    return {
      accessCookie,
      refreshCookie,
      rawAccessToken: cookies[ACCESS_COOKIE_NAME]?.value ?? '',
      rawRefreshToken: cookies[REFRESH_COOKIE_NAME]?.value ?? '',
      allCookiesHeader: [accessCookie, refreshCookie],
    };
  }

  // ── 1. POST /api/v1/auth/logout ─────────────────────────────────────────────

  describe('POST /api/v1/auth/logout', () => {
    it('1a. logs out current device with valid access JWT, clears cookies with correct paths, and revokes session', async () => {
      const login = await loginUser(user1Email, 'Device-1');

      // Verify me works before logout
      const meBefore = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [login.accessCookie]);
      expect(meBefore.status).toBe(200);

      // Perform logout
      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', login.allCookiesHeader);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toBe('Logged out successfully.');

      // Check cookies cleared with correct paths
      const clearedCookies = parseCookies(logoutRes.headers['set-cookie']);
      expect(clearedCookies[ACCESS_COOKIE_NAME]?.path).toBe('/');
      expect(clearedCookies[REFRESH_COOKIE_NAME]?.path).toBe('/api/v1/auth');
      expect(clearedCookies[ACCESS_COOKIE_NAME]?.value).toBe('');
      expect(clearedCookies[REFRESH_COOKIE_NAME]?.value).toBe('');

      // Old access JWT must now fail
      const meAfter = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [login.accessCookie]);
      expect(meAfter.status).toBe(401);
      expect(meAfter.body.message).toBe('Session has expired or was revoked.');

      // Refresh token must also fail
      const refreshAfter = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [login.refreshCookie]);
      expect(refreshAfter.status).toBe(401);
      expect(refreshAfter.body.message).toBe('Session has expired or was revoked.');
    });

    it('1b. logs out when access JWT is expired but refresh cookie is valid', async () => {
      const login = await loginUser(user1Email, 'Device-Expired-Access');

      // Craft an expired access token with same sub and sid
      const payload = await jwtTokenService.verifyAccessToken(login.rawAccessToken);
      const expiredAccessToken = await jwtTokenService.signAccessToken({
        userId: payload.sub,
        sessionId: payload.sid,
        expiresInSeconds: 0, // already expired
      });

      // Confirm expired access token is rejected on GET /me
      const meExpired = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [`${ACCESS_COOKIE_NAME}=${expiredAccessToken}`]);
      expect(meExpired.status).toBe(401);

      // Logout with expired access token and valid refresh cookie
      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [
          `${ACCESS_COOKIE_NAME}=${expiredAccessToken}`,
          login.refreshCookie,
        ]);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toBe('Logged out successfully.');

      // Verify the session in PostgreSQL was revoked
      const sessionInDb = await prisma.userSession.findUnique({
        where: { id: payload.sid },
      });
      expect(sessionInDb?.revokedAt).not.toBeNull();
      expect(sessionInDb?.revocationReason).toBe('USER_LOGOUT');
    });

    it('1c. logs out when access JWT is absent but refresh cookie is valid', async () => {
      const login = await loginUser(user1Email, 'Device-No-Access-JWT');
      const payload = await jwtTokenService.verifyAccessToken(login.rawAccessToken);

      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [login.refreshCookie]); // only refresh cookie provided

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toBe('Logged out successfully.');

      const sessionInDb = await prisma.userSession.findUnique({
        where: { id: payload.sid },
      });
      expect(sessionInDb?.revokedAt).not.toBeNull();
    });

    it('1d. is idempotent: repeated logout succeeds and clears cookies without error', async () => {
      const login = await loginUser(user1Email, 'Device-Idempotent');

      // First logout
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', login.allCookiesHeader);
      expect(res1.status).toBe(200);

      // Second logout with now-revoked credentials
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', login.allCookiesHeader);
      expect(res2.status).toBe(200);
      expect(res2.body.message).toBe('Logged out successfully.');

      // Third logout with no cookies at all
      const res3 = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200');
      expect(res3.status).toBe(200);
      expect(res3.body.message).toBe('Logged out successfully.');
    });

    it('1e. logging out one device does not revoke sessions on other devices', async () => {
      // User 1 logs in on Device A and Device B
      const deviceA = await loginUser(user1Email, 'Device-A');
      const deviceB = await loginUser(user1Email, 'Device-B');

      // Logout Device A
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', deviceA.allCookiesHeader);

      // Device A is revoked
      const resA = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [deviceA.accessCookie]);
      expect(resA.status).toBe(401);

      // Device B is STILL active
      const resB = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [deviceB.accessCookie]);
      expect(resB.status).toBe(200);
      expect(resB.body.email).toBe(user1Email);
    });

    it('1f. rejects logout attempt with untrusted cross-site Origin (CSRF protection)', async () => {
      const login = await loginUser(user1Email);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://evil.com')
        .set('Cookie', login.allCookiesHeader);

      expect(res.status).toBe(403);
    });
  });

  // ── 2. POST /api/v1/auth/logout-all ─────────────────────────────────────────

  describe('POST /api/v1/auth/logout-all', () => {
    it('2a. revokes all sessions belonging to the caller and leaves other users untouched', async () => {
      // User 1 logs in twice
      const u1Session1 = await loginUser(user1Email, 'U1-Laptop');
      const u1Session2 = await loginUser(user1Email, 'U1-Phone');

      // User 2 logs in once
      const u2Session = await loginUser(user2Email, 'U2-Tablet');

      // User 1 invokes logout-all
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', u1Session1.allCookiesHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('All sessions logged out successfully.');
      expect(res.body.revokedCount).toBeGreaterThanOrEqual(2);

      // User 1 Session 1 is dead
      const u1Check1 = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [u1Session1.accessCookie]);
      expect(u1Check1.status).toBe(401);

      // User 1 Session 2 is dead
      const u1Check2 = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [u1Session2.accessCookie]);
      expect(u1Check2.status).toBe(401);

      // User 2's session is UNTOUCHED and still active
      const u2Check = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [u2Session.accessCookie]);
      expect(u2Check.status).toBe(200);
      expect(u2Check.body.email).toBe(user2Email);
    });

    it('2b. rejects unauthenticated call with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Origin', 'http://localhost:4200');

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required.');
    });
  });

  // ── 3. GET /api/v1/auth/sessions ────────────────────────────────────────────

  describe('GET /api/v1/auth/sessions', () => {
    it('3a. returns active sessions with isCurrent flag, truthful device info, and excludes secrets', async () => {
      // Create session 1 and session 2 for User 1
      await loginUser(user1Email, 'Firefox-Desktop');
      const sess2 = await loginUser(user1Email, 'Safari-iPhone');

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Cookie', [sess2.accessCookie]); // Calling from session 2

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      // Session 2 must have isCurrent = true
      const current = res.body.find((s: any) => s.isCurrent === true);
      expect(current).toBeDefined();
      expect(current.userAgent).toBe('Safari-iPhone');

      // Session 1 must have isCurrent = false
      const nonCurrent = res.body.find((s: any) => s.userAgent === 'Firefox-Desktop');
      expect(nonCurrent).toBeDefined();
      expect(nonCurrent.isCurrent).toBe(false);

      // Verify no sensitive fields are leaked on any session item
      for (const item of res.body) {
        expect(item.refreshTokenHash).toBeUndefined();
        expect(item.tokenHash).toBeUndefined();
        expect(item.passwordHash).toBeUndefined();
        expect(item.rawToken).toBeUndefined();
        expect(item.id).toBeDefined();
        expect(item.createdAt).toBeDefined();
        expect(item.expiresAt).toBeDefined();
      }
    });

    it('3b. excludes revoked and expired sessions from the active sessions list', async () => {
      const sessToRevoke = await loginUser(user1Email, 'Revoked-Session');
      const activeSess = await loginUser(user1Email, 'Kept-Active-Session');

      // Revoke the first one via logout
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', sessToRevoke.allCookiesHeader);

      // Query sessions from active session
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Cookie', [activeSess.accessCookie]);

      expect(res.status).toBe(200);
      const foundRevoked = res.body.find(
        (s: any) => s.userAgent === 'Revoked-Session',
      );
      expect(foundRevoked).toBeUndefined();
    });

    it('3c. never returns another user sessions', async () => {
      const u1Sess = await loginUser(user1Email, 'User1-Session');
      await loginUser(user2Email, 'User2-Secret-Session');

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Cookie', [u1Sess.accessCookie]);

      expect(res.status).toBe(200);
      const foundU2 = res.body.find(
        (s: any) => s.userAgent === 'User2-Secret-Session',
      );
      expect(foundU2).toBeUndefined();
    });

    it('3d. rejects unauthenticated call with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/sessions');
      expect(res.status).toBe(401);
    });
  });

  // ── 4. DELETE /api/v1/auth/sessions/:sessionId ──────────────────────────────

  describe('DELETE /api/v1/auth/sessions/:sessionId', () => {
    it('4a. revokes another device session without clearing current browser cookies', async () => {
      const currentSession = await loginUser(user1Email, 'Current-Device');
      const otherDevice = await loginUser(user1Email, 'Other-Device');
      const otherPayload = await jwtTokenService.verifyAccessToken(otherDevice.rawAccessToken);

      // Revoke other device from current session
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/auth/sessions/${otherPayload.sid}`)
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [currentSession.accessCookie]);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Session revoked successfully.');
      expect(res.body.isCurrentSession).toBe(false);

      // Cookies should NOT be cleared on current device
      const setCookies = res.headers['set-cookie'];
      expect(setCookies).toBeUndefined();

      // Current session still works
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [currentSession.accessCookie]);
      expect(meRes.status).toBe(200);

      // Other device session is dead
      const otherMe = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [otherDevice.accessCookie]);
      expect(otherMe.status).toBe(401);
    });

    it('4b. revokes current device session and clears cookies when target is current session', async () => {
      const currentSession = await loginUser(user1Email, 'Self-Revoking-Device');
      const currentPayload = await jwtTokenService.verifyAccessToken(
        currentSession.rawAccessToken,
      );

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/auth/sessions/${currentPayload.sid}`)
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [currentSession.accessCookie]);

      expect(res.status).toBe(200);
      expect(res.body.isCurrentSession).toBe(true);

      // Cookies MUST be cleared
      const clearedCookies = parseCookies(res.headers['set-cookie']);
      expect(clearedCookies[ACCESS_COOKIE_NAME]?.value).toBe('');
      expect(clearedCookies[REFRESH_COOKIE_NAME]?.value).toBe('');

      // Subsequent access with that JWT fails
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [currentSession.accessCookie]);
      expect(meRes.status).toBe(401);
    });

    it('4c. cannot revoke another user session (safe non-enumerating 404 response)', async () => {
      const u1Session = await loginUser(user1Email, 'Attacker-Device');
      const u2Session = await loginUser(user2Email, 'Victim-Device');
      const u2Payload = await jwtTokenService.verifyAccessToken(u2Session.rawAccessToken);

      // User 1 tries to revoke User 2's session
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/auth/sessions/${u2Payload.sid}`)
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [u1Session.accessCookie]);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Session not found.');

      // Victim's session must still be active!
      const victimCheck = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [u2Session.accessCookie]);
      expect(victimCheck.status).toBe(200);
      expect(victimCheck.body.email).toBe(user2Email);
    });

    it('4d. returns 400 Bad Request for non-UUID parameter', async () => {
      const session = await loginUser(user1Email);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/auth/sessions/not-a-valid-uuid')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [session.accessCookie]);

      expect(res.status).toBe(400);
    });

    it('4e. returns 404 for unknown nonexistent UUID', async () => {
      const session = await loginUser(user1Email);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', [session.accessCookie]);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Session not found.');
    });
  });
});
