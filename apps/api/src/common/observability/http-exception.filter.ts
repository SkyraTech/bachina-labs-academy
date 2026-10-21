import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { StructuredLoggerService } from './structured-logger.service';
import { RequestContextService } from './request-context.service';
import { LogSanitizer } from './log-sanitizer';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly isProduction: boolean;

  constructor(
    private readonly logger: StructuredLoggerService,
    configService: ConfigService,
  ) {
    const nodeEnv =
      configService.get<string>('app.nodeEnv') ??
      process.env['NODE_ENV'] ??
      'development';
    this.isProduction = nodeEnv === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId =
      RequestContextService.getRequestId() ??
      (req.headers['x-request-id'] as string) ??
      undefined;

    if (requestId) {
      res.setHeader('X-Request-ID', requestId);
    }

    let clientResponse: Record<string, unknown>;

    if (exception instanceof HttpException) {
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'object' && responseBody !== null) {
        clientResponse = responseBody as Record<string, unknown>;
      } else {
        clientResponse = {
          statusCode: status,
          message: responseBody,
          error: exception.name,
        };
      }
    } else {
      // Unhandled non-HttpException
      clientResponse = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: this.isProduction
          ? 'Internal server error'
          : (exception as Error)?.message ?? 'Internal server error',
        error: 'Internal Server Error',
      };
    }

    // Unhandled 5xx exceptions get explicit exception logging
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const normalized = LogSanitizer.normalizeError(exception, this.isProduction);
      const path = LogSanitizer.sanitizeUrl(req.originalUrl || req.url || '');

      this.logger.emitStructuredEvent('error', `Unhandled Exception: ${normalized.message}`, {
        event: {
          action: 'http.exception',
          category: ['web', 'error'],
          outcome: 'failure',
        },
        http: {
          request: {
            method: req.method,
          },
          response: {
            status_code: status,
          },
        },
        url: {
          path,
        },
        error: normalized,
      });
    }

    res.status(status).json(clientResponse);
  }
}
