import { describe, it, expect } from 'vitest';
import { RequestContextService, RequestContext } from './request-context.service';

describe('RequestContextService', () => {
  it('returns undefined when accessed outside of an active context', () => {
    expect(RequestContextService.get()).toBeUndefined();
    expect(RequestContextService.getRequestId()).toBeUndefined();
    expect(RequestContextService.getTraceId()).toBeUndefined();
  });

  it('runs within an active context and provides request properties', () => {
    const context: RequestContext = {
      requestId: 'req-123',
      traceId: 'trace-456',
      transactionId: 'txn-789',
      clientIp: '192.0.2.1',
      startTime: process.hrtime.bigint(),
      method: 'GET',
      path: '/health',
    };

    RequestContextService.run(context, () => {
      expect(RequestContextService.get()).toEqual(context);
      expect(RequestContextService.getRequestId()).toBe('req-123');
      expect(RequestContextService.getTraceId()).toBe('trace-456');
    });
  });

  it('preserves context across asynchronous promises and awaits', async () => {
    const context = RequestContextService.createContext({ requestId: 'async-test-id' });

    await RequestContextService.run(context, async () => {
      expect(RequestContextService.getRequestId()).toBe('async-test-id');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(RequestContextService.getRequestId()).toBe('async-test-id');
    });

    expect(RequestContextService.getRequestId()).toBeUndefined();
  });

  it('isolates concurrent requests without leaking or overwriting state', async () => {
    const runTask = async (id: string, delayMs: number): Promise<string | undefined> => {
      const context = RequestContextService.createContext({ requestId: id });
      return RequestContextService.run(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return RequestContextService.getRequestId();
      });
    };

    const results = await Promise.all([
      runTask('task-1', 20),
      runTask('task-2', 10),
      runTask('task-3', 15),
      runTask('task-4', 5),
    ]);

    expect(results).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
  });

  it('allows binding an authenticated user ID to the current context', () => {
    const context = RequestContextService.createContext();

    RequestContextService.run(context, () => {
      expect(RequestContextService.get()?.userId).toBeUndefined();
      RequestContextService.setUserId('user-uuid-999');
      expect(RequestContextService.get()?.userId).toBe('user-uuid-999');
    });
  });

  it('delegates instance methods to static implementation', () => {
    const service = new RequestContextService();
    const context = service.createContext({ requestId: 'inst-test' });

    service.run(context, () => {
      expect(service.getRequestId()).toBe('inst-test');
      expect(service.getTraceId()).toBeDefined();
      expect(service.get()?.requestId).toBe('inst-test');
      service.setUserId('user-inst');
      expect(service.get()?.userId).toBe('user-inst');
    });

    const defaultCtx = service.createContext();
    expect(defaultCtx.requestId).toBeDefined();
  });
});
