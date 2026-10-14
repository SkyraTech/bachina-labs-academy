import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * Integration tests for POST /api/v1/auth/register.
 *
 * These tests use the real AppModule with a real PostgreSQL database.
 * All test users are deleted in afterAll so the development database
 * is not polluted with test records.
 *
 * Coverage:
 *   1.  201 Created on valid registration
 *   2.  Default AUTHOR role in response
 *   3.  emailVerifiedAt is null
 *   4.  id is a valid UUID format
 *   5.  passwordHash NOT in response
 *   6.  400 on invalid email format
 *   7.  400 on email exceeding 254 characters
 *   8.  400 on password shorter than 12 characters
 *   9.  400 on password longer than 128 characters
 *   10. 400 on missing email field
 *   11. 400 on missing password field
 *   12. 400 on unexpected extra field (role, id, status, emailVerifiedAt)
 *   13. 409 Conflict on duplicate email (exact match)
 *   14. 409 Conflict on duplicate email (case-insensitive)
 *   15. Concurrent duplicate registration (one 201, one 409)
 *   16. Response does not expose stack traces or database details
 *   17. 429 after exceeding throttle limit
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEST_EMAIL_BASE = `register-e2e-${Date.now()}`;
const testEmails: string[] = [];

function uniqueEmail(): string {
  const email = `${TEST_EMAIL_BASE}-${testEmails.length}@example.com`;
  testEmails.push(email);
  return email;
}

describe('POST /api/v1/auth/register (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Override ThrottlerStorage for functional test suite so standard tests
    // aren't rate limited. Rate limiting is tested specifically below.
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
  });

  afterAll(async () => {
    // Clean up all test records — never leave test data in the dev DB
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: testEmails } },
      });
    }
    await app.close();
  });

  // ── Successful registration ───────────────────────────────────────────────

  describe('successful registration', () => {
    it('returns 201 with a safe user object', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body.email).toBe(email);
      expect(res.body.role).toBe('AUTHOR');
      expect(res.body.status).toBe('ACTIVE');
    });

    it('assigns a database-generated UUID as the id', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
    });

    it('sets emailVerifiedAt to null', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body.emailVerifiedAt).toBeNull();
    });

    it('does NOT include passwordHash in the response', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body).not.toHaveProperty('password');
    });

    it('normalizes email to lowercase', async () => {
      const lowerEmail = uniqueEmail();
      const upperInput = lowerEmail.toUpperCase();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: upperInput, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body.email).toBe(lowerEmail);
    });

    it('includes createdAt and updatedAt timestamps', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');
    });
  });

  // ── Validation errors ─────────────────────────────────────────────────────

  describe('validation errors', () => {
    it('returns 400 for an invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'correct-horse-battery-staple' })
        .expect(400);
    });

    it('returns 400 for email exceeding 254 characters', async () => {
      const longEmail = `${'a'.repeat(250)}@example.com`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: longEmail, password: 'correct-horse-battery-staple' })
        .expect(400);
    });

    it('returns 400 for password shorter than 12 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(), password: 'short' })
        .expect(400);
    });

    it('returns 400 for password longer than 128 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(), password: 'a'.repeat(129) })
        .expect(400);
    });

    it('returns 400 when email is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ password: 'correct-horse-battery-staple' })
        .expect(400);
    });

    it('returns 400 when password is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail() })
        .expect(400);
    });

    it('returns 400 when unexpected field "role" is supplied', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'correct-horse-battery-staple',
          role: 'ADMIN',
        })
        .expect(400);
    });

    it('returns 400 when unexpected field "id" is supplied', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'correct-horse-battery-staple',
          id: 'some-injected-id',
        })
        .expect(400);
    });

    it('returns 400 when unexpected field "status" is supplied', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'correct-horse-battery-staple',
          status: 'ADMIN',
        })
        .expect(400);
    });

    it('returns 400 when "emailVerifiedAt" is supplied', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'correct-horse-battery-staple',
          emailVerifiedAt: new Date().toISOString(),
        })
        .expect(400);
    });
  });

  // ── Duplicate email ───────────────────────────────────────────────────────

  describe('duplicate email', () => {
    it('returns 409 on exact duplicate email', async () => {
      const email = uniqueEmail();

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'another-valid-password-here' })
        .expect(409);
    });

    it('returns 409 on case-insensitive duplicate email', async () => {
      const lowerEmail = uniqueEmail();

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: lowerEmail, password: 'correct-horse-battery-staple' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: lowerEmail.toUpperCase(), password: 'another-valid-password-here' })
        .expect(409);
    });

    it('handles concurrent duplicate registrations safely (one succeeds, one gets 409)', async () => {
      const email = uniqueEmail();
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email, password: 'correct-horse-battery-staple' }),
        request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email, password: 'correct-horse-battery-staple' }),
      ]);

      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);
    });

    it('409 response does not expose Prisma or database details', async () => {
      const email = uniqueEmail();

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'another-valid-password-here' })
        .expect(409);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Prisma');
      expect(body).not.toContain('P2002');
      expect(body).not.toContain('constraint');
      expect(body).not.toContain('stack');
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    let rateLimitApp: INestApplication<App>;

    beforeAll(async () => {
      // Create a fresh app instance WITHOUT overriding ThrottlerGuard
      const fixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      rateLimitApp = fixture.createNestApplication();
      rateLimitApp.setGlobalPrefix('api/v1', { exclude: ['/health'] });
      rateLimitApp.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: false },
        }),
      );
      await rateLimitApp.init();
    });

    afterAll(async () => {
      await rateLimitApp.close();
    });

    it('returns 429 Too Many Requests after exceeding throttle limit (10 requests)', async () => {
      // Send 10 requests to reach the limit
      for (let i = 0; i < 10; i++) {
        const email = uniqueEmail();
        await request(rateLimitApp.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email, password: 'correct-horse-battery-staple' });
      }

      // The 11th request must receive 429
      const res = await request(rateLimitApp.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(), password: 'correct-horse-battery-staple' })
        .expect(429);

      expect(res.status).toBe(429);
      expect(JSON.stringify(res.body)).toContain('ThrottlerException');
    });
  });
});
