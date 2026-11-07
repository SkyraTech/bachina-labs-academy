import { Injectable, Logger } from '@nestjs/common';
import { Prisma, CommentStatus, ModerationReason } from '@prisma/client';
import type { ArticleComment } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminCommentStatusFilter } from '../dto/admin-comments-query.dto.js';

export interface CommentWithRelations extends ArticleComment {
  article: {
    id: string;
    publishedSlug: string | null;
    title: string;
    authorId: string;
  };
  snapshot: {
    id: string;
    snapshotRevision: number;
  };
  author: {
    id: string;
    profile: {
      displayName: string;
    } | null;
  };
}

@Injectable()
export class ArticleCommentsRepository {
  private readonly logger = new Logger(ArticleCommentsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async findArticleForCommentCreation(
    publishedSlug: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string; status: string; currentSnapshotId: string | null; authorId: string } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: string; currentSnapshotId: string | null; authorId: string }>
    >`
      SELECT 
        id, 
        status::text AS "status", 
        current_snapshot_id AS "currentSnapshotId",
        author_id AS "authorId"
      FROM articles
      WHERE published_slug = ${publishedSlug}
      FOR SHARE;
    `;
    return rows[0] ?? null;
  }

  async createComment(
    data: {
      articleId: string;
      snapshotId: string;
      userId: string;
      body: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CommentWithRelations> {
    const client = tx ?? this.prisma;
    return client.articleComment.create({
      data: {
        articleId: data.articleId,
        snapshotId: data.snapshotId,
        userId: data.userId,
        body: data.body,
        status: CommentStatus.VISIBLE,
      },
      include: {
        article: {
          select: {
            id: true,
            publishedSlug: true,
            title: true,
            authorId: true,
          },
        },
        snapshot: {
          select: {
            id: true,
            snapshotRevision: true,
          },
        },
        author: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });
  }

  async findVisibleByPublishedSlug(
    publishedSlug: string,
    page: number,
    limit: number,
  ): Promise<{ items: CommentWithRelations[]; total: number } | null> {
    const article = await this.prisma.article.findUnique({
      where: { publishedSlug },
      select: { id: true, status: true },
    });

    if (!article || article.status !== 'PUBLISHED') {
      return null;
    }

    const where: Prisma.ArticleCommentWhereInput = {
      articleId: article.id,
      status: CommentStatus.VISIBLE,
    };

    const [total, items] = await Promise.all([
      this.prisma.articleComment.count({ where }),
      this.prisma.articleComment.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          article: {
            select: {
              id: true,
              publishedSlug: true,
              title: true,
              authorId: true,
            },
          },
          snapshot: {
            select: {
              id: true,
              snapshotRevision: true,
            },
          },
          author: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return { items, total };
  }

  async findCommentById(id: string): Promise<CommentWithRelations | null> {
    return this.prisma.articleComment.findUnique({
      where: { id },
      include: {
        article: {
          select: {
            id: true,
            publishedSlug: true,
            title: true,
            authorId: true,
          },
        },
        snapshot: {
          select: {
            id: true,
            snapshotRevision: true,
          },
        },
        author: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });
  }

  async updateCommentIfVisibleAndOwner(
    id: string,
    userId: string,
    body: string,
  ): Promise<{ count: number }> {
    return this.prisma.articleComment.updateMany({
      where: {
        id,
        userId,
        status: CommentStatus.VISIBLE,
      },
      data: {
        body,
        updatedAt: new Date(),
      },
    });
  }

  async deleteCommentIfOwner(id: string, userId: string): Promise<{ count: number }> {
    return this.prisma.articleComment.deleteMany({
      where: {
        id,
        userId,
      },
    });
  }

  async findForAdmin(params: {
    page: number;
    limit: number;
    status?: AdminCommentStatusFilter;
    search?: string;
  }): Promise<{ items: CommentWithRelations[]; total: number }> {
    const { page, limit, status, search } = params;

    const where: Prisma.ArticleCommentWhereInput = {};

    if (status && status !== AdminCommentStatusFilter.ALL) {
      where.status = status as unknown as CommentStatus;
    }

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { body: { contains: term, mode: 'insensitive' } },
        { article: { title: { contains: term, mode: 'insensitive' } } },
        { author: { profile: { displayName: { contains: term, mode: 'insensitive' } } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.articleComment.count({ where }),
      this.prisma.articleComment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          article: {
            select: {
              id: true,
              publishedSlug: true,
              title: true,
              authorId: true,
            },
          },
          snapshot: {
            select: {
              id: true,
              snapshotRevision: true,
            },
          },
          author: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return { items, total };
  }

  async removeComment(
    id: string,
    adminUserId: string,
    reason: ModerationReason,
    tx?: Prisma.TransactionClient,
  ): Promise<CommentWithRelations | null> {
    const client = tx ?? this.prisma;
    const now = new Date();

    const existing = await client.articleComment.findUnique({
      where: { id },
      include: {
        article: { select: { id: true, publishedSlug: true, title: true, authorId: true } },
        snapshot: { select: { id: true, snapshotRevision: true } },
        author: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    });

    if (!existing) {
      return null;
    }

    if (existing.status === CommentStatus.REMOVED) {
      return existing;
    }

    return client.articleComment.update({
      where: { id },
      data: {
        status: CommentStatus.REMOVED,
        removedAt: now,
        removedByUserId: adminUserId,
        removalReason: reason,
        updatedAt: now,
      },
      include: {
        article: { select: { id: true, publishedSlug: true, title: true, authorId: true } },
        snapshot: { select: { id: true, snapshotRevision: true } },
        author: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    });
  }

  async scrubExpiredBatch(
    batchSize = 100,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const expiredRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM article_comments
      WHERE status = 'REMOVED'
        AND removed_at <= NOW() - INTERVAL '30 days'
        AND body != ''
      ORDER BY removed_at ASC, id ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED;
    `;

    if (expiredRows.length === 0) {
      return 0;
    }

    const ids = expiredRows.map((r) => r.id);
    await tx.articleComment.updateMany({
      where: { id: { in: ids } },
      data: {
        body: '',
        updatedAt: new Date(),
      },
    });

    return ids.length;
  }
}

