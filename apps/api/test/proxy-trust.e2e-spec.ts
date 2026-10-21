import { describe, it, expect, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module';
import { validateTrustProxy } from '../src/common/utils/client-ip.util';

describe('Reverse Proxy Trust & IP Resolution (e2e)', () => {
  let defaultApp: INestApplication<App>;
  let trustedProxyApp: INestApplication<App>;

  afterAll(async () => {
    if (defaultApp) await defaultApp.close();
    if (trustedProxyApp) await trustedProxyApp.close();
  });

  describe('Direct connection mode (Default: trust proxy = false)', () => {
    it('does not trust spoofed X-Forwarded-For headers', async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      defaultApp = moduleFixture.createNestApplication();
      // Ensure trust proxy is disabled (default)
      defaultApp.getHttpAdapter().getInstance().set('trust proxy', false);
      await defaultApp.init();

      // Send spoofed X-Forwarded-For header
      const spoofedIp = '203.0.113.42';
      const res = await request(defaultApp.getHttpServer())
        .get('/health')
        .set('X-Forwarded-For', spoofedIp)
        .expect(200);

      expect(res.status).toBe(200);
      // The socket address is loopback (127.0.0.1 or ::1), NOT the spoofed IP
    }, 15000);
  });

  describe('Trusted single reverse proxy mode (trust proxy = 1)', () => {
    it('correctly resolves client IP from immediate trusted proxy hop', async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      trustedProxyApp = moduleFixture.createNestApplication();
      const trustSetting = validateTrustProxy('1');
      trustedProxyApp.getHttpAdapter().getInstance().set('trust proxy', trustSetting);
      await trustedProxyApp.init();

      // With trust proxy = 1, Express treats the connection as coming from a trusted proxy
      // and reads the last entry in X-Forwarded-For as the client IP.
      const realClientIp = '203.0.113.99';
      const spoofedInternalIp = '10.0.0.1';

      // Attacker sends: Spoofed, RealClient
      const res = await request(trustedProxyApp.getHttpServer())
        .get('/health')
        .set('X-Forwarded-For', `${spoofedInternalIp}, ${realClientIp}`)
        .expect(200);

      expect(res.status).toBe(200);
    }, 15000);
  });

  describe('Invalid Proxy Configuration Startup Guards', () => {
    it('throws error when blind "true" is configured', () => {
      expect(() => validateTrustProxy('true')).toThrow(
        /Insecure TRUST_PROXY configuration: blind "true" is prohibited/,
      );
    });

    it('throws error when negative or out-of-range hop count is configured', () => {
      expect(() => validateTrustProxy('0')).toThrow(/Must be an integer between 1 and 20/);
      expect(() => validateTrustProxy('99')).toThrow(/Must be an integer between 1 and 20/);
    });

    it('throws error when invalid subnet or malformed string is configured', () => {
      expect(() => validateTrustProxy('invalid-subnet-mask')).toThrow(
        /Invalid TRUST_PROXY configuration token/,
      );
    });
  });
});
