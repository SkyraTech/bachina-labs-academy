import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import appConfig from './app.config';

describe('appConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/testdb';
    process.env['DATABASE_RUNTIME_URL'] = 'postgresql://academy_app:pass@localhost:5432/testdb';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws an error if DATABASE_URL is missing or blank', () => {
    delete process.env['DATABASE_URL'];
    expect(() => appConfig()).toThrow('DATABASE_URL environment variable is required');

    process.env['DATABASE_URL'] = '   ';
    expect(() => appConfig()).toThrow('DATABASE_URL environment variable is required');
  });

  it('throws an error if DATABASE_RUNTIME_URL is missing or blank', () => {
    delete process.env['DATABASE_RUNTIME_URL'];
    expect(() => appConfig()).toThrow('DATABASE_RUNTIME_URL environment variable is required');

    process.env['DATABASE_RUNTIME_URL'] = '   ';
    expect(() => appConfig()).toThrow('DATABASE_RUNTIME_URL environment variable is required');
  });

  it('loads valid defaults for non-sensitive values', () => {
    delete process.env['NODE_ENV'];
    const config = appConfig();

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.apiPrefix).toBe('api/v1');
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:4200']);
    expect(config.serviceName).toBe('bachina-labs-api');
    expect(config.logLevel).toBe('debug');
    expect(config.logHealthChecks).toBe('debug');
    expect(config.trustProxy).toBe(false);
  });

  it('reads custom environment variables accurately', () => {
    process.env['PORT'] = '8080';
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://academy.bachinalabs.com, https://admin.bachinalabs.com';
    process.env['SERVICE_NAME'] = 'custom-api-name';
    process.env['LOG_LEVEL'] = 'warn';
    process.env['LOG_HEALTH_CHECKS'] = 'none';
    process.env['TRUST_PROXY'] = '1';

    const config = appConfig();

    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.corsAllowedOrigins).toEqual([
      'https://academy.bachinalabs.com',
      'https://admin.bachinalabs.com',
    ]);
    expect(config.serviceName).toBe('custom-api-name');
    expect(config.logLevel).toBe('warn');
    expect(config.logHealthChecks).toBe('none');
    expect(config.trustProxy).toBe(1);
  });
});
