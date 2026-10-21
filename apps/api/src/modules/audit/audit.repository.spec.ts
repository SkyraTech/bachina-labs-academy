import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRepository } from './audit.repository.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '@prisma/client';
import type { ValidatedAuditData } from './validators/audit-validator.js';

describe('AuditRepository', () => {
  let repository: AuditRepository;
  let mockPrismaService: any;
  let mockTxClient: any;

  const validData: ValidatedAuditData = {
    actorId: 'a0000000-0000-4000-8000-000000000001',
    actorType: 'USER',
    action: 'auth.login.succeeded',
    resourceType: 'SESSION',
    resourceId: 'sess-abc',
    outcome: 'SUCCESS',
    traceId: '0123456789abcdef0123456789abcdef',
    requestId: 'req-xyz',
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    metadata: { authMethod: 'PASSWORD', rememberMe: true },
  };

  const mockDbRecord = {
    id: 'f0000000-0000-4000-8000-000000000099',
    actorId: validData.actorId,
    actorType: validData.actorType,
    action: validData.action,
    resourceType: validData.resourceType,
    resourceId: validData.resourceId,
    outcome: validData.outcome,
    traceId: validData.traceId,
    requestId: validData.requestId,
    ipAddress: validData.ipAddress,
    userAgent: validData.userAgent,
    metadata: validData.metadata,
    createdAt: new Date('2026-10-20T12:00:00Z'),
  };

  beforeEach(() => {
    mockPrismaService = {
      auditLog: {
        create: vi.fn().mockResolvedValue(mockDbRecord),
      },
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ set_config: '4000' }]),
          $executeRaw: vi.fn().mockResolvedValue(undefined),
          $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
          auditLog: {
            create: vi.fn().mockResolvedValue(mockDbRecord),
          },
        };
        return await callback(tx);
      }),
    };

    mockTxClient = {
      auditLog: {
        create: vi.fn().mockResolvedValue(mockDbRecord),
      },
    };

    repository = new AuditRepository(mockPrismaService as unknown as PrismaService);
  });

  it('persists audit log using global prisma when no transaction client is provided', async () => {
    const result = await repository.create(validData);

    expect(mockPrismaService.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: validData.actorId,
        actorType: validData.actorType,
        action: validData.action,
        resourceType: validData.resourceType,
        resourceId: validData.resourceId,
        outcome: validData.outcome,
        traceId: validData.traceId,
        requestId: validData.requestId,
        ipAddress: validData.ipAddress,
        userAgent: validData.userAgent,
        metadata: validData.metadata,
      },
    });

    expect(result.id).toBe(mockDbRecord.id);
    expect(result.action).toBe(validData.action);
    expect(result.actorId).toBe(validData.actorId);
    expect(result.createdAt).toEqual(mockDbRecord.createdAt);
  });

  it('persists audit log using provided transaction client (tx) when supplied', async () => {
    const result = await repository.create(validData, mockTxClient as Prisma.TransactionClient);

    expect(mockTxClient.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrismaService.auditLog.create).not.toHaveBeenCalled();

    expect(result.id).toBe(mockDbRecord.id);
    expect(result.outcome).toBe(validData.outcome);
  });

  it('persists bounded independent write with dedicated transaction and SET LOCAL statement_timeout', async () => {
    const result = await repository.createIndependentBounded(validData, {
      maxWaitMs: 1500,
      statementTimeoutMs: 3000,
      transactionTimeoutMs: 4000,
    });

    expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    const [, options] = mockPrismaService.$transaction.mock.calls[0];
    expect(options).toEqual({ maxWait: 1500, timeout: 4000 });
    expect(result.id).toBe(mockDbRecord.id);
  });

  it('sanitizes invalid and extreme timeout bounds safely (NaN, negative, Infinity, clamped limits)', async () => {
    const result = await repository.createIndependentBounded(validData, {
      maxWaitMs: NaN,
      statementTimeoutMs: -500,
      transactionTimeoutMs: Infinity,
    });

    expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    const [, options] = mockPrismaService.$transaction.mock.calls[0];
    // maxWait falls back to 2000, transactionTimeout falls back to 5000
    expect(options).toEqual({ maxWait: 2000, timeout: 5000 });
    expect(result.id).toBe(mockDbRecord.id);
  });

  it('propagates database errors thrown by Prisma without suppressing them', async () => {
    const dbError = new Error('Database connection failed');
    mockPrismaService.auditLog.create.mockRejectedValueOnce(dbError);

    await expect(repository.create(validData)).rejects.toThrow('Database connection failed');
  });

  it('propagates transaction client errors without suppressing them', async () => {
    const txError = new Error('Transaction aborted');
    mockTxClient.auditLog.create.mockRejectedValueOnce(txError);

    await expect(
      repository.create(validData, mockTxClient as Prisma.TransactionClient),
    ).rejects.toThrow('Transaction aborted');
  });
});
