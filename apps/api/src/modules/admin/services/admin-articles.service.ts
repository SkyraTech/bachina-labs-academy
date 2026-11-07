import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { ListAdminArticlesQueryDto } from '../dto/list-admin-articles-query.dto.js';
import { AdminArticleItemResponseDto } from '../dto/admin-article-item-response.dto.js';
import { PaginatedAdminArticlesResponseDto } from '../dto/paginated-admin-articles-response.dto.js';

@Injectable()
export class AdminArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  async listArticles(query: ListAdminArticlesQueryDto): Promise<PaginatedAdminArticlesResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ArticleWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }
    if (query.authorId) {
      where.authorId = query.authorId;
    }
    if (query.q) {
      const term = query.q.trim();
      if (term) {
        where.OR = [
          { title: { contains: term, mode: 'insensitive' } },
          { summary: { contains: term, mode: 'insensitive' } },
          { draftSlug: { contains: term, mode: 'insensitive' } },
        ];
      }
    }

    const [total, articles] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        select: {
          id: true,
          title: true,
          draftSlug: true,
          publishedSlug: true,
          summary: true,
          status: true,
          draftRevision: true,
          publishedRevision: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          author: {
            select: {
              id: true,
              email: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items: AdminArticleItemResponseDto[] = articles.map((a) => ({
      id: a.id,
      title: a.title,
      draftSlug: a.draftSlug,
      publishedSlug: a.publishedSlug,
      summary: a.summary,
      status: a.status,
      draftRevision: a.draftRevision,
      publishedRevision: a.publishedRevision,
      author: a.author,
      category: a.category,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    }));

    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getArticleById(id: string): Promise<AdminArticleItemResponseDto> {
    const article = await this.prisma.article.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        draftSlug: true,
        publishedSlug: true,
        summary: true,
        status: true,
        draftRevision: true,
        publishedRevision: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        author: {
          select: {
            id: true,
            email: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!article) {
      throw new NotFoundException(`Article with id '${id}' not found`);
    }

    return {
      id: article.id,
      title: article.title,
      draftSlug: article.draftSlug,
      publishedSlug: article.publishedSlug,
      summary: article.summary,
      status: article.status,
      draftRevision: article.draftRevision,
      publishedRevision: article.publishedRevision,
      author: article.author,
      category: article.category,
      createdAt: article.createdAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
      publishedAt: article.publishedAt ? article.publishedAt.toISOString() : null,
    };
  }
}

