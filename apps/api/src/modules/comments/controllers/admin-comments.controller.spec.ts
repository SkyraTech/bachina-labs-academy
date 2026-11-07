import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminCommentsController } from './admin-comments.controller.js';
import type { ArticleCommentsService } from '../services/article-comments.service.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { ModerationReason, UserRole, UserStatus } from '@prisma/client';

describe('AdminCommentsController', () => {
  let controller: AdminCommentsController;
  let mockService: any;

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    email: 'admin@skyra-tech.com',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'session-admin',
  };

  beforeEach(() => {
    mockService = {
      listAdminComments: vi.fn(),
      removeComment: vi.fn(),
    };
    controller = new AdminCommentsController(mockService as unknown as ArticleCommentsService);
  });

  it('delegates listComments to service', async () => {
    mockService.listAdminComments.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });

    const result = await controller.listComments(adminUser, { page: 1, limit: 20 });

    expect(mockService.listAdminComments).toHaveBeenCalledWith(adminUser, { page: 1, limit: 20 });
    expect(result.items).toEqual([]);
  });

  it('delegates removeComment to service', async () => {
    mockService.removeComment.mockResolvedValue({
      id: 'c-1',
      status: 'REMOVED',
      removalReason: ModerationReason.SPAM,
    });

    const result = await controller.removeComment(adminUser, 'c-1', {
      reason: ModerationReason.SPAM,
    });

    expect(mockService.removeComment).toHaveBeenCalledWith(adminUser, 'c-1', {
      reason: ModerationReason.SPAM,
    });
    expect(result.status).toBe('REMOVED');
  });
});
