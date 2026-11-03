import { Injectable, Logger } from '@nestjs/common';
import type {
  Article,
  ArticleBlock,
  ArticleStatus,
  MediaAsset,
  Category,
  Tag,
  ArticleTag,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateArticleData {
  authorId: string;
  title: string;
  draftSlug: string;
  summary?: string | null;
  typographyPreset?: string;
  coverMediaId?: string | null;
  categoryId?: string | null;
  tagIds?: string[];
}

export interface FindMyArticlesParams {
  authorId: string;
  page: number;
  limit: number;
  status?: ArticleStatus;
}

export type ArticleWithTags = Article & {
  category?: Category | null;
  tags?: (ArticleTag & { tag?: Tag })[];
};

export type ArticleWithBlocks = Article & {
  blocks: ArticleBlock[];
  category?: Category | null;
  tags?: (ArticleTag & { tag?: Tag })[];
};

/**
 * ArticlesRepository — data access layer for the articles domain.
 *
 * Responsibilities:
 * - Direct interaction with the global PrismaService using runtime credentials (academy_app).
 * - Enforces owner-scoped queries, stable ordering, and row locking for mutations.
 * - Does not perform authoring business logic or permission checks (handled in ArticlesService).
 */
@Injectable()
export class ArticlesRepository {
  private readonly logger = new Logger(ArticlesRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs an interactive transaction with the Prisma Client.
   */
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /**
   * Creates a new draft article row in the database with optional taxonomy assignments.
   */
  async create(data: CreateArticleData): Promise<ArticleWithTags> {
    this.logger.debug(
      `Creating draft article for author: ${data.authorId}, slug: ${data.draftSlug}`,
    );

    return this.prisma.article.create({
      data: {
        authorId: data.authorId,
        title: data.title,
        draftSlug: data.draftSlug,
        summary: data.summary ?? null,
        typographyPreset: data.typographyPreset ?? 'MODERN_SANS',
        coverMediaId: data.coverMediaId ?? null,
        categoryId: data.categoryId ?? null,
        status: 'DRAFT',
        draftRevision: 1,
        publishedRevision: 0,
        tags:
          data.tagIds && data.tagIds.length > 0
            ? {
                create: data.tagIds.map((tagId) => ({ tagId })),
              }
            : undefined,
      },
      include: {
        category: true,
        tags: {
          include: { tag: true },
          orderBy: [{ tag: { slug: 'asc' } }, { tagId: 'asc' }],
        },
      },
    });
  }

  /**
   * Lists articles owned by the authenticated author with pagination and optional status filter.
   * Uses deterministic ordering: createdAt DESC, id DESC.
   */
  async findMyArticles(
    params: FindMyArticlesParams,
  ): Promise<{ items: ArticleWithTags[]; total: number }> {
    const where: Prisma.ArticleWhereInput = {
      authorId: params.authorId,
      ...(params.status ? { status: params.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        include: {
          category: true,
          tags: {
            include: { tag: true },
            orderBy: [{ tag: { slug: 'asc' } }, { tagId: 'asc' }],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.article.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Retrieves an article strictly scoped to the owner, including its draft blocks and tags ordered deterministically.
   * Returns null if the article does not exist or belongs to another author.
   */
  async findPrivateById(
    articleId: string,
    authorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<(ArticleWithBlocks & ArticleWithTags) | null> {
    const client = tx ?? this.prisma;
    return client.article.findFirst({
      where: {
        id: articleId,
        authorId,
      },
      include: {
        category: true,
        blocks: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
        },
        tags: {
          include: { tag: true },
          orderBy: [{ tag: { slug: 'asc' } }, { tagId: 'asc' }],
        },
      },
    });
  }

  /**
   * Locks the article row using PostgreSQL `FOR UPDATE` within a transaction.
   * Scoped strictly to the owner. Returns null if not found or foreign-owned.
   */
  async findArticleForUpdate(
    articleId: string,
    authorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Article | null> {
    const rows = await tx.$queryRaw<Article[]>`
      SELECT 
        id,
        author_id AS "authorId",
        title,
        draft_slug AS "draftSlug",
        published_slug AS "publishedSlug",
        summary,
        status,
        typography_preset AS "typographyPreset",
        cover_media_id AS "coverMediaId",
        draft_revision AS "draftRevision",
        published_revision AS "publishedRevision",
        current_snapshot_id AS "currentSnapshotId",
        category_id AS "categoryId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        published_at AS "publishedAt"
      FROM articles
      WHERE id = ${articleId}::uuid AND author_id = ${authorId}::uuid
      FOR UPDATE;
    `;
    return rows[0] ?? null;
  }

  /**
   * Updates an article within a transaction.
   */
  async updateArticle(
    articleId: string,
    data: Prisma.ArticleUpdateInput,
    tx: Prisma.TransactionClient,
  ): Promise<Article> {
    return tx.article.update({
      where: { id: articleId },
      data,
    });
  }

  /**
   * Counts the number of published snapshots associated with an article.
   */
  async countSnapshots(
    articleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return tx.articleSnapshot.count({
      where: { articleId },
    });
  }

  /**
   * Deletes an article within a transaction. Dependent blocks cascade automatically.
   */
  async deleteArticle(
    articleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.article.delete({
      where: { id: articleId },
    });
  }

  /**
   * Looks up a media asset by ID for cover-media validation.
   */
  async findMediaAsset(
    mediaAssetId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<MediaAsset | null> {
    const client = tx ?? this.prisma;
    return client.mediaAsset.findUnique({
      where: { id: mediaAssetId },
    });
  }

  /**
   * Looks up a Category by ID.
   */
  async findCategoryById(
    categoryId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Category | null> {
    const client = tx ?? this.prisma;
    return client.category.findUnique({
      where: { id: categoryId },
    });
  }

  /**
   * Looks up multiple Tags by their IDs.
   */
  async findTagsByIds(
    tagIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Tag[]> {
    const client = tx ?? this.prisma;
    return client.tag.findMany({
      where: { id: { in: tagIds } },
    });
  }

  /**
   * Finds the list of Tag IDs associated with an article.
   */
  async findArticleTagIds(
    articleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const rows = await client.articleTag.findMany({
      where: { articleId },
      select: { tagId: true },
    });
    return rows.map((r) => r.tagId);
  }

  /**
   * Replaces all Tag associations for an article inside a transaction.
   */
  async replaceArticleTags(
    articleId: string,
    tagIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.articleTag.deleteMany({
      where: { articleId },
    });
    if (tagIds.length > 0) {
      await tx.articleTag.createMany({
        data: tagIds.map((tagId) => ({ articleId, tagId })),
      });
    }
  }
}
