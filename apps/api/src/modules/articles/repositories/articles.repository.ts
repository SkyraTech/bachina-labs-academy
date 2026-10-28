import { Injectable, Logger } from '@nestjs/common';
import type {
  Article,
  ArticleBlock,
  ArticleStatus,
  MediaAsset,
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
}

export interface FindMyArticlesParams {
  authorId: string;
  page: number;
  limit: number;
  status?: ArticleStatus;
}

export type ArticleWithBlocks = Article & { blocks: ArticleBlock[] };

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
   * Creates a new draft article row in the database.
   */
  async create(data: CreateArticleData): Promise<Article> {
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
        status: 'DRAFT',
        draftRevision: 1,
        publishedRevision: 0,
      },
    });
  }

  /**
   * Lists articles owned by the authenticated author with pagination and optional status filter.
   * Uses deterministic ordering: createdAt DESC, id DESC.
   */
  async findMyArticles(
    params: FindMyArticlesParams,
  ): Promise<{ items: Article[]; total: number }> {
    const where: Prisma.ArticleWhereInput = {
      authorId: params.authorId,
      ...(params.status ? { status: params.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.article.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Retrieves an article strictly scoped to the owner, including its draft blocks ordered by position ASC, id ASC.
   * Returns null if the article does not exist or belongs to another author.
   */
  async findPrivateById(
    articleId: string,
    authorId: string,
  ): Promise<ArticleWithBlocks | null> {
    return this.prisma.article.findFirst({
      where: {
        id: articleId,
        authorId,
      },
      include: {
        blocks: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
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
}
