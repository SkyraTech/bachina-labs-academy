import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { ArticlesService } from './articles.service.js';
import { ArticlesRepository } from '../repositories/articles.repository.js';
import { UserRole, UserStatus, ArticleStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticlesService', () => {
  let service: ArticlesService;
  let repositoryMock: {
    create: ReturnType<typeof vi.fn>;
    findMyArticles: ReturnType<typeof vi.fn>;
    findPrivateById: ReturnType<typeof vi.fn>;
    findMediaAsset: ReturnType<typeof vi.fn>;
    findCategoryById: ReturnType<typeof vi.fn>;
    findTagsByIds: ReturnType<typeof vi.fn>;
    findArticleTagIds: ReturnType<typeof vi.fn>;
    replaceArticleTags: ReturnType<typeof vi.fn>;
    checkDraftSlugExists: ReturnType<typeof vi.fn>;
    duplicateArticle: ReturnType<typeof vi.fn>;
  };

  const VALID_USER: AuthenticatedUser = {
    id: 'u1111111-0000-4000-8000-000000000001',
    email: 'author@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 's1111111-0000-4000-8000-000000000001',
  };

  const UNVERIFIED_USER: AuthenticatedUser = {
    ...VALID_USER,
    id: 'u2222222-0000-4000-8000-000000000002',
    emailVerifiedAt: null,
  };

  const SUSPENDED_USER: AuthenticatedUser = {
    ...VALID_USER,
    id: 'u3333333-0000-4000-8000-000000000003',
    status: UserStatus.SUSPENDED,
  };

  const MOCK_DATE = new Date('2026-10-25T10:00:00.000Z');

  const MOCK_ARTICLE = {
    id: 'a1b2c3d4-1111-4000-8000-000000000001',
    authorId: VALID_USER.id,
    title: 'Relational Database Design',
    draftSlug: 'relational-database-design',
    publishedSlug: null,
    summary: 'A comprehensive guide.',
    status: ArticleStatus.DRAFT,
    typographyPreset: 'MODERN_SANS' as const,
    coverMediaId: null,
    draftRevision: 1,
    publishedRevision: 0,
    currentSnapshotId: null,
    categoryId: null,
    createdAt: MOCK_DATE,
    updatedAt: MOCK_DATE,
    publishedAt: null,
  };

  beforeEach(async () => {
    repositoryMock = {
      create: vi.fn(),
      findMyArticles: vi.fn(),
      findPrivateById: vi.fn(),
      findMediaAsset: vi.fn(),
      findCategoryById: vi.fn(),
      findTagsByIds: vi.fn(),
      findArticleTagIds: vi.fn(),
      replaceArticleTags: vi.fn(),
      checkDraftSlugExists: vi.fn(),
      duplicateArticle: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticlesService,
        {
          provide: ArticlesRepository,
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get<ArticlesService>(ArticlesService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Account Eligibility ───────────────────────────────────────────────────

  describe('eligibility enforcement', () => {
    it('rejects unverified email users with ForbiddenException', async () => {
      await expect(
        service.createDraft(UNVERIFIED_USER, {
          title: 'Test Title',
          draftSlug: 'test-slug',
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.listMyArticles(UNVERIFIED_USER, {}),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.getPrivateArticle(UNVERIFIED_USER, MOCK_ARTICLE.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects suspended users with UnauthorizedException', async () => {
      await expect(
        service.createDraft(SUSPENDED_USER, {
          title: 'Test Title',
          draftSlug: 'test-slug',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── Create Draft ──────────────────────────────────────────────────────────

  describe('createDraft', () => {
    it('creates a draft article and returns formatted response', async () => {
      repositoryMock.create.mockResolvedValue(MOCK_ARTICLE);

      const result = await service.createDraft(VALID_USER, {
        title: 'Relational Database Design',
        draftSlug: 'relational-database-design',
        summary: 'A comprehensive guide.',
      });

      expect(repositoryMock.create).toHaveBeenCalledWith({
        authorId: VALID_USER.id,
        title: 'Relational Database Design',
        draftSlug: 'relational-database-design',
        summary: 'A comprehensive guide.',
        typographyPreset: undefined,
        coverMediaId: undefined,
        categoryId: null,
        tagIds: undefined,
      });

      expect(result).toEqual({
        id: MOCK_ARTICLE.id,
        authorId: VALID_USER.id,
        title: MOCK_ARTICLE.title,
        draftSlug: MOCK_ARTICLE.draftSlug,
        publishedSlug: null,
        summary: MOCK_ARTICLE.summary,
        status: ArticleStatus.DRAFT,
        typographyPreset: 'MODERN_SANS',
        coverMediaId: null,
        draftRevision: 1,
        publishedRevision: 0,
        currentSnapshotId: null,
        categoryId: null,
        tagIds: [],
        category: null,
        tags: [],
        createdAt: MOCK_DATE.toISOString(),
        updatedAt: MOCK_DATE.toISOString(),
        publishedAt: null,
      });
    });

    it('validates owned image cover media when provided', async () => {
      const coverMediaId = 'm1m2m3m4-1111-4000-8000-000000000001';
      repositoryMock.findMediaAsset.mockResolvedValue({
        id: coverMediaId,
        uploaderId: VALID_USER.id,
        mediaType: 'IMAGE',
      });
      repositoryMock.create.mockResolvedValue({
        ...MOCK_ARTICLE,
        coverMediaId,
      });

      const result = await service.createDraft(VALID_USER, {
        title: 'Title with Cover',
        draftSlug: 'title-with-cover',
        coverMediaId,
      });

      expect(repositoryMock.findMediaAsset).toHaveBeenCalledWith(coverMediaId);
      expect(result.coverMediaId).toBe(coverMediaId);
    });

    it('rejects missing cover media with BadRequestException', async () => {
      const coverMediaId = 'm1m2m3m4-0000-0000-0000-000000000000';
      repositoryMock.findMediaAsset.mockResolvedValue(null);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Title with Bad Media',
          draftSlug: 'title-bad-media',
          coverMediaId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-image cover media with BadRequestException', async () => {
      const coverMediaId = 'm1m2m3m4-1111-4000-8000-000000000001';
      repositoryMock.findMediaAsset.mockResolvedValue({
        id: coverMediaId,
        uploaderId: VALID_USER.id,
        mediaType: 'VIDEO',
      });

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Title with Video Cover',
          draftSlug: 'title-video-cover',
          coverMediaId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cross-author cover media with ForbiddenException', async () => {
      const coverMediaId = 'm1m2m3m4-1111-4000-8000-000000000001';
      repositoryMock.findMediaAsset.mockResolvedValue({
        id: coverMediaId,
        uploaderId: 'other-author-uuid',
        mediaType: 'IMAGE',
      });

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Title with Stolen Cover',
          draftSlug: 'title-stolen-cover',
          coverMediaId,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('propagates database persistence errors safely', async () => {
      repositoryMock.create.mockRejectedValue(new Error('DB failure'));

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Title DB Fail',
          draftSlug: 'title-db-fail',
        }),
      ).rejects.toThrow('DB failure');
    });
  });

  // ── List My Articles ──────────────────────────────────────────────────────

  describe('listMyArticles', () => {
    it('returns paginated envelope scoped to author', async () => {
      repositoryMock.findMyArticles.mockResolvedValue({
        items: [MOCK_ARTICLE],
        total: 1,
      });

      const result = await service.listMyArticles(VALID_USER, {
        page: 1,
        limit: 20,
      });

      expect(repositoryMock.findMyArticles).toHaveBeenCalledWith({
        authorId: VALID_USER.id,
        page: 1,
        limit: 20,
        status: undefined,
      });

      expect(result).toEqual({
        items: [
          {
            ...MOCK_ARTICLE,
            tagIds: [],
            category: null,
            tags: [],
            createdAt: MOCK_DATE.toISOString(),
            updatedAt: MOCK_DATE.toISOString(),
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('handles empty results with stable pagination envelope', async () => {
      repositoryMock.findMyArticles.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await service.listMyArticles(VALID_USER, {
        page: 1,
        limit: 20,
      });

      expect(result).toEqual({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  // ── Get Private Article ───────────────────────────────────────────────────

  describe('getPrivateArticle', () => {
    it('returns own editable draft with ordered blocks', async () => {
      const mockWithBlocks = {
        ...MOCK_ARTICLE,
        blocks: [
          {
            id: 'b1111111-0000-4000-8000-000000000001',
            articleId: MOCK_ARTICLE.id,
            type: 'HEADING',
            position: 0,
            content: { text: 'Introduction' },
            mediaAssetId: null,
            schemaVersion: 1,
            createdAt: MOCK_DATE,
            updatedAt: MOCK_DATE,
          },
        ],
      };
      repositoryMock.findPrivateById.mockResolvedValue(mockWithBlocks);

      const result = await service.getPrivateArticle(VALID_USER, MOCK_ARTICLE.id);

      expect(repositoryMock.findPrivateById).toHaveBeenCalledWith(
        MOCK_ARTICLE.id,
        VALID_USER.id,
      );

      expect(result.id).toBe(MOCK_ARTICLE.id);
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].position).toBe(0);
      expect(result.blocks[0].createdAt).toBe(MOCK_DATE.toISOString());
    });

    it('throws 404 NotFoundException if article does not exist or belongs to another author', async () => {
      repositoryMock.findPrivateById.mockResolvedValue(null);

      await expect(
        service.getPrivateArticle(VALID_USER, 'foreign-article-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateDraftMetadata ───────────────────────────────────────────────────

  describe('updateDraftMetadata', () => {
    let mockTx: {
      findArticleForUpdate: ReturnType<typeof vi.fn>;
      updateArticle: ReturnType<typeof vi.fn>;
      findMediaAsset: ReturnType<typeof vi.fn>;
      findCategoryById: ReturnType<typeof vi.fn>;
      findTagsByIds: ReturnType<typeof vi.fn>;
      findArticleTagIds: ReturnType<typeof vi.fn>;
      replaceArticleTags: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockTx = {
        findArticleForUpdate: vi.fn(),
        updateArticle: vi.fn(),
        findMediaAsset: vi.fn(),
        findCategoryById: vi.fn(),
        findTagsByIds: vi.fn(),
        findArticleTagIds: vi.fn().mockResolvedValue([]),
        replaceArticleTags: vi.fn().mockResolvedValue(undefined),
      };
      (repositoryMock as any).transaction = vi.fn().mockImplementation((cb) => cb(mockTx));
      (repositoryMock as any).findArticleForUpdate = mockTx.findArticleForUpdate;
      (repositoryMock as any).updateArticle = mockTx.updateArticle;
      (repositoryMock as any).findMediaAsset = mockTx.findMediaAsset;
      (repositoryMock as any).findCategoryById = mockTx.findCategoryById;
      (repositoryMock as any).findTagsByIds = mockTx.findTagsByIds;
      (repositoryMock as any).findArticleTagIds = mockTx.findArticleTagIds;
      (repositoryMock as any).replaceArticleTags = mockTx.replaceArticleTags;
    });

    it('rejects ineligible accounts (unverified / suspended)', async () => {
      await expect(
        service.updateDraftMetadata(UNVERIFIED_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          title: 'New Title',
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.updateDraftMetadata(SUSPENDED_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          title: 'New Title',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 404 NotFoundException if article does not exist or belongs to another author', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(null);

      await expect(
        service.updateDraftMetadata(VALID_USER, 'missing-id', {
          expectedRevision: 1,
          title: 'Updated Title',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 ConflictException if article is ARCHIVED', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        status: ArticleStatus.ARCHIVED,
      });

      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          title: 'Updated Title',
        }),
      ).rejects.toThrow('Archived articles cannot be edited');
    });

    it('throws 409 ConflictException when expectedRevision does not match current draftRevision', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 3,
      });

      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 2, // Stale!
          title: 'Updated Title',
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('rejects stale revision even if the payload is an exact no-op', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 5,
        title: 'Exact Same Title',
      });

      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 4, // Stale!
          title: 'Exact Same Title',
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('detects an exact no-op and returns article without calling updateArticle', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(MOCK_ARTICLE);

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 1,
        title: MOCK_ARTICLE.title,
        draftSlug: MOCK_ARTICLE.draftSlug,
        summary: MOCK_ARTICLE.summary,
        typographyPreset: MOCK_ARTICLE.typographyPreset,
        coverMediaId: null,
      });

      expect(mockTx.updateArticle).not.toHaveBeenCalled();
      expect(result.id).toBe(MOCK_ARTICLE.id);
      expect(result.draftRevision).toBe(1);
    });

    it('detects empty update payload (only expectedRevision) as no-op', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(MOCK_ARTICLE);

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 1,
      });

      expect(mockTx.updateArticle).not.toHaveBeenCalled();
      expect(result.id).toBe(MOCK_ARTICLE.id);
      expect(result.draftRevision).toBe(1);
    });

    it('atomically increments draftRevision on meaningful update', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(MOCK_ARTICLE);
      const updatedArticle = {
        ...MOCK_ARTICLE,
        title: 'A Brand New Title',
        draftRevision: 2,
        updatedAt: new Date('2026-10-25T11:00:00Z'),
      };
      mockTx.updateArticle.mockResolvedValue(updatedArticle);

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 1,
        title: '  A Brand New Title  ',
      });

      expect(mockTx.updateArticle).toHaveBeenCalledWith(
        MOCK_ARTICLE.id,
        {
          title: 'A Brand New Title',
          draftRevision: { increment: 1 },
        },
        mockTx,
      );
      expect(result.title).toBe('A Brand New Title');
      expect(result.draftRevision).toBe(2);
    });

    it('allows draft metadata editing on PUBLISHED articles while leaving published metadata untouched', async () => {
      const publishedArticle = {
        ...MOCK_ARTICLE,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 4,
        publishedRevision: 4,
        publishedSlug: 'relational-database-design-live',
        currentSnapshotId: 's1111111-2222-4000-8000-000000000001',
        publishedAt: new Date('2026-10-20T00:00:00Z'),
      };
      mockTx.findArticleForUpdate.mockResolvedValue(publishedArticle);

      const updatedPublishedArticle = {
        ...publishedArticle,
        title: 'Relational Database Design - Draft Improvements',
        draftRevision: 5,
        updatedAt: new Date('2026-10-25T12:00:00Z'),
      };
      mockTx.updateArticle.mockResolvedValue(updatedPublishedArticle);

      const result = await service.updateDraftMetadata(VALID_USER, publishedArticle.id, {
        expectedRevision: 4,
        title: 'Relational Database Design - Draft Improvements',
      });

      expect(result.status).toBe(ArticleStatus.PUBLISHED);
      expect(result.draftRevision).toBe(5);
      expect(result.publishedRevision).toBe(4);
      expect(result.publishedSlug).toBe('relational-database-design-live');
      expect(result.currentSnapshotId).toBe('s1111111-2222-4000-8000-000000000001');
      expect(result.publishedAt).toBe('2026-10-20T00:00:00.000Z');
    });

    it('validates cover media asset ownership, type, and existence when provided', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(MOCK_ARTICLE);
      const mediaId = 'm1111111-0000-4000-8000-000000000001';

      // 1. Missing media asset -> BadRequestException
      mockTx.findMediaAsset.mockResolvedValue(null);
      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          coverMediaId: mediaId,
        }),
      ).rejects.toThrow(BadRequestException);

      // 2. Non-IMAGE media asset -> BadRequestException
      mockTx.findMediaAsset.mockResolvedValue({
        id: mediaId,
        mediaType: 'VIDEO',
        uploaderId: VALID_USER.id,
      });
      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          coverMediaId: mediaId,
        }),
      ).rejects.toThrow('Cover media must be an image asset');

      // 3. Foreign-owned media asset -> ForbiddenException
      mockTx.findMediaAsset.mockResolvedValue({
        id: mediaId,
        mediaType: 'IMAGE',
        uploaderId: 'foreign-user-id',
      });
      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          coverMediaId: mediaId,
        }),
      ).rejects.toThrow(ForbiddenException);

      // 4. Valid owned image media asset -> succeeds and connects
      mockTx.findMediaAsset.mockResolvedValue({
        id: mediaId,
        mediaType: 'IMAGE',
        uploaderId: VALID_USER.id,
      });
      mockTx.updateArticle.mockResolvedValue({
        ...MOCK_ARTICLE,
        coverMediaId: mediaId,
        draftRevision: 2,
      });

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 1,
        coverMediaId: mediaId,
      });

      expect(mockTx.updateArticle).toHaveBeenCalledWith(
        MOCK_ARTICLE.id,
        {
          coverMedia: { connect: { id: mediaId } },
          draftRevision: { increment: 1 },
        },
        mockTx,
      );
      expect(result.coverMediaId).toBe(mediaId);
    });

    it('disconnects cover media when coverMediaId is explicitly null', async () => {
      const articleWithCover = {
        ...MOCK_ARTICLE,
        coverMediaId: 'm1111111-0000-4000-8000-000000000001',
      };
      mockTx.findArticleForUpdate.mockResolvedValue(articleWithCover);
      mockTx.updateArticle.mockResolvedValue({
        ...articleWithCover,
        coverMediaId: null,
        draftRevision: 2,
      });

      const result = await service.updateDraftMetadata(VALID_USER, articleWithCover.id, {
        expectedRevision: 1,
        coverMediaId: null,
      });

      expect(mockTx.updateArticle).toHaveBeenCalledWith(
        articleWithCover.id,
        {
          coverMedia: { disconnect: true },
          draftRevision: { increment: 1 },
        },
        mockTx,
      );
      expect(result.coverMediaId).toBeNull();
    });
  });

  // ── deleteEligibleDraft ───────────────────────────────────────────────────

  describe('deleteEligibleDraft', () => {
    let mockTx: {
      findArticleForUpdate: ReturnType<typeof vi.fn>;
      countSnapshots: ReturnType<typeof vi.fn>;
      deleteArticle: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockTx = {
        findArticleForUpdate: vi.fn(),
        countSnapshots: vi.fn(),
        deleteArticle: vi.fn(),
      };
      (repositoryMock as any).transaction = vi.fn().mockImplementation((cb) => cb(mockTx));
      (repositoryMock as any).findArticleForUpdate = mockTx.findArticleForUpdate;
      (repositoryMock as any).countSnapshots = mockTx.countSnapshots;
      (repositoryMock as any).deleteArticle = mockTx.deleteArticle;
    });

    it('rejects ineligible accounts with Forbidden/Unauthorized', async () => {
      await expect(
        service.deleteEligibleDraft(UNVERIFIED_USER, MOCK_ARTICLE.id, { expectedRevision: 1 }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.deleteEligibleDraft(SUSPENDED_USER, MOCK_ARTICLE.id, { expectedRevision: 1 }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when expectedRevision is missing or invalid', async () => {
      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, undefined as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, {} as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: 0 }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: -1 }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: 1.5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 NotFoundException if article does not exist or belongs to another author', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(null);

      await expect(
        service.deleteEligibleDraft(VALID_USER, 'missing-id', { expectedRevision: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 ConflictException when expectedRevision does not match current revision', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 3,
      });

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 2, // Stale!
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('throws 409 ConflictException if article status is PUBLISHED or ARCHIVED', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        status: ArticleStatus.PUBLISHED,
      });
      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Only unpublished drafts with no publication history may be deleted');

      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        status: ArticleStatus.ARCHIVED,
      });
      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Only unpublished drafts with no publication history may be deleted');
    });

    it('throws 409 ConflictException if article has an active currentSnapshotId', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        currentSnapshotId: 's1111111-0000-4000-8000-000000000001',
      });

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Cannot delete an article with historical snapshots or an active snapshot reference');
    });

    it('throws 409 ConflictException if article has historical snapshots', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue(MOCK_ARTICLE);
      mockTx.countSnapshots.mockResolvedValue(2);

      await expect(
        service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Cannot delete an article that has published history');
    });

    it('successfully deletes an eligible draft with matching expectedRevision', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 3,
      });
      mockTx.countSnapshots.mockResolvedValue(0);
      mockTx.deleteArticle.mockResolvedValue(undefined);

      await service.deleteEligibleDraft(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 3,
      });

      expect(mockTx.findArticleForUpdate).toHaveBeenCalledWith(
        MOCK_ARTICLE.id,
        VALID_USER.id,
        mockTx,
      );
      expect(mockTx.countSnapshots).toHaveBeenCalledWith(MOCK_ARTICLE.id, mockTx);
      expect(mockTx.deleteArticle).toHaveBeenCalledWith(MOCK_ARTICLE.id, mockTx);
    });
  });

  // ── Taxonomy Assignment & Validation (Checkpoint C-2) ────────────────────

  describe('Taxonomy Assignment and Validation (Checkpoint C-2)', () => {
    const validCategoryId = 'c1111111-0000-4000-8000-000000000001';
    const validTagId1 = 't1111111-0000-4000-8000-000000000001';
    const validTagId2 = 't2222222-0000-4000-8000-000000000002';

    let mockTx: {
      findArticleForUpdate: ReturnType<typeof vi.fn>;
      updateArticle: ReturnType<typeof vi.fn>;
      findMediaAsset: ReturnType<typeof vi.fn>;
      findCategoryById: ReturnType<typeof vi.fn>;
      findTagsByIds: ReturnType<typeof vi.fn>;
      findArticleTagIds: ReturnType<typeof vi.fn>;
      replaceArticleTags: ReturnType<typeof vi.fn>;
      findPrivateById: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockTx = {
        findArticleForUpdate: vi.fn(),
        updateArticle: vi.fn(),
        findMediaAsset: vi.fn(),
        findCategoryById: vi.fn(),
        findTagsByIds: vi.fn(),
        findArticleTagIds: vi.fn().mockResolvedValue([]),
        replaceArticleTags: vi.fn().mockResolvedValue(undefined),
        findPrivateById: vi.fn(),
      };
      (repositoryMock as any).transaction = vi.fn().mockImplementation((cb) => cb(mockTx));
      (repositoryMock as any).findArticleForUpdate = mockTx.findArticleForUpdate;
      (repositoryMock as any).updateArticle = mockTx.updateArticle;
      (repositoryMock as any).findMediaAsset = mockTx.findMediaAsset;
      (repositoryMock as any).findCategoryById = mockTx.findCategoryById;
      (repositoryMock as any).findTagsByIds = mockTx.findTagsByIds;
      (repositoryMock as any).findArticleTagIds = mockTx.findArticleTagIds;
      (repositoryMock as any).replaceArticleTags = mockTx.replaceArticleTags;
      (repositoryMock as any).findPrivateById = mockTx.findPrivateById;
    });

    it('creates an article draft with Category and multiple Tags', async () => {
      repositoryMock.findCategoryById = vi.fn().mockResolvedValue({ id: validCategoryId, name: 'Architecture' });
      repositoryMock.findTagsByIds = vi.fn().mockResolvedValue([
        { id: validTagId1, slug: 'nestjs', name: 'NestJS' },
        { id: validTagId2, slug: 'postgres', name: 'PostgreSQL' },
      ]);
      repositoryMock.create.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: validCategoryId,
        tags: [
          { articleId: MOCK_ARTICLE.id, tagId: validTagId1, tag: { slug: 'nestjs' } },
          { articleId: MOCK_ARTICLE.id, tagId: validTagId2, tag: { slug: 'postgres' } },
        ],
      });

      const result = await service.createDraft(VALID_USER, {
        title: 'Taxonomy Article',
        draftSlug: 'taxonomy-article',
        categoryId: validCategoryId,
        tagIds: [validTagId1, validTagId2],
      });

      expect(repositoryMock.findCategoryById).toHaveBeenCalledWith(validCategoryId);
      expect(repositoryMock.findTagsByIds).toHaveBeenCalledWith([validTagId1, validTagId2]);
      expect(repositoryMock.create).toHaveBeenCalledWith({
        authorId: VALID_USER.id,
        title: 'Taxonomy Article',
        draftSlug: 'taxonomy-article',
        summary: undefined,
        typographyPreset: undefined,
        coverMediaId: undefined,
        categoryId: validCategoryId,
        tagIds: [validTagId1, validTagId2],
      });
      expect(result.categoryId).toBe(validCategoryId);
      expect(result.tagIds).toEqual([validTagId1, validTagId2]);
    });

    it('rejects creation when Category does not exist with BadRequestException', async () => {
      repositoryMock.findCategoryById = vi.fn().mockResolvedValue(null);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Taxonomy Article',
          draftSlug: 'taxonomy-article',
          categoryId: 'missing-category-id',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects creation when one or more Tags do not exist with BadRequestException', async () => {
      repositoryMock.findTagsByIds = vi.fn().mockResolvedValue([{ id: validTagId1, slug: 'nestjs' }]);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Taxonomy Article',
          draftSlug: 'taxonomy-article',
          tagIds: [validTagId1, 'missing-tag-id'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces Category and replaces Tag set on draft update with revision increment', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: 'old-category-id',
        draftRevision: 3,
      });
      mockTx.findArticleTagIds.mockResolvedValue(['old-tag-id']);
      mockTx.findCategoryById.mockResolvedValue({ id: validCategoryId });
      mockTx.findTagsByIds.mockResolvedValue([
        { id: validTagId1, slug: 'nestjs' },
        { id: validTagId2, slug: 'postgres' },
      ]);
      mockTx.updateArticle.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: validCategoryId,
        draftRevision: 4,
      });

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 3,
        categoryId: validCategoryId,
        tagIds: [validTagId1, validTagId2],
      });

      expect(mockTx.findCategoryById).toHaveBeenCalledWith(validCategoryId, mockTx);
      expect(mockTx.findTagsByIds).toHaveBeenCalledWith([validTagId1, validTagId2], mockTx);
      expect(mockTx.replaceArticleTags).toHaveBeenCalledWith(
        MOCK_ARTICLE.id,
        [validTagId1, validTagId2],
        mockTx,
      );
      expect(result.categoryId).toBe(validCategoryId);
      expect(result.tagIds).toEqual([validTagId1, validTagId2]);
      expect(result.draftRevision).toBe(4);
    });

    it('explicitly clears Category when categoryId is null and increments revision', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: 'old-category-id',
        draftRevision: 2,
      });
      mockTx.findArticleTagIds.mockResolvedValue([]);
      mockTx.updateArticle.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: null,
        draftRevision: 3,
      });

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 2,
        categoryId: null,
      });

      expect(result.categoryId).toBeNull();
      expect(result.draftRevision).toBe(3);
    });

    it('explicitly clears all Tags when tagIds is empty array [] and increments revision', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 2,
      });
      mockTx.findArticleTagIds.mockResolvedValue([validTagId1]);
      mockTx.updateArticle.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 3,
      });

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 2,
        tagIds: [],
      });

      expect(mockTx.replaceArticleTags).toHaveBeenCalledWith(MOCK_ARTICLE.id, [], mockTx);
      expect(result.tagIds).toEqual([]);
      expect(result.draftRevision).toBe(3);
    });

    it('preserves Category and Tags when taxonomy fields are omitted in draft update', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        title: 'Original Title',
        categoryId: validCategoryId,
        draftRevision: 1,
      });
      mockTx.findPrivateById.mockResolvedValue({
        ...MOCK_ARTICLE,
        title: 'Updated Title Only',
        categoryId: validCategoryId,
        draftRevision: 2,
        tags: [{ tagId: validTagId1, tag: { slug: 'nestjs' } }],
      });
      mockTx.updateArticle.mockResolvedValue({
        ...MOCK_ARTICLE,
        title: 'Updated Title Only',
        categoryId: validCategoryId,
        draftRevision: 2,
      });

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 1,
        title: 'Updated Title Only',
      });

      expect(mockTx.replaceArticleTags).not.toHaveBeenCalled();
      expect(result.title).toBe('Updated Title Only');
      expect(result.categoryId).toBe(validCategoryId);
      expect(result.tagIds).toEqual([validTagId1]);
      expect(result.draftRevision).toBe(2);
    });

    it('detects taxonomy no-op and returns article without incrementing revision', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: validCategoryId,
        draftRevision: 5,
      });
      mockTx.findCategoryById.mockResolvedValue({ id: validCategoryId, slug: 'backend' });
      mockTx.findTagsByIds.mockResolvedValue([{ id: validTagId1, slug: 'nestjs' }]);
      mockTx.findArticleTagIds.mockResolvedValue([validTagId1]);
      mockTx.findPrivateById.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: validCategoryId,
        draftRevision: 5,
        tags: [{ tagId: validTagId1, tag: { slug: 'nestjs' } }],
      });

      const result = await service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
        expectedRevision: 5,
        categoryId: validCategoryId,
        tagIds: [validTagId1],
      });

      expect(mockTx.updateArticle).not.toHaveBeenCalled();
      expect(mockTx.replaceArticleTags).not.toHaveBeenCalled();
      expect(result.draftRevision).toBe(5);
      expect(result.categoryId).toBe(validCategoryId);
      expect(result.tagIds).toEqual([validTagId1]);
    });

    it('maps Prisma P2003 on category to BadRequestException during creation race', async () => {
      repositoryMock.findCategoryById = vi.fn().mockResolvedValue({ id: validCategoryId });
      const p2003Category = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: '6.19.3',
        meta: { field_name: 'articles_category_id_fkey' },
      });
      repositoryMock.create.mockRejectedValue(p2003Category);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Race Article',
          draftSlug: 'race-article',
          categoryId: validCategoryId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps Prisma P2003 on tag to BadRequestException during creation race', async () => {
      repositoryMock.findTagsByIds = vi.fn().mockResolvedValue([{ id: validTagId1, slug: 'nestjs' }]);
      const p2003Tag = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: '6.19.3',
        meta: { field_name: 'article_tags_tag_id_fkey' },
      });
      repositoryMock.create.mockRejectedValue(p2003Tag);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Race Article',
          draftSlug: 'race-article',
          tagIds: [validTagId1],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps Prisma P2002 to ConflictException during creation slug collision', async () => {
      const p2002Slug = new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['draft_slug'] },
      });
      repositoryMock.create.mockRejectedValue(p2002Slug);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Collision Article',
          draftSlug: 'collision-article',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates unexpected database error during creation without misclassifying', async () => {
      const dbError = new Error('Database connection terminated unexpectedly');
      repositoryMock.create.mockRejectedValue(dbError);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Crash Article',
          draftSlug: 'crash-article',
        }),
      ).rejects.toThrow('Database connection terminated unexpectedly');
    });

    it('maps Prisma P2003 on category to BadRequestException during draft update race', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        categoryId: 'old-category-id',
        draftRevision: 1,
      });
      mockTx.findCategoryById.mockResolvedValue({ id: validCategoryId });
      const p2003Category = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: '6.19.3',
        meta: { field_name: 'articles_category_id_fkey' },
      });
      mockTx.updateArticle.mockRejectedValue(p2003Category);

      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          categoryId: validCategoryId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps Prisma P2003 on tag to BadRequestException during draft update race', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 1,
      });
      mockTx.findTagsByIds.mockResolvedValue([{ id: validTagId1, slug: 'nestjs' }]);
      mockTx.updateArticle.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 2,
      });
      const p2003Tag = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: '6.19.3',
        meta: { field_name: 'article_tags_tag_id_fkey' },
      });
      mockTx.replaceArticleTags.mockRejectedValue(p2003Tag);

      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          tagIds: [validTagId1],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps Prisma P2025 on category nested connect to BadRequestException during update', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 1,
      });
      mockTx.findCategoryById.mockResolvedValue({ id: validCategoryId });
      const p2025Cat = new Prisma.PrismaClientKnownRequestError('Record required but not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
        meta: { cause: "No 'Category' record(s) was found for a nested connect on ArticleToCategory" },
      });
      mockTx.updateArticle.mockRejectedValue(p2025Cat);

      const err = await service
        .updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          categoryId: validCategoryId,
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe('Category not found.');
    });

    it('maps Prisma P2003 with unrelated constraint to generic entity not found error without leaking', async () => {
      const p2003Unrelated = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: '6.19.3',
        meta: { constraint: 'unrelated_foreign_key_fkey' },
      });
      repositoryMock.create.mockRejectedValue(p2003Unrelated);

      const err = await service
        .createDraft(VALID_USER, {
          title: 'Unrelated FK Article',
          draftSlug: 'unrelated-fk-article',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe('Referenced entity not found.');
    });

    it('rethrows P2025 unrelated to taxonomy without fabricating taxonomy validation error', async () => {
      mockTx.findArticleForUpdate.mockResolvedValue({
        ...MOCK_ARTICLE,
        draftRevision: 1,
      });
      const p2025Unrelated = new Prisma.PrismaClientKnownRequestError('Unrelated record not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
        meta: { cause: 'Some other record not found' },
      });
      mockTx.updateArticle.mockRejectedValue(p2025Unrelated);

      await expect(
        service.updateDraftMetadata(VALID_USER, MOCK_ARTICLE.id, {
          expectedRevision: 1,
          title: 'New Title',
        }),
      ).rejects.toThrow(p2025Unrelated);
    });

    it('does not misclassify an error containing word tag in an unrelated message', async () => {
      const unrelatedError = new Error('Failed to parse html tag in content parser');
      repositoryMock.create.mockRejectedValue(unrelatedError);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Parser Error Article',
          draftSlug: 'parser-error-article',
        }),
      ).rejects.toThrow('Failed to parse html tag in content parser');
    });

    it('does not misclassify an error containing word category in an unrelated message', async () => {
      const unrelatedError = new Error('Log category disk_io failed');
      repositoryMock.create.mockRejectedValue(unrelatedError);

      await expect(
        service.createDraft(VALID_USER, {
          title: 'Disk IO Article',
          draftSlug: 'disk-io-article',
        }),
      ).rejects.toThrow('Log category disk_io failed');
    });
  });

  describe('duplicateArticle', () => {
    it('rejects unverified users with ForbiddenException', async () => {
      await expect(
        service.duplicateArticle(UNVERIFIED_USER, MOCK_ARTICLE.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if source article does not exist or belongs to another user', async () => {
      repositoryMock.findPrivateById.mockResolvedValue(null);

      await expect(
        service.duplicateArticle(VALID_USER, 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('atomically duplicates article with (Copy) title and unique slug', async () => {
      const sourceArticle = {
        ...MOCK_ARTICLE,
        blocks: [
          {
            id: 'b1111111-0000-4000-8000-000000000001',
            articleId: MOCK_ARTICLE.id,
            type: 'RICH_TEXT',
            position: 1000,
            content: { html: '<p>Content</p>' },
            mediaAssetId: null,
            schemaVersion: 1,
            createdAt: MOCK_DATE,
            updatedAt: MOCK_DATE,
          },
        ],
        tags: [],
      };
      repositoryMock.findPrivateById.mockResolvedValue(sourceArticle);
      repositoryMock.checkDraftSlugExists.mockResolvedValue(false);

      const duplicatedResult = {
        ...sourceArticle,
        id: 'dup-0001-4000-8000-000000000001',
        title: 'Relational Database Design (Copy)',
        draftSlug: 'relational-database-design-copy',
        status: ArticleStatus.DRAFT,
        draftRevision: 1,
        publishedRevision: 0,
        publishedSlug: null,
        currentSnapshotId: null,
        publishedAt: null,
      };
      repositoryMock.duplicateArticle.mockResolvedValue(duplicatedResult);

      const result = await service.duplicateArticle(VALID_USER, MOCK_ARTICLE.id);

      expect(repositoryMock.checkDraftSlugExists).toHaveBeenCalledWith(
        'relational-database-design-copy',
        VALID_USER.id,
      );
      expect(repositoryMock.duplicateArticle).toHaveBeenCalledWith(
        MOCK_ARTICLE.id,
        VALID_USER.id,
        'Relational Database Design (Copy)',
        'relational-database-design-copy',
      );
      expect(result.id).toBe('dup-0001-4000-8000-000000000001');
      expect(result.status).toBe(ArticleStatus.DRAFT);
      expect(result.blocks).toHaveLength(1);
    });

    it('handles slug collisions by appending a counter', async () => {
      const sourceArticle = {
        ...MOCK_ARTICLE,
        blocks: [],
        tags: [],
      };
      repositoryMock.findPrivateById.mockResolvedValue(sourceArticle);
      // First candidate exists, second does not
      repositoryMock.checkDraftSlugExists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const duplicatedResult = {
        ...sourceArticle,
        id: 'dup-0002-4000-8000-000000000001',
        title: 'Relational Database Design (Copy)',
        draftSlug: 'relational-database-design-copy-2',
        status: ArticleStatus.DRAFT,
      };
      repositoryMock.duplicateArticle.mockResolvedValue(duplicatedResult);

      const result = await service.duplicateArticle(VALID_USER, MOCK_ARTICLE.id);

      expect(repositoryMock.checkDraftSlugExists).toHaveBeenNthCalledWith(
        1,
        'relational-database-design-copy',
        VALID_USER.id,
      );
      expect(repositoryMock.checkDraftSlugExists).toHaveBeenNthCalledWith(
        2,
        'relational-database-design-copy-2',
        VALID_USER.id,
      );
      expect(result.draftSlug).toBe('relational-database-design-copy-2');
    });
  });
});

