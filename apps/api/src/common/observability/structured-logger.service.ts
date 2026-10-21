import { Injectable, LoggerService, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from './request-context.service';
import { LogSanitizer } from './log-sanitizer';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export interface EcsLogEntry {
  '@timestamp': string;
  'ecs.version': string;
  'log.level': LogLevel;
  message: string;
  'service.name': string;
  'service.environment': string;
  'process.pid': number;
  'trace.id'?: string;
  'transaction.id'?: string;
  'user.id'?: string;
  'client.ip'?: string;
  labels?: Record<string, string>;
  event?: {
    action?: string;
    category?: string | string[];
    type?: string | string[];
    outcome?: 'success' | 'failure' | 'unknown';
    duration?: number; // In nanoseconds
  };
  http?: {
    request?: {
      method?: string;
    };
    response?: {
      status_code?: number;
    };
  };
  url?: {
    path?: string;
  };
  error?: {
    type?: string;
    message?: string;
    stack_trace?: string;
  };
  [key: string]: unknown;
}

@Injectable()
export class StructuredLoggerService implements LoggerService {
  private readonly serviceName: string;
  private readonly environment: string;
  private minLevel: LogLevel;
  private static logSink?: (entry: EcsLogEntry) => void;

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.serviceName =
      this.configService?.get<string>('app.serviceName') ??
      process.env['SERVICE_NAME'] ??
      'bachina-labs-api';

    this.environment =
      this.configService?.get<string>('app.nodeEnv') ??
      process.env['NODE_ENV'] ??
      'development';

    const configuredLevel = (
      this.configService?.get<string>('app.logLevel') ??
      process.env['LOG_LEVEL'] ??
      (this.environment === 'production' ? 'info' : 'debug')
    ).toLowerCase() as LogLevel;

    this.minLevel = LOG_LEVEL_PRIORITY[configuredLevel] ? configuredLevel : 'info';
  }

  /**
   * Overrides or sets minimum log level threshold.
   */
  setMinLevel(level: LogLevel): void {
    if (LOG_LEVEL_PRIORITY[level]) {
      this.minLevel = level;
    }
  }

  /**
   * Testing hook: allows tests to intercept and verify emitted log objects.
   */
  static setLogSink(sink?: (entry: EcsLogEntry) => void): void {
    this.logSink = sink;
  }

  // ── NestJS LoggerService implementation ───────────────────────────────────

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.writeEntry('info', message, optionalParams);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.writeEntry('info', message, meta ? [meta] : []);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.writeEntry('warn', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.writeEntry('error', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.writeEntry('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.writeEntry('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.writeEntry('fatal', message, optionalParams);
  }

  /**
   * Directly emits a structured event log entry with ECS properties.
   */
  emitStructuredEvent(level: LogLevel, message: string, meta: Partial<EcsLogEntry> = {}): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const context = RequestContextService.get();
    const entry: EcsLogEntry = {
      '@timestamp': new Date().toISOString(),
      'ecs.version': '8.11.0',
      'log.level': level,
      message: LogSanitizer.sanitizeString(message),
      'service.name': this.serviceName,
      'service.environment': this.environment,
      'process.pid': process.pid,
      ...(context?.traceId ? { 'trace.id': context.traceId } : {}),
      ...(context?.transactionId ? { 'transaction.id': context.transactionId } : {}),
      ...(context?.userId ? { 'user.id': context.userId } : {}),
      ...(context?.clientIp ? { 'client.ip': context.clientIp } : {}),
      ...(context?.requestId ? { labels: { request_id: context.requestId } } : {}),
    };

    const sanitizedMeta = LogSanitizer.sanitize(meta) as Record<string, unknown>;

    for (const [key, value] of Object.entries(sanitizedMeta)) {
      if (key === 'labels' && typeof value === 'object' && value !== null) {
        entry.labels = { ...entry.labels, ...(value as Record<string, string>) };
      } else if (key === 'event' && typeof value === 'object' && value !== null) {
        entry.event = { ...entry.event, ...(value as Record<string, unknown>) };
      } else if (key === 'http' && typeof value === 'object' && value !== null) {
        entry.http = { ...entry.http, ...(value as Record<string, unknown>) };
      } else if (key === 'url' && typeof value === 'object' && value !== null) {
        entry.url = { ...entry.url, ...(value as Record<string, unknown>) };
      } else if (key === 'error' && typeof value === 'object' && value !== null) {
        entry.error = { ...entry.error, ...(value as Record<string, unknown>) };
      } else if (!entry[key]) {
        entry[key] = value;
      }
    }

    this.output(entry);
  }

  // ── Internal formatting and output ────────────────────────────────────────

  private writeEntry(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    let msgStr = '';
    let meta: Record<string, unknown> = {};
    let errorDetails: { type: string; message: string; stack_trace?: string } | undefined;

    const isProd = this.environment === 'production';

    if (message instanceof Error) {
      msgStr = message.message;
      errorDetails = LogSanitizer.normalizeError(message, isProd);
    } else if (typeof message === 'string') {
      msgStr = message;
    } else if (typeof message === 'object' && message !== null) {
      msgStr = JSON.stringify(LogSanitizer.sanitize(message));
    } else {
      msgStr = String(message);
    }

    // Process optionalParams (context string, error stack, or metadata object)
    for (const param of optionalParams) {
      if (param instanceof Error) {
        errorDetails = LogSanitizer.normalizeError(param, isProd);
      } else if (typeof param === 'string') {
        if (param.includes('\n') && level === 'error') {
          // Likely stack trace
          errorDetails = {
            type: errorDetails?.type ?? 'Error',
            message: errorDetails?.message ?? msgStr,
            ...(isProd ? {} : { stack_trace: LogSanitizer.sanitizeString(param) }),
          };
        } else {
          // Logger context name (e.g., 'OriginGuard', 'Bootstrap')
          meta['log.logger'] = param;
        }
      } else if (typeof param === 'object' && param !== null) {
        const sanitized = LogSanitizer.sanitize(param) as Record<string, unknown>;
        meta = { ...meta, ...sanitized };
      }
    }

    // Auto-extract bracketed action / outcome for backwards compatibility (low-trust presentation fallback).
    // IMPORTANT: NEVER extract userId from message strings and NEVER mutate RequestContextService here.
    const bracketMatch =
      /\[action=([a-z0-9_.]+)(?:,\s*outcome=(success|failure|unknown))?[^\]]*\]/i.exec(
        msgStr,
      );
    if (bracketMatch) {
      const action = bracketMatch[1];
      const outcome = (bracketMatch[2]?.toLowerCase() ?? 'success') as
        | 'success'
        | 'failure'
        | 'unknown';
      if (!meta['event']) {
        meta['event'] = { action, outcome };
      }
    }

    const context = RequestContextService.get();

    const entry: EcsLogEntry = {
      '@timestamp': new Date().toISOString(),
      'ecs.version': '8.11.0',
      'log.level': level,
      message: LogSanitizer.sanitizeString(msgStr),
      'service.name': this.serviceName,
      'service.environment': this.environment,
      'process.pid': process.pid,
      ...(context?.traceId ? { 'trace.id': context.traceId } : {}),
      ...(context?.transactionId ? { 'transaction.id': context.transactionId } : {}),
      ...(context?.userId ? { 'user.id': context.userId } : {}),
      ...(context?.clientIp ? { 'client.ip': context.clientIp } : {}),
      ...(context?.requestId ? { labels: { request_id: context.requestId } } : {}),
      ...(errorDetails ? { error: errorDetails } : {}),
    };

    // Merge meta fields into entry
    for (const [key, val] of Object.entries(meta)) {
      if (key === 'labels' && typeof val === 'object' && val !== null) {
        entry.labels = { ...entry.labels, ...(val as Record<string, string>) };
      } else if (key === 'event' && typeof val === 'object' && val !== null) {
        entry.event = { ...entry.event, ...(val as Record<string, unknown>) };
      } else if (key === 'http' && typeof val === 'object' && val !== null) {
        entry.http = { ...entry.http, ...(val as Record<string, unknown>) };
      } else if (key === 'url' && typeof val === 'object' && val !== null) {
        entry.url = { ...entry.url, ...(val as Record<string, unknown>) };
      } else if (!entry[key]) {
        entry[key] = val;
      }
    }

    this.output(entry);
  }

  private output(entry: EcsLogEntry): void {
    if (StructuredLoggerService.logSink) {
      StructuredLoggerService.logSink(entry);
    }

    const jsonLine = JSON.stringify(entry);

    if (entry['log.level'] === 'error' || entry['log.level'] === 'fatal') {
      process.stderr.write(jsonLine + '\n');
    } else {
      process.stdout.write(jsonLine + '\n');
    }
  }
}
