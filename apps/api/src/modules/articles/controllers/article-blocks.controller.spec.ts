import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleBlockType, UserRole, UserStatus } from '@prisma/client';
import { ArticleBlocksController } from './article-blocks.controller.js';
import { ArticleBlocksService } from '../services/article-blocks.service.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticleBlocksController', () => {
  let controller: ArticleBlocksController;
  let serviceMock: Record<string, ReturnType<typeof vi.fn>>;

  const mockUser: AuthenticatedUser = {
    id: 'user-0001',
    email: 'author@skyra-tech.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'sess-0001',
  };

  beforeEach(() => {
    serviceMock = {
      createBlock: vi.fn(),
      updateBlock: vi.fn(),
      deleteBlock: vi.fn(),
      reorderBlocks: vi.fn(),
    };

    controller = new ArticleBlocksController(serviceMock as unknown as ArticleBlocksService);
  });

  it('delegates createBlock to service', async () => {
    const dto = {
      expectedRevision: 1,
      type: ArticleBlockType.HEADING,
      content: { text: 'Heading', level: 2 },
    };
    const expected = { id: 'blk-1', draftRevision: 2 };
    serviceMock.createBlock.mockResolvedValue(expected as any);

    const result = await controller.createBlock(mockUser, 'art-1', dto as any);
    expect(result).toBe(expected);
    expect(serviceMock.createBlock).toHaveBeenCalledWith(mockUser, 'art-1', dto);
  });

  it('delegates updateBlock to service', async () => {
    const dto = {
      expectedRevision: 2,
      content: { text: 'Updated' },
    };
    const expected = { id: 'blk-1', draftRevision: 3 };
    serviceMock.updateBlock.mockResolvedValue(expected as any);

    const result = await controller.updateBlock(mockUser, 'art-1', 'blk-1', dto);
    expect(result).toBe(expected);
    expect(serviceMock.updateBlock).toHaveBeenCalledWith(mockUser, 'art-1', 'blk-1', dto);
  });

  it('delegates deleteBlock to service', async () => {
    const query = { expectedRevision: 3 };
    serviceMock.deleteBlock.mockResolvedValue(undefined);

    await controller.deleteBlock(mockUser, 'art-1', 'blk-1', query);
    expect(serviceMock.deleteBlock).toHaveBeenCalledWith(mockUser, 'art-1', 'blk-1', query);
  });

  it('delegates reorderBlocks to service', async () => {
    const dto = {
      expectedRevision: 3,
      blockIds: ['blk-2', 'blk-1'],
    };
    const expected = { blocks: [], draftRevision: 4 };
    serviceMock.reorderBlocks.mockResolvedValue(expected as any);

    const result = await controller.reorderBlocks(mockUser, 'art-1', dto);
    expect(result).toBe(expected);
    expect(serviceMock.reorderBlocks).toHaveBeenCalledWith(mockUser, 'art-1', dto);
  });
});

