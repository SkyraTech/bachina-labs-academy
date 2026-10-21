import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export interface RequestContext {
  /** Server-controlled correlation identifier (UUID or validated upstream ID) */
  requestId: string;
  /** W3C-compatible 32-hex character distributed trace identifier */
  traceId: string;
  /** W3C-compatible 16-hex character transaction/span identifier */
  transactionId: string;
  /** Authenticated user identifier (UUID) when resolved */
  userId?: string;
  /** Resolved, proxy-trust-aware client IP */
  clientIp?: string;
  /** High-resolution start time via process.hrtime.bigint() */
  startTime: bigint;
  /** Sanitized HTTP request method */
  method?: string;
  /** Sanitized HTTP route path (query parameters stripped) */
  path?: string;
}

@Injectable()
export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Executes a callback within an isolated asynchronous request context.
   */
  static run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  /**
   * Retrieves the current asynchronous request context, if active.
   */
  static get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Retrieves the current correlation / request ID, if active.
   */
  static getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  /**
   * Retrieves the current trace ID, if active.
   */
  static getTraceId(): string | undefined {
    return this.storage.getStore()?.traceId;
  }

  /**
   * Mutates the current context to bind an authenticated user ID.
   */
  static setUserId(userId: string): void {
    const store = this.storage.getStore();
    if (store) {
      store.userId = userId;
    }
  }

  /**
   * Helper to construct a fresh, compliant context for out-of-request jobs or testing.
   */
  static createContext(partial: Partial<RequestContext> = {}): RequestContext {
    return {
      requestId: partial.requestId ?? randomUUID(),
      traceId: partial.traceId ?? randomBytes(16).toString('hex'),
      transactionId: partial.transactionId ?? randomBytes(8).toString('hex'),
      startTime: partial.startTime ?? process.hrtime.bigint(),
      userId: partial.userId,
      clientIp: partial.clientIp,
      method: partial.method,
      path: partial.path,
    };
  }

  // Instance delegations for NestJS dependency injection
  run<T>(context: RequestContext, callback: () => T): T {
    return RequestContextService.run(context, callback);
  }

  get(): RequestContext | undefined {
    return RequestContextService.get();
  }

  getRequestId(): string | undefined {
    return RequestContextService.getRequestId();
  }

  getTraceId(): string | undefined {
    return RequestContextService.getTraceId();
  }

  setUserId(userId: string): void {
    RequestContextService.setUserId(userId);
  }

  createContext(partial?: Partial<RequestContext>): RequestContext {
    return RequestContextService.createContext(partial);
  }
}
