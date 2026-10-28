import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface PublishedArticleSummaryRow {
  articleId: string;
  articlePublishedSlug: string;
  articlePublishedRevision: number;
  articleDraftRevision: number;
  snapshotId: string;
  snapshotRevision: number;
  title: string;
  publishedSlug: string;
  summary: string | null;
  typographyPreset: string;
  coverMediaId: string | null;
  publishedAt: Date;
}

export interface PublishedArticleDetailRow extends PublishedArticleSummaryRow {
  blocks: Prisma.JsonValue;
}

export interface RetainedMediaRow {
  snapshotId: string;
  mediaAssetId: string;
  mediaAsset: {
    id: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    altText: string | null;
  };
}

/**
 * ArticlePublicReaderRepository — read-only repository for published articles.
 *
 * Responsibilities:
 * - Queries strictly published articles joined with their active immutable snapshot.
 * - Enforces composite key integrity and revision alignment in SQL.
 * - Enforces deterministic ordering: active snapshot published_at DESC, article id DESC.
 * - Verifies media asset retention references via article_snapshot_media.
 */
@Injectable()
export class ArticlePublicReaderRepository {
  private readonly logger = new Logger(ArticlePublicReaderRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a paginated list of published articles joined with their active snapshot.
   */
  async findPublishedArticles(
    offset: number,
    limit: number,
  ): Promise<PublishedArticleSummaryRow[]> {
    return this.prisma.$queryRaw<PublishedArticleSummaryRow[]>`
      SELECT 
        a.id AS "articleId",
        a.published_slug AS "articlePublishedSlug",
        a.published_revision AS "articlePublishedRevision",
        a.draft_revision AS "articleDraftRevision",
        s.id AS "snapshotId",
        s.snapshot_revision AS "snapshotRevision",
        s.title,
        s.published_slug AS "publishedSlug",
        s.summary,
        s.typography_preset AS "typographyPreset",
        s.cover_media_id AS "coverMediaId",
        s.published_at AS "publishedAt"
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE a.status = 'PUBLISHED'
        AND a.published_slug IS NOT NULL
        AND a.current_snapshot_id IS NOT NULL
        AND a.published_revision >= 1
        AND a.published_revision <= a.draft_revision
        AND a.published_revision = s.snapshot_revision
        AND a.published_slug = s.published_slug
      ORDER BY s.published_at DESC, a.id DESC
      LIMIT ${limit} OFFSET ${offset};
    `;
  }

  /**
   * Computes the total count of eligible published articles using identical predicates.
   */
  async countPublishedArticles(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE a.status = 'PUBLISHED'
        AND a.published_slug IS NOT NULL
        AND a.current_snapshot_id IS NOT NULL
        AND a.published_revision >= 1
        AND a.published_revision <= a.draft_revision
        AND a.published_revision = s.snapshot_revision
        AND a.published_slug = s.published_slug;
    `;
    return Number(result[0]?.count ?? 0);
  }

  /**
   * Retrieves an article and its active immutable snapshot by its current published slug.
   */
  async findPublishedArticleBySlug(
    slug: string,
  ): Promise<PublishedArticleDetailRow | null> {
    const rows = await this.prisma.$queryRaw<PublishedArticleDetailRow[]>`
      SELECT 
        a.id AS "articleId",
        a.published_slug AS "articlePublishedSlug",
        a.published_revision AS "articlePublishedRevision",
        a.draft_revision AS "articleDraftRevision",
        s.id AS "snapshotId",
        s.snapshot_revision AS "snapshotRevision",
        s.title,
        s.published_slug AS "publishedSlug",
        s.summary,
        s.typography_preset AS "typographyPreset",
        s.cover_media_id AS "coverMediaId",
        s.blocks,
        s.published_at AS "publishedAt"
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE a.published_slug = ${slug}
        AND a.status = 'PUBLISHED'
        AND a.current_snapshot_id IS NOT NULL
        AND a.published_revision >= 1
        AND a.published_revision <= a.draft_revision
        AND a.published_revision = s.snapshot_revision
        AND a.published_slug = s.published_slug;
    `;
    return rows[0] ?? null;
  }

  /**
   * Looks up retained media assets for a given snapshot, ensuring retention via article_snapshot_media.
   */
  async findRetainedMediaForSnapshot(
    snapshotId: string,
    mediaAssetIds: string[],
  ): Promise<RetainedMediaRow[]> {
    if (mediaAssetIds.length === 0) {
      return [];
    }

    return this.prisma.articleSnapshotMedia.findMany({
      where: {
        snapshotId,
        mediaAssetId: { in: mediaAssetIds },
      },
      select: {
        snapshotId: true,
        mediaAssetId: true,
        mediaAsset: {
          select: {
            id: true,
            mimeType: true,
            width: true,
            height: true,
            altText: true,
          },
        },
      },
    });
  }

  /**
   * Batch lookup of retained media assets across multiple snapshots (e.g. for article listing covers).
   */
  async findRetainedMediaBatch(
    pairs: { snapshotId: string; mediaAssetId: string }[],
  ): Promise<RetainedMediaRow[]> {
    if (pairs.length === 0) {
      return [];
    }

    return this.prisma.articleSnapshotMedia.findMany({
      where: {
        OR: pairs.map((p) => ({
          snapshotId: p.snapshotId,
          mediaAssetId: p.mediaAssetId,
        })),
      },
      select: {
        snapshotId: true,
        mediaAssetId: true,
        mediaAsset: {
          select: {
            id: true,
            mimeType: true,
            width: true,
            height: true,
            altText: true,
          },
        },
      },
    });
  }
}
