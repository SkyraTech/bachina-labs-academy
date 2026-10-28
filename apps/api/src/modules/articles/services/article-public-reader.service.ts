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

  constructor(private readonly repository: ArticlePublicReaderRepository) {}

  /**
   * Retrieves a paginated list of published articles from immutable snapshots.
   */
  async listPublishedArticles(
    query: PublicArticlesQueryDto,
  ): Promise<PublicArticleListResponseDto> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.repository.findPublishedArticles(offset, limit),
      this.repository.countPublishedArticles(),
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

    const items: PublicArticleItemDto[] = rows.map((r) => ({
      id: r.articleId,
      slug: r.publishedSlug,
      title: r.title,
      summary: r.summary,
      typographyPreset: r.typographyPreset,
      cover: r.coverMediaId ? mediaMap.get(`${r.snapshotId}:${r.coverMediaId}`) ?? null : null,
      revision: r.snapshotRevision,
      publishedAt: r.publishedAt.toISOString(),
    }));

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

    return {
      id: row.articleId,
      slug: row.publishedSlug,
      title: row.title,
      summary: row.summary,
      typographyPreset: row.typographyPreset,
      cover: coverProjection,
      revision: row.snapshotRevision,
      publishedAt: row.publishedAt.toISOString(),
      blocks: projectedBlocks,
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
