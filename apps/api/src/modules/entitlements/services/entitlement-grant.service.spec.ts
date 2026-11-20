import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementType, EntitlementSource } from '@prisma/client';
import { EntitlementGrantService } from './entitlement-grant.service.js';
import type { EntitlementGrantRepository } from '../repositories/entitlement-grant.repository.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('EntitlementGrantService', () => {
  let service: EntitlementGrantService;
  let repoMock: {
    createGrant: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findActiveGrants: ReturnType<typeof vi.fn>;
    revokeGrant: ReturnType<typeof vi.fn>;
  };
  let prismaMock: {
    $transaction: ReturnType<typeof vi.fn>;
  };
  let auditServiceMock: {
    recordTransactional: ReturnType<typeof vi.fn>;
  };

  const userId = '22222222-2222-4222-8222-222222222222';
  const grantId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    repoMock = {
      createGrant: vi.fn(),
      findById: vi.fn(),
      findActiveGrants: vi.fn(),
      revokeGrant: vi.fn(),
    };
    prismaMock = {
      $transaction: vi.fn(async (cb) => cb({})),
    };
    auditServiceMock = {
      recordTransactional: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    service = new EntitlementGrantService(
      repoMock as unknown as EntitlementGrantRepository,
      prismaMock as unknown as PrismaService,
      auditServiceMock as unknown as AuditService,
    );
  });

  it('records entitlement.issued audit event in transaction when issuing a grant', async () => {
    const validFrom = new Date('2026-01-01T00:00:00.000Z');
    const validUntil = new Date('2026-12-31T23:59:59.000Z');
    const mockGrant = {
      id: grantId,
      userId,
      entitlementType: EntitlementType.PREMIUM_CONTENT,
      source: EntitlementSource.COMPLIMENTARY,
      validFrom,
      validUntil,
      revokedAt: null,
      revocationReason: null,
      grantedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repoMock.createGrant.mockResolvedValue(mockGrant);

    const result = await service.issueGrant({
      userId,
      validFrom,
      validUntil,
    });

    expect(result).toEqual(mockGrant);
    expect(repoMock.createGrant).toHaveBeenCalledWith(
      {
        userId,
        validFrom,
        validUntil,
      },
      expect.anything(),
    );
    expect(auditServiceMock.recordTransactional).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'entitlement.issued',
        resourceType: 'ENTITLEMENT',
        resourceId: grantId,
        outcome: 'SUCCESS',
        metadata: {
          grantId,
          targetUserId: userId,
          entitlementType: EntitlementType.PREMIUM_CONTENT,
          source: EntitlementSource.COMPLIMENTARY,
          validFrom: validFrom.toISOString(),
          validUntil: validUntil.toISOString(),
        },
      }),
    );
  });

  it('aborts transaction and propagates error if grant issuance audit write fails', async () => {
    const validFrom = new Date('2026-01-01T00:00:00.000Z');
    const validUntil = new Date('2026-12-31T23:59:59.000Z');
    repoMock.createGrant.mockResolvedValue({
      id: grantId,
      userId,
      entitlementType: EntitlementType.PREMIUM_CONTENT,
      source: EntitlementSource.COMPLIMENTARY,
      validFrom,
      validUntil,
      revokedAt: null,
      revocationReason: null,
      grantedById: null,
    });
    auditServiceMock.recordTransactional.mockRejectedValue(new Error('Audit DB write failed'));

    await expect(
      service.issueGrant({
        userId,
        validFrom,
        validUntil,
      }),
    ).rejects.toThrow('Audit DB write failed');
  });

  it('delegates getActiveGrants to repository', async () => {
    repoMock.findActiveGrants.mockResolvedValue([]);

    const result = await service.getActiveGrants(userId);

    expect(result).toEqual([]);
    expect(repoMock.findActiveGrants).toHaveBeenCalledWith(userId, undefined, undefined);
  });

  it('throws NotFoundException if revoking non-existent grant', async () => {
    repoMock.findById.mockResolvedValue(null);

    await expect(service.revokeGrant(grantId, 'Customer requested refund')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException if revoking an already-revoked grant (idempotency, AH-20)', async () => {
    const mockAlreadyRevoked = {
      id: grantId,
      userId,
      revokedAt: new Date('2026-05-01T10:00:00Z'),
      revocationReason: 'Original revocation',
    };
    repoMock.findById.mockResolvedValue(mockAlreadyRevoked);

    await expect(service.revokeGrant(grantId, 'Second revocation attempt')).rejects.toThrow(
      BadRequestException,
    );

    expect(repoMock.revokeGrant).not.toHaveBeenCalled();
    expect(auditServiceMock.recordTransactional).not.toHaveBeenCalled();
  });

  it('records entitlement.revoked audit event in transaction when revoking grant', async () => {
    const mockExisting = { id: grantId, userId, revokedAt: null };
    const revokedAt = new Date('2026-06-01T12:00:00.000Z');
    const mockRevoked = {
      ...mockExisting,
      revokedAt,
      revocationReason: 'Terms violation',
    };
    repoMock.findById.mockResolvedValue(mockExisting);
    repoMock.revokeGrant.mockResolvedValue(mockRevoked);

    const result = await service.revokeGrant(grantId, 'Terms violation', revokedAt);

    expect(result).toEqual(mockRevoked);
    expect(repoMock.revokeGrant).toHaveBeenCalledWith(grantId, 'Terms violation', revokedAt, expect.anything());
    expect(auditServiceMock.recordTransactional).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'entitlement.revoked',
        resourceType: 'ENTITLEMENT',
        resourceId: grantId,
        outcome: 'SUCCESS',
        metadata: {
          grantId,
          targetUserId: userId,
          revocationReason: 'Terms violation',
          revokedAt: revokedAt.toISOString(),
        },
      }),
    );
  });

  it('aborts transaction and propagates error if grant revocation audit write fails', async () => {
    const mockExisting = { id: grantId, userId, revokedAt: null };
    const revokedAt = new Date('2026-06-01T12:00:00.000Z');
    repoMock.findById.mockResolvedValue(mockExisting);
    repoMock.revokeGrant.mockResolvedValue({
      ...mockExisting,
      revokedAt,
      revocationReason: 'Terms violation',
    });
    auditServiceMock.recordTransactional.mockRejectedValue(new Error('Audit DB write failed'));

    await expect(service.revokeGrant(grantId, 'Terms violation', revokedAt)).rejects.toThrow(
      'Audit DB write failed',
    );
  });
});
