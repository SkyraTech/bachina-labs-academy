import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Article, ArticleBlock, ArticleTag, Tag, Category } from '@prisma/client';
import {
  ArticlesRepository,
  type ArticleWithTags,
} from '../repositories/articles.repository.js';
import type { CreateArticleDto } from '../dto/create-article.dto.js';
import type { UpdateArticleDto } from '../dto/update-article.dto.js';
import type { DeleteArticleQueryDto } from '../dto/delete-article-query.dto.js';
import type { ListArticlesQueryDto } from '../dto/list-articles-query.dto.js';
import type { ArticleResponseDto } from '../dto/article-response.dto.js';
import type { PaginatedArticlesResponseDto } from '../dto/paginated-articles-response.dto.js';
import type {
  ArticleDetailResponseDto,
  ArticleBlockResponseDto,
} from '../dto/article-detail-response.dto.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { AccountEligibilityPolicy } from '../../../common/authorization/policies/account-eligibility.policy.js';

/**
 * ArticlesService — business logic layer for the articles domain.
 *
 * Responsibilities:
 * - Enforce account eligibility (active status and verified email).
 * - Enforce cover media asset ownership, existence, and type constraints.
 * - Enforce author ownership and 404 private resource masking.
 * - Optimistic concurrency control via expectedRevision and row locking.
 * - Detect no-op updates to avoid unnecessary revision bumps or timestamp mutations.
 * - Safe deletion of unpublished draft articles respecting snapshot history and DB FKs.
 * - Map database models into safe, ISO-formatted response DTOs.
 */
@Injectable()
export class ArticlesService {
  private readonly logger = new Logger(ArticlesService.name);

  constructor(private readonly repository: ArticlesRepository) { }

