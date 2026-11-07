import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { PublicAuthorResponseDto } from '../dto/public-author-response.dto.js';
import type {
  PublishedArticleSummaryRow,
  RetainedMediaRow,
} from '../../articles/repositories/article-public-reader.repository.js';

@Injectable()
export class PublicAuthorsRepository {
  private readonly logger = new Logger(PublicAuthorsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up an active author by UUID with strict field projection.
   * Strictly excludes email, passwordHash, emailVerifiedAt, sessions, tokens, and audit logs.
   * Inactive, suspended, or disabled users return null.
   */
  async findAuthorProfile(authorId: string): Promise<PublicAuthorResponseDto | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: authorId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!user) {
      return null;
    }

    const publishedCount = await this.countAuthorPublishedArticles(authorId);

    return {
      id: user.id,
      displayName: 'Academy Author',
      publishedArticlesCount: publishedCount,
      joinedAt: user.createdAt.toISOString(),
    };
  }

  /**
   * Counts active published articles for an author.
   */
  async countAuthorPublishedArticles(authorId: string): Promise<number> {
    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE a.author_id = ${authorId}::uuid
        AND a.status = 'PUBLISHED'
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
   * Retrieves paginated published articles owned by an author from immutable snapshots.
   */
  async findAuthorPublishedArticles(
    authorId: string,
    offset: number,
    limit: number,
  ): Promise<PublishedArticleSummaryRow[]> {
    return this.prisma.$queryRaw<PublishedArticleSummaryRow[]>`
      SELECT 
        a.id AS "articleId",
        a.author_id AS "authorId",
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
        s.published_at AS "publishedAt",
        s.taxonomy,
        (s.taxonomy IS NULL) AS "isTaxonomySqlNull"
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE a.author_id = ${authorId}::uuid
        AND a.status = 'PUBLISHED'
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
   * Resolves retained media asset projections for cover images.
   */
  async findRetainedMediaBatch(
    pairs: { snapshotId: string; mediaAssetId: string }[],
  ): Promise<RetainedMediaRow[]> {
    if (pairs.length === 0) return [];

    const snapshotIds = Array.from(new Set(pairs.map((p) => p.snapshotId)));
    const mediaAssetIds = Array.from(new Set(pairs.map((p) => p.mediaAssetId)));

    return this.prisma.articleSnapshotMedia.findMany({
      where: {
        snapshotId: { in: snapshotIds },
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
}

