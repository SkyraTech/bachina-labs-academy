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
      const roles = reflector.get<UserRole[]>(
        ROLES_KEY,
        proto['publishArticle'],
      );
      expect(roles).toBeDefined();
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);
    });

    it('attaches VerifiedEmailGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        proto['publishArticle'],
      );
      expect(guards).toBeDefined();
      expect(guards).toContain(VerifiedEmailGuard);
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
});
