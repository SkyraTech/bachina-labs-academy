import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AccessPolicyTier,
  ArticleStatus,
  UserRole,
  UserStatus,
  EntitlementType,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { ArticleAccessPolicyRepository } from '../repositories/article-access-policy.repository.js';
import { EntitlementGrantRepository } from '../repositories/entitlement-grant.repository.js';

export interface EvaluatedUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt?: Date | null;
}

export interface AccessDecisionParams {
  articleId: string;
  articleStatus?: ArticleStatus;
  user?: EvaluatedUser | null;
  atTime?: Date;
}

export type AccessDecisionOutcome =
  | { outcome: 'GRANT_FREE' }
  | { outcome: 'GRANT_ENTITLED'; grantId: string; validUntil: Date }
  | { outcome: 'DENY_ANONYMOUS'; reason: 'AUTHENTICATION_REQUIRED' }
  | { outcome: 'DENY_UNENTITLED'; reason: 'ENTITLEMENT_REQUIRED' }
  | { outcome: 'DENY_ACCOUNT_RESTRICTED'; status: UserStatus }
  | { outcome: 'NOT_FOUND' };

@Injectable()
export class AccessDecisionService {
  private readonly logger = new Logger(AccessDecisionService.name);

  constructor(
    private readonly policyRepository: ArticleAccessPolicyRepository,
    private readonly grantRepository: EntitlementGrantRepository,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /**
   * Internal server-side access evaluation for public article reading.
   *
   * Strictly enforces:
   * 1. Only PUBLISHED articles can be evaluated for public consumption. DRAFT, ARCHIVED, or missing -> NOT_FOUND.
   * 2. Policy defaults to FREE if no ArticleAccessPolicy row exists (POD-25).
   * 3. FREE content is always granted without requiring an entitlement or authentication.
   * 4. PREMIUM content requires active, unrevoked EntitlementGrant at server-authoritative time (POD-26).
   * 5. No automatic bypass for ADMIN or AUTHOR by role alone.
   * 6. Suspended, disabled, or unverified users on PREMIUM content are rejected with DENY_ACCOUNT_RESTRICTED.
   * 7. Unauthenticated callers on PREMIUM content receive DENY_ANONYMOUS.
   */
  async evaluatePublicArticleAccess(
    params: AccessDecisionParams,
  ): Promise<AccessDecisionOutcome> {
    const { articleId, user, atTime = new Date() } = params;

    // 1. Publication status barrier — trusted DB state lookup or fallback to caller param
    if (this.prisma) {
      const article = await this.prisma.article.findUnique({
        where: { id: articleId },
        select: { id: true, status: true },
      });
      if (!article || article.status !== ArticleStatus.PUBLISHED) {
        return { outcome: 'NOT_FOUND' };
      }
    } else {
      if (!params.articleStatus || params.articleStatus !== ArticleStatus.PUBLISHED) {
        return { outcome: 'NOT_FOUND' };
      }
    }

    // 2. Resolve policy tier — non-negotiable POD-25 rule: no row = FREE
    const effectiveTier = await this.policyRepository.resolveEffectiveTier(articleId);

    if (effectiveTier === AccessPolicyTier.FREE) {
      return { outcome: 'GRANT_FREE' };
    }

    // 3. For PREMIUM content: evaluate caller credentials
    if (!user) {
      return {
        outcome: 'DENY_ANONYMOUS',
        reason: 'AUTHENTICATION_REQUIRED',
      };
    }

    // 4. Account eligibility barrier: account must be ACTIVE and not unverified
    if (user.status !== UserStatus.ACTIVE || user.emailVerifiedAt === null) {
      return {
        outcome: 'DENY_ACCOUNT_RESTRICTED',
        status: user.status,
      };
    }

    // 5. Query active, non-revoked entitlement grants
    const activeGrants = await this.grantRepository.findActiveGrants(
      user.id,
      atTime,
      EntitlementType.PREMIUM_CONTENT,
    );

    if (activeGrants.length > 0) {
      const primaryGrant = activeGrants[0];
      return {
        outcome: 'GRANT_ENTITLED',
        grantId: primaryGrant.id,
        validUntil: primaryGrant.validUntil,
      };
    }

    // 6. No active grant found — access denied (no automatic role bypass)
    return {
      outcome: 'DENY_UNENTITLED',
      reason: 'ENTITLEMENT_REQUIRED',
    };
  }
}
