import { Injectable, Logger } from '@nestjs/common';
import type {
  Article,
  ArticleBlock,
  ArticleSnapshot,
  MediaAsset,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateSnapshotData {
  articleId: string;
  snapshotRevision: number;
  title: string;
  publishedSlug: string;
  summary?: string | null;
  typographyPreset: string;
  coverMediaId?: string | null;
  blocks: Prisma.InputJsonValue;
  publishedAt?: Date;
}

export interface UpdateArticlePublishedData {
  publishedSlug: string;
  publishedRevision: number;
  currentSnapshotId: string;
  publishedAt: Date;
}

/**
 * ArticlePublicationRepository — data access layer for the article publication lifecycle.
 *
 * Responsibilities:
 * - Scoped row locking (FOR UPDATE) under author isolation.
 * - Ordered retrieval of draft blocks.
 * - Creation of immutable article snapshots.
 * - Atomic persistence of snapshot media retention relationships.
 * - Atomic promotion of article published state.
 */
@Injectable()
export class ArticlePublicationRepository {
  private readonly logger = new Logger(ArticlePublicationRepository.name);

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
   * Locks the owned article row using PostgreSQL `FOR UPDATE` within an interactive transaction.
   * Strictly scoped to the authenticated author. Returns null if not found or foreign-owned.
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
   * Retrieves all draft blocks for an article in deterministic ascending position order.
   */
  async findBlocksForArticle(
    articleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ArticleBlock[]> {
    return tx.articleBlock.findMany({
      where: { articleId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Looks up a media asset by ID for existence, uploader ownership, and mediaType verification.
   */
  async findMediaAsset(
    mediaAssetId: string,
    tx: Prisma.TransactionClient,
  ): Promise<MediaAsset | null> {
    return tx.mediaAsset.findUnique({
      where: { id: mediaAssetId },
    });
  }

  /**
   * Inserts an immutable ArticleSnapshot row.
   */
  async createSnapshot(
    data: CreateSnapshotData,
    tx: Prisma.TransactionClient,
  ): Promise<ArticleSnapshot> {
    return tx.articleSnapshot.create({
      data: {
        articleId: data.articleId,
        snapshotRevision: data.snapshotRevision,
        title: data.title,
        publishedSlug: data.publishedSlug,
        summary: data.summary ?? null,
        typographyPreset: data.typographyPreset,
        coverMediaId: data.coverMediaId ?? null,
        blocks: data.blocks,
        publishedAt: data.publishedAt ?? new Date(),
      },
    });
  }

  /**
   * Inserts media retention rows into article_snapshot_media.
   */
  async createSnapshotMediaRetention(
    records: { snapshotId: string; mediaAssetId: string }[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await tx.articleSnapshotMedia.createMany({
      data: records,
    });
  }

  /**
   * Atomically updates article publication state:
   * Sets status = 'PUBLISHED', publishedSlug, publishedRevision, currentSnapshotId, publishedAt.
   */
  async updateArticlePublished(
    articleId: string,
    data: UpdateArticlePublishedData,
    tx: Prisma.TransactionClient,
  ): Promise<Article> {
    return tx.article.update({
      where: { id: articleId },
      data: {
        status: 'PUBLISHED',
        publishedSlug: data.publishedSlug,
        publishedRevision: data.publishedRevision,
        currentSnapshotId: data.currentSnapshotId,
        publishedAt: data.publishedAt,
        updatedAt: new Date(),
      },
    });
  }
}
