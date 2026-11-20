import { Injectable } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AccountEligibilityPolicy } from '../../../common/authorization/policies/account-eligibility.policy.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import type {
  AuthorDashboardResponseDto,
  AuthorDashboardArticleItemDto,
} from '../dto/author-dashboard-response.dto.js';

@Injectable()
export class AuthorDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves authoritative, authenticated-author-scoped dashboard metrics
   * and recently updated articles directly from the PostgreSQL store.
   *
   * Security & Isolation Guarantees:
   * - Enforces user eligibility via AccountEligibilityPolicy (ACTIVE status & verified email).
   * - All queries strictly filtered by authorId (user.id).
   * - Zero global aggregation; admins only see their own authored content.
   * - Uncapped count queries ensure 50+ articles are accurately counted without pagination truncation.
   * - Read-only operation with zero side effects or database mutations.
   */
  async getDashboardData(user: AuthenticatedUser): Promise<AuthorDashboardResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);

    const [total, draft, published, archived, recentlyUpdated] = await Promise.all([
      this.prisma.article.count({
        where: { authorId: user.id },
      }),
      this.prisma.article.count({
        where: { authorId: user.id, status: ArticleStatus.DRAFT },
      }),
      this.prisma.article.count({
        where: { authorId: user.id, status: ArticleStatus.PUBLISHED },
      }),
      this.prisma.article.count({
        where: { authorId: user.id, status: ArticleStatus.ARCHIVED },
      }),
      this.prisma.article.findMany({
        where: { authorId: user.id },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ]);

    const mappedRecentlyUpdated: AuthorDashboardArticleItemDto[] = recentlyUpdated.map((art) => ({
      id: art.id,
      title: art.title,
      status: art.status,
      updatedAt: art.updatedAt.toISOString(),
    }));

    return {
      metrics: {
        total,
        draft,
        published,
        archived,
      },
      recentlyUpdated: mappedRecentlyUpdated,
    };
  }
}
