import { describe, it, expect } from 'vitest';
import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  // Test class exposing protected getTracker
  class TestThrottlerGuard extends AppThrottlerGuard {
    public testGetTracker(req: Record<string, any>): Promise<string> {
      return this.getTracker(req);
    }
  }

  // Minimal mocks for ThrottlerGuard constructor dependencies
  const mockOptions: any = { throttlers: [{ ttl: 60_000, limit: 10 }] };
  const mockStorage: any = {};
  const mockReflector: any = { getAllAndOverride: () => undefined };

  const guard = new TestThrottlerGuard(mockOptions, mockStorage, mockReflector);

  it('tracks by authenticated user ID when user is present on request', async () => {
    const req = {
      user: { id: 'user-uuid-1234' },
      ip: '203.0.113.50',
    };

    const tracker = await guard.testGetTracker(req);
    expect(tracker).toBe('user_user-uuid-1234');
  });

  it('tracks by client IP when request is unauthenticated', async () => {
    const req = {
      ip: '198.51.100.88',
    };

    const tracker = await guard.testGetTracker(req);
    expect(tracker).toBe('ip_198.51.100.88');
  });

  it('normalizes IPv4-mapped IPv6 address when tracking by IP', async () => {
    const req = {
      ip: '::ffff:192.0.2.1',
    };

    const tracker = await guard.testGetTracker(req);
    expect(tracker).toBe('ip_192.0.2.1');
  });

  it('logs rate limit warning and throws ThrottlerException on throwThrottlingException', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '203.0.113.99',
        }),
      }),
    } as any;

    const detail = {
      limit: 10,
      ttl: 60000,
      key: 'ip_203.0.113.99',
      tracker: 'ip_203.0.113.99',
      totalHits: 11,
      timeToExpire: 55,
      isBlocked: true,
      timeToBlockExpire: 55,
    };

    await expect(
      guard['throwThrottlingException'](mockContext, detail),
    ).rejects.toThrow();
  });
});
