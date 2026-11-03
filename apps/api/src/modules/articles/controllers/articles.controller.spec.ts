import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from '../services/articles.service.js';
import { UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticlesController', () => {
  let controller: ArticlesController;
  let reflector: Reflector;
  let serviceMock: {
    createDraft: ReturnType<typeof vi.fn>;
    listMyArticles: ReturnType<typeof vi.fn>;
    getPrivateArticle: ReturnType<typeof vi.fn>;
    updateDraftMetadata: ReturnType<typeof vi.fn>;
    deleteEligibleDraft: ReturnType<typeof vi.fn>;
  };

  const VALID_USER: AuthenticatedUser = {
    id: 'u1111111-0000-4000-8000-000000000001',
    email: 'author@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 's1111111-0000-4000-8000-000000000001',
  };

  const MOCK_ARTICLE_RESPONSE = {
    id: 'a1b2c3d4-1111-4000-8000-000000000001',
    authorId: VALID_USER.id,
    title: 'Relational Database Design',
    draftSlug: 'relational-database-design',
    publishedSlug: null,
    summary: 'A comprehensive guide.',
    status: ArticleStatus.DRAFT,
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 1,
    publishedRevision: 0,
    currentSnapshotId: null,
    categoryId: null,
    tagIds: [],
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    publishedAt: null,
  };

  beforeEach(async () => {
    serviceMock = {
      createDraft: vi.fn(),
      listMyArticles: vi.fn(),
      getPrivateArticle: vi.fn(),
      updateDraftMetadata: vi.fn(),
      deleteEligibleDraft: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArticlesController],
      providers: [
        Reflector,
        {
          provide: ArticlesService,
          useValue: serviceMock,
        },
      ],
    }).compile();

    controller = module.get<ArticlesController>(ArticlesController);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Guard and Decorator Metadata Verification ─────────────────────────────

  describe('route guards and metadata', () => {
    const proto = ArticlesController.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    it('decorates create handler with AUTHOR and ADMIN roles and VerifiedEmailGuard', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, proto['create']);
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const guards = Reflect.getMetadata('__guards__', proto['create']);
      expect(guards).toBeDefined();
      expect(guards.some((g: unknown) => g === VerifiedEmailGuard)).toBe(true);
    });

    it('decorates listMine handler with AUTHOR and ADMIN roles and VerifiedEmailGuard', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, proto['listMine']);
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const guards = Reflect.getMetadata('__guards__', proto['listMine']);
      expect(guards).toBeDefined();
      expect(guards.some((g: unknown) => g === VerifiedEmailGuard)).toBe(true);
    });

    it('decorates getById handler with AUTHOR and ADMIN roles and VerifiedEmailGuard', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, proto['getById']);
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const guards = Reflect.getMetadata('__guards__', proto['getById']);
      expect(guards).toBeDefined();
      expect(guards.some((g: unknown) => g === VerifiedEmailGuard)).toBe(true);
    });

    it('decorates update handler with AUTHOR and ADMIN roles and VerifiedEmailGuard', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, proto['update']);
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const guards = Reflect.getMetadata('__guards__', proto['update']);
      expect(guards).toBeDefined();
      expect(guards.some((g: unknown) => g === VerifiedEmailGuard)).toBe(true);
    });

    it('decorates delete handler with AUTHOR and ADMIN roles and VerifiedEmailGuard', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, proto['delete']);
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const guards = Reflect.getMetadata('__guards__', proto['delete']);
      expect(guards).toBeDefined();
      expect(guards.some((g: unknown) => g === VerifiedEmailGuard)).toBe(true);
    });
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to service.createDraft with authenticated user and dto', async () => {
      serviceMock.createDraft.mockResolvedValue(MOCK_ARTICLE_RESPONSE);

      const dto = {
        title: 'Relational Database Design',
        draftSlug: 'relational-database-design',
        summary: 'A comprehensive guide.',
      };

      const result = await controller.create(VALID_USER, dto);

      expect(serviceMock.createDraft).toHaveBeenCalledWith(VALID_USER, dto);
      expect(result).toEqual(MOCK_ARTICLE_RESPONSE);
    });
  });

  describe('listMine', () => {
    it('delegates to service.listMyArticles with authenticated user and query', async () => {
      const mockListResponse = {
        items: [MOCK_ARTICLE_RESPONSE],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      };
      serviceMock.listMyArticles.mockResolvedValue(mockListResponse);

      const query = { page: 1, limit: 20 };
      const result = await controller.listMine(VALID_USER, query);

      expect(serviceMock.listMyArticles).toHaveBeenCalledWith(VALID_USER, query);
      expect(result).toEqual(mockListResponse);
    });
  });

  describe('getById', () => {
    it('delegates to service.getPrivateArticle with authenticated user and articleId', async () => {
      const mockDetailResponse = {
        ...MOCK_ARTICLE_RESPONSE,
        blocks: [],
      };
      serviceMock.getPrivateArticle.mockResolvedValue(mockDetailResponse);

      const result = await controller.getById(VALID_USER, MOCK_ARTICLE_RESPONSE.id);

      expect(serviceMock.getPrivateArticle).toHaveBeenCalledWith(
        VALID_USER,
        MOCK_ARTICLE_RESPONSE.id,
      );
      expect(result).toEqual(mockDetailResponse);
    });
  });

  describe('update', () => {
    it('delegates to service.updateDraftMetadata with user, articleId, and dto', async () => {
      const updatedResponse = {
        ...MOCK_ARTICLE_RESPONSE,
        title: 'Updated Title',
        draftRevision: 2,
      };
      serviceMock.updateDraftMetadata.mockResolvedValue(updatedResponse);

      const dto = {
        expectedRevision: 1,
        title: 'Updated Title',
      };

      const result = await controller.update(
        VALID_USER,
        MOCK_ARTICLE_RESPONSE.id,
        dto,
      );

      expect(serviceMock.updateDraftMetadata).toHaveBeenCalledWith(
        VALID_USER,
        MOCK_ARTICLE_RESPONSE.id,
        dto,
      );
      expect(result).toEqual(updatedResponse);
    });
  });

  describe('delete', () => {
    it('delegates to service.deleteEligibleDraft with user, articleId, and query', async () => {
      serviceMock.deleteEligibleDraft.mockResolvedValue(undefined);

      const query = { expectedRevision: 1 };

      await controller.delete(
        VALID_USER,
        MOCK_ARTICLE_RESPONSE.id,
        query,
      );

      expect(serviceMock.deleteEligibleDraft).toHaveBeenCalledWith(
        VALID_USER,
        MOCK_ARTICLE_RESPONSE.id,
        query,
      );
    });
  });
});

