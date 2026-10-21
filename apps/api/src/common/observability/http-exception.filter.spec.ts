import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import { StructuredLoggerService, EcsLogEntry } from './structured-logger.service';
import { RequestContextService } from './request-context.service';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let logger: StructuredLoggerService;
  let capturedEntries: EcsLogEntry[];

  beforeEach(() => {
    capturedEntries = [];
    StructuredLoggerService.setLogSink((entry) => {
      capturedEntries.push(entry);
    });

    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'app.nodeEnv') return 'test';
        return undefined;
      }),
    } as any;

    logger = new StructuredLoggerService(mockConfigService);
    filter = new HttpExceptionFilter(logger, mockConfigService);
  });

  afterEach(() => {
    StructuredLoggerService.setLogSink(undefined);
  });

  function createMockHost() {
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const setHeaderMock = vi.fn();

    const res = {
      status: statusMock,
      setHeader: setHeaderMock,
    } as unknown as Response;

    const req = {
      method: 'GET',
      url: '/api/v1/articles/999?query=secret',
      originalUrl: '/api/v1/articles/999?query=secret',
      headers: {},
    } as unknown as Request;

    const host = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;

    return { host, req, res, statusMock, jsonMock, setHeaderMock };
  }

  it('handles standard HttpException and returns client response format', () => {
    const { host, statusMock, jsonMock } = createMockHost();
    const exception = new NotFoundException('Article not found.');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Article not found.',
      error: 'Not Found',
    });
  });

  it('attaches X-Request-ID to error responses from active context', () => {
    const { host, setHeaderMock } = createMockHost();
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    const context = RequestContextService.createContext({ requestId: 'corr-id-999' });
    RequestContextService.run(context, () => {
      filter.catch(exception, host);
    });

    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', 'corr-id-999');
  });

  it('handles unhandled 500 exceptions, emits structured error log, and returns safe response', () => {
    const { host, statusMock, jsonMock } = createMockHost();
    const exception = new Error('Database connection failed unexpectedly');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'Internal Server Error',
      }),
    );

    expect(capturedEntries).toHaveLength(1);
    const logEntry = capturedEntries[0];
    expect(logEntry['log.level']).toBe('error');
    expect(logEntry.event?.action).toBe('http.exception');
    expect(logEntry.error?.message).toContain('Database connection failed unexpectedly');
    expect(logEntry.url?.path).toBe('/api/v1/articles/999');
  });

  it('handles string response body in HttpException', () => {
    const { host, statusMock, jsonMock } = createMockHost();
    const exception = new HttpException('Bad input parameter', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Bad input parameter',
      error: 'HttpException',
    });
  });

  it('masks internal error details in production mode', () => {
    const prodConfig = {
      get: vi.fn((key: string) => (key === 'app.nodeEnv' ? 'production' : undefined)),
    } as any;
    const prodFilter = new HttpExceptionFilter(logger, prodConfig);

    const { host, statusMock, jsonMock } = createMockHost();
    const exception = new Error('Sensitive database internals leaked');

    prodFilter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  });

  it('uses req.headers x-request-id when AsyncLocalStorage has no context', () => {
    const { host, req, setHeaderMock } = createMockHost();
    req.headers['x-request-id'] = 'header-req-id-777';

    filter.catch(new HttpException('Not found', 404), host);

    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-ID', 'header-req-id-777');
  });
});
