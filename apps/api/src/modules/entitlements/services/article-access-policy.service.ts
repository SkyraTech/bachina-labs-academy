import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { AccessPolicyTier, type ArticleAccessPolicy } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditActorFactory, type AuditActor } from '../../audit/types/audit-event.types.js';
import { ArticleAccessPolicyRepository } from '../repositories/article-access-policy.repository.js';

@Injectable()
export class ArticleAccessPolicyService {
  private readonly logger = new Logger(ArticleAccessPolicyService.name);

  constructor(
    private readonly repository: ArticleAccessPolicyRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Resolves the effective policy tier for an article.
   * If no policy row exists, resolves to FREE.
   */
  async getEffectiveTier(articleId: string): Promise<AccessPolicyTier> {
    return this.repository.resolveEffectiveTier(articleId);
  }

  /**
   * Internal / test-only retrieval of the explicit policy record.
   */
  async getPolicyRecord(articleId: string): Promise<ArticleAccessPolicy | null> {
    return this.repository.findByArticleId(articleId);
  }

  /**
   * Internal helper for setting an article's policy.
   * Atomic with append-only audit logging: domain mutation + audit log insertion = 1 transaction.
   * Protected by a fail-closed PREMIUM activation lock.
   */
  async setPolicy(
    articleId: string,
    tier: AccessPolicyTier,
    note?: string | null,
    updatedById?: string | null,
    actor?: AuditActor,
  ): Promise<ArticleAccessPolicy> {
    // 0. Fail-closed PREMIUM activation lock
    if (tier === AccessPolicyTier.PREMIUM) {
      throw new ForbiddenException(
        'PREMIUM content activation is locked pending public Reader and media paywall verification.',
      );
    }

    this.logger.log(`Setting access policy for article ${articleId} to ${tier}`);

    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch current policy if one exists to determine action and previous tier
      const existing = await this.repository.findByArticleId(articleId, tx);

      // 2. Perform domain mutation within tx (mandatory tx parameter)
      const updatedPolicy = await this.repository.upsertPolicy(
        articleId,
        tier,
        note,
        updatedById,
        tx,
      );

      // 3. Resolve actor
      const resolvedActor =
        actor ??
        (updatedById
          ? AuditActorFactory.fromAuthenticatedPrincipal({ id: updatedById })
          : AuditActorFactory.forSystem());

      // 4. Record transactional audit event
      if (!existing) {
        await this.auditService.recordTransactional(tx, {
          action: 'policy.created',
          actor: resolvedActor,
          resourceType: 'ACCESS_POLICY',
          resourceId: updatedPolicy.id,
          outcome: 'SUCCESS',
          metadata: {
            articleId,
            policyId: updatedPolicy.id,
            tier: updatedPolicy.tier,
            ...(note ? { note } : {}),
          },
        });
      } else if (existing.tier !== updatedPolicy.tier) {
        // Only emit policy.tier_changed when the tier actually transitions (prevents false transitions, AH-25)
        await this.auditService.recordTransactional(tx, {
          action: 'policy.tier_changed',
          actor: resolvedActor,
          resourceType: 'ACCESS_POLICY',
          resourceId: updatedPolicy.id,
          outcome: 'SUCCESS',
          metadata: {
            articleId,
            policyId: updatedPolicy.id,
            previousTier: existing.tier,
            newTier: updatedPolicy.tier,
            ...(note ? { reason: note } : {}),
          },
        });
      }

      return updatedPolicy;
    });
  }
}
