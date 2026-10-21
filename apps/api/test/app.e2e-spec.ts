import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET) - Root info', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect((res: { body: { name: string; version: string } }) => {
        expect(res.body.name).toBe('Bachina Labs Academy API');
        expect(res.body.version).toBe('1.0.0');
      });
  });

  it('/health (GET) - Liveness probe', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res: { body: { status: string; uptime: number; timestamp: string } }) => {
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.uptime).toBe('number');
        expect(res.body).toHaveProperty('timestamp');
      });
  });

  it('/health/database (GET) - Database readiness probe', () => {
    return request(app.getHttpServer())
      .get('/health/database')
      .expect(200)
      .expect((res: { body: { status: string; database: string; timestamp: string } }) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.database).toBe('connected');
        expect(res.body).toHaveProperty('timestamp');
      });
  });

  it('/health (GET) - Repeated polling is exempt from rate limits (>10 requests)', async () => {
    // Default throttler limit is 10 req/min. Send 15 consecutive requests.
    for (let i = 0; i < 15; i++) {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    }
  });

  it('/health/database (GET) - Repeated readiness polling is exempt from rate limits (>10 requests)', async () => {
    for (let i = 0; i < 15; i++) {
      const res = await request(app.getHttpServer()).get('/health/database');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    }
  });
});
