import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StructuredLoggerService, EcsLogEntry } from './structured-logger.service';
import { RequestContextService } from './request-context.service';

describe('StructuredLoggerService', () => {
  let logger: StructuredLoggerService;
  let capturedEntries: EcsLogEntry[];
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    capturedEntries = [];
    StructuredLoggerService.setLogSink((entry) => {
      capturedEntries.push(entry);
    });

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'app.serviceName') return 'bachina-labs-api';
        if (key === 'app.nodeEnv') return 'test';
        if (key === 'app.logLevel') return 'debug';
        return undefined;
      }),
    } as any;

    logger = new StructuredLoggerService(mockConfigService);
  });

  afterEach(() => {
    StructuredLoggerService.setLogSink(undefined);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('formats standard log messages as valid ECS 8.11 JSON entries', () => {
    logger.log('Application started successfully', 'Bootstrap');

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];

    expect(entry['@timestamp']).toBeDefined();
    expect(entry['ecs.version']).toBe('8.11.0');
    expect(entry['log.level']).toBe('info');
    expect(entry['service.name']).toBe('bachina-labs-api');
    expect(entry['service.environment']).toBe('test');
    expect(entry['process.pid']).toBe(process.pid);
    expect(entry.message).toBe('Application started successfully');
    expect(entry['log.logger']).toBe('Bootstrap');

    // Verify stdout was called with valid JSON
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const writtenJson = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(writtenJson.message).toBe('Application started successfully');
  });

  it('routes error and fatal logs to process.stderr', () => {
    logger.error('Database connection failed', new Error('Timeout error'));

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('error');
    expect(entry.error?.type).toBe('Error');
    expect(entry.error?.message).toBe('Timeout error');

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('automatically binds active request context into log records', () => {
    const context = RequestContextService.createContext({
      requestId: 'req-abc-123',
      traceId: '0123456789abcdef0123456789abcdef',
      transactionId: '0123456789abcdef',
      userId: 'user-777',
      clientIp: '203.0.113.10',
    });

    RequestContextService.run(context, () => {
      logger.info('User viewed dashboard');
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['trace.id']).toBe('0123456789abcdef0123456789abcdef');
    expect(entry['transaction.id']).toBe('0123456789abcdef');
    expect(entry['user.id']).toBe('user-777');
    expect(entry['client.ip']).toBe('203.0.113.10');
    expect(entry.labels?.request_id).toBe('req-abc-123');
  });

  it('redacts sensitive values embedded in metadata and log arguments', () => {
    logger.warn('Login attempt failed', {
      password: 'PlaintextPassword123',
      token: 'secret_token_val',
      email: 'test@example.com',
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['password']).toBe('[REDACTED]');
    expect(entry['token']).toBe('[REDACTED]');
    expect(entry['email']).toBe('test@example.com');
  });

  it('filters out messages below the configured minimum log level', () => {
    logger.setMinLevel('warn');

    logger.debug('This debug should be filtered');
    logger.log('This info should be filtered');
    logger.warn('This warning should pass');
    logger.error('This error should pass');

    expect(capturedEntries).toHaveLength(2);
    expect(capturedEntries[0]['log.level']).toBe('warn');
    expect(capturedEntries[1]['log.level']).toBe('error');
  });

  it('emits structured events with proper ECS action and category fields', () => {
    logger.emitStructuredEvent('info', 'Authentication successful', {
      event: {
        action: 'auth.login',
        category: ['authentication'],
        outcome: 'success',
      },
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry.event?.action).toBe('auth.login');
    expect(entry.event?.outcome).toBe('success');
    expect(entry.event?.category).toEqual(['authentication']);
  });

  it('supports fatal, verbose, debug, and object messages', () => {
    logger.fatal('Critical system shutdown');
    logger.verbose('Detailed verbose trace');
    logger.debug('Debug diagnostic trace');
    logger.log({ customData: 'test-value', numberVal: 42 });

    expect(capturedEntries).toHaveLength(4);
    expect(capturedEntries[0]['log.level']).toBe('fatal');
    expect(capturedEntries[1]['log.level']).toBe('debug');
    expect(capturedEntries[2]['log.level']).toBe('debug');
    expect(capturedEntries[3].message).toContain('customData');
  });

  it('handles stack trace in optionalParams for error logs', () => {
    logger.error('Failed operation', 'Error: Failed\n    at testFn (test.ts:1:1)');

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry.error?.stack_trace).toContain('testFn (test.ts:1:1)');
  });

  it('merges http, url, labels, and error properties in emitStructuredEvent', () => {
    logger.emitStructuredEvent('info', 'HTTP request tracked', {
      labels: { app: 'academy' },
      http: { request: { method: 'GET' } },
      url: { path: '/health' },
      error: { type: 'WarnType', message: 'soft warning' },
      customField: 'customValue',
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry.labels?.app).toBe('academy');
    expect(entry.http?.request?.method).toBe('GET');
    expect(entry.url?.path).toBe('/health');
    expect(entry.error?.type).toBe('WarnType');
    expect(entry['customField']).toBe('customValue');
  });

  it('auto-extracts bracketed action and outcome, but NEVER extracts userId or mutates request context', () => {
    logger.log('User login completed [action=auth.login, outcome=success, userId=usr-abc-123]');

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry.event?.action).toBe('auth.login');
    expect(entry.event?.outcome).toBe('success');
    expect(entry['user.id']).toBeUndefined();
    expect(RequestContextService.get()?.userId).toBeUndefined();
  });

  describe('Security regression: Logger user-identity spoofing protection', () => {
    it('Test 1 — Untrusted userId injection: request context remains unchanged when string contains [userId=...]', () => {
      const trustedContext = RequestContextService.createContext({
        userId: 'trusted-user-uuid-1111',
        requestId: 'req-test-1',
      });

      RequestContextService.run(trustedContext, () => {
        logger.warn('Suspicious event [userId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]');
        expect(RequestContextService.get()?.userId).toBe('trusted-user-uuid-1111');
      });

      expect(capturedEntries).toHaveLength(1);
      expect(capturedEntries[0]['user.id']).toBe('trusted-user-uuid-1111');
      expect(capturedEntries[0]['user.id']).not.toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });

    it('Test 2 — Anonymous request: logging arbitrary userId leaves user.id absent from current and subsequent logs', () => {
      const anonContext = RequestContextService.createContext({
        requestId: 'req-anon-1',
      });

      RequestContextService.run(anonContext, () => {
        logger.log('Anonymous request received [userId=injected-spoofed-user]');
        logger.log('Subsequent operational message in same request');
      });

      expect(capturedEntries).toHaveLength(2);
      expect(capturedEntries[0]['user.id']).toBeUndefined();
      expect(capturedEntries[1]['user.id']).toBeUndefined();
      expect(anonContext.userId).toBeUndefined();
    });

    it('Test 3 — Authenticated request: trusted user ID remains authoritative despite conflicting bracketed userId', () => {
      const authContext = RequestContextService.createContext({
        userId: 'verified-actor-777',
        requestId: 'req-auth-1',
      });

      RequestContextService.run(authContext, () => {
        logger.info('Action performed [action=auth.session.revoke, userId=attacker-impersonator]');
      });

      expect(capturedEntries).toHaveLength(1);
      expect(capturedEntries[0]['user.id']).toBe('verified-actor-777');
      expect(capturedEntries[0].event?.action).toBe('auth.session.revoke');
    });

    it('Test 4 — Concurrent requests: zero cross-request identity contamination across concurrent asynchronous contexts', async () => {
      const contextA = RequestContextService.createContext({
        userId: 'user-alpha',
        requestId: 'req-alpha',
      });
      const contextB = RequestContextService.createContext({
        userId: 'user-beta',
        requestId: 'req-beta',
      });

      const runA = () =>
        new Promise<void>((resolve) => {
          RequestContextService.run(contextA, () => {
            setTimeout(() => {
              logger.log('Alpha operation [userId=user-beta-attempted-override]');
              resolve();
            }, 5);
          });
        });

      const runB = () =>
        new Promise<void>((resolve) => {
          RequestContextService.run(contextB, () => {
            setTimeout(() => {
              logger.log('Beta operation [userId=user-alpha-attempted-override]');
              resolve();
            }, 5);
          });
        });

      await Promise.all([runA(), runB()]);

      expect(capturedEntries).toHaveLength(2);
      const entryA = capturedEntries.find((e) => e.labels?.request_id === 'req-alpha');
      const entryB = capturedEntries.find((e) => e.labels?.request_id === 'req-beta');

      expect(entryA?.['user.id']).toBe('user-alpha');
      expect(entryB?.['user.id']).toBe('user-beta');
      expect(contextA.userId).toBe('user-alpha');
      expect(contextB.userId).toBe('user-beta');
    });

    it('Test 5 — Failed login: failure does not populate user.id from request body, headers, or log text', () => {
      const unauthContext = RequestContextService.createContext({
        requestId: 'req-failed-login',
        clientIp: '198.51.100.25',
      });

      RequestContextService.run(unauthContext, () => {
        // Simulating failed login logging with attacker-controlled input in message
        logger.warn(
          'Authentication failed: invalid credentials [action=auth.login, outcome=failure, userId=attacker-probe@example.com]',
        );
      });

      expect(capturedEntries).toHaveLength(1);
      expect(capturedEntries[0]['user.id']).toBeUndefined();
      expect(capturedEntries[0].event?.action).toBe('auth.login');
      expect(capturedEntries[0].event?.outcome).toBe('failure');
      expect(unauthContext.userId).toBeUndefined();
    });

    it('Test 6 — Legitimate successful login: authenticated success event and HTTP completion event include verified user ID', () => {
      const loginContext = RequestContextService.createContext({
        requestId: 'req-login-success',
      });

      RequestContextService.run(loginContext, () => {
        // Explicit authoritative boundary binding
        RequestContextService.setUserId('verified-user-uuid-999');

        logger.log(
          'Authentication successful [action=auth.login, outcome=success, sessionId=sess-123]',
        );

        // Simulating HTTP completion event emitted by middleware
        logger.emitStructuredEvent('info', 'HTTP POST /api/v1/auth/login 200 - 45ms', {
          event: { action: 'http.request', outcome: 'success' },
          http: { response: { status_code: 200 } },
        });
      });

      expect(capturedEntries).toHaveLength(2);
      expect(capturedEntries[0]['user.id']).toBe('verified-user-uuid-999');
      expect(capturedEntries[0].event?.action).toBe('auth.login');

      expect(capturedEntries[1]['user.id']).toBe('verified-user-uuid-999');
      expect(capturedEntries[1].event?.action).toBe('http.request');
    });

    it('Test 7 — Explicit metadata precedence: untrusted log text cannot override security fields, verified on emitted stdout JSON', () => {
      // Clear logSink so output goes to stdoutSpy
      StructuredLoggerService.setLogSink(undefined);

      logger.log(
        'Operation completed [action=fake.spoofed_action, outcome=success, userId=fake-user-id]',
        {
          event: { action: 'security.real_action', outcome: 'failure' },
        },
      );

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const emittedJson = JSON.parse(stdoutSpy.mock.calls[0][0]);

      // Assert that explicit typed metadata took strict precedence over bracket parsing
      expect(emittedJson.event?.action).toBe('security.real_action');
      expect(emittedJson.event?.outcome).toBe('failure');
      // Assert that fake-user-id was never extracted
      expect(emittedJson['user.id']).toBeUndefined();
    });
  });
});
