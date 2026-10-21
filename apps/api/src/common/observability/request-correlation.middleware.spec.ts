import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { RequestCorrelationMiddleware } from './request-correlation.middleware';
import { RequestContextService } from './request-context.service';
import { StructuredLoggerService, EcsLogEntry } from './structured-logger.service';

describe('RequestCorrelationMiddleware', () => {
  let middleware: RequestCorrelationMiddleware;
  let logger: StructuredLoggerService;
  let capturedEntries: EcsLogEntry[];
  let finishCallback: (() => void) | undefined;
  let closeCallback: (() => void) | undefined;

  beforeEach(() => {
    capturedEntries = [];
    StructuredLoggerService.setLogSink((entry) => {
      capturedEntries.push(entry);
    });

    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'app.logHealthChecks') return 'debug';
        return undefined;
      }),
    } as any;

    logger = new StructuredLoggerService(mockConfigService);
    middleware = new RequestCorrelationMiddleware(logger, mockConfigService);
    finishCallback = undefined;
    closeCallback = undefined;
  });

  afterEach(() => {
    StructuredLoggerService.setLogSink(undefined);
  });

  function createMocks(headers: Record<string, string> = {}, statusCode = 200) {
    const req = {
      headers: { ...headers },
      method: 'GET',
      url: '/api/v1/auth/me?query=ignored',
      originalUrl: '/api/v1/auth/me?query=ignored',
      socket: { remoteAddress: '127.0.0.1' },
      user: { id: 'user-auth-123' },
    } as unknown as Request;

    const setHeaderMock = vi.fn();
    const res = {
      statusCode,
      setHeader: setHeaderMock,
      writableEnded: false,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
        if (event === 'close') closeCallback = cb;
      }),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction & {
      mockImplementation: (fn: any) => void;
    };

    return { req, res, next, setHeaderMock };
  }

  it('accepts and preserves a valid upstream X-Request-ID header', () => {
    const { req, res, next, setHeaderMock } = createMocks({
      'x-request-id': 'custom-upstream-id-12345',
    });

    let contextInsideNext: any;
    next.mockImplementation(() => {
      contextInsideNext = RequestContextService.get();
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', 'custom-upstream-id-12345');
    expect(contextInsideNext?.requestId).toBe('custom-upstream-id-12345');
    expect(contextInsideNext?.traceId).toHaveLength(32);
    expect(contextInsideNext?.path).toBe('/api/v1/auth/me');
  });

  it('generates a new UUID when X-Request-ID is missing', () => {
    const { req, res, next, setHeaderMock } = createMocks();

    let capturedId: string | undefined;
    next.mockImplementation(() => {
      capturedId = RequestContextService.getRequestId();
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(capturedId).toBeDefined();
    // UUIDv4 format check
    expect(capturedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', capturedId);
  });

  it('rejects overlong or malformed upstream X-Request-ID and replaces with a fresh UUID', () => {
    const maliciousHeaders = [
      'id-with-<script>alert(1)</script>',
      'a'.repeat(65), // > 64 chars
      'invalid space id',
      'id_with;semicolon',
    ];

    for (const badId of maliciousHeaders) {
      const { req, res, next, setHeaderMock } = createMocks({
        'x-request-id': badId,
      });

      let capturedId: string | undefined;
      next.mockImplementation(() => {
        capturedId = RequestContextService.getRequestId();
      });

      middleware.use(req, res, next);

      expect(capturedId).not.toBe(badId);
      expect(capturedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', capturedId);
    }
  });

  it('accepts an exactly 64-character valid X-Request-ID', () => {
    const valid64 = 'a'.repeat(64);
    const { req, res, next, setHeaderMock } = createMocks({
      'x-request-id': valid64,
    });

    let capturedId: string | undefined;
    next.mockImplementation(() => {
      capturedId = RequestContextService.getRequestId();
    });

    middleware.use(req, res, next);

    expect(capturedId).toBe(valid64);
    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', valid64);
  });

  it('generates a fresh UUID when X-Request-ID is empty string', () => {
    const { req, res, next, setHeaderMock } = createMocks({
      'x-request-id': '',
    });

    let capturedId: string | undefined;
    next.mockImplementation(() => {
      capturedId = RequestContextService.getRequestId();
    });

    middleware.use(req, res, next);

    expect(capturedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', capturedId);
  });

  // ── HTTP Lifecycle completion event tests ──────────────────────────────────

  it('emits exactly one completion log event when response finishes successfully', () => {
    const { req, res, next } = createMocks({}, 200);

    middleware.use(req, res, next);
    expect(finishCallback).toBeDefined();

    // Simulate response finish
    (res as any).writableEnded = true;
    finishCallback!();

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('info');
    expect(entry.event?.action).toBe('http.request');
    expect(entry.event?.outcome).toBe('success');
    expect(entry.http?.response?.status_code).toBe(200);
    expect(entry['user.id']).toBe('user-auth-123');
    expect(entry.url?.path).toBe('/api/v1/auth/me');
  });

  it('emits warn level completion log event for 4xx client errors (guard/validation)', () => {
    const { req, res, next } = createMocks({}, 401);

    middleware.use(req, res, next);
    (res as any).writableEnded = true;
    finishCallback!();

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('warn');
    expect(entry.event?.outcome).toBe('failure');
    expect(entry.http?.response?.status_code).toBe(401);
  });

  it('emits error level completion log event for 5xx server errors', () => {
    const { req, res, next } = createMocks({}, 500);

    middleware.use(req, res, next);
    (res as any).writableEnded = true;
    finishCallback!();

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('error');
    expect(entry.event?.outcome).toBe('failure');
    expect(entry.http?.response?.status_code).toBe(500);
  });

  it('emits aborted completion log event when connection closes before writableEnded', () => {
    const { req, res, next } = createMocks({}, 200);

    middleware.use(req, res, next);
    expect(closeCallback).toBeDefined();

    // Client disconnected before finish
    (res as any).writableEnded = false;
    closeCallback!();

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('warn');
    expect(entry.event?.outcome).toBe('failure');
    expect(entry.message).toContain('[aborted]');
  });

  it('prevents double logging when both finish and close fire', () => {
    const { req, res, next } = createMocks({}, 200);

    middleware.use(req, res, next);
    (res as any).writableEnded = true;
    finishCallback!();
    closeCallback!();

    expect(capturedEntries).toHaveLength(1);
  });

  it('handles health check logging policy: debug and none', () => {
    // 1. debug policy
    const { req: reqDebug, res: resDebug, next: nextDebug } = createMocks({}, 200);
    (reqDebug as any).url = '/health';
    (reqDebug as any).originalUrl = '/health';

    middleware.use(reqDebug, resDebug, nextDebug);
    (resDebug as any).writableEnded = true;
    finishCallback!();

    expect(capturedEntries).toHaveLength(1);
    expect(capturedEntries[0]['log.level']).toBe('debug');
    expect(capturedEntries[0].url?.path).toBe('/health');

    // 2. none policy
    capturedEntries = [];
    const mockQuietConfig = {
      get: vi.fn((key: string) => (key === 'app.logHealthChecks' ? 'none' : undefined)),
    } as any;
    const quietMiddleware = new RequestCorrelationMiddleware(logger, mockQuietConfig);

    const { req: reqNone, res: resNone, next: nextNone } = createMocks({}, 200);
    (reqNone as any).url = '/health';
    (reqNone as any).originalUrl = '/health';

    quietMiddleware.use(reqNone, resNone, nextNone);
    (resNone as any).writableEnded = true;
    finishCallback!();

    expect(capturedEntries).toHaveLength(0);
  });

  it('handles requests without user, user-agent, or originalUrl', () => {
    const req = {
      headers: {},
      method: 'GET',
      url: '/test-route',
      socket: {},
    } as unknown as Request;

    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      writableEnded: false,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
      }),
    } as unknown as Response;

    const next = vi.fn();
    middleware.use(req, res, next);
    (res as any).writableEnded = true;
    finishCallback!();

    expect(capturedEntries).toHaveLength(1);
    expect(capturedEntries[0]['user.id']).toBeUndefined();
    expect(capturedEntries[0]['user_agent']).toBeUndefined();
    expect(capturedEntries[0].url?.path).toBe('/test-route');
  });
});
