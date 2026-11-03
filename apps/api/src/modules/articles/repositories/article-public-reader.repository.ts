import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  taxonomy: Prisma.JsonValue | null;
  isTaxonomySqlNull: boolean;
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

export interface DiscoveredTaxonomyRow {
  id: string;
  name: string;
  slug: string;
  articleCount: number;
}

/**
 * Valid captured schemaVersion 1 snapshot taxonomy predicate.
 * Excludes legacy SQL NULL, JSON literal null, wrong versions, malformed structures,
 * duplicate tag IDs, and oversized arrays.
 */
const VALID_CAPTURED_TAXONOMY_SQL = Prisma.sql`(
  s.taxonomy IS NOT NULL
  AND jsonb_typeof(s.taxonomy) = 'object'
  AND (s.taxonomy ? 'schemaVersion')
  AND (s.taxonomy ? 'category')
  AND (s.taxonomy ? 'tags')
  AND jsonb_typeof(s.taxonomy->'schemaVersion') = 'number'
  AND s.taxonomy->'schemaVersion' = '1'::jsonb
  AND (
    s.taxonomy->'category' = 'null'::jsonb
    OR (
      jsonb_typeof(s.taxonomy->'category') = 'object'
      AND (s.taxonomy->'category'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (s.taxonomy->'category'->>'name') IS NOT NULL
      AND length(s.taxonomy->'category'->>'name') BETWEEN 2 AND 120
      AND (s.taxonomy->'category'->>'slug') IS NOT NULL
      AND length(s.taxonomy->'category'->>'slug') BETWEEN 2 AND 160
      AND (s.taxonomy->'category'->>'slug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
  )
  AND (
    CASE 
      WHEN jsonb_typeof(s.taxonomy->'tags') = 'array' AND jsonb_array_length(s.taxonomy->'tags') <= 20 THEN
        NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(s.taxonomy->'tags') = 'array' THEN s.taxonomy->'tags' ELSE '[]'::jsonb END
          ) AS t
          WHERE jsonb_typeof(t) != 'object'
            OR (t->>'id') IS NULL
            OR NOT ((t->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR (t->>'name') IS NULL
            OR length(t->>'name') NOT BETWEEN 2 AND 80
            OR (t->>'slug') IS NULL
            OR length(t->>'slug') NOT BETWEEN 2 AND 120
            OR NOT ((t->>'slug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
        )
        AND (
          SELECT count(DISTINCT t->>'id') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(s.taxonomy->'tags') = 'array' THEN s.taxonomy->'tags' ELSE '[]'::jsonb END
          ) AS t
        ) = jsonb_array_length(s.taxonomy->'tags')
      ELSE false
    END
  )
)`;

/**
 * ArticlePublicReaderRepository — read-only repository for published articles.
 *
 * Responsibilities:
 * - Queries strictly published articles joined with their active immutable snapshot.
 * - Enforces composite key integrity and revision alignment in SQL.
 * - Enforces deterministic ordering: active snapshot published_at DESC, article id DESC.
 * - Verifies media asset retention references via article_snapshot_media.
 * - Discovers published categories and tags represented in active immutable snapshots.
 * - Filters published articles by category and/or tag slug using immutable snapshot taxonomy.
 */
