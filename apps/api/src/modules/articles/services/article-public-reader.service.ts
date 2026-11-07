import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ArticleBlockType } from '@prisma/client';
import {
  ArticlePublicReaderRepository,
  type RetainedMediaRow,
} from '../repositories/article-public-reader.repository.js';
import type { PublicArticlesQueryDto } from '../dto/public-articles-query.dto.js';
import type {
  PublicArticleListResponseDto,
  PublicArticleItemDto,
} from '../dto/public-article-list-response.dto.js';
import type {
  PublicArticleDetailResponseDto,
  PublicArticleBlockDto,
} from '../dto/public-article-detail-response.dto.js';
import type { PublicMediaResponseDto } from '../dto/public-media-response.dto.js';
import type {
  PublicDiscoveredCategoryDto,
  PublicDiscoveredTagDto,
} from '../dto/public-taxonomy-discovery-response.dto.js';
import { validateBlockContent } from '../types/block-payloads.types.js';

interface RawSnapshotBlocksPayload {
  schemaVersion: number;
  blocks: Array<{
    id: string;
    type: ArticleBlockType;
    position: number;
    schemaVersion?: number;
    content: Record<string, any>;
    mediaAssetId?: string | null;
  }>;
}

/**
 * ArticlePublicReaderService — business logic layer for public article reading.
 *
 * Responsibilities:
 * - Exposes exclusively immutable publication snapshots.
 * - Guarantees unpublished draft edits never leak into public responses.
 * - Fails closed on publication inconsistencies or missing retention references.
 * - Safely projects media metadata without exposing storage keys or credentials.
 * - Preserves deterministic ordering and pagination.
 */
@Injectable()
export class ArticlePublicReaderService {
  private readonly logger = new Logger(ArticlePublicReaderService.name);

  private readonly SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  private readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(private readonly repository: ArticlePublicReaderRepository) {}

  /**
   * Retrieves a paginated list of published articles from immutable snapshots,
   * optionally filtered by category, tag slug, and/or search keyword.
   */
  async listPublishedArticles(
    query: PublicArticlesQueryDto,
  ): Promise<PublicArticleListResponseDto> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    const categorySlug = query.category?.trim() || undefined;
    const tagSlug = query.tag?.trim() || undefined;
    const searchTerm = query.q?.trim() || undefined;
    const authorId = query.authorId?.trim() || undefined;

    const hasFilter = Boolean(categorySlug || tagSlug || searchTerm || authorId);

    const [rows, total] = await Promise.all([
      hasFilter
        ? authorId
          ? this.repository.findPublishedArticles(
              offset,
              limit,
              categorySlug,
              tagSlug,
              searchTerm,
              authorId,
            )
          : searchTerm
            ? this.repository.findPublishedArticles(
                offset,
                limit,
                categorySlug,
                tagSlug,
                searchTerm,
              )
            : this.repository.findPublishedArticles(
                offset,
                limit,
                categorySlug,
                tagSlug,
              )
        : this.repository.findPublishedArticles(offset, limit),
      hasFilter
        ? authorId
          ? this.repository.countPublishedArticles(
              categorySlug,
              tagSlug,
              searchTerm,
              authorId,
            )
          : searchTerm
            ? this.repository.countPublishedArticles(
                categorySlug,
                tagSlug,
                searchTerm,
              )
            : this.repository.countPublishedArticles(categorySlug, tagSlug)
        : this.repository.countPublishedArticles(),
    ]);

    // Batch resolve retained cover media
    const coverPairs: { snapshotId: string; mediaAssetId: string }[] = [];
    for (const r of rows) {
      if (r.coverMediaId) {
        coverPairs.push({
          snapshotId: r.snapshotId,
          mediaAssetId: r.coverMediaId,
        });
      }
    }

    const mediaMap = new Map<string, PublicMediaResponseDto>();
    if (coverPairs.length > 0) {
      const retainedMedia = await this.repository.findRetainedMediaBatch(coverPairs);
      for (const m of retainedMedia) {
        mediaMap.set(`${m.snapshotId}:${m.mediaAssetId}`, this.mapMediaProjection(m));
      }
    }

