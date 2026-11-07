import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleCommentsController } from './article-comments.controller.js';
import type { ArticleCommentsService } from '../services/article-comments.service.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { UserRole, UserStatus } from '@prisma/client';

describe('ArticleCommentsController', () => {
  let controller: ArticleCommentsController;
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
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
    };
    controller = new ArticleCommentsController(mockService as unknown as ArticleCommentsService);
  });

  it('delegates updateComment to service', async () => {
    mockService.updateComment.mockResolvedValue({
      id: 'c-1',
      body: 'Updated text',
    });

    const result = await controller.updateComment(testUser, 'c-1', { body: 'Updated text' });

    expect(mockService.updateComment).toHaveBeenCalledWith(testUser, 'c-1', { body: 'Updated text' });
    expect(result.body).toBe('Updated text');
  });

  it('delegates deleteComment to service', async () => {
    mockService.deleteComment.mockResolvedValue(undefined);

    await expect(controller.deleteComment(testUser, 'c-1')).resolves.toBeUndefined();
    expect(mockService.deleteComment).toHaveBeenCalledWith(testUser, 'c-1');
  });
});
