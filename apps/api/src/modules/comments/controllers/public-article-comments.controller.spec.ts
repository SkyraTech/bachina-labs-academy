import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicArticleCommentsController } from './public-article-comments.controller.js';
import type { ArticleCommentsService } from '../services/article-comments.service.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { UserRole, UserStatus } from '@prisma/client';

describe('PublicArticleCommentsController', () => {
  let controller: PublicArticleCommentsController;
  let mockService: any;

  const testUser: AuthenticatedUser = {
    id: 'user-uuid-1',
    email: 'author@skyra-tech.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'session-author',
  };

  beforeEach(() => {
    mockService = {
      listPublicComments: vi.fn(),
      createComment: vi.fn(),
    };
    controller = new PublicArticleCommentsController(mockService as unknown as ArticleCommentsService);
  });

  it('delegates listComments to service', async () => {
    mockService.listPublicComments.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });

    const result = await controller.listComments('test-slug', { page: 1, limit: 20 });

    expect(mockService.listPublicComments).toHaveBeenCalledWith('test-slug', { page: 1, limit: 20 });
    expect(result.items).toEqual([]);
  });

  it('delegates createComment to service', async () => {
    mockService.createComment.mockResolvedValue({
      id: 'c-1',
      articleSlug: 'test-slug',
      snapshotRevision: 1,
      authorDisplayName: 'Jane',
      isArticleAuthor: false,
      body: 'Hello',
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    });

    const result = await controller.createComment(testUser, 'test-slug', { body: 'Hello' });

    expect(mockService.createComment).toHaveBeenCalledWith(testUser, 'test-slug', { body: 'Hello' });
    expect(result.id).toBe('c-1');
  });
});
