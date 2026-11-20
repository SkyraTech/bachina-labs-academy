import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AccessPolicyTier,
  ArticleStatus,
  UserRole,
  UserStatus,
  EntitlementType,
  EntitlementSource,
} from '@prisma/client';
import { AccessDecisionService } from './access-decision.service.js';
import type { ArticleAccessPolicyRepository } from '../repositories/article-access-policy.repository.js';
import type { EntitlementGrantRepository } from '../repositories/entitlement-grant.repository.js';

describe('AccessDecisionService (Internal Tier 1 Evaluation)', () => {
  let service: AccessDecisionService;
  let policyRepositoryMock: {
    resolveEffectiveTier: ReturnType<typeof vi.fn>;
    findByArticleId: ReturnType<typeof vi.fn>;
    upsertPolicy: ReturnType<typeof vi.fn>;
  };
  let grantRepositoryMock: {
    findActiveGrants: ReturnType<typeof vi.fn>;
    createGrant: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    revokeGrant: ReturnType<typeof vi.fn>;
  };

  const articleId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const now = new Date('2026-11-20T12:00:00Z');

  beforeEach(() => {
    policyRepositoryMock = {
      resolveEffectiveTier: vi.fn(),
      findByArticleId: vi.fn(),
      upsertPolicy: vi.fn(),
    };
    grantRepositoryMock = {
      findActiveGrants: vi.fn(),
      createGrant: vi.fn(),
      findById: vi.fn(),
      revokeGrant: vi.fn(),
    };

    service = new AccessDecisionService(
      policyRepositoryMock as unknown as ArticleAccessPolicyRepository,
      grantRepositoryMock as unknown as EntitlementGrantRepository,
    );
  });

  describe('Publication Status Gates', () => {
    it('returns NOT_FOUND for DRAFT articles regardless of policy', async () => {
      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.DRAFT,
      });

      expect(result).toEqual({ outcome: 'NOT_FOUND' });
      expect(policyRepositoryMock.resolveEffectiveTier).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND for ARCHIVED articles regardless of policy', async () => {
      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.ARCHIVED,
      });

      expect(result).toEqual({ outcome: 'NOT_FOUND' });
      expect(policyRepositoryMock.resolveEffectiveTier).not.toHaveBeenCalled();
    });
  });

  describe('Default FREE Behavior (POD-25)', () => {
    it('grants access when repository resolves default FREE (no policy row exists)', async () => {
      policyRepositoryMock.resolveEffectiveTier.mockResolvedValue(AccessPolicyTier.FREE);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: null, // anonymous
      });

      expect(result).toEqual({ outcome: 'GRANT_FREE' });
      expect(policyRepositoryMock.resolveEffectiveTier).toHaveBeenCalledWith(articleId);
      expect(grantRepositoryMock.findActiveGrants).not.toHaveBeenCalled();
    });

    it('grants access when explicit FREE policy is configured', async () => {
      policyRepositoryMock.resolveEffectiveTier.mockResolvedValue(AccessPolicyTier.FREE);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.ACTIVE,
        },
      });

      expect(result).toEqual({ outcome: 'GRANT_FREE' });
    });
  });

  describe('PREMIUM Policy Evaluation (POD-26)', () => {
    beforeEach(() => {
      policyRepositoryMock.resolveEffectiveTier.mockResolvedValue(AccessPolicyTier.PREMIUM);
    });

    it('denies anonymous visitors on PREMIUM content with AUTHENTICATION_REQUIRED', async () => {
      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: null,
      });

      expect(result).toEqual({
        outcome: 'DENY_ANONYMOUS',
        reason: 'AUTHENTICATION_REQUIRED',
      });
      expect(grantRepositoryMock.findActiveGrants).not.toHaveBeenCalled();
    });

    it('denies SUSPENDED users on PREMIUM content with DENY_ACCOUNT_RESTRICTED', async () => {
      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.SUSPENDED,
        },
      });

      expect(result).toEqual({
        outcome: 'DENY_ACCOUNT_RESTRICTED',
        status: UserStatus.SUSPENDED,
      });
      expect(grantRepositoryMock.findActiveGrants).not.toHaveBeenCalled();
    });

    it('denies DISABLED users on PREMIUM content with DENY_ACCOUNT_RESTRICTED', async () => {
      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.DISABLED,
        },
      });

      expect(result).toEqual({
        outcome: 'DENY_ACCOUNT_RESTRICTED',
        status: UserStatus.DISABLED,
      });
    });

    it('grants access when user has an active, valid EntitlementGrant', async () => {
      const validUntil = new Date('2026-12-31T23:59:59Z');
      grantRepositoryMock.findActiveGrants.mockResolvedValue([
        {
          id: 'grant-001',
          userId,
          entitlementType: EntitlementType.PREMIUM_CONTENT,
          source: EntitlementSource.COMPLIMENTARY,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil,
          revokedAt: null,
          revocationReason: null,
        },
      ]);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.ACTIVE,
        },
        atTime: now,
      });

      expect(result).toEqual({
        outcome: 'GRANT_ENTITLED',
        grantId: 'grant-001',
        validUntil,
      });
      expect(grantRepositoryMock.findActiveGrants).toHaveBeenCalledWith(
        userId,
        now,
        EntitlementType.PREMIUM_CONTENT,
      );
    });

    it('denies active READER when no entitlement grants exist', async () => {
      grantRepositoryMock.findActiveGrants.mockResolvedValue([]);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.ACTIVE,
        },
        atTime: now,
      });

      expect(result).toEqual({
        outcome: 'DENY_UNENTITLED',
        reason: 'ENTITLEMENT_REQUIRED',
      });
    });

    it('denies ADMIN without active entitlement (no automatic role bypass)', async () => {
      grantRepositoryMock.findActiveGrants.mockResolvedValue([]);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        },
        atTime: now,
      });

      expect(result).toEqual({
        outcome: 'DENY_UNENTITLED',
        reason: 'ENTITLEMENT_REQUIRED',
      });
    });

    it('denies AUTHOR without active entitlement on another author article (no role bypass)', async () => {
      grantRepositoryMock.findActiveGrants.mockResolvedValue([]);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.AUTHOR,
          status: UserStatus.ACTIVE,
        },
        atTime: now,
      });

      expect(result).toEqual({
        outcome: 'DENY_UNENTITLED',
        reason: 'ENTITLEMENT_REQUIRED',
      });
    });

    it('denies unverified accounts on PREMIUM content with DENY_ACCOUNT_RESTRICTED', async () => {
      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: null,
        },
      });

      expect(result).toEqual({
        outcome: 'DENY_ACCOUNT_RESTRICTED',
        status: UserStatus.ACTIVE,
      });
      expect(grantRepositoryMock.findActiveGrants).not.toHaveBeenCalled();
    });

    it('isolates user grants — requests query grants strictly for the authenticated user ID', async () => {
      const otherUserId = '99999999-9999-4999-8999-999999999999';
      grantRepositoryMock.findActiveGrants.mockResolvedValue([]);

      await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: otherUserId,
          role: UserRole.READER,
          status: UserStatus.ACTIVE,
        },
        atTime: now,
      });

      expect(grantRepositoryMock.findActiveGrants).toHaveBeenCalledWith(
        otherUserId,
        now,
        EntitlementType.PREMIUM_CONTENT,
      );
      expect(grantRepositoryMock.findActiveGrants).not.toHaveBeenCalledWith(
        userId,
        expect.anything(),
        expect.anything(),
      );
    });

    it('handles multiple overlapping grants by using the latest active grant', async () => {
      const grant1 = {
        id: 'grant-001',
        userId,
        entitlementType: EntitlementType.PREMIUM_CONTENT,
        source: EntitlementSource.PROMOTIONAL,
        validFrom: new Date('2026-10-01T00:00:00Z'),
        validUntil: new Date('2026-11-25T00:00:00Z'),
        revokedAt: null,
      };
      const grant2 = {
        id: 'grant-002',
        userId,
        entitlementType: EntitlementType.PREMIUM_CONTENT,
        source: EntitlementSource.COMPLIMENTARY,
        validFrom: new Date('2026-11-01T00:00:00Z'),
        validUntil: new Date('2026-12-31T23:59:59Z'),
        revokedAt: null,
      };

      grantRepositoryMock.findActiveGrants.mockResolvedValue([grant2, grant1]);

      const result = await service.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED,
        user: {
          id: userId,
          role: UserRole.READER,
          status: UserStatus.ACTIVE,
        },
        atTime: now,
      });

      expect(result).toEqual({
        outcome: 'GRANT_ENTITLED',
        grantId: 'grant-002',
        validUntil: grant2.validUntil,
      });
    });
  });

  describe('Database-Backed Article State Validation (Prisma Injected)', () => {
    let serviceWithPrisma: AccessDecisionService;
    let prismaMock: {
      article: {
        findUnique: ReturnType<typeof vi.fn>;
      };
    };

    beforeEach(() => {
      prismaMock = {
        article: {
          findUnique: vi.fn(),
        },
      };

      serviceWithPrisma = new AccessDecisionService(
        policyRepositoryMock as unknown as ArticleAccessPolicyRepository,
        grantRepositoryMock as unknown as EntitlementGrantRepository,
        prismaMock as any,
      );
    });

    it('returns NOT_FOUND when article does not exist in the database', async () => {
      prismaMock.article.findUnique.mockResolvedValue(null);

      const result = await serviceWithPrisma.evaluatePublicArticleAccess({
        articleId: 'missing-article-uuid',
      });

      expect(result).toEqual({ outcome: 'NOT_FOUND' });
      expect(prismaMock.article.findUnique).toHaveBeenCalledWith({
        where: { id: 'missing-article-uuid' },
        select: { id: true, status: true },
      });
      expect(policyRepositoryMock.resolveEffectiveTier).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when article in database is DRAFT even if caller passed PUBLISHED', async () => {
      prismaMock.article.findUnique.mockResolvedValue({
        id: articleId,
        status: ArticleStatus.DRAFT,
      });

      const result = await serviceWithPrisma.evaluatePublicArticleAccess({
        articleId,
        articleStatus: ArticleStatus.PUBLISHED, // attempt caller forgery
      });

      expect(result).toEqual({ outcome: 'NOT_FOUND' });
      expect(policyRepositoryMock.resolveEffectiveTier).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when article in database is ARCHIVED', async () => {
      prismaMock.article.findUnique.mockResolvedValue({
        id: articleId,
        status: ArticleStatus.ARCHIVED,
      });

      const result = await serviceWithPrisma.evaluatePublicArticleAccess({
        articleId,
      });

      expect(result).toEqual({ outcome: 'NOT_FOUND' });
      expect(policyRepositoryMock.resolveEffectiveTier).not.toHaveBeenCalled();
    });

    it('proceeds to policy evaluation when article in database is PUBLISHED', async () => {
      prismaMock.article.findUnique.mockResolvedValue({
        id: articleId,
        status: ArticleStatus.PUBLISHED,
      });
      policyRepositoryMock.resolveEffectiveTier.mockResolvedValue(AccessPolicyTier.FREE);

      const result = await serviceWithPrisma.evaluatePublicArticleAccess({
        articleId,
      });

      expect(result).toEqual({ outcome: 'GRANT_FREE' });
      expect(policyRepositoryMock.resolveEffectiveTier).toHaveBeenCalledWith(articleId);
    });
  });
});
