import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service.js';
import { AuditRepository } from './audit.repository.js';
import {
  AuditIndependentWriteError,
  AuditValidationError,
} from './errors/audit-validation.error.js';
import { RequestContextService } from '../../common/observability/request-context.service.js';
import {
  AuditActorFactory,
  type IndependentAuditEvent,
  type TransactionalAuditEvent,
} from './types/audit-event.types.js';
import type { Prisma } from '@prisma/client';

describe('AuditService', () => {
  let service: AuditService;
  let mockRepository: any;
  let mockTx: Prisma.TransactionClient;

  const validUserUuid = 'a0000000-0000-4000-8000-000000000001';

  const validTransactionalEvent: TransactionalAuditEvent = {
    action: 'auth.login.succeeded',
    actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: validUserUuid }),
    resourceType: 'SESSION',
    resourceId: 'sess-100',
    outcome: 'SUCCESS',
    metadata: {
      authMethod: 'PASSWORD',
      rememberMe: false,
    },
  };

  const validIndependentEvent: IndependentAuditEvent = {
    action: 'auth.session.replay_detected',
    actor: AuditActorFactory.forAnonymous(),
    resourceType: 'SESSION',
    resourceId: 'compromised-session-200',
    outcome: 'DENIED',
    metadata: {
      incidentClassification: 'SUSPICIOUS_REUSE',
      revocationReason: 'TOKEN_REUSE_DETECTED',
    },
  };

  const mockCreatedRecord = {
    id: 'f0000000-0000-4000-8000-000000000099',
    actorId: validUserUuid,
    actorType: 'USER' as const,
    action: 'auth.login.succeeded',
    resourceType: 'SESSION',
    resourceId: 'sess-100',
    outcome: 'SUCCESS' as const,
    traceId: '0123456789abcdef0123456789abcdef',
    requestId: 'req-001',
    ipAddress: '127.0.0.1',
    userAgent: 'Agent/1.0',
    metadata: { authMethod: 'PASSWORD', rememberMe: false },
    createdAt: new Date(),
  };

  beforeEach(() => {
    mockRepository = {
      create: vi.fn().mockResolvedValue(mockCreatedRecord),
      createIndependentBounded: vi.fn().mockResolvedValue(mockCreatedRecord),
    };

    mockTx = {} as Prisma.TransactionClient;

    service = new AuditService(mockRepository as unknown as AuditRepository);
  });

  describe('recordTransactional', () => {
    it('records event within active Prisma transaction', async () => {
      const result = await service.recordTransactional(mockTx, validTransactionalEvent);

      expect(mockRepository.create).toHaveBeenCalledTimes(1);
      const [calledData, calledTx] = mockRepository.create.mock.calls[0];
      expect(calledTx).toBe(mockTx);
      expect(calledData.action).toBe('auth.login.succeeded');
      expect(calledData.actorId).toBe(validUserUuid);
      expect(result.id).toBe(mockCreatedRecord.id);
    });

    it('rejects if transaction client (tx) is missing or undefined', async () => {
      await expect(
        service.recordTransactional(undefined as any, validTransactionalEvent),
      ).rejects.toThrow(AuditValidationError);
      await expect(
        service.recordTransactional(undefined as any, validTransactionalEvent),
      ).rejects.toThrow(/Active Prisma transaction client \(tx\) is required/);
    });

    it('rejects if non-transactional event is submitted to recordTransactional', async () => {
      const event: any = {
        ...validIndependentEvent,
      };
      await expect(service.recordTransactional(mockTx, event)).rejects.toThrow(
        AuditValidationError,
      );
      await expect(service.recordTransactional(mockTx, event)).rejects.toThrow(
        /not eligible for transactional recording/,
      );
    });

    it('enriches traceId, requestId, and ipAddress from RequestContext if omitted', async () => {
      const mockContext = RequestContextService.createContext({
        requestId: 'enriched-req-123',
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        clientIp: '192.168.1.50',
      });

      await RequestContextService.run(mockContext, async () => {
        await service.recordTransactional(mockTx, validTransactionalEvent);
      });

      const [calledData] = mockRepository.create.mock.calls[0];
      expect(calledData.requestId).toBe('enriched-req-123');
      expect(calledData.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(calledData.ipAddress).toBe('192.168.1.50');
    });

    it('propagates repository error without suppressing it, ensuring outer tx rollback', async () => {
      const repoError = new Error('PostgreSQL constraint check failed');
      mockRepository.create.mockRejectedValueOnce(repoError);

      await expect(
        service.recordTransactional(mockTx, validTransactionalEvent),
      ).rejects.toThrow('PostgreSQL constraint check failed');
    });
  });

  describe('recordIndependent', () => {
    it('records approved independent high-risk security event without tx and returns PERSISTED status', async () => {
      mockRepository.createIndependentBounded.mockResolvedValueOnce({
        ...mockCreatedRecord,
        action: 'auth.session.replay_detected',
        actorType: 'ANONYMOUS',
        actorId: null,
      });

      const result = await service.recordIndependent(validIndependentEvent);

      expect(mockRepository.createIndependentBounded).toHaveBeenCalledTimes(1);
      const [calledData, calledOptions] = mockRepository.createIndependentBounded.mock.calls[0];
      expect(calledOptions.transactionTimeoutMs).toBe(5000);
      expect(calledData.action).toBe('auth.session.replay_detected');
      expect(result.status).toBe('PERSISTED');
      expect(result.record).not.toBeNull();
      expect(service.getActiveIndependentWrites()).toBe(0);
    });

    it('rejects mandatory transactional events from being downgraded to independent writes', async () => {
      const result = await service.recordIndependent(validTransactionalEvent as any);
      expect(result.status).toBe('REJECTED_VALIDATION');
      expect(result.error).toBeInstanceOf(AuditValidationError);

      await expect(
        service.recordIndependent(validTransactionalEvent as any, { throwOnError: true }),
      ).rejects.toThrow(AuditValidationError);
    });

    it('enforces concurrency limit and drops event when limit is reached', async () => {
      // Simulate exhausting the concurrency limit
      (service as any).activeIndependentWrites = 10;

      const result = await service.recordIndependent(validIndependentEvent);
      expect(result.status).toBe('REJECTED_CONCURRENCY');
      expect(result.record).toBeNull();
      expect(mockRepository.createIndependentBounded).not.toHaveBeenCalled();

      // If throwOnError: true, throws AuditIndependentWriteError
      await expect(
        service.recordIndependent(validIndependentEvent, { throwOnError: true }),
      ).rejects.toThrow(AuditIndependentWriteError);
    });

    it('handles repository timeout safely: returns WAIT_TIMEOUT_PENDING and retains slot until actual settlement', async () => {
      let resolveDelayedWrite: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveDelayedWrite = resolve;
      });

      mockRepository.createIndependentBounded.mockImplementation(() => delayedPromise);

      const result = await service.recordIndependent(validIndependentEvent, {
        timeoutMs: 30,
        throwOnError: false,
      });

      // 1. Caller receives WAIT_TIMEOUT_PENDING
      expect(result.status).toBe('WAIT_TIMEOUT_PENDING');
      expect(result.record).toBeNull();
      expect(result.timeoutMs).toBe(30);

      // 2. CRITICAL: Concurrency slot remains held because underlying database write is still pending!
      expect(service.getActiveIndependentWrites()).toBe(1);

      // 3. When the database write finally completes later, the slot is safely released
      resolveDelayedWrite!(mockCreatedRecord);
      await (result as any).settlementPromise;

      expect(service.getActiveIndependentWrites()).toBe(0);
    });

    it('handles delayed write rejection after timeout safely without unhandled rejection', async () => {
      let rejectDelayedWrite: (err: any) => void;
      const delayedPromise = new Promise((_, reject) => {
        rejectDelayedWrite = reject;
      });

      mockRepository.createIndependentBounded.mockImplementation(() => delayedPromise);

      const result = await service.recordIndependent(validIndependentEvent, {
        timeoutMs: 30,
        throwOnError: false,
      });

      expect(result.status).toBe('WAIT_TIMEOUT_PENDING');
      expect(service.getActiveIndependentWrites()).toBe(1);

      // Database eventually errors
      rejectDelayedWrite!(new Error('Query killed by DBA'));
      await (result as any).settlementPromise;

      // Slot is released safely
      expect(service.getActiveIndependentWrites()).toBe(0);
    });

    it('handles immediate repository failure safely with CONFIRMED_FAILURE status when throwOnError is false', async () => {
      mockRepository.createIndependentBounded.mockRejectedValueOnce(new Error('Connection terminated'));

      const result = await service.recordIndependent(validIndependentEvent, {
        throwOnError: false,
      });
      expect(result.status).toBe('CONFIRMED_FAILURE');
      expect(result.record).toBeNull();
      expect(result.error?.message).toBe('Connection terminated');
      expect(service.getActiveIndependentWrites()).toBe(0);
    });

    it('rethrows AuditIndependentWriteError when throwOnError is true', async () => {
      mockRepository.createIndependentBounded.mockRejectedValueOnce(new Error('Connection terminated'));

      await expect(
        service.recordIndependent(validIndependentEvent, { throwOnError: true }),
      ).rejects.toThrow(AuditIndependentWriteError);
      expect(service.getActiveIndependentWrites()).toBe(0);
    });
  });
});
