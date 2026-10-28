import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ArticleBlockType, ArticleStatus, type ArticleBlock } from '@prisma/client';
import { ArticleBlocksRepository } from '../repositories/article-blocks.repository.js';
import type { CreateArticleBlockDto } from '../dto/create-article-block.dto.js';
import type { UpdateArticleBlockDto } from '../dto/update-article-block.dto.js';
import type { DeleteArticleBlockQueryDto } from '../dto/delete-article-block-query.dto.js';
import type { ReorderArticleBlocksDto } from '../dto/reorder-article-blocks.dto.js';
import type {
  ArticleBlockWithRevisionDto,
  ReorderBlocksResponseDto,
} from '../dto/article-block-response.dto.js';
import type { ArticleBlockResponseDto } from '../dto/article-detail-response.dto.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { validateBlockContent } from '../types/block-payloads.types.js';

@Injectable()
export class ArticleBlocksService {
  private readonly logger = new Logger(ArticleBlocksService.name);

  constructor(private readonly repository: ArticleBlocksRepository) {}

  /**
   * Helper to map an ArticleBlock database model to its public DTO contract.
   */
  private mapBlockDto(block: ArticleBlock): ArticleBlockResponseDto {
    return {
      id: block.id,
      articleId: block.articleId,
      type: block.type,
      position: block.position,
      content: block.content as Record<string, unknown>,
      mediaAssetId: block.mediaAssetId,
      schemaVersion: block.schemaVersion,
      createdAt: block.createdAt.toISOString(),
      updatedAt: block.updatedAt.toISOString(),
    };
  }

  /**
   * Deep comparison for JSON content objects to identify exact no-ops.
   */
  private isContentEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Identifies PostgreSQL CHECK constraint violations for chk_article_blocks_content_size.
   * Inspects SQLSTATE 23514, Prisma error codes (P2004, P2010), and structured constraint metadata,
   * ensuring foreign key (23503), unique (23505), or connectivity errors are not misclassified.
   */
  private isContentSizeConstraintViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as Record<string, any>;

    const fullErrorText = `${e.message ?? ''} ${JSON.stringify(e.meta ?? '')}`;
    if (!fullErrorText.includes('chk_article_blocks_content_size')) {
      return false;
    }

