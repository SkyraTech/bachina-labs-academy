import { Test, TestingModule } from '@nestjs/testing';
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
          status: 'DRAFT',
          draftRevision: 1,
          publishedRevision: 0,
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
          blocks: {
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
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
});

