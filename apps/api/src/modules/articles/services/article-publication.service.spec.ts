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
});
