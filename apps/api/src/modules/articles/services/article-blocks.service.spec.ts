import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ArticleBlockType, ArticleStatus, UserRole, UserStatus } from '@prisma/client';
import { ArticleBlocksService } from './article-blocks.service.js';
import { ArticleBlocksRepository } from '../repositories/article-blocks.repository.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticleBlocksService', () => {
  let service: ArticleBlocksService;
  let repositoryMock: Record<string, ReturnType<typeof vi.fn>>;

  const mockUser: AuthenticatedUser = {
    id: 'user-0001',
    email: 'author@skyra-tech.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'sess-0001',
  };

  const mockArticle = {
    id: 'art-0001',
    authorId: mockUser.id,
    title: 'PostgreSQL Architecture',
    draftSlug: 'postgresql-architecture',
    publishedSlug: null,
    summary: 'Summary',
    status: ArticleStatus.DRAFT,
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 5,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
  };

  const mockBlock = {
    id: 'blk-0001',
    articleId: mockArticle.id,
    type: ArticleBlockType.HEADING,
    position: 0,
    content: { text: 'Heading 1', level: 2 },
    mediaAssetId: null,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockImageMedia = {
    id: 'med-0001',
    uploaderId: mockUser.id,
    mediaType: 'IMAGE',
    mimeType: 'image/png',
    storageKey: 'media/test.png',
    fileSize: 2048,
    originalFilename: 'test.png',
  };

  beforeEach(() => {
    repositoryMock = {
      transaction: vi.fn(async (fn: any) => fn({} as any)),
      findArticleForUpdate: vi.fn(),
      findBlockById: vi.fn(),
      findBlocksByArticle: vi.fn(),
      getNextPosition: vi.fn(),
      createBlock: vi.fn(),
      updateBlock: vi.fn(),
      deleteBlock: vi.fn(),
      deferPositionConstraint: vi.fn(),
      reindexPositionsAfterDelete: vi.fn(),
      updatePositions: vi.fn(),
      incrementDraftRevision: vi.fn(),
      findMediaAsset: vi.fn(),
    };

    service = new ArticleBlocksService(repositoryMock as unknown as ArticleBlocksRepository);
  });

  describe('createBlock', () => {
    it('creates a block at next position and increments draft revision', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.getNextPosition.mockResolvedValue(2);
      repositoryMock.createBlock.mockResolvedValue({
        ...mockBlock,
        id: 'blk-0002',
        position: 2,
      } as any);
      repositoryMock.incrementDraftRevision.mockResolvedValue(6);

      const result = await service.createBlock(mockUser, mockArticle.id, {
        expectedRevision: 5,
        type: ArticleBlockType.HEADING,
        content: { text: 'Heading 1', level: 2 },
      });

      expect(result.id).toBe('blk-0002');
      expect(result.position).toBe(2);
      expect(result.draftRevision).toBe(6);
      expect(repositoryMock.createBlock).toHaveBeenCalled();
      expect(repositoryMock.incrementDraftRevision).toHaveBeenCalledWith(mockArticle.id, 5, expect.anything());
    });

    it('throws NotFoundException if article does not exist or belongs to another author', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(null);

      await expect(
        service.createBlock(mockUser, 'art-foreign', {
          expectedRevision: 1,
          type: ArticleBlockType.DIVIDER,
          content: {},
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if article is ARCHIVED', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue({
        ...mockArticle,
        status: ArticleStatus.ARCHIVED,
      } as any);

      await expect(
        service.createBlock(mockUser, mockArticle.id, {
          expectedRevision: 5,
          type: ArticleBlockType.DIVIDER,
          content: {},
        }),
      ).rejects.toThrow('Archived articles cannot be modified.');
    });

    it('throws ConflictException if expectedRevision is stale', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);

      await expect(
        service.createBlock(mockUser, mockArticle.id, {
          expectedRevision: 4, // current is 5
          type: ArticleBlockType.DIVIDER,
          content: {},
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('throws BadRequestException if IMAGE block is missing mediaAssetId', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);

      await expect(
        service.createBlock(mockUser, mockArticle.id, {
          expectedRevision: 5,
          type: ArticleBlockType.IMAGE,
          content: { caption: 'Pic' },
        }),
      ).rejects.toThrow('IMAGE blocks require a mediaAssetId.');
    });

    it('throws ForbiddenException if IMAGE block references media owned by another user', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findMediaAsset.mockResolvedValue({
        ...mockImageMedia,
        uploaderId: 'other-user',
      } as any);

      await expect(
        service.createBlock(mockUser, mockArticle.id, {
          expectedRevision: 5,
          type: ArticleBlockType.IMAGE,
          content: {},
          mediaAssetId: mockImageMedia.id,
        }),
      ).rejects.toThrow('You do not have permission to use this media asset.');
    });

    it('throws BadRequestException if non-IMAGE block supplies mediaAssetId', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);

      await expect(
        service.createBlock(mockUser, mockArticle.id, {
          expectedRevision: 5,
          type: ArticleBlockType.DIVIDER,
          content: {},
          mediaAssetId: mockImageMedia.id,
        }),
      ).rejects.toThrow('mediaAssetId must be null for non-IMAGE blocks.');
    });
  });

  describe('updateBlock', () => {
    it('updates block content and increments draft revision', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlockById.mockResolvedValue(mockBlock as any);
      repositoryMock.updateBlock.mockResolvedValue({
        ...mockBlock,
        content: { text: 'Updated Text', level: 2 },
      } as any);
      repositoryMock.incrementDraftRevision.mockResolvedValue(6);

      const res = await service.updateBlock(mockUser, mockArticle.id, mockBlock.id, {
        expectedRevision: 5,
        content: { text: 'Updated Text', level: 2 },
      });

      expect(res.draftRevision).toBe(6);
      expect(repositoryMock.updateBlock).toHaveBeenCalled();
      expect(repositoryMock.incrementDraftRevision).toHaveBeenCalled();
    });

    it('returns exact no-op without incrementing draft revision when content is identical', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlockById.mockResolvedValue(mockBlock as any);

      const res = await service.updateBlock(mockUser, mockArticle.id, mockBlock.id, {
        expectedRevision: 5,
        content: { text: 'Heading 1', level: 2 }, // Identical to mockBlock.content
      });

      expect(res.draftRevision).toBe(5);
      expect(repositoryMock.updateBlock).not.toHaveBeenCalled();
      expect(repositoryMock.incrementDraftRevision).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if block does not exist on article', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlockById.mockResolvedValue(null);

      await expect(
        service.updateBlock(mockUser, mockArticle.id, 'blk-unknown', {
          expectedRevision: 5,
          content: { text: 'New', level: 1 },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if expectedRevision is stale on update', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);

      await expect(
        service.updateBlock(mockUser, mockArticle.id, mockBlock.id, {
          expectedRevision: 1, // current is 5
          content: { text: 'Stale', level: 1 },
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('throws BadRequestException if clearing mediaAssetId on IMAGE block with null', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlockById.mockResolvedValue({
        ...mockBlock,
        type: ArticleBlockType.IMAGE,
        mediaAssetId: 'med-0001',
      } as any);

      await expect(
        service.updateBlock(mockUser, mockArticle.id, mockBlock.id, {
          expectedRevision: 5,
          mediaAssetId: null,
        }),
      ).rejects.toThrow('IMAGE blocks require a valid mediaAssetId');
    });
  });

  describe('deleteBlock', () => {
    it('deletes block, defers constraint, compacts positions, and increments revision', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlockById.mockResolvedValue(mockBlock as any);

      await service.deleteBlock(mockUser, mockArticle.id, mockBlock.id, {
        expectedRevision: 5,
      });

      expect(repositoryMock.deleteBlock).toHaveBeenCalledWith(mockBlock.id, expect.anything());
      expect(repositoryMock.deferPositionConstraint).toHaveBeenCalled();
      expect(repositoryMock.reindexPositionsAfterDelete).toHaveBeenCalledWith(
        mockArticle.id,
        mockBlock.position,
        expect.anything(),
      );
      expect(repositoryMock.incrementDraftRevision).toHaveBeenCalledWith(mockArticle.id, 5, expect.anything());
    });

    it('rejects missing or invalid expectedRevision with BadRequestException', async () => {
      await expect(
        service.deleteBlock(mockUser, mockArticle.id, mockBlock.id, {} as any),
      ).rejects.toThrow('expectedRevision query parameter is required');

      await expect(
        service.deleteBlock(mockUser, mockArticle.id, mockBlock.id, { expectedRevision: 0 } as any),
      ).rejects.toThrow('expectedRevision query parameter is required');
    });

    it('throws ConflictException if delete revision is stale', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);

      await expect(
        service.deleteBlock(mockUser, mockArticle.id, mockBlock.id, {
          expectedRevision: 99,
        }),
      ).rejects.toThrow('Draft revision conflict');
    });
  });

  describe('reorderBlocks', () => {
    const b1 = { ...mockBlock, id: 'blk-1', position: 0 };
    const b2 = { ...mockBlock, id: 'blk-2', position: 1 };
    const b3 = { ...mockBlock, id: 'blk-3', position: 2 };

    it('successfully reorders blocks with deferred constraint and revision increment', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlocksByArticle.mockResolvedValue([b1, b2, b3] as any);
      repositoryMock.updatePositions.mockResolvedValue([
        { ...b2, position: 0 },
        { ...b1, position: 1 },
        { ...b3, position: 2 },
      ] as any);
      repositoryMock.incrementDraftRevision.mockResolvedValue(6);

      const res = await service.reorderBlocks(mockUser, mockArticle.id, {
        expectedRevision: 5,
        blockIds: ['blk-2', 'blk-1', 'blk-3'], // Swapped 1 and 2
      });

      expect(res.draftRevision).toBe(6);
      expect(res.blocks[0].id).toBe('blk-2');
      expect(repositoryMock.deferPositionConstraint).toHaveBeenCalled();
      expect(repositoryMock.updatePositions).toHaveBeenCalledWith(
        mockArticle.id,
        ['blk-2', 'blk-1', 'blk-3'],
        expect.anything(),
      );
      expect(repositoryMock.incrementDraftRevision).toHaveBeenCalled();
    });

    it('returns exact no-op when reorder sequence is identical to current order', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlocksByArticle.mockResolvedValue([b1, b2, b3] as any);

      const res = await service.reorderBlocks(mockUser, mockArticle.id, {
        expectedRevision: 5,
        blockIds: ['blk-1', 'blk-2', 'blk-3'], // Identical
      });

      expect(res.draftRevision).toBe(5);
      expect(repositoryMock.deferPositionConstraint).not.toHaveBeenCalled();
      expect(repositoryMock.updatePositions).not.toHaveBeenCalled();
      expect(repositoryMock.incrementDraftRevision).not.toHaveBeenCalled();
    });

    it('handles empty article reorder as a valid no-op', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlocksByArticle.mockResolvedValue([]);

      const res = await service.reorderBlocks(mockUser, mockArticle.id, {
        expectedRevision: 5,
        blockIds: [],
      });

      expect(res.blocks).toEqual([]);
      expect(res.draftRevision).toBe(5);
      expect(repositoryMock.updatePositions).not.toHaveBeenCalled();
    });

    it('rejects duplicate block IDs with BadRequestException', async () => {
      await expect(
        service.reorderBlocks(mockUser, mockArticle.id, {
          expectedRevision: 5,
          blockIds: ['blk-1', 'blk-1'],
        }),
      ).rejects.toThrow('Duplicate block IDs in reorder request.');
    });

    it('rejects incomplete block list with BadRequestException', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlocksByArticle.mockResolvedValue([b1, b2, b3] as any);

      await expect(
        service.reorderBlocks(mockUser, mockArticle.id, {
          expectedRevision: 5,
          blockIds: ['blk-1', 'blk-2'], // Missing blk-3
        }),
      ).rejects.toThrow('Submitted block count (2) does not match existing block count (3)');
    });

    it('rejects foreign block ID with BadRequestException', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(mockArticle as any);
      repositoryMock.findBlocksByArticle.mockResolvedValue([b1, b2] as any);

      await expect(
        service.reorderBlocks(mockUser, mockArticle.id, {
          expectedRevision: 5,
          blockIds: ['blk-1', 'blk-foreign'],
        }),
      ).rejects.toThrow('Block ID blk-foreign does not belong to this article');
    });
  });
});