  /**
   * Creates a new draft article owned by the authenticated author.
   */
  async createDraft(
    user: AuthenticatedUser,
    dto: CreateArticleDto,
  ): Promise<ArticleResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);

    // Validate cover media asset if provided
    if (dto.coverMediaId) {
      const media = await this.repository.findMediaAsset(dto.coverMediaId);

      if (!media) {
        throw new BadRequestException('Cover media asset not found.');
      }

      if (media.mediaType !== 'IMAGE') {
        throw new BadRequestException(
          'Cover media must be an image asset (IMAGE).',
        );
      }

      if (media.uploaderId !== user.id) {
        this.logger.warn(
          `User ${user.id} attempted to use media asset ${dto.coverMediaId} owned by ${media.uploaderId}`,
        );
        throw new ForbiddenException(
          'You do not have permission to use this media asset.',
        );
      }
    }

    // Validate category if provided
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const category = await this.repository.findCategoryById(dto.categoryId);
      if (!category) {
        throw new BadRequestException('Category not found.');
      }
    }

    // Validate tags if provided
    if (dto.tagIds !== undefined && dto.tagIds.length > 0) {
      const foundTags = await this.repository.findTagsByIds(dto.tagIds);
      if (foundTags.length !== dto.tagIds.length) {
        throw new BadRequestException('One or more tags not found.');
      }
    }

    let article: ArticleWithTags;
    try {
      article = await this.repository.create({
        authorId: user.id,
        title: dto.title,
        draftSlug: dto.draftSlug,
        summary: dto.summary,
        typographyPreset: dto.typographyPreset,
        coverMediaId: dto.coverMediaId,
        categoryId: dto.categoryId ?? null,
        tagIds: dto.tagIds,
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2003') {
          const constraint =
            typeof err.meta?.constraint === 'string'
              ? err.meta.constraint
              : '';
          const fieldName =
            typeof err.meta?.field_name === 'string'
              ? err.meta.field_name
              : '';
          const target = Array.isArray(err.meta?.target)
            ? err.meta.target.join(' ')
            : typeof err.meta?.target === 'string'
              ? err.meta.target
              : '';

          if (
            constraint === 'articles_category_id_fkey' ||
            fieldName.includes('articles_category_id_fkey') ||
            target.includes('category_id')
          ) {
            throw new BadRequestException('Category not found.');
          }

          if (
            constraint === 'article_tags_tag_id_fkey' ||
            fieldName.includes('article_tags_tag_id_fkey') ||
            target.includes('tag_id')
          ) {
            throw new BadRequestException('One or more tags not found.');
          }

          if (
            constraint === 'articles_cover_media_id_fkey' ||
            fieldName.includes('articles_cover_media_id_fkey') ||
            target.includes('cover_media_id')
          ) {
            throw new BadRequestException('Cover media not found.');
          }

          throw new BadRequestException('Referenced entity not found.');
        }

        if (err.code === 'P2002') {
          throw new ConflictException(
            'An article with this draft slug already exists.',
          );
        }
      }
      throw err;
    }

    return this.mapToArticleResponse(article);
  }

  /**
   * Updates an owned article's editable draft metadata using optimistic concurrency control.
   */
  async updateDraftMetadata(
    user: AuthenticatedUser,
    articleId: string,
    dto: UpdateArticleDto,
  ): Promise<ArticleResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);

    return this.repository.transaction(async (tx) => {
      const article = await this.repository.findArticleForUpdate(
        articleId,
        user.id,
        tx,
      );

      if (!article) {
        throw new NotFoundException('Article not found.');
      }

      // Check lifecycle: ARCHIVED articles cannot be edited
      if (article.status === 'ARCHIVED') {
        throw new ConflictException(
          'Archived articles cannot be edited. Restore or unarchive the article before editing.',
        );
      }

      // Optimistic concurrency check (checked before no-op evaluation)
      if (article.draftRevision !== dto.expectedRevision) {
        throw new ConflictException(
          'Draft revision conflict. Refresh the article before saving again.',
        );
      }

      // Validate cover media if explicitly specified and changed
      if (
        dto.coverMediaId !== undefined &&
        dto.coverMediaId !== null &&
        dto.coverMediaId !== article.coverMediaId
      ) {
        const media = await this.repository.findMediaAsset(
          dto.coverMediaId,
          tx,
        );

        if (!media) {
          throw new BadRequestException('Cover media asset not found.');
        }

        if (media.mediaType !== 'IMAGE') {
          throw new BadRequestException(
            'Cover media must be an image asset (IMAGE).',
          );
        }

        if (media.uploaderId !== user.id) {
          this.logger.warn(
            `User ${user.id} attempted to use media asset ${dto.coverMediaId} owned by ${media.uploaderId}`,
          );
          throw new ForbiddenException(
            'You do not have permission to use this media asset.',
          );
        }
      }

      const updateData: Prisma.ArticleUpdateInput = {};

      // Validate Category if explicitly specified and changed
      let categoryChanged = false;
      if (dto.categoryId !== undefined) {
        const normalizedCategory = dto.categoryId ?? null;
        if (normalizedCategory !== (article.categoryId ?? null)) {
          if (normalizedCategory !== null) {
            const category = await this.repository.findCategoryById(
              normalizedCategory,
              tx,
            );
            if (!category) {
              throw new BadRequestException('Category not found.');
            }
          }
          categoryChanged = true;
          if (normalizedCategory === null) {
            updateData.category = { disconnect: true };
          } else {
            updateData.category = { connect: { id: normalizedCategory } };
          }
        }
      }

      // Validate Tags if explicitly specified and changed
      let tagsChanged = false;
      if (dto.tagIds !== undefined) {
        if (dto.tagIds.length > 0) {
          const foundTags = (await this.repository.findTagsByIds(dto.tagIds, tx)) ?? [];
          if (foundTags.length !== dto.tagIds.length) {
            throw new BadRequestException('One or more tags not found.');
          }
        }

        const currentTagIds = await this.repository.findArticleTagIds(
          article.id,
          tx,
        );
        const currentSorted = [...currentTagIds].sort();
        const requestedSorted = [...dto.tagIds].sort();

        if (
          currentSorted.length !== requestedSorted.length ||
          !currentSorted.every((id, idx) => id === requestedSorted[idx])
        ) {
          tagsChanged = true;
        }
      }

      // No-op detection: compare normalized requested values against persisted state
      let hasChanges = categoryChanged || tagsChanged;

      if (dto.title !== undefined) {
        const trimmedTitle = dto.title.trim();
        if (trimmedTitle !== article.title) {
          hasChanges = true;
          updateData.title = trimmedTitle;
        }
      }

      if (dto.draftSlug !== undefined && dto.draftSlug !== article.draftSlug) {
        hasChanges = true;
        updateData.draftSlug = dto.draftSlug;
      }

      if (dto.summary !== undefined) {
        const normalizedSummary = dto.summary ?? null;
        if (normalizedSummary !== (article.summary ?? null)) {
          hasChanges = true;
          updateData.summary = normalizedSummary;
        }
      }

      if (
        dto.typographyPreset !== undefined &&
        dto.typographyPreset !== article.typographyPreset
      ) {
        hasChanges = true;
        updateData.typographyPreset = dto.typographyPreset;
      }

      if (dto.coverMediaId !== undefined) {
        const normalizedCover = dto.coverMediaId ?? null;
        if (normalizedCover !== (article.coverMediaId ?? null)) {
          hasChanges = true;
          if (normalizedCover === null) {
            updateData.coverMedia = { disconnect: true };
          } else {
            updateData.coverMedia = { connect: { id: normalizedCover } };
          }
        }
      }

      // If no mutable fields changed, return existing article without updating or bumping revision
      if (!hasChanges) {
        const current = await this.repository.findPrivateById(
          article.id,
          user.id,
          tx,
        );
        return this.mapToArticleResponse(current ?? article);
      }

      // Meaningful update: atomically increment draftRevision by 1
      updateData.draftRevision = { increment: 1 };

      try {
        const updated = await this.repository.updateArticle(
          article.id,
          updateData,
          tx,
        );

        const refreshed = await this.repository.findPrivateById(
          article.id,
          user.id,
          tx,
        );

        let finalTags: (ArticleTag & { tag?: Tag })[] | undefined =
          refreshed?.tags ?? [];
        if (tagsChanged && dto.tagIds !== undefined) {
          await this.repository.replaceArticleTags(article.id, dto.tagIds, tx);
          if (dto.tagIds.length > 0) {
            const foundTags =
              (await this.repository.findTagsByIds(dto.tagIds, tx)) ?? [];
            finalTags = foundTags
              .sort(
                (a, b) =>
                  a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id),
              )
              .map((t) => ({
                articleId: article.id,
                tagId: t.id,
                tag: t,
                createdAt: new Date(),
              }));
          } else {
            finalTags = [];
          }
        }

        let finalCategory: Category | null | undefined =
          refreshed?.category ?? null;
        if (categoryChanged) {
          if (dto.categoryId !== undefined && dto.categoryId !== null) {
            finalCategory = await this.repository.findCategoryById(
              dto.categoryId,
              tx,
            );
          } else if (dto.categoryId === null) {
            finalCategory = null;
          }
        }

        return this.mapToArticleResponse({
          ...updated,
          category: finalCategory,
          tags: finalTags,
        });
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new ConflictException(
              'A uniqueness conflict occurred while updating article draft metadata.',
            );
          }
          if (err.code === 'P2003') {
            const constraint =
              typeof err.meta?.constraint === 'string'
                ? err.meta.constraint
                : '';
            const fieldName =
              typeof err.meta?.field_name === 'string'
                ? err.meta.field_name
                : '';
            const target = Array.isArray(err.meta?.target)
              ? err.meta.target.join(' ')
              : typeof err.meta?.target === 'string'
                ? err.meta.target
                : '';

            if (
              constraint === 'articles_category_id_fkey' ||
              fieldName.includes('articles_category_id_fkey') ||
              target.includes('category_id')
            ) {
              throw new BadRequestException('Category not found.');
            }

            if (
              constraint === 'article_tags_tag_id_fkey' ||
              fieldName.includes('article_tags_tag_id_fkey') ||
              target.includes('tag_id')
            ) {
              throw new BadRequestException('One or more tags not found.');
            }

            if (
              constraint === 'articles_cover_media_id_fkey' ||
              fieldName.includes('articles_cover_media_id_fkey') ||
              target.includes('cover_media_id')
            ) {
              throw new BadRequestException('Cover media not found.');
            }

            throw new BadRequestException('Referenced entity not found.');
          }
          if (err.code === 'P2025') {
            const cause =
              typeof err.meta?.cause === 'string' ? err.meta.cause : '';
            const modelName =
              typeof err.meta?.modelName === 'string'
                ? err.meta.modelName
                : '';

            if (
              modelName === 'Category' ||
              /no 'category' record/i.test(cause) ||
              cause.includes('ArticleToCategory')
            ) {
              throw new BadRequestException('Category not found.');
            }

            if (
              modelName === 'Tag' ||
              /no 'tag' record/i.test(cause)
            ) {
              throw new BadRequestException('One or more tags not found.');
            }

            if (
              modelName === 'MediaAsset' ||
              /no 'mediaasset' record/i.test(cause)
            ) {
              throw new BadRequestException('Cover media not found.');
            }

            throw err;
          }
        }
        throw err;
      }
    });
  }

  /**
   * Safely deletes an owned article draft that has never been published.
   *
   * Safety rules:
   * 1. Author must be eligible (active account and verified email).
   * 2. expectedRevision is strictly mandatory (integer >= 1). Missing/invalid returns 400 Bad Request.
   * 3. Transactionally locks the article row (FOR UPDATE) scoped strictly to authorId.
   *    If not found, returns 404 (private resource masking).
   * 4. Enforces optimistic concurrency: expectedRevision must match draft_revision (409 Conflict).
   * 5. Article must be in status DRAFT (cannot delete PUBLISHED or ARCHIVED; 409 Conflict).
   * 6. Article must have no active snapshot pointer (currentSnapshotId must be null; 409 Conflict).
   * 7. Article must have zero historical snapshots in article_snapshots (409 Conflict).
   * 8. Deletion cascades to draft blocks (article_blocks) via DB FK ON DELETE CASCADE.
   * 9. Does not delete media assets or any snapshots.
   */
  async deleteEligibleDraft(
    user: AuthenticatedUser,
    articleId: string,
    query: DeleteArticleQueryDto,
  ): Promise<void> {
    AccountEligibilityPolicy.assertEligible(user);

    if (
      !query ||
      query.expectedRevision === undefined ||
      query.expectedRevision === null ||
      typeof query.expectedRevision !== 'number' ||
      !Number.isInteger(query.expectedRevision) ||
      query.expectedRevision < 1
    ) {
      throw new BadRequestException(
        'expectedRevision query parameter is required and must be an integer >= 1.',
      );
    }

    await this.repository.transaction(async (tx) => {
      const article = await this.repository.findArticleForUpdate(
        articleId,
        user.id,
        tx,
      );

      if (!article) {
        throw new NotFoundException('Article not found.');
      }

      // Concurrency check: expectedRevision must match draft_revision
      if (article.draftRevision !== query.expectedRevision) {
        throw new ConflictException(
          'Draft revision conflict. Refresh the article before deleting.',
        );
      }

      // Status eligibility: only DRAFT may be deleted
      if (article.status !== 'DRAFT') {
        throw new ConflictException(
          `Cannot delete an article with status ${article.status}. Only unpublished drafts with no publication history may be deleted.`,
        );
      }

      // Current snapshot pointer check
      if (article.currentSnapshotId !== null) {
        throw new ConflictException(
          'Cannot delete an article with historical snapshots or an active snapshot reference.',
        );
      }

      // Historical snapshots check
      const snapshotCount = await this.repository.countSnapshots(
        articleId,
        tx,
      );

      if (snapshotCount > 0) {
        throw new ConflictException(
          'Cannot delete an article that has published history. Archive the article instead.',
        );
      }

      try {
        await this.repository.deleteArticle(articleId, tx);
      } catch (err: unknown) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2003'
        ) {
          throw new ConflictException(
            'Cannot delete article due to existing restricted relational dependencies.',
          );
        }
        throw err;
      }
    });
  }

  /**
   * Lists articles owned by the authenticated author with pagination and optional status filter.
   */
  async listMyArticles(
    user: AuthenticatedUser,
    query: ListArticlesQueryDto,
  ): Promise<PaginatedArticlesResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.repository.findMyArticles({
      authorId: user.id,
      page,
      limit,
      status: query.status,
    });

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
      items: items.map((a) => this.mapToArticleResponse(a)),
      page,
      limit,
      total,
      totalPages,
    };
  }

  /**
   * Retrieves a privately owned editable article, including its draft blocks.
   * If the article does not exist or belongs to another author, throws 404 to prevent information disclosure.
   */
  async getPrivateArticle(
    user: AuthenticatedUser,
    articleId: string,
  ): Promise<ArticleDetailResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);

    const article = await this.repository.findPrivateById(articleId, user.id);

    if (!article) {
      throw new NotFoundException('Article not found.');
    }

    return {
      ...this.mapToArticleResponse(article),
      blocks: article.blocks.map((b) => this.mapToBlockResponse(b)),
    };
  }

  /**
   * Maps Prisma Article to ArticleResponseDto with ISO 8601 timestamps and deterministic taxonomy references.
   */
  private mapToArticleResponse(
    article: Article & {
      category?: Category | null;
      tags?: (ArticleTag & { tag?: Tag })[];
    },
  ): ArticleResponseDto {
    const tagIds = (article.tags ?? []).map((t) => t.tagId);

    const categorySummary = article.category
      ? {
          id: article.category.id,
          name: article.category.name,
          slug: article.category.slug,
        }
      : null;

    const tagsSummary = (article.tags ?? [])
      .map((t) => t.tag)
      .filter((t): t is Tag => t !== undefined && t !== null)
      .map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
      }));

    return {
      id: article.id,
      authorId: article.authorId,
      title: article.title,
      draftSlug: article.draftSlug,
      publishedSlug: article.publishedSlug,
      summary: article.summary,
      status: article.status,
      typographyPreset: article.typographyPreset,
      coverMediaId: article.coverMediaId,
      draftRevision: article.draftRevision,
      publishedRevision: article.publishedRevision,
      currentSnapshotId: article.currentSnapshotId,
      categoryId: article.categoryId ?? null,
      tagIds,
      category: categorySummary,
      tags: tagsSummary,
      createdAt:
        article.createdAt instanceof Date
          ? article.createdAt.toISOString()
          : new Date(article.createdAt).toISOString(),
      updatedAt:
        article.updatedAt instanceof Date
          ? article.updatedAt.toISOString()
          : new Date(article.updatedAt).toISOString(),
      publishedAt: article.publishedAt
        ? article.publishedAt instanceof Date
          ? article.publishedAt.toISOString()
          : new Date(article.publishedAt).toISOString()
        : null,
    };
  }

  /**
   * Maps Prisma ArticleBlock to ArticleBlockResponseDto with ISO 8601 timestamps.
   */
  private mapToBlockResponse(block: ArticleBlock): ArticleBlockResponseDto {
    return {
      id: block.id,
      articleId: block.articleId,
      type: block.type,
      position: block.position,
      content: (block.content as Record<string, unknown>) ?? {},
      mediaAssetId: block.mediaAssetId,
      schemaVersion: block.schemaVersion,
      createdAt:
        block.createdAt instanceof Date
          ? block.createdAt.toISOString()
          : new Date(block.createdAt).toISOString(),
      updatedAt:
        block.updatedAt instanceof Date
          ? block.updatedAt.toISOString()
          : new Date(block.updatedAt).toISOString(),
    };
  }
}

