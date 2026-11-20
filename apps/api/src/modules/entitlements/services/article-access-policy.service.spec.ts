import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccessPolicyTier } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { ArticleAccessPolicyService } from './article-access-policy.service.js';
import type { ArticleAccessPolicyRepository } from '../repositories/article-access-policy.repository.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { AuditService } from '../../audit/audit.service.js';

describe('ArticleAccessPolicyService', () => {
  let service: ArticleAccessPolicyService;
  let repoMock: {
    resolveEffectiveTier: ReturnType<typeof vi.fn>;
    findByArticleId: ReturnType<typeof vi.fn>;
    upsertPolicy: ReturnType<typeof vi.fn>;
  };
  let prismaMock: {
    $transaction: ReturnType<typeof vi.fn>;
  };
  let auditServiceMock: {
    recordTransactional: ReturnType<typeof vi.fn>;
  };

  const articleId = '11111111-1111-4111-8111-111111111111';
  const policyId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    repoMock = {
      resolveEffectiveTier: vi.fn(),
      findByArticleId: vi.fn(),
      upsertPolicy: vi.fn(),
    };
    prismaMock = {
      $transaction: vi.fn(async (cb) => cb({})),
    };
    auditServiceMock = {
      recordTransactional: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    service = new ArticleAccessPolicyService(
      repoMock as unknown as ArticleAccessPolicyRepository,
      prismaMock as unknown as PrismaService,
      auditServiceMock as unknown as AuditService,
    );
  });

  it('delegates getEffectiveTier to repository and resolves FREE by default', async () => {
    repoMock.resolveEffectiveTier.mockResolvedValue(AccessPolicyTier.FREE);

    const tier = await service.getEffectiveTier(articleId);

    expect(tier).toBe(AccessPolicyTier.FREE);
    expect(repoMock.resolveEffectiveTier).toHaveBeenCalledWith(articleId);
  });

  it('fail-closed lock rejects setting policy to PREMIUM before database write or transaction', async () => {
    await expect(
      service.setPolicy(articleId, AccessPolicyTier.PREMIUM, 'Attempting premium activation'),
    ).rejects.toThrow(ForbiddenException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(repoMock.upsertPolicy).not.toHaveBeenCalled();
    expect(auditServiceMock.recordTransactional).not.toHaveBeenCalled();
  });

  it('records policy.created audit event when creating initial policy in transaction with tier FREE', async () => {
    const mockRecord = {
      id: policyId,
      articleId,
      tier: AccessPolicyTier.FREE,
      note: 'Initial free policy',
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repoMock.findByArticleId.mockResolvedValue(null);
    repoMock.upsertPolicy.mockResolvedValue(mockRecord);

    const result = await service.setPolicy(articleId, AccessPolicyTier.FREE, 'Initial free policy');

    expect(result).toEqual(mockRecord);
    expect(repoMock.upsertPolicy).toHaveBeenCalledWith(
      articleId,
      AccessPolicyTier.FREE,
      'Initial free policy',
      undefined,
      expect.anything(),
    );
    expect(auditServiceMock.recordTransactional).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'policy.created',
        resourceType: 'ACCESS_POLICY',
        resourceId: policyId,
        outcome: 'SUCCESS',
        metadata: {
          articleId,
          policyId,
          tier: AccessPolicyTier.FREE,
          note: 'Initial free policy',
        },
      }),
    );
  });

  it('does not emit policy.tier_changed when updating existing policy with same tier (no-op tier update, AH-25)', async () => {
    const existing = {
      id: policyId,
      articleId,
      tier: AccessPolicyTier.FREE,
      note: 'Initial note',
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated = {
      ...existing,
      note: 'Updated note only',
    };
    repoMock.findByArticleId.mockResolvedValue(existing);
    repoMock.upsertPolicy.mockResolvedValue(updated);

    const result = await service.setPolicy(articleId, AccessPolicyTier.FREE, 'Updated note only');

    expect(result).toEqual(updated);
    expect(repoMock.upsertPolicy).toHaveBeenCalledWith(
      articleId,
      AccessPolicyTier.FREE,
      'Updated note only',
      undefined,
      expect.anything(),
    );
    // Should NOT record policy.tier_changed because tier did not transition
    expect(auditServiceMock.recordTransactional).not.toHaveBeenCalled();
  });

  it('aborts transaction and propagates error if audit write fails', async () => {
    repoMock.findByArticleId.mockResolvedValue(null);
    repoMock.upsertPolicy.mockResolvedValue({
      id: policyId,
      articleId,
      tier: AccessPolicyTier.FREE,
      note: null,
      updatedById: null,
    });
    auditServiceMock.recordTransactional.mockRejectedValue(new Error('Audit DB write failed'));

    await expect(service.setPolicy(articleId, AccessPolicyTier.FREE)).rejects.toThrow('Audit DB write failed');
  });
});
