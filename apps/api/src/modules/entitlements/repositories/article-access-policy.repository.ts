import { Injectable } from '@nestjs/common';
import { AccessPolicyTier, type ArticleAccessPolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class ArticleAccessPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves the explicit access policy row for an article, if one exists.
   */
  async findByArticleId(
    articleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ArticleAccessPolicy | null> {
    const client = tx ?? this.prisma;
    return client.articleAccessPolicy.findUnique({
      where: { articleId },
    });
  }

  /**
   * Resolves the effective access policy tier for an article.
   * POD-25 non-negotiable rule: If no policy row exists, effective access is FREE.
   */
  async resolveEffectiveTier(
    articleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AccessPolicyTier> {
    const client = tx ?? this.prisma;
    const policy = await client.articleAccessPolicy.findUnique({
      where: { articleId },
      select: { tier: true },
    });

    return policy?.tier ?? AccessPolicyTier.FREE;
  }

  /**
   * Internal upsert for article access policy.
   * Strictly requires an active Prisma interactive transaction client to enforce transactional audit atomicity.
   */
  async upsertPolicy(
    articleId: string,
    tier: AccessPolicyTier,
    note: string | null | undefined,
    updatedById: string | null | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<ArticleAccessPolicy> {
    return tx.articleAccessPolicy.upsert({
      where: { articleId },
      create: {
        articleId,
        tier,
        note: note ?? null,
        updatedById: updatedById ?? null,
      },
      update: {
        tier,
        note: note ?? null,
        updatedById: updatedById ?? null,
      },
    });
  }
}
