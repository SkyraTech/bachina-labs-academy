import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  ArticleBlockType,
  ArticleStatus,
  UserRole,
  UserStatus,
  Prisma,
} from '@prisma/client';
import { ArticlePublicationService } from './article-publication.service.js';
import { ArticlePublicationRepository } from '../repositories/article-publication.repository.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticlePublicationService', () => {
  let service: ArticlePublicationService;
  let repositoryMock: {
    transaction: ReturnType<typeof vi.fn>;
    findArticleForUpdate: ReturnType<typeof vi.fn>;
    findBlocksForArticle: ReturnType<typeof vi.fn>;
    findMediaAsset: ReturnType<typeof vi.fn>;
    captureDraftTaxonomy: ReturnType<typeof vi.fn>;
    createSnapshot: ReturnType<typeof vi.fn>;
    createSnapshotMediaRetention: ReturnType<typeof vi.fn>;
    updateArticlePublished: ReturnType<typeof vi.fn>;
  };

  const AUTHOR_ID = 'u1111111-0000-4000-8000-000000000001';
  const OTHER_USER_ID = 'u2222222-0000-4000-8000-000000000002';
  const ARTICLE_ID = 'a1111111-0000-4000-8000-000000000001';
  const MEDIA_COVER_ID = 'm1111111-0000-4000-8000-000000000001';
  const MEDIA_BLOCK_ID = 'm2222222-0000-4000-8000-000000000002';
  const SNAPSHOT_ID = 's1111111-0000-4000-8000-000000000001';

  const VALID_AUTHOR: AuthenticatedUser = {
    id: AUTHOR_ID,
    email: 'author@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 'sess-1',
  };

  const VALID_ARTICLE_DRAFT = {
    id: ARTICLE_ID,
    authorId: AUTHOR_ID,
    title: 'Relational Database Concurrency',
    draftSlug: 'relational-database-concurrency',
    publishedSlug: null,
    summary: 'A deep dive into ACID transactions.',
    status: ArticleStatus.DRAFT,
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 8,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: new Date('2026-10-25T10:00:00Z'),
    updatedAt: new Date('2026-10-25T10:00:00Z'),
    publishedAt: null,
  };

  const VALID_HEADING_BLOCK = {
    id: 'b1111111-0000-4000-8000-000000000001',
    articleId: ARTICLE_ID,
    type: ArticleBlockType.HEADING,
    position: 0,
    schemaVersion: 1,
    content: { text: 'Introduction to PostgreSQL', level: 2 },
    mediaAssetId: null,
    createdAt: new Date('2026-10-25T10:00:00Z'),
    updatedAt: new Date('2026-10-25T10:00:00Z'),
  };

  const VALID_PARAGRAPH_BLOCK = {
    id: 'b2222222-0000-4000-8000-000000000002',
    articleId: ARTICLE_ID,
    type: ArticleBlockType.RICH_TEXT,
    position: 1,
    schemaVersion: 1,
    content: { html: '<p>PostgreSQL provides robust transactional integrity.</p>' },
    mediaAssetId: null,
    createdAt: new Date('2026-10-25T10:00:00Z'),
    updatedAt: new Date('2026-10-25T10:00:00Z'),
  };

  beforeEach(() => {
    repositoryMock = {
      transaction: vi.fn(async (cb) => cb({} as any)),
      findArticleForUpdate: vi.fn(),
      findBlocksForArticle: vi.fn(),
      findMediaAsset: vi.fn(),
      captureDraftTaxonomy: vi.fn().mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: [],
      }),
      createSnapshot: vi.fn(),
      createSnapshotMediaRetention: vi.fn(),
      updateArticlePublished: vi.fn(),
    };

    service = new ArticlePublicationService(
      repositoryMock as unknown as ArticlePublicationRepository,
    );
  });

  describe('Authorization and ownership', () => {
    it('rejects publication when user account is not active with UnauthorizedException', async () => {
      const suspendedUser: AuthenticatedUser = {
        ...VALID_AUTHOR,
        status: UserStatus.SUSPENDED,
      };

      await expect(
        service.publishArticle(suspendedUser, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow('Account is not active.');
    });

    it('rejects publication when user email is not verified with ForbiddenException', async () => {
      const unverifiedUser: AuthenticatedUser = {
        ...VALID_AUTHOR,
        emailVerifiedAt: null,
      };

      await expect(
        service.publishArticle(unverifiedUser, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow('Email verification required.');
    });

    it('returns 404 when article does not exist', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(null);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 when article belongs to another author (private masking)', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(null);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Lifecycle and revision concurrency checks', () => {
    it('rejects publication of an ARCHIVED article with 409 Conflict', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue({
        ...VALID_ARTICLE_DRAFT,
        status: ArticleStatus.ARCHIVED,
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects publication when expectedRevision does not match current draftRevision', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 7 }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects republishing when no unpublished draft changes exist (draftRevision === publishedRevision)', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue({
        ...VALID_ARTICLE_DRAFT,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 8,
        publishedRevision: 8,
        publishedSlug: 'relational-database-concurrency',
        publishedAt: new Date('2026-10-25T11:00:00Z'),
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(new ConflictException('No unpublished draft changes to publish.'));
    });
  });

  describe('Content publishability validation', () => {
    it('rejects publication of an article with zero blocks', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([]);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(
        new BadRequestException('Article must contain at least one content block to be published.'),
      );
    });

    it('rejects publication of an article containing only DIVIDER blocks', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([
        {
          id: 'b3333333-0000-4000-8000-000000000003',
          articleId: ARTICLE_ID,
          type: ArticleBlockType.DIVIDER,
          position: 0,
          schemaVersion: 1,
          content: {},
          mediaAssetId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(
        new BadRequestException('Article must contain at least one non-divider content block to be published.'),
      );
    });

    it('revalidates content blocks and rejects corrupt content', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([
        {
          id: 'b1111111-0000-4000-8000-000000000001',
          articleId: ARTICLE_ID,
          type: ArticleBlockType.HEADING,
          position: 0,
          schemaVersion: 1,
          content: { text: '', level: 2 }, // invalid empty text
          mediaAssetId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Media retention and ownership validation', () => {
    it('rejects publication if cover media does not exist', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue({
        ...VALID_ARTICLE_DRAFT,
        coverMediaId: MEDIA_COVER_ID,
      });
      repositoryMock.findBlocksForArticle.mockResolvedValue([VALID_HEADING_BLOCK]);
      repositoryMock.findMediaAsset.mockResolvedValue(null);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(new BadRequestException('Cover media asset not found.'));
    });

    it('rejects publication if cover media is owned by another user', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue({
        ...VALID_ARTICLE_DRAFT,
        coverMediaId: MEDIA_COVER_ID,
      });
      repositoryMock.findBlocksForArticle.mockResolvedValue([VALID_HEADING_BLOCK]);
      repositoryMock.findMediaAsset.mockResolvedValue({
        id: MEDIA_COVER_ID,
        uploaderId: OTHER_USER_ID,
        mediaType: 'IMAGE',
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects publication if IMAGE block references missing media', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([
        {
          id: 'b4444444-0000-4000-8000-000000000004',
          articleId: ARTICLE_ID,
          type: ArticleBlockType.IMAGE,
          position: 0,
          schemaVersion: 1,
          content: { caption: 'Architecture diagram' },
          mediaAssetId: MEDIA_BLOCK_ID,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      repositoryMock.findMediaAsset.mockResolvedValue(null);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(new BadRequestException('Referenced media asset not found.'));
    });

    it('rejects publication if IMAGE block references foreign media', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([
        {
          id: 'b4444444-0000-4000-8000-000000000004',
          articleId: ARTICLE_ID,
          type: ArticleBlockType.IMAGE,
          position: 0,
          schemaVersion: 1,
          content: { caption: 'Architecture diagram' },
          mediaAssetId: MEDIA_BLOCK_ID,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      repositoryMock.findMediaAsset.mockResolvedValue({
        id: MEDIA_BLOCK_ID,
        uploaderId: OTHER_USER_ID,
        mediaType: 'IMAGE',
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deduplicates cover media and image block media references', async () => {
      // Cover media and block media refer to the same media asset
      repositoryMock.findArticleForUpdate.mockResolvedValue({
        ...VALID_ARTICLE_DRAFT,
        coverMediaId: MEDIA_COVER_ID,
      });
      repositoryMock.findBlocksForArticle.mockResolvedValue([
        {
          id: 'b4444444-0000-4000-8000-000000000004',
          articleId: ARTICLE_ID,
          type: ArticleBlockType.IMAGE,
          position: 0,
          schemaVersion: 1,
          content: { caption: 'Cover illustration reused' },
          mediaAssetId: MEDIA_COVER_ID,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      repositoryMock.findMediaAsset.mockResolvedValue({
        id: MEDIA_COVER_ID,
        uploaderId: AUTHOR_ID,
        mediaType: 'IMAGE',
      });

      repositoryMock.createSnapshot.mockResolvedValue({
        id: SNAPSHOT_ID,
        articleId: ARTICLE_ID,
        snapshotRevision: 8,
      });

      repositoryMock.updateArticlePublished.mockResolvedValue({
        id: ARTICLE_ID,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 8,
        publishedRevision: 8,
        publishedSlug: 'relational-database-concurrency',
        currentSnapshotId: SNAPSHOT_ID,
        publishedAt: new Date('2026-10-25T12:00:00Z'),
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      // Exactly 1 retention record should be created, not 2
      expect(repositoryMock.createSnapshotMediaRetention).toHaveBeenCalledWith(
        [{ snapshotId: SNAPSHOT_ID, mediaAssetId: MEDIA_COVER_ID }],
        expect.anything(),
      );
    });
  });

  describe('Initial publication success', () => {
    it('successfully publishes eligible DRAFT, creates snapshot, and updates article state', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([
        VALID_HEADING_BLOCK,
        VALID_PARAGRAPH_BLOCK,
      ]);

      repositoryMock.createSnapshot.mockResolvedValue({
        id: SNAPSHOT_ID,
        articleId: ARTICLE_ID,
        snapshotRevision: 8,
        title: VALID_ARTICLE_DRAFT.title,
        publishedSlug: VALID_ARTICLE_DRAFT.draftSlug,
        summary: VALID_ARTICLE_DRAFT.summary,
        typographyPreset: VALID_ARTICLE_DRAFT.typographyPreset,
        coverMediaId: null,
      });

      const publicationDate = new Date('2026-10-25T12:00:00Z');
      repositoryMock.updateArticlePublished.mockResolvedValue({
        id: ARTICLE_ID,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 8,
        publishedRevision: 8,
        publishedSlug: VALID_ARTICLE_DRAFT.draftSlug,
        currentSnapshotId: SNAPSHOT_ID,
        publishedAt: publicationDate,
      });

      const response = await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, {
        expectedRevision: 8,
      });

      expect(response).toEqual({
        articleId: ARTICLE_ID,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 8,
        publishedRevision: 8,
        publishedSlug: 'relational-database-concurrency',
        currentSnapshotId: SNAPSHOT_ID,
        publishedAt: publicationDate.toISOString(),
      });

      // Assert snapshot blocks payload structure
      expect(repositoryMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          articleId: ARTICLE_ID,
          snapshotRevision: 8,
          title: 'Relational Database Concurrency',
          publishedSlug: 'relational-database-concurrency',
          blocks: {
            schemaVersion: 1,
            blocks: [
              {
                id: VALID_HEADING_BLOCK.id,
                type: ArticleBlockType.HEADING,
                position: 0,
                schemaVersion: 1,
                content: { text: 'Introduction to PostgreSQL', level: 2 },
                mediaAssetId: null,
              },
              {
                id: VALID_PARAGRAPH_BLOCK.id,
                type: ArticleBlockType.RICH_TEXT,
                position: 1,
                schemaVersion: 1,
                content: { html: '<p>PostgreSQL provides robust transactional integrity.</p>' },
                mediaAssetId: null,
              },
            ],
          },
        }),
        expect.anything(),
      );
    });
  });

  describe('Republishing and timestamp policy', () => {
    it('advances publishedRevision to new draftRevision and preserves initial publishedAt', async () => {
      const initialPublishedAt = new Date('2026-10-20T10:00:00Z');
      const publishedArticleWithNewDraftRevision = {
        ...VALID_ARTICLE_DRAFT,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 9,
        publishedRevision: 8,
        publishedSlug: 'relational-database-concurrency',
        publishedAt: initialPublishedAt,
      };

      repositoryMock.findArticleForUpdate.mockResolvedValue(
        publishedArticleWithNewDraftRevision,
      );
      repositoryMock.findBlocksForArticle.mockResolvedValue([VALID_HEADING_BLOCK]);

      const secondSnapshotId = 's2222222-0000-4000-8000-000000000002';
      repositoryMock.createSnapshot.mockResolvedValue({
        id: secondSnapshotId,
        articleId: ARTICLE_ID,
        snapshotRevision: 9,
      });

      repositoryMock.updateArticlePublished.mockResolvedValue({
        id: ARTICLE_ID,
        status: ArticleStatus.PUBLISHED,
        draftRevision: 9,
        publishedRevision: 9,
        publishedSlug: 'relational-database-concurrency',
        currentSnapshotId: secondSnapshotId,
        publishedAt: initialPublishedAt,
      });

      const response = await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, {
        expectedRevision: 9,
      });

      expect(response.draftRevision).toBe(9);
      expect(response.publishedRevision).toBe(9);
      expect(response.currentSnapshotId).toBe(secondSnapshotId);
      expect(response.publishedAt).toBe(initialPublishedAt.toISOString());

      // Confirm updateArticlePublished was called with initialPublishedAt preserved
      expect(repositoryMock.updateArticlePublished).toHaveBeenCalledWith(
        ARTICLE_ID,
        expect.objectContaining({
          publishedRevision: 9,
          currentSnapshotId: secondSnapshotId,
          publishedAt: initialPublishedAt,
        }),
        expect.anything(),
      );
    });
  });

  describe('Database constraint error mappings', () => {
    it('maps unique published_slug collision to 409 Conflict', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([VALID_HEADING_BLOCK]);

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on published_slug',
        {
          code: 'P2002',
          clientVersion: '6.19.3',
          meta: { target: ['published_slug'] },
        },
      );

      repositoryMock.createSnapshot.mockResolvedValue({ id: SNAPSHOT_ID });
      repositoryMock.updateArticlePublished.mockRejectedValue(p2002Error);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(
        new ConflictException('A published article with this slug already exists.'),
      );
    });

    it('maps unique snapshot_revision collision to 409 Conflict', async () => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([VALID_HEADING_BLOCK]);

      const p2002SnapshotError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on snapshot_revision',
        {
          code: 'P2002',
          clientVersion: '6.19.3',
          meta: { target: ['article_id', 'snapshot_revision'] },
        },
      );

      repositoryMock.createSnapshot.mockRejectedValue(p2002SnapshotError);

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(
        new ConflictException('A snapshot for this revision has already been published.'),
      );
    });
  });

  describe('Taxonomy capture during publication', () => {
    const CATEGORY_ID = 'c1111111-0000-4000-8000-000000000001';
    const TAG_1_ID = 'b1111111-0000-4000-8000-000000000001';
    const TAG_2_ID = 'b2222222-0000-4000-8000-000000000002';

    beforeEach(() => {
      repositoryMock.findArticleForUpdate.mockResolvedValue(VALID_ARTICLE_DRAFT);
      repositoryMock.findBlocksForArticle.mockResolvedValue([VALID_HEADING_BLOCK]);
      repositoryMock.createSnapshot.mockResolvedValue({ id: SNAPSHOT_ID });
      repositoryMock.updateArticlePublished.mockResolvedValue({
        ...VALID_ARTICLE_DRAFT,
        status: ArticleStatus.PUBLISHED,
        publishedSlug: VALID_ARTICLE_DRAFT.draftSlug,
        publishedRevision: 8,
        currentSnapshotId: SNAPSHOT_ID,
        publishedAt: new Date(),
      });
    });

    it('captures explicitly empty taxonomy when article has no Category or Tags', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: [],
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [],
          },
        }),
        expect.anything(),
      );
    });

    it('captures Category only with empty tags', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: CATEGORY_ID,
        categoryId: CATEGORY_ID,
        categoryName: 'Backend Engineering',
        categorySlug: 'backend-engineering',
        tagsJson: [],
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          taxonomy: {
            schemaVersion: 1,
            category: {
              id: CATEGORY_ID,
              name: 'Backend Engineering',
              slug: 'backend-engineering',
            },
            tags: [],
          },
        }),
        expect.anything(),
      );
    });

    it('captures Tags only with null category', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: [
          { id: TAG_1_ID, name: 'PostgreSQL', slug: 'postgresql' },
        ],
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [
              { id: TAG_1_ID, name: 'PostgreSQL', slug: 'postgresql' },
            ],
          },
        }),
        expect.anything(),
      );
    });

    it('captures both Category and Tags', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: CATEGORY_ID,
        categoryId: CATEGORY_ID,
        categoryName: 'Cloud Native',
        categorySlug: 'cloud-native',
        tagsJson: [
          { id: TAG_1_ID, name: 'Docker', slug: 'docker' },
          { id: TAG_2_ID, name: 'Kubernetes', slug: 'kubernetes' },
        ],
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          taxonomy: {
            schemaVersion: 1,
            category: {
              id: CATEGORY_ID,
              name: 'Cloud Native',
              slug: 'cloud-native',
            },
            tags: [
              { id: TAG_1_ID, name: 'Docker', slug: 'docker' },
              { id: TAG_2_ID, name: 'Kubernetes', slug: 'kubernetes' },
            ],
          },
        }),
        expect.anything(),
      );
    });

    it('enforces deterministic tag ordering by slug ascending then id ascending', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: [
          { id: TAG_2_ID, name: 'Zebra', slug: 'zebra' },
          { id: TAG_1_ID, name: 'Alpha', slug: 'alpha' },
        ],
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [
              { id: TAG_1_ID, name: 'Alpha', slug: 'alpha' },
              { id: TAG_2_ID, name: 'Zebra', slug: 'zebra' },
            ],
          },
        }),
        expect.anything(),
      );
    });

    it('accepts up to exactly 20 tags', async () => {
      const twentyTags = Array.from({ length: 20 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `Tag ${i}`,
        slug: `tag-${i}`,
      }));

      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: twentyTags,
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.createSnapshot).toHaveBeenCalled();
    });

    it('rejects publication when tags exceed 20 with BadRequestException', async () => {
      const twentyOneTags = Array.from({ length: 21 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `Tag ${i}`,
        slug: `tag-${i}`,
      }));

      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: twentyOneTags,
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects publication if draft has categoryId but captured category is missing (409 Conflict)', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: CATEGORY_ID,
        categoryId: null, // Category deleted or missing concurrently
        categoryName: null,
        categorySlug: null,
        tagsJson: [],
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects publication on duplicate tag IDs with BadRequestException', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: [
          { id: TAG_1_ID, name: 'Tag One', slug: 'tag-one' },
          { id: TAG_1_ID, name: 'Tag One Dup', slug: 'tag-one-dup' },
        ],
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects publication on invalid category slug format with BadRequestException', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: CATEGORY_ID,
        categoryId: CATEGORY_ID,
        categoryName: 'Invalid Category',
        categorySlug: 'Invalid Slug!',
        tagsJson: [],
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects publication on invalid tag slug format with BadRequestException', async () => {
      repositoryMock.captureDraftTaxonomy.mockResolvedValue({
        draftCategoryId: null,
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        tagsJson: [
          { id: TAG_1_ID, name: 'Bad Tag', slug: 'Bad Slug!' },
        ],
      });

      await expect(
        service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('executes captureDraftTaxonomy within the active transaction', async () => {
      let passedTx: any = null;
      repositoryMock.transaction.mockImplementation(async (cb: any) => {
        const dummyTx = { dummy: true };
        passedTx = dummyTx;
        return cb(dummyTx);
      });

      repositoryMock.captureDraftTaxonomy.mockImplementation(async (_articleId: string, tx: any) => {
        expect(tx).toBe(passedTx);
        return {
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [],
        };
      });

      await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });

      expect(repositoryMock.captureDraftTaxonomy).toHaveBeenCalledWith(
        ARTICLE_ID,
        passedTx,
      );
    });

    describe('Taxonomy validation boundary limits', () => {
      it('rejects category name shorter than 2 characters (1 char)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'A',
          categorySlug: 'valid-cat',
          tagsJson: [],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts category name of minimum length (2 characters)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'AI',
          categorySlug: 'valid-cat',
          tagsJson: [],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('accepts category name of maximum length (120 characters)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'A'.repeat(120),
          categorySlug: 'valid-cat',
          tagsJson: [],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('rejects category name longer than 120 characters (121 chars)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'A'.repeat(121),
          categorySlug: 'valid-cat',
          tagsJson: [],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects category slug shorter than 2 characters (1 char)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'Valid Name',
          categorySlug: 'a',
          tagsJson: [],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts category slug of minimum length (2 characters)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'Valid Name',
          categorySlug: 'ai',
          tagsJson: [],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('accepts category slug of maximum length (160 characters)', async () => {
        const slug160 = 'a'.repeat(160);
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'Valid Name',
          categorySlug: slug160,
          tagsJson: [],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('rejects category slug longer than 160 characters (161 chars)', async () => {
        const slug161 = 'a'.repeat(161);
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: CATEGORY_ID,
          categoryId: CATEGORY_ID,
          categoryName: 'Valid Name',
          categorySlug: slug161,
          tagsJson: [],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects tag name shorter than 2 characters (1 char)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'T', slug: 'valid-tag' }],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts tag name of minimum length (2 characters)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'Go', slug: 'golang' }],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('accepts tag name of maximum length (80 characters)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'T'.repeat(80), slug: 'valid-tag' }],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('rejects tag name longer than 80 characters (81 chars)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'T'.repeat(81), slug: 'valid-tag' }],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects tag slug shorter than 2 characters (1 char)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'Tag One', slug: 't' }],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts tag slug of minimum length (2 characters)', async () => {
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'Tag One', slug: 'go' }],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('accepts tag slug of maximum length (120 characters)', async () => {
        const slug120 = 't'.repeat(120);
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'Tag One', slug: slug120 }],
        });
        await service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 });
        expect(repositoryMock.createSnapshot).toHaveBeenCalled();
      });

      it('rejects tag slug longer than 120 characters (121 chars)', async () => {
        const slug121 = 't'.repeat(121);
        repositoryMock.captureDraftTaxonomy.mockResolvedValue({
          draftCategoryId: null,
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          tagsJson: [{ id: TAG_1_ID, name: 'Tag One', slug: slug121 }],
        });
        await expect(
          service.publishArticle(VALID_AUTHOR, ARTICLE_ID, { expectedRevision: 8 }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('ArticlePublicationRepository createSnapshot runtime guard', () => {
      let realRepo: ArticlePublicationRepository;
      let txMock: {
        articleSnapshot: {
          create: ReturnType<typeof vi.fn>;
        };
      };

      beforeEach(() => {
        realRepo = new ArticlePublicationRepository({} as any);
        txMock = {
          articleSnapshot: {
            create: vi.fn().mockResolvedValue({ id: 'snapshot-id-real' }),
          },
        };
      });

      const baseSnapshotData = {
        articleId: ARTICLE_ID,
        snapshotRevision: 1,
        title: 'Title',
        publishedSlug: 'slug',
        typographyPreset: 'MODERN_SANS',
        blocks: { schemaVersion: 1, blocks: [] },
      };

      it('rejects snapshot creation if taxonomy property is omitted', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData } as any,
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is explicitly undefined', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: undefined as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is explicitly null', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: null as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is Prisma.JsonNull', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: Prisma.JsonNull as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is Prisma.DbNull', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: Prisma.DbNull as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is Prisma.AnyNull', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: Prisma.AnyNull as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is a scalar (string, number, boolean)', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: 'string-val' as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: 42 as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: true as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is an array', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: ['invalid'] as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is an empty object', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: {} as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy has missing or non-1 schemaVersion', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { category: null, tags: [] } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: null, category: null, tags: [] } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: 0, category: null, tags: [] } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: 2, category: null, tags: [] } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: '1', category: null, tags: [] } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is missing category property', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: 1, tags: [] } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects snapshot creation if taxonomy is missing tags property or tags is not an array', async () => {
        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: 1, category: null } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: 1, category: null, tags: null } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          realRepo.createSnapshot(
            { ...baseSnapshotData, taxonomy: { schemaVersion: 1, category: null, tags: 'not-array' } as any },
            txMock as any,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('creates snapshot successfully when structured empty taxonomy is provided', async () => {
        const emptyTaxonomy = {
          schemaVersion: 1,
          category: null,
          tags: [],
        };

        const result = await realRepo.createSnapshot(
          { ...baseSnapshotData, taxonomy: emptyTaxonomy },
          txMock as any,
        );

        expect(result).toEqual({ id: 'snapshot-id-real' });
        expect(txMock.articleSnapshot.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              taxonomy: emptyTaxonomy,
            }),
          }),
        );
      });

      it('creates snapshot successfully when valid populated schemaVersion 1 taxonomy is provided', async () => {
        const validTaxonomy = {
          schemaVersion: 1,
          category: { id: CATEGORY_ID, name: 'AI', slug: 'ai' },
          tags: [{ id: TAG_1_ID, name: 'ML', slug: 'ml' }],
        };

        const result = await realRepo.createSnapshot(
          { ...baseSnapshotData, taxonomy: validTaxonomy },
          txMock as any,
        );

        expect(result).toEqual({ id: 'snapshot-id-real' });
        expect(txMock.articleSnapshot.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              taxonomy: validTaxonomy,
            }),
          }),
        );
      });
    });
  });
});
