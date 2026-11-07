import { Injectable } from '@nestjs/common';
import { UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminOverviewResponseDto } from '../dto/admin-overview-response.dto.js';

@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverviewMetrics(): Promise<AdminOverviewResponseDto> {
    const [
      totalUsers,
      verifiedUsers,
      authorsCount,
      adminsCount,
      activeUsersCount,
      suspendedUsersCount,
      disabledUsersCount,
      totalArticles,
      draftArticlesCount,
      publishedArticlesCount,
      archivedArticlesCount,
      totalPublishedSnapshots,
      totalCategories,
      totalTags,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      this.prisma.user.count({ where: { role: UserRole.AUTHOR } }),
      this.prisma.user.count({ where: { role: UserRole.ADMIN } }),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.prisma.user.count({ where: { status: UserStatus.DISABLED } }),
      this.prisma.article.count(),
      this.prisma.article.count({ where: { status: ArticleStatus.DRAFT } }),
      this.prisma.article.count({ where: { status: ArticleStatus.PUBLISHED } }),
      this.prisma.article.count({ where: { status: ArticleStatus.ARCHIVED } }),
      this.prisma.articleSnapshot.count(),
      this.prisma.category.count(),
      this.prisma.tag.count(),
    ]);

    return {
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        unverified: Math.max(0, totalUsers - verifiedUsers),
        byRole: {
          author: authorsCount,
          admin: adminsCount,
        },
        byStatus: {
          active: activeUsersCount,
          suspended: suspendedUsersCount,
          disabled: disabledUsersCount,
        },
      },
      articles: {
        total: totalArticles,
        draft: draftArticlesCount,
        published: publishedArticlesCount,
        archived: archivedArticlesCount,
        totalPublishedSnapshots,
      },
      taxonomy: {
        totalCategories,
        totalTags,
      },
    };
  }
}

