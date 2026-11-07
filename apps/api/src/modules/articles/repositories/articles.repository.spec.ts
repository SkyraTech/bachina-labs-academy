import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ArticlesRepository } from './articles.repository.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ArticleStatus } from '@prisma/client';

describe('ArticlesRepository', () => {
  let repository: ArticlesRepository;
  let prismaMock: {
    article: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    mediaAsset: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  const MOCK_DATE = new Date('2026-10-25T10:00:00.000Z');

  const MOCK_ARTICLE = {
    id: 'a1b2c3d4-1111-4000-8000-000000000001',
    authorId: 'u1111111-0000-4000-8000-000000000001',
    title: 'PostgreSQL Mastery',
    draftSlug: 'postgresql-mastery',
    publishedSlug: null,
    summary: 'A deep dive into PostgreSQL.',
    status: ArticleStatus.DRAFT,
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 1,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: MOCK_DATE,
    updatedAt: MOCK_DATE,
    publishedAt: null,
  };

  beforeEach(async () => {
    prismaMock = {
      article: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      mediaAsset: {
        findUnique: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticlesRepository,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    repository = module.get<ArticlesRepository>(ArticlesRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates an article draft with database defaults', async () => {
      prismaMock.article.create.mockResolvedValue(MOCK_ARTICLE);

      const result = await repository.create({
        authorId: MOCK_ARTICLE.authorId,
        title: MOCK_ARTICLE.title,
        draftSlug: MOCK_ARTICLE.draftSlug,
        summary: MOCK_ARTICLE.summary,
      });

      expect(prismaMock.article.create).toHaveBeenCalledWith({
        data: {
          authorId: MOCK_ARTICLE.authorId,
          title: MOCK_ARTICLE.title,
          draftSlug: MOCK_ARTICLE.draftSlug,
          summary: MOCK_ARTICLE.summary,
          typographyPreset: 'MODERN_SANS',
          coverMediaId: null,
          categoryId: null,
          status: 'DRAFT',
          draftRevision: 1,
          publishedRevision: 0,
          tags: undefined,
        },
        include: {
          category: true,
          tags: {
            include: { tag: true },
            orderBy: [{ tag: { slug: 'asc' } }, { tagId: 'asc' }],
          },
        },
      });
      expect(result).toEqual(MOCK_ARTICLE);
    });
  });

  describe('findMyArticles', () => {
    it('queries with authorId, pagination, and deterministic ordering', async () => {
      prismaMock.article.findMany.mockResolvedValue([MOCK_ARTICLE]);
      prismaMock.article.count.mockResolvedValue(1);

      const result = await repository.findMyArticles({
        authorId: MOCK_ARTICLE.authorId,
        page: 2,
        limit: 10,
        status: ArticleStatus.DRAFT,
      });

      expect(prismaMock.article.findMany).toHaveBeenCalledWith({
        where: {
          authorId: MOCK_ARTICLE.authorId,
          status: ArticleStatus.DRAFT,
        },
        include: {
          category: true,
          tags: {
            include: { tag: true },
            orderBy: [{ tag: { slug: 'asc' } }, { tagId: 'asc' }],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      });
      expect(prismaMock.article.count).toHaveBeenCalledWith({
        where: {
          authorId: MOCK_ARTICLE.authorId,
          status: ArticleStatus.DRAFT,
        },
      });
      expect(result.items).toEqual([MOCK_ARTICLE]);
      expect(result.total).toBe(1);
    });
  });

  describe('findPrivateById', () => {
    it('queries by articleId and authorId including ordered blocks', async () => {
      const mockWithBlocks = {
        ...MOCK_ARTICLE,
        blocks: [
          {
            id: 'b1b2c3d4-1111-4000-8000-000000000001',
            articleId: MOCK_ARTICLE.id,
            type: 'HEADING',
            position: 0,
            content: { text: 'Intro' },
            mediaAssetId: null,
            schemaVersion: 1,
            createdAt: MOCK_DATE,
            updatedAt: MOCK_DATE,
          },
        ],
      };
      prismaMock.article.findFirst.mockResolvedValue(mockWithBlocks);

      const result = await repository.findPrivateById(
        MOCK_ARTICLE.id,
        MOCK_ARTICLE.authorId,
      );

      expect(prismaMock.article.findFirst).toHaveBeenCalledWith({
        where: {
          id: MOCK_ARTICLE.id,
          authorId: MOCK_ARTICLE.authorId,
        },
        include: {
          category: true,
          blocks: {
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          },
          tags: {
            include: { tag: true },
            orderBy: [{ tag: { slug: 'asc' } }, { tagId: 'asc' }],
          },
        },
      });
      expect(result).toEqual(mockWithBlocks);
    });

    it('returns null if article does not exist or belongs to another user', async () => {
      prismaMock.article.findFirst.mockResolvedValue(null);

      const result = await repository.findPrivateById(
        'random-id',
        'wrong-user',
      );
      expect(result).toBeNull();
    });
  });

  describe('findMediaAsset', () => {
    it('looks up media asset using transaction client when provided', async () => {
      const mockMedia = {
        id: 'm1m2m3m4-1111-4000-8000-000000000001',
        uploaderId: MOCK_ARTICLE.authorId,
        mediaType: 'IMAGE',
      };
      const mockTx = {
        mediaAsset: {
          findUnique: vi.fn().mockResolvedValue(mockMedia),
        },
      };

      const result = await repository.findMediaAsset(mockMedia.id, mockTx as any);
      expect(mockTx.mediaAsset.findUnique).toHaveBeenCalledWith({
        where: { id: mockMedia.id },
      });
      expect(result).toEqual(mockMedia);
    });
  });

  describe('transaction', () => {
    it('executes callback inside prisma.$transaction', async () => {
      const mockTx = { txId: 'test-tx' };
      (prismaMock as any).$transaction = vi.fn().mockImplementation((cb) => cb(mockTx));

      const result = await repository.transaction(async (tx) => {
        return tx;
      });

      expect((prismaMock as any).$transaction).toHaveBeenCalled();
      expect(result).toEqual(mockTx);
    });
  });

  describe('findArticleForUpdate', () => {
    it('executes raw SQL FOR UPDATE and returns first matching row', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([MOCK_ARTICLE]),
      };

      const result = await repository.findArticleForUpdate(
        MOCK_ARTICLE.id,
        MOCK_ARTICLE.authorId,
        mockTx as any,
      );

      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(result).toEqual(MOCK_ARTICLE);
    });

    it('returns null if queryRaw returns empty array', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
      };

      const result = await repository.findArticleForUpdate(
        'non-existent',
        'wrong-user',
        mockTx as any,
      );

      expect(result).toBeNull();
    });
  });

  describe('updateArticle', () => {
    it('calls tx.article.update with id and data', async () => {
      const mockTx = {
        article: {
          update: vi.fn().mockResolvedValue({
            ...MOCK_ARTICLE,
            title: 'Updated Title',
            draftRevision: 2,
          }),
        },
      };

      const result = await repository.updateArticle(
        MOCK_ARTICLE.id,
        { title: 'Updated Title', draftRevision: { increment: 1 } },
        mockTx as any,
      );

      expect(mockTx.article.update).toHaveBeenCalledWith({
        where: { id: MOCK_ARTICLE.id },
        data: { title: 'Updated Title', draftRevision: { increment: 1 } },
      });
      expect(result.title).toBe('Updated Title');
      expect(result.draftRevision).toBe(2);
    });
  });

  describe('countSnapshots', () => {
    it('calls tx.articleSnapshot.count with articleId', async () => {
      const mockTx = {
        articleSnapshot: {
          count: vi.fn().mockResolvedValue(3),
        },
      };

      const count = await repository.countSnapshots(MOCK_ARTICLE.id, mockTx as any);
      expect(mockTx.articleSnapshot.count).toHaveBeenCalledWith({
        where: { articleId: MOCK_ARTICLE.id },
      });
      expect(count).toBe(3);
    });
  });

  describe('deleteArticle', () => {
    it('calls tx.article.delete with articleId', async () => {
      const mockTx = {
        article: {
          delete: vi.fn().mockResolvedValue(MOCK_ARTICLE),
        },
      };

      await repository.deleteArticle(MOCK_ARTICLE.id, mockTx as any);
      expect(mockTx.article.delete).toHaveBeenCalledWith({
        where: { id: MOCK_ARTICLE.id },
      });
    });
  });

  describe('duplicateArticle', () => {
    it('throws NotFoundException if source article does not exist or author does not match', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: MOCK_ARTICLE.authorId }]),
        article: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };
      (prismaMock as any).$transaction = vi.fn().mockImplementation((cb) => cb(mockTx));

      await expect(
        repository.duplicateArticle(
          'nonexistent-id',
          MOCK_ARTICLE.authorId,
          'Original Title (Copy)',
          'original-title-copy',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(mockTx.article.findFirst).toHaveBeenCalledWith({
        where: { id: 'nonexistent-id', authorId: MOCK_ARTICLE.authorId },
        include: {
          blocks: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
          tags: { select: { tagId: true } },
        },
      });
    });

    it('acquires author row lock, resets revisions, preserves blocks and tags with fresh identities', async () => {
      const sourceArticle = {
        ...MOCK_ARTICLE,
        title: 'Original Title',
        draftSlug: 'original-title',
        publishedSlug: 'original-title',
        publishedRevision: 3,
        draftRevision: 5,
        status: ArticleStatus.PUBLISHED,
        currentSnapshotId: 'snap-123',
        publishedAt: new Date(),
        coverMediaId: 'media-cover-1',
        blocks: [
          {
            id: 'block-old-1',
            type: 'PARAGRAPH',
            position: 1000,
            content: { text: 'Hello' },
            schemaVersion: 1,
            mediaAssetId: null,
          },
        ],
        tags: [{ tagId: 'tag-1' }],
      };

      const duplicatedArticle = {
        ...MOCK_ARTICLE,
        id: 'new-dup-article-id',
        title: 'Original Title (Copy)',
        draftSlug: 'original-title-copy',
        publishedSlug: null,
        status: ArticleStatus.DRAFT,
        draftRevision: 1,
        publishedRevision: 0,
        currentSnapshotId: null,
        publishedAt: null,
        blocks: [
          {
            id: 'new-block-id-1',
            type: 'PARAGRAPH',
            position: 1000,
            content: { text: 'Hello' },
            schemaVersion: 1,
            mediaAssetId: null,
          },
        ],
        tags: [{ tagId: 'tag-1' }],
      };

      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: sourceArticle.authorId }]),
        article: {
          findFirst: vi
            .fn()
            // 1st call: find source article
            .mockResolvedValueOnce(sourceArticle)
            // 2nd call: check unique slug 'original-title-copy' -> null (available)
            .mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValue(duplicatedArticle),
          findFirstOrThrow: vi.fn().mockResolvedValue(duplicatedArticle),
        },
        articleBlock: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        articleTag: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      (prismaMock as any).$transaction = vi.fn().mockImplementation((cb) => cb(mockTx));

      const result = await repository.duplicateArticle(
        sourceArticle.id,
        sourceArticle.authorId,
        'Original Title (Copy)',
        'original-title-copy',
      );

      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(mockTx.article.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorId: sourceArticle.authorId,
            title: 'Original Title (Copy)',
            draftSlug: 'original-title-copy',
            publishedSlug: null,
            status: ArticleStatus.DRAFT,
            draftRevision: 1,
            publishedRevision: 0,
            currentSnapshotId: null,
            publishedAt: null,
            coverMediaId: 'media-cover-1',
          }),
        }),
      );
      expect(result.id).toBe('new-dup-article-id');
      expect(result.draftRevision).toBe(1);
      expect(result.publishedRevision).toBe(0);
    });

    it('increments copy suffix when base copy slug is already taken', async () => {
      const sourceArticle = {
        ...MOCK_ARTICLE,
        title: 'Concurrent Article',
        draftSlug: 'concurrent-article',
        blocks: [],
        tags: [],
      };

      const duplicatedArticle = {
        ...MOCK_ARTICLE,
        id: 'dup-id-2',
        draftSlug: 'concurrent-article-copy-2',
      };

      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: sourceArticle.authorId }]),
        article: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(sourceArticle)
            // First check: concurrent-article-copy is taken
            .mockResolvedValueOnce({ id: 'existing-copy' })
            // Second check: concurrent-article-copy-2 is available
            .mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValue(duplicatedArticle),
          findFirstOrThrow: vi.fn().mockResolvedValue(duplicatedArticle),
        },
        articleBlock: {
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        articleTag: {
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      (prismaMock as any).$transaction = vi.fn().mockImplementation((cb) => cb(mockTx));

      const result = await repository.duplicateArticle(
        sourceArticle.id,
        sourceArticle.authorId,
        'Concurrent Article (Copy)',
        'concurrent-article-copy',
      );

      expect(result.draftSlug).toBe('concurrent-article-copy-2');
      expect(mockTx.article.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            draftSlug: 'concurrent-article-copy-2',
          }),
        }),
      );
    });
  });
});

