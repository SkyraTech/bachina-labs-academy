import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma, ArticleBlockType } from '@prisma/client';
import { ArticlePublicationRepository } from '../repositories/article-publication.repository.js';
import type { PublishArticleDto } from '../dto/publish-article.dto.js';
import type { ArticlePublicationResponseDto } from '../dto/article-publication-response.dto.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { AccountEligibilityPolicy } from '../../../common/authorization/policies/account-eligibility.policy.js';
import { validateBlockContent } from '../types/block-payloads.types.js';

/**
 * ArticlePublicationService — business logic layer for article publication and snapshotting.
 *
 * Responsibilities:
 * - Author account eligibility and ownership verification.
 * - Optimistic concurrency control via expectedRevision.
 * - Publication lifecycle state transitions (DRAFT -> PUBLISHED, PUBLISHED -> PUBLISHED republishing).
 * - Detection and rejection of unchanged republish requests.
 * - Revalidation of all persisted content blocks and media asset references.
 * - Deterministic, ordered assembly of immutable snapshot payloads.
 * - Media asset retention collection and deduplication.
 * - Atomic execution of snapshot creation, retention association, and article publication state.
 * - Comprehensive error mapping of PostgreSQL unique and check constraints.
 */
@Injectable()
export class ArticlePublicationService {
  private readonly logger = new Logger(ArticlePublicationService.name);

  constructor(private readonly repository: ArticlePublicationRepository) {}

