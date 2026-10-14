import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Roles } from '../src/common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import { Public } from '../src/modules/auth/decorators/public.decorator.js';
import { CurrentUser } from '../src/modules/auth/decorators/current-user.decorator.js';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/services/cookie.service.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

// ── Test-only Fixture Controllers ─────────────────────────────────────────────

@Controller('test-authorization')
class TestAuthorizationController {
  @Get('no-roles')
  getNoRoles(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, user: { id: user.id, role: user.role } };
  }

  @Roles(UserRole.AUTHOR)
  @Get('author-only')
  getAuthorOnly(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, user: { id: user.id, role: user.role } };
  }

  @Roles(UserRole.ADMIN)
  @Get('admin-only')
  getAdminOnly(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, user: { id: user.id, role: user.role } };
  }

  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @Get('multi-roles')
  getMultiRoles(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, user: { id: user.id, role: user.role } };
  }

  @Public()
  @Get('public-endpoint')
  getPublic() {
    return { ok: true, public: true };
  }

  @Public()
  @Roles(UserRole.ADMIN)
  @Get('contradictory')
  getContradictory() {
    return { ok: true };
  }

  @UseGuards(VerifiedEmailGuard)
  @Get('verified-email-required')
  getVerifiedEmailRequired(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, emailVerifiedAt: user.emailVerifiedAt };
  }
}

@Roles(UserRole.AUTHOR)
@Controller('test-controller-roles')
class TestControllerRolesController {
  @Get('default-inherited')
  getDefaultInherited(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, user: { id: user.id, role: user.role } };
  }

  @Roles(UserRole.ADMIN)
  @Get('handler-override-admin')
  getHandlerOverrideAdmin(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, user: { id: user.id, role: user.role } };
  }
}

// ── E2E Test Suite ────────────────────────────────────────────────────────────

