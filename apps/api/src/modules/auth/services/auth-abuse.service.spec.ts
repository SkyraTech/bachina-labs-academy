import { describe, it, expect, beforeEach } from 'vitest';
import { AuthAbuseService } from './auth-abuse.service';

describe('AuthAbuseService', () => {
  let service: AuthAbuseService;

  beforeEach(() => {
    service = new AuthAbuseService();
    service.resetAll();
  });

  it('allows login attempts when zero failures are recorded', () => {
    const check = service.checkLoginAllowed('192.0.2.1', 'user@example.com');
    expect(check.blocked).toBe(false);
    expect(check.retryAfterSeconds).toBe(0);
  });

  it('allows login attempts when failures are below threshold (< 5)', () => {
    service.recordFailedAttempt('192.0.2.1', 'user@example.com');
    service.recordFailedAttempt('192.0.2.1', 'user@example.com');
    service.recordFailedAttempt('192.0.2.1', 'user@example.com');

    const check = service.checkLoginAllowed('192.0.2.1', 'user@example.com');
    expect(check.blocked).toBe(false);
  });

  it('blocks IP after 5 consecutive failed attempts from the same IP', () => {
    for (let i = 0; i < 5; i++) {
      service.recordFailedAttempt('198.51.100.10', `different${i}@example.com`);
    }

    const check = service.checkLoginAllowed('198.51.100.10', 'anybody@example.com');
    expect(check.blocked).toBe(true);
    expect(check.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('blocks account digest after 5 consecutive failed attempts on the same email across different IPs', () => {
    const targetEmail = 'victim@example.com';
    for (let i = 0; i < 5; i++) {
      service.recordFailedAttempt(`203.0.113.${i + 1}`, targetEmail);
    }

    // New IP trying the same email is blocked by email digest
    const check = service.checkLoginAllowed('203.0.113.99', targetEmail);
    expect(check.blocked).toBe(true);
    expect(check.retryAfterSeconds).toBeGreaterThan(0);

    // But a different email from the new IP is NOT blocked
    const differentCheck = service.checkLoginAllowed('203.0.113.99', 'innocent@example.com');
    expect(differentCheck.blocked).toBe(false);
  });

  it('resets failure counters upon successful authentication', () => {
    service.recordFailedAttempt('192.0.2.5', 'user@example.com');
    service.recordFailedAttempt('192.0.2.5', 'user@example.com');
    service.recordFailedAttempt('192.0.2.5', 'user@example.com');

    service.recordSuccessfulLogin('192.0.2.5', 'user@example.com');

    // Should now have 0 recorded failures, meaning 4 more failures will still be allowed
    for (let i = 0; i < 4; i++) {
      service.recordFailedAttempt('192.0.2.5', 'user@example.com');
    }
    const check = service.checkLoginAllowed('192.0.2.5', 'user@example.com');
    expect(check.blocked).toBe(false);
  });

  it('hashes email identifier deterministically without exposing raw email', () => {
    const hash1 = service.hashEmailIdentifier('TEST@Example.com  ');
    const hash2 = service.hashEmailIdentifier('test@example.com');

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
    expect(hash1).not.toContain('example');
  });
});