  /**
   * Publishes an owned article draft or republishes an updated published article.
   */
  async publishArticle(
    user: AuthenticatedUser,
    articleId: string,
    dto: PublishArticleDto,
  ): Promise<ArticlePublicationResponseDto> {
    // 1. Author eligibility enforcement (active account + verified email)
    AccountEligibilityPolicy.assertEligible(user);

    try {
      return await this.repository.transaction(async (tx) => {
        // 2. Lock the owned article row using PostgreSQL FOR UPDATE
        const article = await this.repository.findArticleForUpdate(
          articleId,
          user.id,
          tx,
        );

        // Mask existence if missing or foreign-owned
        if (!article) {
          throw new NotFoundException('Article not found.');
        }

        // 3. Lifecycle check: ARCHIVED articles cannot be published
        if (article.status === 'ARCHIVED') {
          throw new ConflictException('Cannot publish an archived article.');
        }

        // 4. Optimistic concurrency control: expectedRevision must match current draftRevision
        if (article.draftRevision !== dto.expectedRevision) {
          throw new ConflictException(
            `Revision conflict: expected revision ${dto.expectedRevision}, but article is at revision ${article.draftRevision}.`,
          );
        }

        // 5. Republishing check: unchanged drafts must not create duplicate snapshots
        if (
          article.status === 'PUBLISHED' &&
          article.publishedRevision === article.draftRevision
        ) {
          throw new ConflictException('No unpublished draft changes to publish.');
        }

        if (
          article.status === 'PUBLISHED' &&
          article.publishedRevision > article.draftRevision
        ) {
          throw new ConflictException(
            'Integrity anomaly: published revision exceeds draft revision.',
          );
        }

        // 6. Validate core publication metadata against database constraints
        const trimmedTitle = article.title.trim();
        if (trimmedTitle.length < 3 || article.title.length > 255) {
          throw new BadRequestException(
            'Article title must be between 3 and 255 characters after trimming.',
          );
        }

        const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
        if (
          !slugRegex.test(article.draftSlug) ||
          article.draftSlug.length < 3 ||
          article.draftSlug.length > 280
        ) {
          throw new BadRequestException(
            'Article draft slug must be lowercase alphanumeric with hyphens, 3 to 280 characters.',
          );
        }

        if (
          !['MODERN_SANS', 'EDITORIAL_SERIF', 'TECHNICAL_MINIMAL'].includes(
            article.typographyPreset,
          )
        ) {
          throw new BadRequestException('Invalid typography preset.');
        }

        // 7. Ordered retrieval of all draft blocks
        const blocks = await this.repository.findBlocksForArticle(articleId, tx);

        // 8. Publishability content check: minimum 1 non-divider block
        if (blocks.length === 0) {
          throw new BadRequestException(
            'Article must contain at least one content block to be published.',
          );
        }

        const hasNonDividerBlock = blocks.some(
          (b) => b.type !== ArticleBlockType.DIVIDER,
        );
        if (!hasNonDividerBlock) {
          throw new BadRequestException(
            'Article must contain at least one non-divider content block to be published.',
          );
        }

        // 9. Revalidate all block contents and collect distinct media references
        const distinctMediaIds = new Set<string>();

        // Check cover media if present
        if (article.coverMediaId) {
          const coverMedia = await this.repository.findMediaAsset(
            article.coverMediaId,
            tx,
          );
          if (!coverMedia) {
            throw new BadRequestException('Cover media asset not found.');
          }
          if (coverMedia.uploaderId !== user.id) {
            throw new ForbiddenException(
              'You do not have permission to use the cover media asset.',
            );
          }
          if (coverMedia.mediaType !== 'IMAGE') {
            throw new BadRequestException(
              'Cover media asset must be an IMAGE.',
            );
          }
          distinctMediaIds.add(article.coverMediaId);
        }

        // Validate draft blocks and media references
        const validatedBlocks: Array<{
          id: string;
          type: ArticleBlockType;
          position: number;
          schemaVersion: number;
          content: Record<string, any>;
          mediaAssetId: string | null;
        }> = [];

        for (const block of blocks) {
          // Revalidate block content against authoritative content validator
          const validatedContent = validateBlockContent(
            block.type,
            block.content,
          );

          if (block.type === ArticleBlockType.IMAGE) {
            if (!block.mediaAssetId) {
              throw new BadRequestException(
                'IMAGE blocks require a mediaAssetId.',
              );
            }
            const media = await this.repository.findMediaAsset(
              block.mediaAssetId,
              tx,
            );
            if (!media) {
              throw new BadRequestException(
                'Referenced media asset not found.',
              );
            }
            if (media.uploaderId !== user.id) {
              throw new ForbiddenException(
                'You do not have permission to use the referenced media asset.',
              );
            }
            if (media.mediaType !== 'IMAGE') {
              throw new BadRequestException(
                'Referenced media asset must be an IMAGE.',
              );
            }
            distinctMediaIds.add(block.mediaAssetId);
          } else {
            if (block.mediaAssetId !== null && block.mediaAssetId !== undefined) {
              throw new BadRequestException(
                'Non-IMAGE blocks cannot reference a mediaAssetId.',
              );
            }
          }

          validatedBlocks.push({
            id: block.id,
            type: block.type,
            position: block.position,
            schemaVersion: block.schemaVersion ?? 1,
            content: validatedContent,
            mediaAssetId: block.mediaAssetId ?? null,
          });
        }

        // 10. Construct deterministic canonical snapshot blocks payload
        const snapshotBlocksPayload = {
          schemaVersion: 1,
          blocks: validatedBlocks,
        };

        const payloadJsonStr = JSON.stringify(snapshotBlocksPayload);
        if (Buffer.byteLength(payloadJsonStr, 'utf8') > 1048576) {
          throw new BadRequestException(
            'Snapshot blocks content exceeds maximum allowed size of 1048576 bytes.',
          );
        }

        // 11. Create immutable ArticleSnapshot record
        const now = new Date();
        const snapshot = await this.repository.createSnapshot(
          {
            articleId: article.id,
            snapshotRevision: article.draftRevision,
            title: trimmedTitle,
            publishedSlug: article.draftSlug,
            summary: article.summary,
            typographyPreset: article.typographyPreset,
            coverMediaId: article.coverMediaId,
            blocks: snapshotBlocksPayload,
            publishedAt: now,
          },
          tx,
        );

        // 12. Persist media retention records in article_snapshot_media
        if (distinctMediaIds.size > 0) {
          const retentionRecords = Array.from(distinctMediaIds).map(
            (mediaAssetId) => ({
              snapshotId: snapshot.id,
              mediaAssetId,
            }),
          );
          await this.repository.createSnapshotMediaRetention(
            retentionRecords,
            tx,
          );
        }

        // 13. Update Article publication state
        // publishedAt preserves first publication timestamp; republishing keeps the original publishedAt.
        const firstPublishedAt = article.publishedAt ?? now;

        const updatedArticle = await this.repository.updateArticlePublished(
          article.id,
          {
            publishedSlug: article.draftSlug,
            publishedRevision: article.draftRevision,
            currentSnapshotId: snapshot.id,
            publishedAt: firstPublishedAt,
          },
          tx,
        );

        this.logger.log(
          `Article ${article.id} published successfully at revision ${article.draftRevision} (snapshot: ${snapshot.id}, slug: ${article.draftSlug}).`,
        );

        return {
          articleId: updatedArticle.id,
          status: updatedArticle.status,
          draftRevision: updatedArticle.draftRevision,
          publishedRevision: updatedArticle.publishedRevision,
          publishedSlug: updatedArticle.publishedSlug!,
          currentSnapshotId: updatedArticle.currentSnapshotId!,
          publishedAt: updatedArticle.publishedAt!.toISOString(),
        };
      });
    } catch (error: unknown) {
      this.handleDatabaseErrors(error);
      throw error;
    }
  }

  /**
   * Translates known Prisma / PostgreSQL constraint violations into semantic HTTP exceptions.
   */
  private handleDatabaseErrors(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const metaTarget = error.meta?.target;
        const target = Array.isArray(metaTarget)
          ? metaTarget.join(',')
          : typeof metaTarget === 'string'
            ? metaTarget
            : JSON.stringify(metaTarget ?? '');

        if (
          target.includes('published_slug') ||
          target.includes('articles_published_slug_key')
        ) {
          throw new ConflictException(
            'A published article with this slug already exists.',
          );
        }
        if (
          target.includes('snapshot_revision') ||
          target.includes('article_snapshots_article_id_snapshot_revision_key')
        ) {
          throw new ConflictException(
            'A snapshot for this revision has already been published.',
          );
        }
        throw new ConflictException(
          'Publication conflict: a unique constraint was violated.',
        );
      }
    }
  }
}
