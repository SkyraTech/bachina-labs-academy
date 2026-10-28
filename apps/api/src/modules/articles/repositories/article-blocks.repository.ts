import { Injectable, Logger } from '@nestjs/common';
import type {
  Article,
  ArticleBlock,
  MediaAsset,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateBlockInput {
  articleId: string;
  type: ArticleBlock['type'];
  position: number;
  content: Record<string, any>;
  mediaAssetId?: string | null;
  schemaVersion?: number;
}

@Injectable()
export class ArticleBlocksRepository {
  private readonly logger = new Logger(ArticleBlocksRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes operations within an interactive transaction with the Prisma Client.
   */
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /**
   * Locks the target article row using PostgreSQL `FOR UPDATE` strictly scoped to the owner.
   * Prevents concurrent edits and race conditions on draft revisions.
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
   * Finds a specific block by its UUID and article UUID.
   * Returns null if nonexistent or belonging to another article.
   */
  async findBlockById(
    blockId: string,
    articleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ArticleBlock | null> {
    const client = tx ?? this.prisma;
    return client.articleBlock.findFirst({
      where: {
        id: blockId,
        articleId,
      },
    });
  }

  /**
   * Finds all draft blocks for an article in deterministic ascending position order.
   */
  async findBlocksByArticle(
    articleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ArticleBlock[]> {
    const client = tx ?? this.prisma;
    return client.articleBlock.findMany({
      where: { articleId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Computes the next available sequential position for appending a new block to an article.
   */
  async getNextPosition(
    articleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.$queryRaw<{ next_pos: number }[]>`
      SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
      FROM article_blocks
      WHERE article_id = ${articleId}::uuid;
    `;
    return Number(result[0]?.next_pos ?? 0);
  }

  /**
   * Defers the unique (article_id, position) constraint to COMMIT time within this transaction.
   * Allows position swaps, rotations, and compactions without constraint violations.
   */
  async deferPositionConstraint(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe(
      'SET CONSTRAINTS "article_blocks_article_id_position_key" DEFERRED;',
    );
  }

  /**
   * Creates a new block record.
   */
  async createBlock(
    input: CreateBlockInput,
    tx: Prisma.TransactionClient,
  ): Promise<ArticleBlock> {
    return tx.articleBlock.create({
      data: {
        articleId: input.articleId,
        type: input.type,
        position: input.position,
        content: input.content,
        mediaAssetId: input.mediaAssetId ?? null,
        schemaVersion: input.schemaVersion ?? 1,
      },
    });
  }

  /**
   * Updates mutable block attributes.
   */
  async updateBlock(
    blockId: string,
    data: Prisma.ArticleBlockUpdateInput,
    tx: Prisma.TransactionClient,
  ): Promise<ArticleBlock> {
    return tx.articleBlock.update({
      where: { id: blockId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Deletes a block by its UUID.
   */
  async deleteBlock(
    blockId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.articleBlock.delete({
      where: { id: blockId },
    });
  }

  /**
   * Reindexes positions following the deletion of a block to preserve contiguous 0-based indices.
   * Requires deferPositionConstraint to have been called.
   */
  async reindexPositionsAfterDelete(
    articleId: string,
    deletedPosition: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE article_blocks
      SET position = position - 1, updated_at = NOW()
      WHERE article_id = ${articleId}::uuid AND position > ${deletedPosition};
    `;
  }

  /**
   * Reassigns block positions sequentially to match the submitted block IDs array.
   * Requires deferPositionConstraint to have been called.
   */
  async updatePositions(
    articleId: string,
    orderedBlockIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<ArticleBlock[]> {
    for (let i = 0; i < orderedBlockIds.length; i++) {
      await tx.articleBlock.update({
        where: { id: orderedBlockIds[i] },
        data: {
          position: i,
          updatedAt: new Date(),
        },
      });
    }

    return tx.articleBlock.findMany({
      where: { articleId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Atomically increments the article draft revision by 1.
   */
  async incrementDraftRevision(
    articleId: string,
    currentRevision: number,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const nextRevision = currentRevision + 1;
    await tx.article.update({
      where: { id: articleId },
      data: {
        draftRevision: nextRevision,
        updatedAt: new Date(),
      },
    });
    return nextRevision;
  }

  /**
   * Looks up a media asset by ID for uploader ownership and media-type validation.
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