describe('Centralized Authorization, RBAC and Security Policies (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testPassword = 'Password123!Secure';
  const authorEmail = `author-rbac-${Date.now()}@skyra-tech.com`;
  const adminEmail = `admin-rbac-${Date.now()}@skyra-tech.com`;
  const suspendedEmail = `suspended-rbac-${Date.now()}@skyra-tech.com`;
  const disabledEmail = `disabled-rbac-${Date.now()}@skyra-tech.com`;
  const unverifiedEmail = `unverified-rbac-${Date.now()}@skyra-tech.com`;

  let authorCookie: string;
  let adminCookie: string;
  let suspendedCookie: string;
  let disabledCookie: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestAuthorizationController, TestControllerRolesController],
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

    const passwordHash = await argon2.hash(testPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // 1. Author User (ACTIVE, email verified, role AUTHOR)
    const authorUser = await prisma.user.create({
      data: {
        email: authorEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(authorUser.id);

    // 2. Admin User (ACTIVE, email verified, role ADMIN)
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'ADMIN',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(adminUser.id);

    // 3. Suspended User (initially active for login, then suspended)
    const suspendedUser = await prisma.user.create({
      data: {
        email: suspendedEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(suspendedUser.id);

    // 4. Disabled User (initially active for login, then disabled)
    const disabledUser = await prisma.user.create({
      data: {
        email: disabledEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
    createdUserIds.push(disabledUser.id);

    // 5. Unverified User
    const unverifiedUser = await prisma.user.create({
      data: {
        email: unverifiedEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: null,
      },
    });
    createdUserIds.push(unverifiedUser.id);

    // Log in AUTHOR to obtain real cookie
    const authorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: authorEmail, password: testPassword });
    const authorCookies = authorLogin.headers['set-cookie'] as unknown as string[];
    authorCookie = authorCookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))?.split(';')[0] ?? '';

    // Log in ADMIN to obtain real cookie
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: adminEmail, password: testPassword });
    const adminCookies = adminLogin.headers['set-cookie'] as unknown as string[];
    adminCookie = adminCookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))?.split(';')[0] ?? '';

    // Log in SUSPENDED user while active, then update DB status to SUSPENDED
    const suspendedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: suspendedEmail, password: testPassword });
    const suspendedCookies = suspendedLogin.headers['set-cookie'] as unknown as string[];
    suspendedCookie = suspendedCookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))?.split(';')[0] ?? '';
    await prisma.user.update({
      where: { id: suspendedUser.id },
      data: { status: 'SUSPENDED' },
    });

    // Log in DISABLED user while active, then update DB status to DISABLED
    const disabledLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: disabledEmail, password: testPassword });
    const disabledCookies = disabledLogin.headers['set-cookie'] as unknown as string[];
    disabledCookie = disabledCookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))?.split(';')[0] ?? '';
    await prisma.user.update({
      where: { id: disabledUser.id },
      data: { status: 'DISABLED' },
    });
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

  // ── 1. No role metadata ─────────────────────────────────────────────────────

  it('1. permits authenticated AUTHOR when no role metadata exists', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/no-roles')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe('AUTHOR');
  });

  it('1b. permits authenticated ADMIN when no role metadata exists', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/no-roles')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('1c. rejects unauthenticated caller with 401 when no role metadata exists', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/test-authorization/no-roles',
    );

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Authentication required.');
  });

  // ── 2. AUTHOR on AUTHOR route ───────────────────────────────────────────────

  it('2. permits AUTHOR on route requiring AUTHOR role', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/author-only')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe('AUTHOR');
  });

  // ── 3. ADMIN on ADMIN route ─────────────────────────────────────────────────

  it('3. permits ADMIN on route requiring ADMIN role', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/admin-only')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe('ADMIN');
  });

  // ── 4. AUTHOR denied on ADMIN route ─────────────────────────────────────────

  it('4. denies AUTHOR on route requiring ADMIN role with 403 Forbidden', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/admin-only')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions.');
  });

  // ── 5. ADMIN denied on AUTHOR-only route ────────────────────────────────────

  it('5. denies ADMIN on AUTHOR-only route when ADMIN is not explicitly included', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/author-only')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions.');
  });

  // ── 6. Multiple permitted roles ─────────────────────────────────────────────

  it('6a. permits AUTHOR on route with @Roles(AUTHOR, ADMIN)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/multi-roles')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('6b. permits ADMIN on route with @Roles(AUTHOR, ADMIN)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/multi-roles')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ── 7. Missing authenticated-user context ───────────────────────────────────

  it('7. rejects unauthenticated caller on role-protected route with 401 from JwtAccessGuard', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/test-authorization/admin-only',
    );

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Authentication required.');
  });

  // ── 8. Controller-level role metadata ───────────────────────────────────────

  it('8a. permits AUTHOR on controller guarded by @Roles(AUTHOR)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-controller-roles/default-inherited')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('8b. denies ADMIN on controller guarded by @Roles(AUTHOR) with 403 Forbidden', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-controller-roles/default-inherited')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions.');
  });

  // ── 9. Handler-level metadata overrides controller-level ────────────────────

  it('9a. permits ADMIN on handler override @Roles(ADMIN) despite controller @Roles(AUTHOR)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-controller-roles/handler-override-admin')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('9b. denies AUTHOR on handler override @Roles(ADMIN) despite controller @Roles(AUTHOR)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-controller-roles/handler-override-admin')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions.');
  });

  // ── 10. Deliberately public routes remain accessible ────────────────────────

  it('10. permits unauthenticated caller on @Public() endpoint', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/test-authorization/public-endpoint',
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.public).toBe(true);
  });

  // ── 11. Contradictory @Public() and @Roles() metadata fails-closed ──────────

  it('11. rejects contradictory @Public() and @Roles(...) route with 403 Forbidden', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/test-authorization/contradictory',
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Invalid route configuration: @Public() cannot be combined with role restrictions.',
    );
  });

  it('11b. rejects contradictory route even when called by authenticated ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/contradictory')
      .set('Cookie', [adminCookie]);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Invalid route configuration: @Public() cannot be combined with role restrictions.',
    );
  });

  // ── 12. Account Status Policies (SUSPENDED & DISABLED) ──────────────────────

  it('12a. denies SUSPENDED account access to protected routes despite valid JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/no-roles')
      .set('Cookie', [suspendedCookie]);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Account is not active.');
  });

  it('12b. denies DISABLED account access to protected routes despite valid JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/no-roles')
      .set('Cookie', [disabledCookie]);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Account is not active.');
  });

  // ── 13. Email Verification Policy ───────────────────────────────────────────

  it('13a. permits verified user on route with VerifiedEmailGuard', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/verified-email-required')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.emailVerifiedAt).toBeDefined();
  });

  it('13b. prevents unverified user from logging in or receiving valid session', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: unverifiedEmail, password: testPassword });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body.message).toBe('Please verify your email address before logging in.');
  });

  // ── 14. Privilege Escalation Prevention ─────────────────────────────────────

  it('14. ignores client-provided role fields in query params or body', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-authorization/admin-only?role=ADMIN')
      .set('Cookie', [authorCookie]);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions.');
  });

  // ── 15. Preserves existing auth endpoints ───────────────────────────────────

  it('15a. keeps POST /api/v1/auth/login accessible without role restrictions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: authorEmail, password: testPassword });

    expect(res.status).toBe(200);
  });

  it('15b. keeps GET /health accessible as a public endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
