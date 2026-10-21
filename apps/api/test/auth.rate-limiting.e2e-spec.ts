import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthAbuseService } from '../src/modules/auth/services/auth-abuse.service';
import { PasswordHashingService } from '../src/modules/auth/services/password-hashing.service';

describe('Auth Rate Limiting & Abuse Detection (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let authAbuseService: AuthAbuseService;
  let passwordHashingService: PasswordHashingService;

  const testUserEmail = `abuse-test-${Date.now()}@skyra-tech.com`;
  const testPassword = 'Password123!Secure';
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: ['/health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    // Enable trust proxy so we can test multi-IP abuse and per-account abuse controls
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();

    prisma = app.get(PrismaService);
    authAbuseService = app.get(AuthAbuseService);
    passwordHashingService = app.get(PasswordHashingService);

    // Create a verified active user for login testing
    const passwordHash = await passwordHashingService.hash(testPassword);
    const user = await prisma.user.create({
      data: {
        email: testUserEmail,
        passwordHash,
        status: 'ACTIVE',
        role: 'AUTHOR',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /api/v1/auth/resend-verification Rate Limiting', () => {
    it('returns 429 Too Many Requests after 3 resend attempts in window', async () => {
      const email = `resend-throttle-${Date.now()}@example.com`;
      const clientIp = '198.51.100.44';

      // 3 allowed attempts from this IP
      for (let i = 0; i < 3; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/resend-verification')
          .set('X-Forwarded-For', clientIp)
          .send({ email });
        expect(res.status).toBe(202);
      }

      // 4th attempt must be throttled with 429
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .set('X-Forwarded-For', clientIp)
        .send({ email });

      expect(res.status).toBe(429);
      expect(res.body.message).toMatch(/Too Many Requests|ThrottlerException/i);
    });
  });

  describe('Failed Login Abuse Protection (AuthAbuseService)', () => {
    it('blocks repeated failed login attempts on an account digest across multiple IPs after 5 failures', async () => {
      const targetEmail = `brute-force-${Date.now()}@example.com`;

      // 4 failed attempts from 4 different IPs (simulating credential stuffing)
      for (let i = 1; i <= 4; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', 'http://localhost:4200')
          .set('X-Forwarded-For', `203.0.113.${i}`)
          .send({ email: targetEmail, password: 'WrongPassword!' });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid email or password.');
      }

      // 5th attempt from a 5th IP still fails with 401 and trips the account digest threshold
      const fifthRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .set('X-Forwarded-For', '203.0.113.5')
        .send({ email: targetEmail, password: 'WrongPassword!' });
      expect(fifthRes.status).toBe(401);

      // 6th attempt from a completely fresh 6th IP (which has 0 per-IP throttle count)
      // is blocked on the target account digest with HTTP 429
      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .set('X-Forwarded-For', '203.0.113.6')
        .send({ email: targetEmail, password: 'WrongPassword!' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toMatch(/Too many failed login attempts/i);
    });

    it('successful login resets failure counters and does not trigger abuse lockout', async () => {
      authAbuseService.resetAll();
      const freshIp = '203.0.113.77';

      // 2 failed attempts
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', 'http://localhost:4200')
          .set('X-Forwarded-For', freshIp)
          .send({ email: testUserEmail, password: 'WrongPassword!' });
      }

      // 1 successful login
      const successRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:4200')
        .set('X-Forwarded-For', freshIp)
        .send({ email: testUserEmail, password: testPassword });

      expect(successRes.status).toBe(200);
      expect(successRes.body.message).toBe('Login successful.');

      // Check that failure counter was reset
      const check = authAbuseService.checkLoginAllowed(freshIp, testUserEmail);
      expect(check.blocked).toBe(false);
    });
  });
});
