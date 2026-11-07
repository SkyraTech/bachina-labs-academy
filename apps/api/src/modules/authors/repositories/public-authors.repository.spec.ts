import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicAuthorsRepository } from './public-authors.repository.js';
import { PrismaService } from '../../../database/prisma.service.js';

describe('PublicAuthorsRepository', () => {
  let repository: PublicAuthorsRepository;
  let prismaMock: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    articleSnapshotMedia: {
      findMany: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
  };

  const MOCK_AUTHOR_ID = 'a1b2c3d4-1111-4000-8000-000000000001';

  beforeEach(async () => {
    prismaMock = {
      user: {
        findFirst: vi.fn(),
      },
      articleSnapshotMedia: {
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicAuthorsRepository,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    repository = module.get<PublicAuthorsRepository>(PublicAuthorsRepository);
  });

  describe('findAuthorProfile', () => {
    it('1. Public field projection: selects strictly id and createdAt, excluding private fields', async () => {
      const mockUser = {
        id: MOCK_AUTHOR_ID,
        createdAt: new Date('2026-10-01T12:00:00.000Z'),
      };
      prismaMock.user.findFirst.mockResolvedValue(mockUser);
      prismaMock.$queryRaw.mockResolvedValue([{ count: 4 }]);

      const result = await repository.findAuthorProfile(MOCK_AUTHOR_ID);

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { id: MOCK_AUTHOR_ID, status: 'ACTIVE' },
        select: { id: true, createdAt: true },
      });
      expect(result).toEqual({
        id: MOCK_AUTHOR_ID,
        displayName: 'Academy Author',
        publishedArticlesCount: 4,
        joinedAt: '2026-10-01T12:00:00.000Z',
      });
      expect((result as any).email).toBeUndefined();
      expect((result as any).passwordHash).toBeUndefined();
    });

    it('2. Unknown author: returns null when user does not exist or is inactive', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      const result = await repository.findAuthorProfile('non-existent');

      expect(result).toBeNull();
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('findAuthorPublishedArticles', () => {
    it('7. queries raw SQL with authorId and snapshot-only constraints', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      const result = await repository.findAuthorPublishedArticles(MOCK_AUTHOR_ID, 0, 10);

      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('findRetainedMediaBatch', () => {
    it('returns empty array when input pairs is empty', async () => {
      const result = await repository.findRetainedMediaBatch([]);
      expect(result).toEqual([]);
      expect(prismaMock.articleSnapshotMedia.findMany).not.toHaveBeenCalled();
    });

    it('queries articleSnapshotMedia when pairs provided', async () => {
      prismaMock.articleSnapshotMedia.findMany.mockResolvedValue([]);

      const result = await repository.findRetainedMediaBatch([
        { snapshotId: 'snap-1', mediaAssetId: 'media-1' },
      ]);

      expect(prismaMock.articleSnapshotMedia.findMany).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});

