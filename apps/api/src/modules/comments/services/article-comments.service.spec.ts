import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommentStatus, ModerationReason, UserRole, UserStatus } from '@prisma/client';
import { ArticleCommentsService, THIRTY_DAYS_MS } from './article-comments.service.js';
import type { ArticleCommentsRepository } from '../repositories/article-comments.repository.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticleCommentsService', () => {
  let service: ArticleCommentsService;
  let mockRepo: any;

  const activeAuthor: AuthenticatedUser = {
    id: 'user-uuid-1',
    email: 'author@skyra-tech.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'session-author',
  };

  const otherUser: AuthenticatedUser = {
    id: 'user-uuid-2',
    email: 'other@skyra-tech.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'session-other',
  };

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    email: 'admin@skyra-tech.com',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'session-admin',
  };

  beforeEach(() => {
    mockRepo = {
      transaction: vi.fn(async (cb) => cb({
        auditLog: { create: vi.fn() },
        articleComment: { findUnique: vi.fn(), update: vi.fn() },
      })),
      findArticleForCommentCreation: vi.fn(),
      createComment: vi.fn(),
      findVisibleByPublishedSlug: vi.fn(),
      findCommentById: vi.fn(),
      updateCommentIfVisibleAndOwner: vi.fn(),
      deleteCommentIfOwner: vi.fn(),
      findForAdmin: vi.fn(),
      removeComment: vi.fn(),
    };

    service = new ArticleCommentsService(mockRepo as unknown as ArticleCommentsRepository);
  });

  describe('validateBody', () => {
    it('accepts valid 1-2000 character plain text', () => {
      expect(service.validateBody('Great post!')).toBe('Great post!');
      expect(service.validateBody('  Trimmed text  ')).toBe('Trimmed text');
    });

    it('rejects empty or whitespace-only bodies', () => {
      expect(() => service.validateBody('')).toThrow(BadRequestException);
      expect(() => service.validateBody('   ')).toThrow(BadRequestException);
    });

    it('rejects bodies exceeding 2000 characters', () => {
      const longBody = 'A'.repeat(2001);
      expect(() => service.validateBody(longBody)).toThrow(BadRequestException);
    });
  });

  describe('createComment', () => {
    it('creates comment when article is published', async () => {
      mockRepo.transaction.mockImplementation(async (cb: any) => {
        mockRepo.findArticleForCommentCreation.mockResolvedValue({
          id: 'article-1',
          status: 'PUBLISHED',
          currentSnapshotId: 'snap-1',
          authorId: 'article-author-1',
        });
        mockRepo.createComment.mockResolvedValue({
          id: 'comment-1',
          articleId: 'article-1',
          snapshotId: 'snap-1',
          userId: activeAuthor.id,
          body: 'Hello world',
          status: CommentStatus.VISIBLE,
          createdAt: new Date('2026-11-06T00:00:00.000Z'),
          updatedAt: new Date('2026-11-06T00:00:00.000Z'),
          article: { publishedSlug: 'test-slug', authorId: 'article-author-1' },
          snapshot: { snapshotRevision: 1 },
          author: { profile: { displayName: 'Jane Doe' } },
        });
        return cb({});
      });

      const result = await service.createComment(activeAuthor, 'test-slug', { body: 'Hello world' });

      expect(result.id).toBe('comment-1');
      expect(result.authorDisplayName).toBe('Jane Doe');
      expect(result.isArticleAuthor).toBe(false);
      expect(result.body).toBe('Hello world');
    });

    it('throws NotFoundException if article is not published or missing snapshot', async () => {
      mockRepo.transaction.mockImplementation(async (cb: any) => {
        mockRepo.findArticleForCommentCreation.mockResolvedValue(null);
        return cb({});
      });

      await expect(
        service.createComment(activeAuthor, 'test-slug', { body: 'Hello' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listPublicComments', () => {
    it('returns paginated comments with safe attribution', async () => {
      mockRepo.findVisibleByPublishedSlug.mockResolvedValue({
        total: 1,
        items: [
          {
            id: 'c-1',
            articleId: 'a-1',
            snapshotId: 's-1',
            userId: 'user-uuid-1',
            body: 'Visible comment',
            status: CommentStatus.VISIBLE,
            createdAt: new Date('2026-11-06T00:00:00.000Z'),
            updatedAt: new Date('2026-11-06T00:00:00.000Z'),
            article: { publishedSlug: 'test-slug', authorId: 'user-uuid-1' },
            snapshot: { snapshotRevision: 2 },
            author: { profile: null },
          },
        ],
      });

      const result = await service.listPublicComments('test-slug', { page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].authorDisplayName).toBe('Academy Member'); // Fallback verified
      expect(result.items[0].isArticleAuthor).toBe(true);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('updateComment', () => {
    it('updates own visible comment successfully', async () => {
      mockRepo.updateCommentIfVisibleAndOwner.mockResolvedValue({ count: 1 });
      mockRepo.findCommentById.mockResolvedValue({
        id: 'c-1',
        articleId: 'a-1',
        snapshotId: 's-1',
        userId: activeAuthor.id,
        body: 'Updated text',
        status: CommentStatus.VISIBLE,
        createdAt: new Date('2026-11-06T00:00:00.000Z'),
        updatedAt: new Date('2026-11-06T01:00:00.000Z'),
        article: { publishedSlug: 'test-slug', authorId: 'other' },
        snapshot: { snapshotRevision: 1 },
        author: { profile: { displayName: 'Jane' } },
      });

      const result = await service.updateComment(activeAuthor, 'c-1', { body: 'Updated text' });

      expect(result.body).toBe('Updated text');
    });

    it('rejects editing if comment was moderated (status REMOVED)', async () => {
      mockRepo.updateCommentIfVisibleAndOwner.mockResolvedValue({ count: 0 });
      mockRepo.findCommentById.mockResolvedValue({
        id: 'c-1',
        userId: activeAuthor.id,
        status: CommentStatus.REMOVED,
      });

      await expect(
        service.updateComment(activeAuthor, 'c-1', { body: 'Try edit' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects editing if caller is not comment author', async () => {
      mockRepo.updateCommentIfVisibleAndOwner.mockResolvedValue({ count: 0 });
      mockRepo.findCommentById.mockResolvedValue({
        id: 'c-1',
        userId: otherUser.id,
        status: CommentStatus.VISIBLE,
      });

      await expect(
        service.updateComment(activeAuthor, 'c-1', { body: 'Try edit' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteComment', () => {
    it('physically deletes owned comment', async () => {
      mockRepo.deleteCommentIfOwner.mockResolvedValue({ count: 1 });

      await expect(service.deleteComment(activeAuthor, 'c-1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException if caller does not own comment', async () => {
      mockRepo.deleteCommentIfOwner.mockResolvedValue({ count: 0 });
      mockRepo.findCommentById.mockResolvedValue({
        id: 'c-1',
        userId: otherUser.id,
      });

      await expect(service.deleteComment(activeAuthor, 'c-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listAdminComments and 30-day retention redaction', () => {
    it('redacts removed body if removed > 30 days ago', async () => {
      const expiredDate = new Date(Date.now() - (THIRTY_DAYS_MS + 1000));
      mockRepo.findForAdmin.mockResolvedValue({
        total: 1,
        items: [
          {
            id: 'c-expired',
            articleId: 'a-1',
            snapshotId: 's-1',
            userId: 'u-1',
            body: 'Confidential spam text',
            status: CommentStatus.REMOVED,
            removedAt: expiredDate,
            removedByUserId: adminUser.id,
            removalReason: ModerationReason.SPAM,
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            updatedAt: new Date('2026-09-02T00:00:00.000Z'),
            article: { publishedSlug: 'slug', title: 'Article', authorId: 'author-1' },
            snapshot: { snapshotRevision: 1 },
            author: { profile: { displayName: 'Spammer' } },
          },
        ],
      });

      const result = await service.listAdminComments(adminUser, { page: 1, limit: 20 });

      expect(result.items[0].body).toBe(''); // Body redacted!
      expect(result.items[0].isRetentionExpired).toBe(true);
      expect(result.items[0].removalReason).toBe(ModerationReason.SPAM);
    });

    it('keeps body visible if removed <= 30 days ago', async () => {
      const recentRemoval = new Date(Date.now() - 5000);
      mockRepo.findForAdmin.mockResolvedValue({
        total: 1,
        items: [
          {
            id: 'c-recent',
            articleId: 'a-1',
            snapshotId: 's-1',
            userId: 'u-1',
            body: 'Recently removed text for appeal review',
            status: CommentStatus.REMOVED,
            removedAt: recentRemoval,
            removedByUserId: adminUser.id,
            removalReason: ModerationReason.HARASSMENT,
            createdAt: new Date(),
            updatedAt: new Date(),
            article: { publishedSlug: 'slug', title: 'Article', authorId: 'author-1' },
            snapshot: { snapshotRevision: 1 },
            author: { profile: null },
          },
        ],
      });

      const result = await service.listAdminComments(adminUser, { page: 1, limit: 20 });

      expect(result.items[0].body).toBe('Recently removed text for appeal review');
      expect(result.items[0].isRetentionExpired).toBe(false);
    });
  });

  describe('removeComment (ADMIN moderation)', () => {
    it('transitions status to REMOVED and writes audit log without body text', async () => {
      let auditLogCreated: any = null;
      mockRepo.transaction.mockImplementation(async (cb: any) => {
        const tx = {
          articleComment: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'c-1',
              status: CommentStatus.VISIBLE,
              articleId: 'a-1',
              snapshotId: 's-1',
              userId: 'u-1',
              body: 'Offensive content',
              createdAt: new Date(),
              updatedAt: new Date(),
              article: { publishedSlug: 'slug', title: 'Title', authorId: 'a-author' },
              snapshot: { snapshotRevision: 1 },
              author: { profile: { displayName: 'Poster' } },
            }),
            update: vi.fn().mockResolvedValue({
              id: 'c-1',
              status: CommentStatus.REMOVED,
              removedAt: new Date(),
              removedByUserId: adminUser.id,
              removalReason: ModerationReason.HARASSMENT,
              articleId: 'a-1',
              snapshotId: 's-1',
              userId: 'u-1',
              body: 'Offensive content',
              createdAt: new Date(),
              updatedAt: new Date(),
              article: { publishedSlug: 'slug', title: 'Title', authorId: 'a-author' },
              snapshot: { snapshotRevision: 1 },
              author: { profile: { displayName: 'Poster' } },
            }),
          },
          auditLog: {
            create: vi.fn().mockImplementation((args) => {
              auditLogCreated = args.data;
              return args.data;
            }),
          },
        };
        return cb(tx);
      });

      const result = await service.removeComment(adminUser, 'c-1', {
        reason: ModerationReason.HARASSMENT,
      });

      expect(result.status).toBe(CommentStatus.REMOVED);
      expect(result.removalReason).toBe(ModerationReason.HARASSMENT);
      expect(auditLogCreated).toBeDefined();
      expect(auditLogCreated.action).toBe('comment.removed');
      expect(auditLogCreated.actorId).toBe(adminUser.id);
      expect(auditLogCreated.metadata.body).toBeUndefined(); // Crucial privacy guarantee: no body in audit!
      expect(auditLogCreated.metadata.reason).toBe(ModerationReason.HARASSMENT);
    });
  });
});
