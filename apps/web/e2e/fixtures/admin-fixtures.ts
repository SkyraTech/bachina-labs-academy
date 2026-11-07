import type { Page, Route } from '@playwright/test';
import type {
  AdminOverviewResponse,
  AdminUserItem,
  AdminArticleItem,
} from '../../src/app/features/admin/models/admin.models';

export const MOCK_ADMIN_USER = {
  id: 'usr-admin-001',
  email: 'admin@skyra-tech.com',
  name: 'Platform Administrator',
  role: 'ADMIN',
  status: 'ACTIVE',
  isEmailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const MOCK_ADMIN_OVERVIEW: AdminOverviewResponse = {
  users: {
    total: 12,
    verified: 10,
    unverified: 2,
    byRole: { author: 9, admin: 3 },
    byStatus: { active: 11, suspended: 1, disabled: 0 },
  },
  articles: {
    total: 35,
    published: 20,
    draft: 12,
    archived: 3,
    totalPublishedSnapshots: 20,
  },
  taxonomy: {
    totalCategories: 6,
    totalTags: 18,
  },
};

export const MOCK_ADMIN_USERS: AdminUserItem[] = [
  {
    id: 'usr-admin-001',
    email: 'admin@skyra-tech.com',
    role: 'ADMIN',
    status: 'ACTIVE',
    isEmailVerified: true,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'usr-author-002',
    email: 'author.alex@skyra-tech.com',
    role: 'AUTHOR',
    status: 'ACTIVE',
    isEmailVerified: true,
    emailVerifiedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'usr-author-003',
    email: 'unverified.author@skyra-tech.com',
    role: 'AUTHOR',
    status: 'ACTIVE',
    isEmailVerified: false,
    emailVerifiedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'usr-author-004',
    email: 'suspended.user@skyra-tech.com',
    role: 'AUTHOR',
    status: 'SUSPENDED',
    isEmailVerified: true,
    emailVerifiedAt: '2026-03-15T00:00:00.000Z',
    createdAt: '2026-03-15T00:00:00.000Z',
    updatedAt: '2026-03-15T00:00:00.000Z',
  },
  {
    id: 'usr-admin-005',
    email: 'secops.admin@skyra-tech.com',
    role: 'ADMIN',
    status: 'ACTIVE',
    isEmailVerified: true,
    emailVerifiedAt: '2026-04-01T00:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'usr-author-006',
    email: 'disabled.account@skyra-tech.com',
    role: 'AUTHOR',
    status: 'DISABLED',
    isEmailVerified: true,
    emailVerifiedAt: '2026-04-10T00:00:00.000Z',
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
];

export const MOCK_ADMIN_ARTICLES: AdminArticleItem[] = [
  {
    id: 'art-001',
    title: 'High-Performance PostgreSQL Indexing Guide (Draft)',
    draftSlug: 'high-performance-postgresql-indexing',
    status: 'PUBLISHED',
    draftRevision: 4,
    publishedRevision: 2,
    authorId: 'usr-author-002',
    authorEmail: 'author.alex@skyra-tech.com',
    publishedAt: '2026-04-10T00:00:00.000Z',
    publishedSlug: 'high-performance-postgresql-indexing',
    publishedTitle: 'High-Performance PostgreSQL Indexing Guide (Published)',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'art-002',
    title: 'Distributed Consensus with Raft in Rust',
    draftSlug: 'distributed-consensus-raft-rust',
    status: 'DRAFT',
    draftRevision: 1,
    publishedRevision: 0,
    authorId: 'usr-author-002',
    authorEmail: 'author.alex@skyra-tech.com',
    publishedAt: null,
    publishedSlug: null,
    publishedTitle: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
  },
  {
    id: 'art-003',
    title: 'Legacy Monolith Decomposition Playbook',
    draftSlug: 'legacy-monolith-decomposition',
    status: 'ARCHIVED',
    draftRevision: 3,
    publishedRevision: 1,
    authorId: 'usr-author-004',
    authorEmail: 'suspended.user@skyra-tech.com',
    publishedAt: null,
    publishedSlug: null,
    publishedTitle: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
];

export interface MockAdminOptions {
  authenticated?: boolean;
  role?: 'ADMIN' | 'AUTHOR' | 'READER';
  failOverview?: boolean;
  failUsers?: boolean;
  failArticles?: boolean;
  emptyUsers?: boolean;
  emptyArticles?: boolean;
}

export async function setupAdminMock(page: Page, options: MockAdminOptions = {}): Promise<void> {
  try {
    await page.unroute('**/api/v1/**');
  } catch {
    // ignore
  }

  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    // 1. Auth Profile: GET /api/v1/auth/me
    if (path === '/api/v1/auth/me') {
      if (options.authenticated === false) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...MOCK_ADMIN_USER,
          role: options.role || 'ADMIN',
        }),
      });
    }

    // 2. Admin Overview: GET /api/v1/admin/overview
    if (path === '/api/v1/admin/overview') {
      if (options.failOverview) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ADMIN_OVERVIEW),
      });
    }

    // 3. Admin Users: GET /api/v1/admin/users
    if (path === '/api/v1/admin/users') {
      if (options.failUsers) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
        });
      }
      if (options.emptyUsers) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
        });
      }

      const roleFilter = url.searchParams.get('role');
      const statusFilter = url.searchParams.get('status');
      const query = (url.searchParams.get('q') || '').toLowerCase().trim();
      const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);

      let filtered = [...MOCK_ADMIN_USERS];
      if (roleFilter && roleFilter !== 'ALL') {
        filtered = filtered.filter((u) => u.role === roleFilter);
      }
      if (statusFilter && statusFilter !== 'ALL') {
        filtered = filtered.filter((u) => u.status === statusFilter);
      }
      if (query) {
        filtered = filtered.filter((u) => u.email.toLowerCase().includes(query));
      }

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const start = (pageNum - 1) * limit;
      const data = filtered.slice(start, start + limit);

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data, total, page: pageNum, limit, totalPages }),
      });
    }

    // 4. Single User: GET /api/v1/admin/users/:id
    const userMatch = path.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (userMatch && method === 'GET') {
      const userId = userMatch[1];
      const found = MOCK_ADMIN_USERS.find((u) => u.id === userId);
      if (found) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(found),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 404, message: 'User not found' }),
      });
    }

    // 5. Admin Articles: GET /api/v1/admin/articles
    if (path === '/api/v1/admin/articles') {
      if (options.failArticles) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
        });
      }
      if (options.emptyArticles) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
        });
      }

      const statusFilter = url.searchParams.get('status');
      const query = (url.searchParams.get('q') || '').toLowerCase().trim();
      const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);

      let filtered = [...MOCK_ADMIN_ARTICLES];
      if (statusFilter && statusFilter !== 'ALL') {
        filtered = filtered.filter((a) => a.status === statusFilter);
      }
      if (query) {
        filtered = filtered.filter(
          (a) =>
            a.title.toLowerCase().includes(query) ||
            a.draftSlug.toLowerCase().includes(query) ||
            (a.publishedSlug && a.publishedSlug.toLowerCase().includes(query)),
        );
      }

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const start = (pageNum - 1) * limit;
      const data = filtered.slice(start, start + limit);

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data, total, page: pageNum, limit, totalPages }),
      });
    }

    // 6. Single Article: GET /api/v1/admin/articles/:id
    const articleMatch = path.match(/^\/api\/v1\/admin\/articles\/([^/]+)$/);
    if (articleMatch && method === 'GET') {
      const articleId = articleMatch[1];
      const found = MOCK_ADMIN_ARTICLES.find((a) => a.id === articleId);
      if (found) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(found),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 404, message: 'Article not found' }),
      });
    }

    // 7. Categories & Tags for Admin
    if (path === '/api/v1/admin/categories') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'cat-01', name: 'Databases', slug: 'databases', description: 'DB Architecture' },
          ],
          total: 1,
        }),
      });
    }

    if (path === '/api/v1/admin/tags') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'tag-01', name: 'postgresql', slug: 'postgresql' }],
          total: 1,
        }),
      });
    }

    // 8. Admin Comments: GET /api/v1/admin/comments and POST /api/v1/admin/comments/:id/remove
    if (path === '/api/v1/admin/comments' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'mock-admin-c1',
              articleId: 'art-001',
              articleSlug: 'concurrency-in-modern-postgresql',
              articleTitle: 'Concurrency in Modern PostgreSQL',
              authorId: 'usr-author-002',
              authorDisplayName: 'Jane PostgreSQL',
              body: 'Great article on row lock concurrency!',
              status: 'VISIBLE',
              removalReason: null,
              removedAt: null,
              removedByUserId: null,
              retentionRedacted: false,
              createdAt: '2026-11-06T00:00:00.000Z',
              updatedAt: '2026-11-06T00:00:00.000Z',
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        }),
      });
    }

    const removeMatch = path.match(/^\/api\/v1\/admin\/comments\/([^/]+)\/remove$/);
    if (removeMatch && method === 'POST') {
      const commentId = removeMatch[1];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: commentId,
          articleId: 'art-001',
          articleSlug: 'concurrency-in-modern-postgresql',
          articleTitle: 'Concurrency in Modern PostgreSQL',
          authorId: 'usr-author-002',
          authorDisplayName: 'Jane PostgreSQL',
          body: 'Great article on row lock concurrency!',
          status: 'REMOVED',
          removalReason: 'SPAM',
          removedAt: new Date().toISOString(),
          removedByUserId: 'usr-admin-001',
          retentionRedacted: false,
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
        }),
      });
    }

    // Fail-closed firewall for any other unhandled API routes
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 404, message: `Mock unhandled endpoint: ${path}` }),
    });
  });
}

