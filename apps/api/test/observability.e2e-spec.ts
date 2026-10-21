import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { StructuredLoggerService, EcsLogEntry } from '../src/common/observability/structured-logger.service';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../src/modules/auth/services/cookie.service';

describe('Observability & Request Correlation (e2e)', () => {
  let app: INestApplication<App>;
  let capturedLogs: EcsLogEntry[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(app.get(StructuredLoggerService));
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: ['/health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    capturedLogs = [];
    StructuredLoggerService.setLogSink((entry) => {
      capturedLogs.push(entry);
    });
  });

  afterAll(async () => {
    StructuredLoggerService.setLogSink(undefined);
    if (app) {
      await app.close();
    }
  });

  it('returns X-Request-ID response header on standard requests', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('accepts and echoes a valid upstream X-Request-ID', async () => {
    const upstreamId = 'gateway-trace-req-888';
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', upstreamId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(upstreamId);
  });

  it('replaces malicious or invalid upstream X-Request-ID with a server-generated UUID', async () => {
    const maliciousId = 'invalid<script>id;' + 'a'.repeat(80);
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', maliciousId)
      .expect(200);

    const returnedId = res.headers['x-request-id'];
    expect(returnedId).not.toBe(maliciousId);
    expect(returnedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('includes X-Request-ID in 404 Not Found error responses and logs exactly one completion event', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/non-existent-route').expect(404);

    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.body.statusCode).toBe(404);

    const httpLogs = capturedLogs.filter((l) => l.event?.action === 'http.request');
    expect(httpLogs).toHaveLength(1);
    expect(httpLogs[0].http?.response?.status_code).toBe(404);
    expect(httpLogs[0].event?.outcome).toBe('failure');
  });

  it('assigns unique request IDs to concurrent requests', async () => {
    const reqs = Array.from({ length: 10 }, () =>
      request(app.getHttpServer()).get('/health'),
    );

    const responses = await Promise.all(reqs);
    const requestIds = responses.map((r) => r.headers['x-request-id']);

    responses.forEach((r) => expect(r.status).toBe(200));

    const uniqueIds = new Set(requestIds);
    expect(uniqueIds.size).toBe(10);
  });

  it('emits exactly one completion event on guard rejection (401 Unauthorized)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .expect(401);

    expect(res.headers['x-request-id']).toBeDefined();

    const httpLogs = capturedLogs.filter((l) => l.event?.action === 'http.request');
    expect(httpLogs).toHaveLength(1);
    expect(httpLogs[0].http?.response?.status_code).toBe(401);
    expect(httpLogs[0].event?.outcome).toBe('failure');
    expect(httpLogs[0]['log.level']).toBe('warn');
  });

  it('emits exactly one completion event on DTO validation failure (400 Bad Request)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);

    expect(res.headers['x-request-id']).toBeDefined();

    const httpLogs = capturedLogs.filter((l) => l.event?.action === 'http.request');
    expect(httpLogs).toHaveLength(1);
    expect(httpLogs[0].http?.response?.status_code).toBe(400);
    expect(httpLogs[0].event?.outcome).toBe('failure');
  });

  it('emits exactly one completion event on OriginGuard rejection (403 Forbidden)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://malicious-attacker.com')
      .send({ email: 'test@example.com', password: 'Password123!' })
      .expect(403);

    expect(res.headers['x-request-id']).toBeDefined();

    const httpLogs = capturedLogs.filter((l) => l.event?.action === 'http.request');
    expect(httpLogs).toHaveLength(1);
    expect(httpLogs[0].http?.response?.status_code).toBe(403);
    expect(httpLogs[0].event?.outcome).toBe('failure');

    const originRejectedLogs = capturedLogs.filter(
      (l) => l.event?.action === 'security.origin_rejected',
    );
    expect(originRejectedLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('verifies authentication cookies match academy_access and academy_refresh contract', async () => {
    expect(ACCESS_COOKIE_NAME).toBe('academy_access');
    expect(REFRESH_COOKIE_NAME).toBe('academy_refresh');
  });

  it('ensures canary sensitive values are redacted and never appear in captured logs', async () => {
    const canaryPassword = 'CANARY_SENSITIVE_PASSWORD_999!';
    const canaryToken = 'CANARY_VERIFICATION_TOKEN_888';

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: 'test@example.com', password: canaryPassword })
      .expect(401);

    const serializedLogs = JSON.stringify(capturedLogs);
    expect(serializedLogs).not.toContain(canaryPassword);
    expect(serializedLogs).not.toContain(canaryToken);
  });
});
