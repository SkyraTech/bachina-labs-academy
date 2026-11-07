import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommentStatus } from '@prisma/client';
import { AccountEligibilityPolicy } from '../../../common/authorization/policies/account-eligibility.policy.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import {
  ArticleCommentsRepository,
  type CommentWithRelations,
} from '../repositories/article-comments.repository.js';
import type { CreateCommentDto } from '../dto/create-comment.dto.js';
import type { UpdateCommentDto } from '../dto/update-comment.dto.js';
import type { PublicCommentsQueryDto } from '../dto/public-comments-query.dto.js';
import type {
  PublicCommentResponseDto,
  PaginatedPublicCommentsResponseDto,
} from '../dto/public-comment-response.dto.js';
import type {
  AdminCommentResponseDto,
  PaginatedAdminCommentsResponseDto,
} from '../dto/admin-comment-response.dto.js';
import type { AdminCommentsQueryDto } from '../dto/admin-comments-query.dto.js';
import type { AdminRemoveCommentDto } from '../dto/admin-remove-comment.dto.js';

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ArticleCommentsService {
  constructor(private readonly repository: ArticleCommentsRepository) {}

  validateBody(rawBody: unknown): string {
    if (typeof rawBody !== 'string') {
      throw new BadRequestException('Comment body must be a string.');
    }
    const trimmed = rawBody.trim();
    if (trimmed.length < 1) {
      throw new BadRequestException('Comment body must not be empty or whitespace only.');
    }
    if (trimmed.length > 2000) {
      throw new BadRequestException('Comment body cannot exceed 2000 characters.');
    }
    return trimmed;
  }

  async createComment(
    user: AuthenticatedUser,
    publishedSlug: string,
    dto: CreateCommentDto,
  ): Promise<PublicCommentResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);
    const sanitizedBody = this.validateBody(dto.body);

    const created = await this.repository.transaction(async (tx) => {
      const article = await this.repository.findArticleForCommentCreation(publishedSlug, tx);
      if (!article || article.status !== 'PUBLISHED' || !article.currentSnapshotId) {
        throw new NotFoundException('Published article not found or not published.');
      }

      return this.repository.createComment(
        {
          articleId: article.id,
          snapshotId: article.currentSnapshotId,
          userId: user.id,
          body: sanitizedBody,
        },
        tx,
      );
    });

    return this.mapToPublicDto(created);
  }

  async listPublicComments(
    publishedSlug: string,
    query: PublicCommentsQueryDto,
  ): Promise<PaginatedPublicCommentsResponseDto> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));

    const result = await this.repository.findVisibleByPublishedSlug(publishedSlug, page, limit);
    if (!result) {
      throw new NotFoundException('Published article not found.');
    }

    const { items, total } = result;
    return {
      items: items.map((c) => this.mapToPublicDto(c)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async updateComment(
    user: AuthenticatedUser,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<PublicCommentResponseDto> {
    AccountEligibilityPolicy.assertEligible(user);
    const sanitizedBody = this.validateBody(dto.body);

    const result = await this.repository.updateCommentIfVisibleAndOwner(
      commentId,
      user.id,
      sanitizedBody,
    );

    if (result.count === 0) {
      const existing = await this.repository.findCommentById(commentId);
      if (!existing) {
        throw new NotFoundException('Comment not found.');
      }
      if (existing.userId !== user.id) {
        throw new ForbiddenException('Cannot edit another user\'s comment.');
      }
      if (existing.status === CommentStatus.REMOVED) {
        throw new ConflictException('Comment has been removed by an administrator and cannot be edited.');
      }
    }

    const updated = await this.repository.findCommentById(commentId);
    if (!updated) {
      throw new NotFoundException('Comment not found after update.');
    }

    return this.mapToPublicDto(updated);
  }

  async deleteComment(user: AuthenticatedUser, commentId: string): Promise<void> {
    AccountEligibilityPolicy.assertEligible(user);

    const result = await this.repository.deleteCommentIfOwner(commentId, user.id);
    if (result.count === 0) {
      const existing = await this.repository.findCommentById(commentId);
      if (!existing) {
        throw new NotFoundException('Comment not found.');
      }
      if (existing.userId !== user.id) {
        throw new ForbiddenException('Cannot delete another user\'s comment.');
      }
    }
  }

  async listAdminComments(
    user: AuthenticatedUser,
    query: AdminCommentsQueryDto,
  ): Promise<PaginatedAdminCommentsResponseDto> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const { items, total } = await this.repository.findForAdmin({
      page,
      limit,
      status: query.status,
      search: query.search,
    });

    const now = Date.now();
    return {
      items: items.map((c) => this.mapToAdminDto(c, now)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async removeComment(
    adminUser: AuthenticatedUser,
    commentId: string,
    dto: AdminRemoveCommentDto,
  ): Promise<AdminCommentResponseDto> {
    return this.repository.transaction(async (tx) => {
      const existing = await tx.articleComment.findUnique({
        where: { id: commentId },
        include: {
          article: { select: { id: true, publishedSlug: true, title: true, authorId: true } },
          snapshot: { select: { id: true, snapshotRevision: true } },
          author: { select: { id: true, profile: { select: { displayName: true } } } },
        },
      });

      if (!existing) {
        throw new NotFoundException('Comment not found.');
      }

      if (existing.status === CommentStatus.REMOVED) {
        return this.mapToAdminDto(existing as unknown as CommentWithRelations, Date.now());
      }

      const now = new Date();
      const updated = await tx.articleComment.update({
        where: { id: commentId },
        data: {
          status: CommentStatus.REMOVED,
          removedAt: now,
          removedByUserId: adminUser.id,
          removalReason: dto.reason,
          updatedAt: now,
        },
        include: {
          article: { select: { id: true, publishedSlug: true, title: true, authorId: true } },
          snapshot: { select: { id: true, snapshotRevision: true } },
          author: { select: { id: true, profile: { select: { displayName: true } } } },
        },
      });

      // Atomic AuditLog entry: strictly excluding comment body for privacy
      await tx.auditLog.create({
        data: {
          action: 'comment.removed',
          actorId: adminUser.id,
          actorType: 'USER',
          resourceType: 'ARTICLE_COMMENT',
          resourceId: commentId,
          outcome: 'SUCCESS',
          metadata: {
            reason: dto.reason,
            articleId: updated.articleId,
          },
        },
      });

      return this.mapToAdminDto(updated as unknown as CommentWithRelations, now.getTime());
    });
  }

  private mapToPublicDto(c: CommentWithRelations): PublicCommentResponseDto {
    return {
      id: c.id,
      articleSlug: c.article.publishedSlug ?? '',
      snapshotRevision: c.snapshot.snapshotRevision,
      authorDisplayName: c.author.profile?.displayName || 'Academy Member',
      isArticleAuthor: c.userId === c.article.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private mapToAdminDto(c: CommentWithRelations, currentTimestamp: number): AdminCommentResponseDto {
    let body = c.body;
    let isRetentionExpired = false;

    if (c.status === CommentStatus.REMOVED && c.removedAt) {
      if (currentTimestamp - c.removedAt.getTime() > THIRTY_DAYS_MS) {
        body = '';
        isRetentionExpired = true;
      }
    }

    return {
      id: c.id,
      articleId: c.articleId,
      articleSlug: c.article.publishedSlug ?? '',
      articleTitle: c.article.title,
      snapshotId: c.snapshotId,
      snapshotRevision: c.snapshot.snapshotRevision,
      userId: c.userId,
      authorDisplayName: c.author.profile?.displayName || 'Academy Member',
      body,
      status: c.status,
      removedAt: c.removedAt ? c.removedAt.toISOString() : null,
      removedByUserId: c.removedByUserId,
      removalReason: c.removalReason,
      isRetentionExpired,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
