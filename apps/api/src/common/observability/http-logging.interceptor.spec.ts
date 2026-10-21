import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HttpLoggingInterceptor } from './http-logging.interceptor';
import { StructuredLoggerService, EcsLogEntry } from './structured-logger.service';
import { RequestContextService } from './request-context.service';

describe('HttpLoggingInterceptor', () => {
  let interceptor: HttpLoggingInterceptor;
  let logger: StructuredLoggerService;
  let capturedEntries: EcsLogEntry[];

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
    interceptor = new HttpLoggingInterceptor(logger, mockConfigService);
  });

  afterEach(() => {
    StructuredLoggerService.setLogSink(undefined);
  });

  function createMockContext(
    method = 'GET',
    url = '/api/v1/auth/me?token=secret123',
    statusCode = 200,
  ): { context: ExecutionContext; req: Request; res: Response } {
    const req = {
      method,
      url,
      originalUrl: url,
      headers: {
        'user-agent': 'Mozilla/5.0 TestBrowser',
      },
      socket: { remoteAddress: '127.0.0.1' },
      user: { id: 'user-xyz-123' },
    } as unknown as Request;

    const res = {
      statusCode,
    } as unknown as Response;

    const context = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    return { context, req, res };
  }

  it('logs successful request completion with ECS http fields and nanosecond duration', async () => {
    const { context } = createMockContext('POST', '/api/v1/articles?param=test', 201);
    const next: CallHandler = {
      handle: () => of({ success: true }),
    };

    const reqContext = RequestContextService.createContext({
      requestId: 'test-req-id',
      startTime: process.hrtime.bigint(),
    });

    await new Promise<void>((resolve) => {
      RequestContextService.run(reqContext, () => {
        interceptor.intercept(context, next).subscribe({
          next: () => {},
          complete: () => resolve(),
        });
      });
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];

    expect(entry['log.level']).toBe('info');
    expect(entry.event?.action).toBe('http.request');
    expect(entry.event?.outcome).toBe('success');
    expect(typeof entry.event?.duration).toBe('number');
    expect(entry.event?.duration).toBeGreaterThan(0);
    expect(entry.http?.request?.method).toBe('POST');
    expect(entry.http?.response?.status_code).toBe(201);
    // Path is sanitized (query parameter stripped)
    expect(entry.url?.path).toBe('/api/v1/articles');
    expect(entry['user.id']).toBe('user-xyz-123');
  });

  it('handles health check requests in accordance with policy', async () => {
    const { context } = createMockContext('GET', '/health', 200);
    const next: CallHandler = {
      handle: () => of({ status: 'ok' }),
    };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context, next).subscribe({
        complete: () => resolve(),
      });
    });

    expect(capturedEntries).toHaveLength(1);
    // Configured policy emits at 'debug' level
    expect(capturedEntries[0]['log.level']).toBe('debug');
    expect(capturedEntries[0].url?.path).toBe('/health');
  });

  it('logs failed requests at warn or error level with failure outcome', async () => {
    const { context, res } = createMockContext('POST', '/api/v1/auth/login', 401);
    res.statusCode = 401;

    const error = new Error('Unauthorized credentials');
    const next: CallHandler = {
      handle: () => throwError(() => error),
    };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context, next).subscribe({
        error: () => resolve(),
      });
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('warn');
    expect(entry.event?.outcome).toBe('failure');
    expect(entry.http?.response?.status_code).toBe(401);
    expect(entry.error?.message).toBe('Unauthorized credentials');
  });

  it('skips health check logging when logHealthChecks is set to none', async () => {
    const mockConfig = {
      get: vi.fn((key: string) => (key === 'app.logHealthChecks' ? 'none' : undefined)),
    } as any;
    const quietInterceptor = new HttpLoggingInterceptor(logger, mockConfig);

    const { context } = createMockContext('GET', '/health/database', 200);
    const next: CallHandler = {
      handle: () => of({ status: 'ok' }),
    };

    await new Promise<void>((resolve) => {
      quietInterceptor.intercept(context, next).subscribe({
        complete: () => resolve(),
      });
    });

    expect(capturedEntries).toHaveLength(0);
  });

  it('logs internal server error (500) at error level', async () => {
    const { context, res, req } = createMockContext('GET', '/api/v1/error', 500);
    (req as any).user = undefined; // unauthenticated request
    res.statusCode = 500;

    const error = {
      getStatus: () => 500,
      message: 'Critical error',
    };
    const next: CallHandler = {
      handle: () => throwError(() => error),
    };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context, next).subscribe({
        error: () => resolve(),
      });
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0];
    expect(entry['log.level']).toBe('error');
    expect(entry.http?.response?.status_code).toBe(500);
    expect(entry['user.id']).toBeUndefined();
  });
});
