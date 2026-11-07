import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminApiService } from './admin-api.service';
import { ApiClientService } from '../../../core/api';
import {
  AdminOverviewResponse,
  PaginatedAdminUsersResponse,
  AdminUserItem,
  PaginatedAdminArticlesResponse,
  AdminArticleItem,
} from '../models/admin.models';

describe('AdminApiService', () => {
  let service: AdminApiService;
  let apiSpy: {
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    apiSpy = {
      get: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AdminApiService,
        { provide: ApiClientService, useValue: apiSpy },
      ],
    });

    service = TestBed.inject(AdminApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('retrieves overview metrics from admin/overview', () => {
    const mockOverview: AdminOverviewResponse = {
      users: {
        total: 10,
        verified: 8,
        unverified: 2,
        byRole: { author: 8, admin: 2 },
        byStatus: { active: 9, suspended: 1, disabled: 0 },
      },
      articles: {
        total: 25,
        published: 15,
        draft: 8,
        archived: 2,
        totalPublishedSnapshots: 15,
      },
      taxonomy: {
        totalCategories: 5,
        totalTags: 12,
      },
    };
    apiSpy.get.mockReturnValue(of(mockOverview));

    let result: AdminOverviewResponse | undefined;
    service.getOverview().subscribe((res) => (result = res));

    expect(apiSpy.get).toHaveBeenCalledWith('admin/overview');
    expect(result).toEqual(mockOverview);
  });

  it('lists users with query params omitting ALL filters', () => {
    const mockUsers: PaginatedAdminUsersResponse = {
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };
    apiSpy.get.mockReturnValue(of(mockUsers));

    service
      .listUsers({ page: 2, limit: 10, role: 'ALL', status: 'ACTIVE', q: 'skyra' })
      .subscribe();

    expect(apiSpy.get).toHaveBeenCalledWith('admin/users', {
      params: {
        page: 2,
        limit: 10,
        status: 'ACTIVE',
        q: 'skyra',
      },
    });
  });

  it('retrieves single user by id with encoded url', () => {
    const mockUser: AdminUserItem = {
      id: 'u-123',
      email: 'admin@skyra-tech.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      isEmailVerified: true,
      emailVerifiedAt: '2026-10-15T00:00:00Z',
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    };
    apiSpy.get.mockReturnValue(of(mockUser));

    let result: AdminUserItem | undefined;
    service.getUserById('u-123').subscribe((res) => (result = res));

    expect(apiSpy.get).toHaveBeenCalledWith('admin/users/u-123');
    expect(result).toEqual(mockUser);
  });

  it('lists articles with query parameters', () => {
    const mockArticles: PaginatedAdminArticlesResponse = {
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };
    apiSpy.get.mockReturnValue(of(mockArticles));

    service.listArticles({ page: 1, limit: 20, status: 'PUBLISHED', q: 'guide' }).subscribe();

    expect(apiSpy.get).toHaveBeenCalledWith('admin/articles', {
      params: {
        page: 1,
        limit: 20,
        status: 'PUBLISHED',
        q: 'guide',
      },
    });
  });

  it('retrieves single article by id', () => {
    const mockArticle: AdminArticleItem = {
      id: 'a-123',
      title: 'Production Guide',
      draftSlug: 'production-guide',
      status: 'PUBLISHED',
      draftRevision: 2,
      publishedRevision: 1,
      authorId: 'auth-1',
      authorEmail: 'author@skyra-tech.com',
      publishedAt: '2026-10-20T00:00:00Z',
      publishedSlug: 'production-guide',
      publishedTitle: 'Production Guide',
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-20T00:00:00Z',
    };
    apiSpy.get.mockReturnValue(of(mockArticle));

    let result: AdminArticleItem | undefined;
    service.getArticleById('a-123').subscribe((res) => (result = res));

    expect(apiSpy.get).toHaveBeenCalledWith('admin/articles/a-123');
    expect(result).toEqual(mockArticle);
  });
});