    const items: PublicArticleItemDto[] = rows.map((r) => {
      const taxonomy = this.mapSnapshotTaxonomy(r.taxonomy, r.isTaxonomySqlNull);
      return {
        id: r.articleId,
        slug: r.publishedSlug,
        title: r.title,
        summary: r.summary,
        typographyPreset: r.typographyPreset,
        cover: r.coverMediaId ? mediaMap.get(`${r.snapshotId}:${r.coverMediaId}`) ?? null : null,
        revision: r.snapshotRevision,
        publishedAt: r.publishedAt.toISOString(),
        taxonomyCaptured: taxonomy.taxonomyCaptured,
        category: taxonomy.category,
        tags: taxonomy.tags,
        author: {
          id: r.authorId,
          displayName: 'Academy Author',
        },
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items,
      page,
      limit,
      total,
      totalPages,
    };
  }

  /**
   * Discovers categories represented in active published snapshots.
   */
  async discoverCategories(): Promise<PublicDiscoveredCategoryDto[]> {
    const rows = await this.repository.discoverCategories();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      articleCount: r.articleCount,
    }));
  }

  /**
   * Discovers tags represented in active published snapshots.
   */
  async discoverTags(): Promise<PublicDiscoveredTagDto[]> {
    const rows = await this.repository.discoverTags();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      articleCount: r.articleCount,
    }));
  }

  /**
   * Retrieves an immutable published article snapshot by its current published slug.
   */
  async getPublishedArticleBySlug(
    slug: string,
  ): Promise<PublicArticleDetailResponseDto> {
    // 1. Validate slug syntax
    if (!slug || !this.SLUG_REGEX.test(slug) || slug.length < 3 || slug.length > 280) {
      throw new BadRequestException(
        'Invalid article slug format. Must be lowercase alphanumeric with hyphens, 3 to 280 characters.',
      );
    }

    // 2. Fetch published article joined with its active snapshot
    const row = await this.repository.findPublishedArticleBySlug(slug);
    if (!row) {
      throw new NotFoundException('Article not found.');
    }

    // 3. Parse and validate snapshot JSONB blocks structure
    const snapshotPayload = this.validateSnapshotPayload(row.blocks);

    // 4. Collect referenced media IDs and verify against snapshot media retention
    const referencedMediaIds = new Set<string>();
    if (row.coverMediaId) {
      referencedMediaIds.add(row.coverMediaId);
    }

    for (const block of snapshotPayload.blocks) {
      if (block.type === ArticleBlockType.IMAGE) {
        if (!block.mediaAssetId) {
          this.logger.warn(`Snapshot ${row.snapshotId} has IMAGE block without mediaAssetId.`);
          throw new NotFoundException('Article not found.');
        }
        referencedMediaIds.add(block.mediaAssetId);
      } else {
        if (block.mediaAssetId) {
          this.logger.warn(`Snapshot ${row.snapshotId} has non-IMAGE block with mediaAssetId.`);
          throw new NotFoundException('Article not found.');
        }
      }
    }

    const mediaMap = new Map<string, PublicMediaResponseDto>();
    if (referencedMediaIds.size > 0) {
      const retainedMedia = await this.repository.findRetainedMediaForSnapshot(
        row.snapshotId,
        Array.from(referencedMediaIds),
      );

      // Verify that every referenced media ID has an authentic retention record
      for (const m of retainedMedia) {
        mediaMap.set(m.mediaAssetId, this.mapMediaProjection(m));
      }

      if (row.coverMediaId && !mediaMap.has(row.coverMediaId)) {
        this.logger.warn(
          `Snapshot ${row.snapshotId} coverMediaId ${row.coverMediaId} missing from retention table.`,
        );
        throw new NotFoundException('Article not found.');
      }

      for (const block of snapshotPayload.blocks) {
        if (block.type === ArticleBlockType.IMAGE && block.mediaAssetId) {
          if (!mediaMap.has(block.mediaAssetId)) {
            this.logger.warn(
              `Snapshot ${row.snapshotId} image block media ${block.mediaAssetId} missing from retention table.`,
            );
            throw new NotFoundException('Article not found.');
          }
        }
      }
    }

    // 5. Revalidate and assemble deterministic content blocks
    const sortedBlocks = [...snapshotPayload.blocks].sort(
      (a, b) => a.position - b.position,
    );

    const projectedBlocks: PublicArticleBlockDto[] = sortedBlocks.map((block) => {
      // Revalidate content structure
      const validatedContent = validateBlockContent(block.type, block.content);
      const media = block.mediaAssetId ? mediaMap.get(block.mediaAssetId) ?? null : null;

      return {
        id: block.id,
        type: block.type,
        position: block.position,
        schemaVersion: block.schemaVersion ?? 1,
        content: validatedContent,
        media,
      };
    });

    const coverProjection = row.coverMediaId ? mediaMap.get(row.coverMediaId) ?? null : null;
    const taxonomy = this.mapSnapshotTaxonomy(row.taxonomy, row.isTaxonomySqlNull);

    return {
      id: row.articleId,
      slug: row.publishedSlug,
      title: row.title,
      summary: row.summary,
      typographyPreset: row.typographyPreset,
      cover: coverProjection,
      revision: row.snapshotRevision,
      publishedAt: row.publishedAt.toISOString(),
      taxonomyCaptured: taxonomy.taxonomyCaptured,
      category: taxonomy.category,
      tags: taxonomy.tags,
      author: {
        id: row.authorId,
        displayName: 'Academy Author',
      },
      blocks: projectedBlocks,
    };
  }

  /**
   * Validates and projects immutable snapshot taxonomy into public response shape.
   * Fails closed with NotFoundException if malformed non-null data or invalid discriminator is encountered.
   */
  private mapSnapshotTaxonomy(
    rawTaxonomy: unknown,
    isTaxonomySqlNull: boolean,
  ): {
    taxonomyCaptured: boolean;
    category: { id: string; name: string; slug: string } | null;
    tags: Array<{ id: string; name: string; slug: string }>;
  } {
    // 1. Strict boolean discriminator verification — only primitive boolean is acceptable
    if (typeof isTaxonomySqlNull !== 'boolean') {
      this.logger.warn(
        `Snapshot taxonomy SQL null discriminator is invalid or missing: ${String(isTaxonomySqlNull)}.`,
      );
      throw new NotFoundException('Article not found.');
    }

    // 2. If isTaxonomySqlNull is true, rawTaxonomy MUST strictly be null (SQL NULL)
    if (isTaxonomySqlNull === true) {
      if (rawTaxonomy !== null) {
        this.logger.warn(
          `Inconsistent snapshot taxonomy: SQL NULL discriminator requires an explicit null taxonomy value (received: ${typeof rawTaxonomy}).`,
        );
        throw new NotFoundException('Article not found.');
      }
      return {
        taxonomyCaptured: false,
        category: null,
        tags: [],
      };
    }

    // 3. From here, isTaxonomySqlNull is guaranteed to be false (PostgreSQL verified non-SQL-NULL).
    // If rawTaxonomy is null/undefined, it represents JSON literal null ('null'::jsonb), which is malformed.
    if (rawTaxonomy === null || rawTaxonomy === undefined) {
      this.logger.warn('Snapshot taxonomy is JSON literal null (malformed non-null).');
      throw new NotFoundException('Article not found.');
    }

    // 3. Must be a non-array JSON object
    if (typeof rawTaxonomy !== 'object' || Array.isArray(rawTaxonomy)) {
      this.logger.warn('Snapshot taxonomy is not a JSON object.');
      throw new NotFoundException('Article not found.');
    }

    const doc = rawTaxonomy as Record<string, any>;

    // 4. schemaVersion must be numeric 1
    if (typeof doc.schemaVersion !== 'number' || doc.schemaVersion !== 1) {
      this.logger.warn(`Snapshot taxonomy has unsupported schemaVersion: ${doc.schemaVersion}.`);
      throw new NotFoundException('Article not found.');
    }

    // 5. category and tags properties must be present
    if (!('category' in doc) || !('tags' in doc)) {
      this.logger.warn('Snapshot taxonomy missing category or tags property.');
      throw new NotFoundException('Article not found.');
    }

    // 6. Validate category: null OR valid object
    let category: { id: string; name: string; slug: string } | null = null;
    if (doc.category !== null) {
      if (typeof doc.category !== 'object' || Array.isArray(doc.category)) {
        this.logger.warn('Snapshot taxonomy category is not an object.');
        throw new NotFoundException('Article not found.');
      }
      const cat = doc.category as Record<string, any>;
      if (
        typeof cat.id !== 'string' ||
        !this.UUID_REGEX.test(cat.id) ||
        typeof cat.name !== 'string' ||
        cat.name.length < 2 ||
        cat.name.length > 120 ||
        typeof cat.slug !== 'string' ||
        cat.slug.length < 2 ||
        cat.slug.length > 160 ||
        !this.SLUG_REGEX.test(cat.slug)
      ) {
        this.logger.warn('Snapshot taxonomy category structure is invalid.');
        throw new NotFoundException('Article not found.');
      }
      category = {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
      };
    }

    // 7. Validate tags: array of 0..20 unique valid tag objects
    if (!Array.isArray(doc.tags) || doc.tags.length > 20) {
      this.logger.warn('Snapshot taxonomy tags is not an array or exceeds 20 items.');
      throw new NotFoundException('Article not found.');
    }

    const tagIdSet = new Set<string>();
    const tags: Array<{ id: string; name: string; slug: string }> = [];

    for (const item of doc.tags) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        this.logger.warn('Snapshot taxonomy tag item is not an object.');
        throw new NotFoundException('Article not found.');
      }
      const t = item as Record<string, any>;
      if (
        typeof t.id !== 'string' ||
        !this.UUID_REGEX.test(t.id) ||
        typeof t.name !== 'string' ||
        t.name.length < 2 ||
        t.name.length > 80 ||
        typeof t.slug !== 'string' ||
        t.slug.length < 2 ||
        t.slug.length > 120 ||
        !this.SLUG_REGEX.test(t.slug)
      ) {
        this.logger.warn('Snapshot taxonomy tag structure is invalid.');
        throw new NotFoundException('Article not found.');
      }

      if (tagIdSet.has(t.id)) {
        this.logger.warn(`Snapshot taxonomy contains duplicate tag id: ${t.id}.`);
        throw new NotFoundException('Article not found.');
      }
      tagIdSet.add(t.id);

      tags.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
      });
    }

    return {
      taxonomyCaptured: true,
      category,
      tags,
    };
  }

  /**
   * Validates that the raw JSONB payload conforms to the snapshot contract.
   * Fails closed if malformed.
   */
  private validateSnapshotPayload(rawBlocks: unknown): RawSnapshotBlocksPayload {
    if (typeof rawBlocks !== 'object' || rawBlocks === null || Array.isArray(rawBlocks)) {
      this.logger.warn('Snapshot blocks JSON is not an object.');
      throw new NotFoundException('Article not found.');
    }

    const payload = rawBlocks as Record<string, any>;
    if (typeof payload.schemaVersion !== 'number' || payload.schemaVersion < 1) {
      this.logger.warn('Snapshot blocks missing valid schemaVersion.');
      throw new NotFoundException('Article not found.');
    }

    if (!Array.isArray(payload.blocks)) {
      this.logger.warn('Snapshot blocks property is not an array.');
      throw new NotFoundException('Article not found.');
    }

    return payload as RawSnapshotBlocksPayload;
  }

  /**
   * Projects a raw RetainedMediaRow into a safe public DTO without exposing storage keys or credentials.
   */
  private mapMediaProjection(row: RetainedMediaRow): PublicMediaResponseDto {
    return {
      id: row.mediaAsset.id,
      mimeType: row.mediaAsset.mimeType,
      width: row.mediaAsset.width,
      height: row.mediaAsset.height,
      altText: row.mediaAsset.altText,
      url: `/api/v1/articles/public/media/${row.mediaAsset.id}`,
    };
  }
}
