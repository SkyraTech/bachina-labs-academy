import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticlePublicationController } from './article-publication.controller.js';
import { ArticlePublicationService } from '../services/article-publication.service.js';
import { UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticlePublicationController', () => {
  let controller: ArticlePublicationController;
  let reflector: Reflector;
  let serviceMock: {
    publishArticle: ReturnType<typeof vi.fn>;
    archiveArticle: ReturnType<typeof vi.fn>;
    restoreArticle: ReturnType<typeof vi.fn>;
  };

  const VALID_USER: AuthenticatedUser = {
    id: 'u1111111-0000-4000-8000-000000000001',
    email: 'author@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 's1111111-0000-4000-8000-000000000001',
  };

  const MOCK_PUBLICATION_RESPONSE = {
    articleId: 'a1b2c3d4-1111-4000-8000-000000000001',
    status: ArticleStatus.PUBLISHED,
    draftRevision: 8,
    publishedRevision: 8,
    publishedSlug: 'introduction-to-postgresql',
    currentSnapshotId: 's1b2c3d4-1111-4000-8000-000000000001',
    publishedAt: '2026-10-25T12:00:00.000Z',
  };

  beforeEach(async () => {
    serviceMock = {
      publishArticle: vi.fn(),
      archiveArticle: vi.fn(),
      restoreArticle: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArticlePublicationController],
      providers: [
        Reflector,
        {
          provide: ArticlePublicationService,
          useValue: serviceMock,
        },
      ],
    }).compile();

    controller = module.get<ArticlePublicationController>(
      ArticlePublicationController,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  describe('metadata & authorization decorators', () => {
    const proto = ArticlePublicationController.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    it('requires AUTHOR and ADMIN roles', () => {
      for (const method of ['publishArticle', 'archiveArticle', 'restoreArticle']) {
        const roles = reflector.get<UserRole[]>(ROLES_KEY, proto[method]);
        expect(roles).toBeDefined();
        expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);
      }
    });

    it('attaches VerifiedEmailGuard', () => {
      for (const method of ['publishArticle', 'archiveArticle', 'restoreArticle']) {
        const guards = Reflect.getMetadata('__guards__', proto[method]);
        expect(guards).toBeDefined();
        expect(guards).toContain(VerifiedEmailGuard);
      }
    });
  });

  describe('publishArticle', () => {
    it('delegates to ArticlePublicationService.publishArticle and returns publication response', async () => {
      serviceMock.publishArticle.mockResolvedValue(MOCK_PUBLICATION_RESPONSE);

      const result = await controller.publishArticle(
        VALID_USER,
        'a1b2c3d4-1111-4000-8000-000000000001',
        { expectedRevision: 8 },
      );

      expect(serviceMock.publishArticle).toHaveBeenCalledWith(
        VALID_USER,
        'a1b2c3d4-1111-4000-8000-000000000001',
        { expectedRevision: 8 },
      );
      expect(result).toEqual(MOCK_PUBLICATION_RESPONSE);
    });
  });

  describe('archiveArticle', () => {
    it('delegates to ArticlePublicationService.archiveArticle and returns archived response', async () => {
      const archivedResponse = {
        ...MOCK_PUBLICATION_RESPONSE,
        status: ArticleStatus.ARCHIVED,
      };
      serviceMock.archiveArticle.mockResolvedValue(archivedResponse);

      const result = await controller.archiveArticle(
        VALID_USER,
        'a1b2c3d4-1111-4000-8000-000000000001',
        { expectedRevision: 8 },
      );

      expect(serviceMock.archiveArticle).toHaveBeenCalledWith(
        VALID_USER,
        'a1b2c3d4-1111-4000-8000-000000000001',
        { expectedRevision: 8 },
      );
      expect(result).toEqual(archivedResponse);
    });
  });

  describe('restoreArticle', () => {
    it('delegates to ArticlePublicationService.restoreArticle and returns restored response', async () => {
      serviceMock.restoreArticle.mockResolvedValue(MOCK_PUBLICATION_RESPONSE);

      const result = await controller.restoreArticle(
        VALID_USER,
        'a1b2c3d4-1111-4000-8000-000000000001',
        { expectedRevision: 8 },
      );

      expect(serviceMock.restoreArticle).toHaveBeenCalledWith(
        VALID_USER,
        'a1b2c3d4-1111-4000-8000-000000000001',
        { expectedRevision: 8 },
      );
      expect(result).toEqual(MOCK_PUBLICATION_RESPONSE);
    });
  });
});