@Injectable()
export class ArticlePublicReaderRepository {
  private readonly logger = new Logger(ArticlePublicReaderRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a paginated list of published articles joined with their active snapshot,
   * optionally filtered by category, tag slug, and/or search term.
   */
  async findPublishedArticles(
    offset: number,
    limit: number,
    categorySlug?: string,
    tagSlug?: string,
    searchTerm?: string,
  ): Promise<PublishedArticleSummaryRow[]> {
    const whereClauses: Prisma.Sql[] = [
      Prisma.sql`a.status = 'PUBLISHED'`,
      Prisma.sql`a.published_slug IS NOT NULL`,
      Prisma.sql`a.current_snapshot_id IS NOT NULL`,
      Prisma.sql`a.published_revision >= 1`,
      Prisma.sql`a.published_revision <= a.draft_revision`,
      Prisma.sql`a.published_revision = s.snapshot_revision`,
      Prisma.sql`a.published_slug = s.published_slug`,
    ];

    if (categorySlug || tagSlug) {
      whereClauses.push(VALID_CAPTURED_TAXONOMY_SQL);
    }

    if (categorySlug) {
      whereClauses.push(
        Prisma.sql`s.taxonomy->'category' != 'null'::jsonb AND s.taxonomy->'category'->>'slug' = ${categorySlug}`,
      );
    }

    if (tagSlug) {
      whereClauses.push(
        Prisma.sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(s.taxonomy->'tags') = 'array' THEN s.taxonomy->'tags' ELSE '[]'::jsonb END
          ) AS t 
          WHERE t->>'slug' = ${tagSlug}
        )`,
      );
    }

    if (searchTerm) {
      const escaped = searchTerm
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      whereClauses.push(
        Prisma.sql`(s.title ILIKE ${pattern} ESCAPE '\\' OR (s.summary IS NOT NULL AND s.summary ILIKE ${pattern} ESCAPE '\\'))`,
      );
    }

    const whereSql = Prisma.join(whereClauses, ' AND ');

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
        s.published_at AS "publishedAt",
        s.taxonomy,
        (s.taxonomy IS NULL) AS "isTaxonomySqlNull"
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE ${whereSql}
      ORDER BY s.published_at DESC, a.id DESC
      LIMIT ${limit} OFFSET ${offset};
    `;
  }

  /**
   * Computes the total count of eligible published articles using identical predicates,
   * optionally filtered by category, tag slug, and/or search term.
   */
  async countPublishedArticles(
    categorySlug?: string,
    tagSlug?: string,
    searchTerm?: string,
  ): Promise<number> {
    const whereClauses: Prisma.Sql[] = [
      Prisma.sql`a.status = 'PUBLISHED'`,
      Prisma.sql`a.published_slug IS NOT NULL`,
      Prisma.sql`a.current_snapshot_id IS NOT NULL`,
      Prisma.sql`a.published_revision >= 1`,
      Prisma.sql`a.published_revision <= a.draft_revision`,
      Prisma.sql`a.published_revision = s.snapshot_revision`,
      Prisma.sql`a.published_slug = s.published_slug`,
    ];

    if (categorySlug || tagSlug) {
      whereClauses.push(VALID_CAPTURED_TAXONOMY_SQL);
    }

    if (categorySlug) {
      whereClauses.push(
        Prisma.sql`s.taxonomy->'category' != 'null'::jsonb AND s.taxonomy->'category'->>'slug' = ${categorySlug}`,
      );
    }

    if (tagSlug) {
      whereClauses.push(
        Prisma.sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(s.taxonomy->'tags') = 'array' THEN s.taxonomy->'tags' ELSE '[]'::jsonb END
          ) AS t 
          WHERE t->>'slug' = ${tagSlug}
        )`,
      );
    }

    if (searchTerm) {
      const escaped = searchTerm
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      whereClauses.push(
        Prisma.sql`(s.title ILIKE ${pattern} ESCAPE '\\' OR (s.summary IS NOT NULL AND s.summary ILIKE ${pattern} ESCAPE '\\'))`,
      );
    }

    const whereSql = Prisma.join(whereClauses, ' AND ');

    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM articles a
      JOIN article_snapshots s 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE ${whereSql};
    `;
    return Number(result[0]?.count ?? 0);
  }

  /**
   * Discovers categories represented in active published snapshots.
   * Returns deterministic frozen labels from latest active snapshot, with article count.
   */
  async discoverCategories(): Promise<DiscoveredTaxonomyRow[]> {
    return this.prisma.$queryRaw<DiscoveredTaxonomyRow[]>`
      WITH valid_categories AS (
        SELECT 
          s.taxonomy->'category'->>'slug' AS slug,
          s.taxonomy->'category'->>'id' AS id,
          s.taxonomy->'category'->>'name' AS name,
          a.id AS article_id,
          s.published_at AS published_at,
          s.id AS snapshot_id
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
          AND ${VALID_CAPTURED_TAXONOMY_SQL}
          AND s.taxonomy->'category' != 'null'::jsonb
      ),
      latest_per_slug AS (
        SELECT DISTINCT ON (slug)
          slug,
          id,
          name
        FROM valid_categories
        ORDER BY slug, published_at DESC, snapshot_id DESC
      ),
      counts_per_slug AS (
        SELECT 
          slug,
          count(DISTINCT article_id)::int AS "articleCount"
        FROM valid_categories
        GROUP BY slug
      )
      SELECT 
        l.id,
        l.name,
        l.slug,
        c."articleCount"
      FROM latest_per_slug l
      JOIN counts_per_slug c ON l.slug = c.slug
      ORDER BY l.slug ASC, l.id ASC;
    `;
  }

  /**
   * Discovers tags represented in active published snapshots.
   * Returns deterministic frozen labels from latest active snapshot, with article count.
   */
  async discoverTags(): Promise<DiscoveredTaxonomyRow[]> {
    return this.prisma.$queryRaw<DiscoveredTaxonomyRow[]>`
      WITH valid_tags AS (
        SELECT 
          t->>'slug' AS slug,
          t->>'id' AS id,
          t->>'name' AS name,
          a.id AS article_id,
          s.published_at AS published_at,
          s.id AS snapshot_id
        FROM articles a
        JOIN article_snapshots s 
          ON a.current_snapshot_id = s.id 
          AND a.id = s.article_id,
        jsonb_array_elements(
          CASE WHEN jsonb_typeof(s.taxonomy->'tags') = 'array' THEN s.taxonomy->'tags' ELSE '[]'::jsonb END
        ) AS t
        WHERE a.status = 'PUBLISHED'
          AND a.published_slug IS NOT NULL
          AND a.current_snapshot_id IS NOT NULL
          AND a.published_revision >= 1
          AND a.published_revision <= a.draft_revision
          AND a.published_revision = s.snapshot_revision
          AND a.published_slug = s.published_slug
          AND ${VALID_CAPTURED_TAXONOMY_SQL}
      ),
      latest_per_slug AS (
        SELECT DISTINCT ON (slug)
          slug,
          id,
          name
        FROM valid_tags
        ORDER BY slug, published_at DESC, snapshot_id DESC
      ),
      counts_per_slug AS (
        SELECT 
          slug,
          count(DISTINCT article_id)::int AS "articleCount"
        FROM valid_tags
        GROUP BY slug
      )
      SELECT 
        l.id,
        l.name,
        l.slug,
        c."articleCount"
      FROM latest_per_slug l
      JOIN counts_per_slug c ON l.slug = c.slug
      ORDER BY l.slug ASC, l.id ASC;
    `;
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
        s.published_at AS "publishedAt",
        s.taxonomy,
        (s.taxonomy IS NULL) AS "isTaxonomySqlNull"
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
