import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RequestContextService, RequestContext } from './request-context.service';
import { StructuredLoggerService, LogLevel } from './structured-logger.service';
import { getClientIp } from '../utils/client-ip.util';
import { LogSanitizer } from './log-sanitizer';

const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

@Injectable()
export class RequestCorrelationMiddleware implements NestMiddleware {
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

  use(req: Request, res: Response, next: NextFunction): void {
    // 1. Inspect upstream X-Request-ID header if provided by trusted ingress
    const rawHeader = req.headers['x-request-id'];
    let requestId: string;

    if (
      typeof rawHeader === 'string' &&
      rawHeader.length > 0 &&
      rawHeader.length <= 64 &&
      VALID_REQUEST_ID_REGEX.test(rawHeader)
    ) {
      requestId = rawHeader;
    } else {
      requestId = randomUUID();
    }

    // 2. Generate standard W3C trace identifiers
    const traceId = randomBytes(16).toString('hex');
    const transactionId = randomBytes(8).toString('hex');
    const startTime = process.hrtime.bigint();
    const clientIp = getClientIp(req);
    const path = LogSanitizer.sanitizeUrl(req.originalUrl || req.url || '');
    const isHealthCheck = path === '/health' || path === '/health/database';

    // 3. Attach correlation header to HTTP response
    res.setHeader('X-Request-ID', requestId);

    // 4. Attach identifiers to request object for convenience
    (req as unknown as Record<string, unknown>)['id'] = requestId;
    (req as unknown as Record<string, unknown>)['traceId'] = traceId;
    (req as unknown as Record<string, unknown>)['__lifecycleHandled'] = true;

    // 5. Establish AsyncLocalStorage context
    const context: RequestContext = {
      requestId,
      traceId,
      transactionId,
      clientIp,
      startTime,
      method: req.method,
      path,
    };

    let completed = false;

    const emitCompletionLog = (aborted: boolean) => {
      if (completed) {
        return;
      }
      completed = true;

      const durationNs = Number(process.hrtime.bigint() - startTime);
      const statusCode = res.statusCode || (aborted ? 499 : 200);
      const isSuccess = statusCode < 400 && !aborted;
      const outcome = isSuccess ? 'success' : 'failure';

      const user = (req as Record<string, any>)['user'] as { id?: string } | undefined;
      const effectiveUserId = user?.id || RequestContextService.get()?.userId;

      // Apply health-check logging policy
      if (isHealthCheck && isSuccess) {
        if (this.logHealthChecks === 'none') {
          return;
        }
        if (this.logHealthChecks === 'debug') {
          this.emitLog('debug', req, statusCode, path, durationNs, outcome, effectiveUserId, aborted);
          return;
        }
      }

      const level: LogLevel =
        statusCode >= 500 ? 'error' : statusCode >= 400 || aborted ? 'warn' : 'info';
      this.emitLog(level, req, statusCode, path, durationNs, outcome, effectiveUserId, aborted);
    };

    res.on('finish', () => {
      RequestContextService.run(context, () => emitCompletionLog(false));
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        RequestContextService.run(context, () => emitCompletionLog(true));
      }
    });

    RequestContextService.run(context, () => next());
  }

  private emitLog(
    level: LogLevel,
    req: Request,
    statusCode: number,
    path: string,
    durationNs: number,
    outcome: 'success' | 'failure',
    userId?: string,
    aborted = false,
  ): void {
    const userAgent = req.headers['user-agent']
      ? String(req.headers['user-agent']).slice(0, 1024)
      : undefined;

    const message = `HTTP ${req.method} ${path} ${statusCode} - ${Math.round(durationNs / 1_000_000)}ms${aborted ? ' [aborted]' : ''}`;

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
      ...(userId ? { 'user.id': userId } : {}),
      'client.ip': getClientIp(req),
      ...(userAgent ? { user_agent: { original: userAgent } } : {}),
    });
  }
}