    return (
      e.code === 'P2004' ||
      e.code === 'P2010' ||
      e.code === '23514' ||
      e.sqlState === '23514' ||
      e.meta?.code === '23514' ||
      fullErrorText.includes('check constraint') ||
      fullErrorText.includes('23514')
    );
  }

  /**
   * POST /api/v1/articles/:articleId/blocks
   *
   * Appends a new content block to the specified article draft.
   */
  async createBlock(
    user: AuthenticatedUser,
    articleId: string,
    dto: CreateArticleBlockDto,
  ): Promise<ArticleBlockWithRevisionDto> {
    const validatedContent = validateBlockContent(dto.type, dto.content);

    try {
      return await this.repository.transaction(async (tx) => {
      // 1. Lock article row with FOR UPDATE scoped to author
      const article = await this.repository.findArticleForUpdate(articleId, user.id, tx);
      if (!article) {
        throw new NotFoundException('Article not found.');
      }

      // 2. Lifecycle check: Archived articles cannot be edited
      if (article.status === ArticleStatus.ARCHIVED) {
        throw new ConflictException('Archived articles cannot be modified.');
      }

      // 3. Concurrency check: Validate optimistic draft revision
      if (article.draftRevision !== dto.expectedRevision) {
        throw new ConflictException(
          `Draft revision conflict: expected revision ${dto.expectedRevision}, but article is at revision ${article.draftRevision}.`,
        );
      }

      // 4. Validate media reference rules
      if (dto.type === ArticleBlockType.IMAGE) {
        if (!dto.mediaAssetId) {
          throw new BadRequestException('IMAGE blocks require a mediaAssetId.');
        }
        const media = await this.repository.findMediaAsset(dto.mediaAssetId, tx);
        if (!media) {
          throw new NotFoundException('Media asset not found.');
        }
        if (media.uploaderId !== user.id) {
          throw new ForbiddenException('You do not have permission to use this media asset.');
        }
        if (media.mediaType !== 'IMAGE') {
          throw new BadRequestException('Referenced media asset must be an IMAGE.');
        }
      } else {
        if (dto.mediaAssetId !== undefined && dto.mediaAssetId !== null) {
          throw new BadRequestException('mediaAssetId must be null for non-IMAGE blocks.');
        }
      }

      // 5. Append position determination
      const nextPosition = await this.repository.getNextPosition(articleId, tx);

      // 6. Insert new block
      const createdBlock = await this.repository.createBlock(
        {
          articleId,
          type: dto.type,
          position: nextPosition,
          content: validatedContent,
          mediaAssetId: dto.type === ArticleBlockType.IMAGE ? dto.mediaAssetId : null,
          schemaVersion: dto.schemaVersion ?? 1,
        },
        tx,
      );

      // 7. Increment draft revision exactly once
      const newRevision = await this.repository.incrementDraftRevision(
        articleId,
        article.draftRevision,
        tx,
      );

      this.logger.debug(
        `Created block ${createdBlock.id} for article ${articleId} at position ${nextPosition}. Revision advanced to ${newRevision}.`,
      );

      return {
        ...this.mapBlockDto(createdBlock),
        draftRevision: newRevision,
      };
    });
    } catch (err: unknown) {
      if (this.isContentSizeConstraintViolation(err)) {
        throw new BadRequestException(
          'Block content exceeds database maximum allowed size of 65536 bytes.',
        );
      }
      throw err;
    }
  }

  /**
   * PATCH /api/v1/articles/:articleId/blocks/:blockId
   *
   * Updates mutable attributes of an existing draft block.
   */
  async updateBlock(
    user: AuthenticatedUser,
    articleId: string,
    blockId: string,
    dto: UpdateArticleBlockDto,
  ): Promise<ArticleBlockWithRevisionDto> {
    try {
      return await this.repository.transaction(async (tx) => {
      // 1. Lock article row with FOR UPDATE scoped to author
      const article = await this.repository.findArticleForUpdate(articleId, user.id, tx);
      if (!article) {
        throw new NotFoundException('Article not found.');
      }

      // 2. Lifecycle check: Archived articles cannot be edited
      if (article.status === ArticleStatus.ARCHIVED) {
        throw new ConflictException('Archived articles cannot be modified.');
      }

      // 3. Concurrency check: Validate optimistic draft revision
      if (article.draftRevision !== dto.expectedRevision) {
        throw new ConflictException(
          `Draft revision conflict: expected revision ${dto.expectedRevision}, but article is at revision ${article.draftRevision}.`,
        );
      }

      // 4. Find block belonging to this article
      const block = await this.repository.findBlockById(blockId, articleId, tx);
      if (!block) {
        throw new NotFoundException('Block not found.');
      }

      // 5. Validate mutable fields
      let targetContent = block.content as Record<string, any>;
      let targetMediaAssetId = block.mediaAssetId;
      let hasMeaningfulChange = false;

      // Content update validation
      if (dto.content !== undefined) {
        const validatedContent = validateBlockContent(block.type, dto.content);
        if (!this.isContentEqual(validatedContent, block.content)) {
          targetContent = validatedContent;
          hasMeaningfulChange = true;
        }
      }

      // Media reference update validation
      if (dto.mediaAssetId !== undefined) {
        if (block.type === ArticleBlockType.IMAGE) {
          if (dto.mediaAssetId === null) {
            throw new BadRequestException('IMAGE blocks require a valid mediaAssetId and cannot be set to null.');
          }
          if (dto.mediaAssetId !== block.mediaAssetId) {
            const media = await this.repository.findMediaAsset(dto.mediaAssetId, tx);
            if (!media) {
              throw new NotFoundException('Media asset not found.');
            }
            if (media.uploaderId !== user.id) {
              throw new ForbiddenException('You do not have permission to use this media asset.');
            }
            if (media.mediaType !== 'IMAGE') {
              throw new BadRequestException('Referenced media asset must be an IMAGE.');
            }
            targetMediaAssetId = dto.mediaAssetId;
            hasMeaningfulChange = true;
          }
        } else {
          if (dto.mediaAssetId !== null) {
            throw new BadRequestException('mediaAssetId must be null for non-IMAGE blocks.');
          }
        }
      }

      // 6. No-op detection: If no meaningful changes, return without revision increment
      if (!hasMeaningfulChange) {
        this.logger.debug(
          `Update block ${blockId} is an exact no-op. Preserving revision ${article.draftRevision}.`,
        );
        return {
          ...this.mapBlockDto(block),
          draftRevision: article.draftRevision,
        };
      }

      // 7. Apply updates to the block
      const updatedBlock = await this.repository.updateBlock(
        blockId,
        {
          content: targetContent,
          mediaAsset: targetMediaAssetId
            ? { connect: { id: targetMediaAssetId } }
            : block.type === ArticleBlockType.IMAGE
              ? undefined
              : { disconnect: true },
        },
        tx,
      );

      // 8. Increment draft revision once
      const newRevision = await this.repository.incrementDraftRevision(
        articleId,
        article.draftRevision,
        tx,
      );

      this.logger.debug(
        `Updated block ${blockId} on article ${articleId}. Revision advanced to ${newRevision}.`,
      );

      return {
        ...this.mapBlockDto(updatedBlock),
        draftRevision: newRevision,
      };
    });
    } catch (err: unknown) {
      if (this.isContentSizeConstraintViolation(err)) {
        throw new BadRequestException(
          'Block content exceeds database maximum allowed size of 65536 bytes.',
        );
      }
      throw err;
    }
  }

  /**
   * DELETE /api/v1/articles/:articleId/blocks/:blockId?expectedRevision=N
   *
   * Deletes a draft block and compacts remaining positions contiguously.
   */
  async deleteBlock(
    user: AuthenticatedUser,
    articleId: string,
    blockId: string,
    query: DeleteArticleBlockQueryDto,
  ): Promise<void> {
    if (
      query?.expectedRevision === undefined ||
      query?.expectedRevision === null ||
      typeof query.expectedRevision !== 'number' ||
      !Number.isInteger(query.expectedRevision) ||
      query.expectedRevision < 1
    ) {
      throw new BadRequestException(
        'expectedRevision query parameter is required and must be an integer >= 1.',
      );
    }

    await this.repository.transaction(async (tx) => {
      // 1. Lock article row with FOR UPDATE scoped to author
      const article = await this.repository.findArticleForUpdate(articleId, user.id, tx);
      if (!article) {
        throw new NotFoundException('Article not found.');
      }

      // 2. Lifecycle check: Archived articles cannot be edited
      if (article.status === ArticleStatus.ARCHIVED) {
        throw new ConflictException('Archived articles cannot be modified.');
      }

      // 3. Concurrency check: Validate optimistic draft revision
      if (article.draftRevision !== query.expectedRevision) {
        throw new ConflictException(
          `Draft revision conflict: expected revision ${query.expectedRevision}, but article is at revision ${article.draftRevision}.`,
        );
      }

      // 4. Find block belonging to this article
      const block = await this.repository.findBlockById(blockId, articleId, tx);
      if (!block) {
        throw new NotFoundException('Block not found.');
      }

      // 5. Delete block
      await this.repository.deleteBlock(blockId, tx);

      // 6. Defer position constraint and compact remaining block positions
      await this.repository.deferPositionConstraint(tx);
      await this.repository.reindexPositionsAfterDelete(articleId, block.position, tx);

      // 7. Increment draft revision once
      await this.repository.incrementDraftRevision(articleId, article.draftRevision, tx);

      this.logger.debug(
        `Deleted block ${blockId} from article ${articleId}. Remaining blocks compacted.`,
      );
    });
  }

  /**
   * PUT /api/v1/articles/:articleId/blocks/order
   *
   * Atomically reorders all blocks belonging to an article.
   */
  async reorderBlocks(
    user: AuthenticatedUser,
    articleId: string,
    dto: ReorderArticleBlocksDto,
  ): Promise<ReorderBlocksResponseDto> {
    // Validate for duplicate block IDs
    const uniqueIds = new Set(dto.blockIds);
    if (uniqueIds.size !== dto.blockIds.length) {
      throw new BadRequestException('Duplicate block IDs in reorder request.');
    }

    return this.repository.transaction(async (tx) => {
      // 1. Lock article row with FOR UPDATE scoped to author
      const article = await this.repository.findArticleForUpdate(articleId, user.id, tx);
      if (!article) {
        throw new NotFoundException('Article not found.');
      }

      // 2. Lifecycle check: Archived articles cannot be edited
      if (article.status === ArticleStatus.ARCHIVED) {
        throw new ConflictException('Archived articles cannot be modified.');
      }

      // 3. Concurrency check: Validate optimistic draft revision
      if (article.draftRevision !== dto.expectedRevision) {
        throw new ConflictException(
          `Draft revision conflict: expected revision ${dto.expectedRevision}, but article is at revision ${article.draftRevision}.`,
        );
      }

      // 4. Fetch all current blocks for this article
      const currentBlocks = await this.repository.findBlocksByArticle(articleId, tx);

      // 5. Empty article handling
      if (currentBlocks.length === 0 && dto.blockIds.length === 0) {
        return {
          blocks: [],
          draftRevision: article.draftRevision,
        };
      }

      // 6. Cardinality check: Complete block set must be submitted
      if (dto.blockIds.length !== currentBlocks.length) {
        throw new BadRequestException(
          `Submitted block count (${dto.blockIds.length}) does not match existing block count (${currentBlocks.length}). Reorder requires the complete block set.`,
        );
      }

      // 7. Membership check: Every submitted block must exist on this article
      const currentBlockMap = new Map(currentBlocks.map((b) => [b.id, b]));
      for (const id of dto.blockIds) {
        if (!currentBlockMap.has(id)) {
          throw new BadRequestException(
            `Block ID ${id} does not belong to this article.`,
          );
        }
      }

      // 8. No-op detection: If submitted order is identical to current order
      const isIdentical = currentBlocks.every(
        (b, idx) => b.id === dto.blockIds[idx] && b.position === idx,
      );
      if (isIdentical) {
        this.logger.debug(
          `Reorder on article ${articleId} is an exact no-op. Preserving revision ${article.draftRevision}.`,
        );
        return {
          blocks: currentBlocks.map((b) => this.mapBlockDto(b)),
          draftRevision: article.draftRevision,
        };
      }

      // 9. Defer the unique position constraint for the transaction
      await this.repository.deferPositionConstraint(tx);

      // 10. Update positions sequentially
      const updatedBlocks = await this.repository.updatePositions(
        articleId,
        dto.blockIds,
        tx,
      );

      // 11. Increment draft revision once
      const newRevision = await this.repository.incrementDraftRevision(
        articleId,
        article.draftRevision,
        tx,
      );

      this.logger.debug(
        `Reordered ${updatedBlocks.length} blocks for article ${articleId}. Revision advanced to ${newRevision}.`,
      );

      return {
        blocks: updatedBlocks.map((b) => this.mapBlockDto(b)),
        draftRevision: newRevision,
      };
    });
  }
}
