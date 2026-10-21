import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { StructuredLoggerService, LogLevel } from './structured-logger.service';
import { RequestContextService } from './request-context.service';
import { LogSanitizer } from './log-sanitizer';
import { getClientIp } from '../utils/client-ip.util';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logHealthChecks: string;

  constructor(
    private readonly logger: StructuredLoggerService,
    configService: ConfigService,
  ) {
    this.logHealthChecks =
      configService.get<string>('app.logHealthChecks') ??
      process.env['LOG_HEALTH_CHECKS'] ??
      'debug';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // If request lifecycle is already tracked and logged by middleware finish/close listener, bypass interceptor
    if ((req as any)?.__lifecycleHandled) {
      return next.handle();
    }

    const reqContext = RequestContextService.get();
    const startTime = reqContext?.startTime ?? process.hrtime.bigint();
    const path = LogSanitizer.sanitizeUrl(req.originalUrl || req.url || '');
    const isHealthCheck = path === '/health' || path === '/health/database';

    return next.handle().pipe(
      tap({
        next: () => {
          this.logCompletion(req, res, path, startTime, isHealthCheck);
        },
        error: (err: unknown) => {
          // Exception filter handles error response body;
          // interceptor logs request completion event
          this.logCompletion(req, res, path, startTime, isHealthCheck, err);
        },
      }),
    );
  }

  private logCompletion(
    req: Request,
    res: Response,
    path: string,
    startTime: bigint,
    isHealthCheck: boolean,
    error?: unknown,
  ): void {
    const durationNs = Number(process.hrtime.bigint() - startTime);
    const statusCode = res.statusCode || (error && typeof (error as any).getStatus === 'function' ? (error as any).getStatus() : 500);

    const isSuccess = statusCode < 400;
    const outcome = isSuccess ? 'success' : 'failure';

    // Apply health-check logging policy
    if (isHealthCheck && isSuccess) {
      if (this.logHealthChecks === 'none') {
        return;
      }
      if (this.logHealthChecks === 'debug') {
        this.emitLog('debug', req, statusCode, path, durationNs, outcome);
        return;
      }
    }

    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.emitLog(level, req, statusCode, path, durationNs, outcome, error);
  }

  private emitLog(
    level: LogLevel,
    req: Request,
    statusCode: number,
    path: string,
    durationNs: number,
    outcome: 'success' | 'failure',
    error?: unknown,
  ): void {
    const user = (req as Record<string, any>)['user'] as { id?: string } | undefined;
    if (user?.id) {
      RequestContextService.setUserId(user.id);
    }

    const userAgent = req.headers['user-agent']
      ? String(req.headers['user-agent']).slice(0, 1024)
      : undefined;

    const message = `HTTP ${req.method} ${path} ${statusCode} - ${Math.round(durationNs / 1_000_000)}ms`;

    this.logger.emitStructuredEvent(level, message, {
      event: {
        action: 'http.request',
        category: ['web', 'network'],
        outcome,
        duration: durationNs,
      },
      http: {
        request: {
          method: req.method,
        },
        response: {
          status_code: statusCode,
        },
      },
      url: {
        path,
      },
      ...(user?.id ? { 'user.id': user.id } : {}),
      'client.ip': getClientIp(req),
      ...(userAgent ? { user_agent: { original: userAgent } } : {}),
      ...(error ? { error: LogSanitizer.normalizeError(error) } : {}),
    });
  }
}
