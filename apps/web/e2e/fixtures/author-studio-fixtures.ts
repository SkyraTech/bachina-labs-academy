import type { Page, Route } from '@playwright/test';

export interface AuthorUser {
  id: string;
  email: string;
  name: string;
  role: 'AUTHOR' | 'ADMIN' | 'READER';
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export const MOCK_AUTHOR_USER: AuthorUser = {
  id: 'usr-author-001',
  email: 'author@bachinalabs.com',
  name: 'Alex Author',
  role: 'AUTHOR',
  isEmailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const MOCK_CATEGORIES = [
  {
    id: 'cat-001',
    name: 'Databases',
    slug: 'databases',
    description: 'Relational and distributed database architecture',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'cat-002',
    name: 'Distributed Systems',
    slug: 'distributed-systems',
    description: 'Consensus, replication, and high availability',
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
];

export const MOCK_TAGS = [
  {
    id: 'tag-001',
    name: 'postgresql',
    slug: 'postgresql',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'tag-002',
    name: 'indexing',
    slug: 'indexing',
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'tag-003',
    name: 'performance',
    slug: 'performance',
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
  },
  ...Array.from({ length: 22 }, (_, i) => ({
    id: `tag-${String(i + 4).padStart(3, '0')}`,
    name: `topic-${i + 4}`,
    slug: `topic-${i + 4}`,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
  })),
];

export const MOCK_EDITABLE_ARTICLE = {
  id: 'art-001-mock',
  authorId: 'usr-author-001',
  title: 'High-Performance Relational Indexing in PostgreSQL',
  draftSlug: 'high-performance-relational-indexing',
  publishedSlug: null,
  summary: 'Architectural deep-dive into B-Tree, BRIN, and GiST indexing mechanisms.',
  status: 'DRAFT',
  typographyPreset: 'MODERN_SANS',
  coverMediaId: null,
  categoryId: 'cat-001',
  tagIds: ['tag-001', 'tag-002'],
  category: { id: 'cat-001', name: 'Databases', slug: 'databases' },
  tags: [
    { id: 'tag-001', name: 'postgresql', slug: 'postgresql' },
    { id: 'tag-002', name: 'indexing', slug: 'indexing' },
  ],
  draftRevision: 1,
  publishedRevision: 0,
  currentSnapshotId: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  publishedAt: null,
  blocks: [
    {
      id: 'blk-001',
      articleId: 'art-001-mock',
      type: 'HEADING',
      position: 1,
      content: { text: 'Core Architecture Overview', level: 1 },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
    {
      id: 'blk-002',
      articleId: 'art-001-mock',
      type: 'RICH_TEXT',
      position: 2,
      content: { html: '<p>When designing high-throughput databases, memory indexing is essential.</p>' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
    {
      id: 'blk-003',
      articleId: 'art-001-mock',
      type: 'CODE',
      position: 3,
      content: {
        code: 'CREATE INDEX CONCURRENTLY idx_users_email ON users(email);',
        language: 'sql',
        showLineNumbers: true,
      },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
    {
      id: 'blk-004',
      articleId: 'art-001-mock',
      type: 'RICH_TEXT',
      position: 4,
      content: { html: '<p><em>Beta</em> indexing architecture and query optimization.</p>' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
  ],
};

export const MOCK_ACTIVE_SESSIONS = [
  {
    id: 'sess-current-01',
    deviceLabel: 'Microsoft Edge on Windows',
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    createdAt: '2026-11-01T08:00:00.000Z',
    lastSeenAt: '2026-11-03T18:00:00.000Z',
    expiresAt: '2026-12-01T08:00:00.000Z',
    rememberMe: true,
    isCurrent: true,
  },
  {
    id: 'sess-other-02',
    deviceLabel: 'Safari on iPhone',
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    createdAt: '2026-10-25T14:30:00.000Z',
    lastSeenAt: '2026-10-30T10:15:00.000Z',
    expiresAt: '2026-11-25T14:30:00.000Z',
    rememberMe: false,
    isCurrent: false,
  },
];

export interface MockAuthorOptions {
  emptyArticles?: boolean;
  role?: 'AUTHOR' | 'ADMIN' | 'READER';
  authenticated?: boolean;
  failTaxonomy?: boolean;
  categoryDeleteConflict?: boolean;
  tagDeleteConflict?: boolean;
  metadataSaveConflict?: boolean;
  incompleteArticle?: boolean;
}

export async function setupAuthorStudioMock(page: Page, options: MockAuthorOptions = {}): Promise<void> {
  try {
    await page.unroute('**/api/v1/**');
  } catch {
    // ignore
  }

  const categoriesList = [...MOCK_CATEGORIES];
  const tagsList = [...MOCK_TAGS];
  const articlesMap = new Map<string, any>();
  if (options.incompleteArticle) {
    articlesMap.set('art-001-mock', {
      ...MOCK_EDITABLE_ARTICLE,
      title: 'Hi',
      draftSlug: 'invalid slug!',
      blocks: [],
    });
  } else {
    articlesMap.set('art-001-mock', { ...MOCK_EDITABLE_ARTICLE });
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
          ...MOCK_AUTHOR_USER,
          role: options.role || 'AUTHOR',
        }),
      });
    }

    // 2. Author Articles List: GET /api/v1/articles/mine
    if (path === '/api/v1/articles/mine') {
      if (options.emptyArticles) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 0,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: Array.from(articlesMap.values()),
          total: articlesMap.size,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      });
    }

    // 3. Single Article Draft: GET /api/v1/articles/:articleId
    const articleDetailMatch = path.match(/^\/api\/v1\/articles\/([^/]+)$/);
    if (articleDetailMatch && method === 'GET') {
      const articleId = articleDetailMatch[1];
      if (articlesMap.has(articleId)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(articlesMap.get(articleId)),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 404, message: 'Article draft not found' }),
      });
    }

    // 4. Update Article Metadata: PATCH /api/v1/articles/:articleId
    if (articleDetailMatch && method === 'PATCH') {
      if (options.metadataSaveConflict) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 409,
            message: 'Conflict: The article draft was updated concurrently by another session. Please reload.',
          }),
        });
      }
      const articleId = articleDetailMatch[1];
      const body = route.request().postDataJSON();
      const existing = articlesMap.get(articleId) || { ...MOCK_EDITABLE_ARTICLE, id: articleId };
      const updated = {
        ...existing,
        ...body,
        draftRevision: (existing.draftRevision || 1) + 1,
        updatedAt: new Date().toISOString(),
      };
      articlesMap.set(articleId, updated);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
    }

    // 5. Create Draft: POST /api/v1/articles
    if (path === '/api/v1/articles' && method === 'POST') {
      const body = route.request().postDataJSON();
      const created = {
        ...MOCK_EDITABLE_ARTICLE,
        ...body,
        id: 'art-new-created',
        title: body?.title || 'Newly Created Draft',
        draftSlug: body?.draftSlug || 'newly-created-draft',
        categoryId: body?.categoryId ?? null,
        tagIds: body?.tagIds ?? [],
        draftRevision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      articlesMap.set('art-new-created', created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    }

    // 6. Active Sessions: GET /api/v1/auth/sessions
    if (path === '/api/v1/auth/sessions' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ACTIVE_SESSIONS),
      });
    }

    // 7. Sign Out: POST /api/v1/auth/logout
    if (path === '/api/v1/auth/logout' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Logged out successfully' }),
      });
    }

    // 8. Public Categories: GET /api/v1/categories
    if (path === '/api/v1/categories' && method === 'GET') {
      if (options.failTaxonomy) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'Database query failed' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: categoriesList,
          total: categoriesList.length,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      });
    }

    // 9. Public Tags: GET /api/v1/tags
    if (path === '/api/v1/tags' && method === 'GET') {
      if (options.failTaxonomy) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'Database query failed' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: tagsList,
          total: tagsList.length,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      });
    }

    // 10. Admin Categories: /api/v1/admin/categories
    const adminCategoryMatch = path.match(/^\/api\/v1\/admin\/categories(?:\/([^/]+))?$/);
    if (adminCategoryMatch) {
      if (options.role !== 'ADMIN') {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 403, message: 'Administrator privileges required' }),
        });
      }
      const catId = adminCategoryMatch[1];
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: categoriesList,
            total: categoriesList.length,
            page: 1,
            limit: 20,
            totalPages: 1,
          }),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        const created = {
          id: `cat-${Date.now()}`,
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        categoriesList.unshift(created);
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      }
      if (method === 'PATCH' && catId) {
        const body = route.request().postDataJSON();
        const idx = categoriesList.findIndex((c) => c.id === catId);
        if (idx >= 0) {
          categoriesList[idx] = { ...categoriesList[idx], ...body, updatedAt: new Date().toISOString() };
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(categoriesList[idx]),
          });
        }
      }
      if (method === 'DELETE' && catId) {
        if (options.categoryDeleteConflict) {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 409,
              message: 'Cannot delete category: Category is referenced by active articles.',
            }),
          });
        }
        const idx = categoriesList.findIndex((c) => c.id === catId);
        if (idx >= 0) {
          categoriesList.splice(idx, 1);
        }
        return route.fulfill({ status: 204 });
      }
    }

    // 11. Admin Tags: /api/v1/admin/tags
    const adminTagMatch = path.match(/^\/api\/v1\/admin\/tags(?:\/([^/]+))?$/);
    if (adminTagMatch) {
      if (options.role !== 'ADMIN') {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 403, message: 'Administrator privileges required' }),
        });
      }
      const tagId = adminTagMatch[1];
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: tagsList,
            total: tagsList.length,
            page: 1,
            limit: 20,
            totalPages: 1,
          }),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        const created = {
          id: `tag-${Date.now()}`,
          name: body.name,
          slug: body.slug,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        tagsList.unshift(created);
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      }
      if (method === 'PATCH' && tagId) {
        const body = route.request().postDataJSON();
        const idx = tagsList.findIndex((t) => t.id === tagId);
        if (idx >= 0) {
          tagsList[idx] = { ...tagsList[idx], ...body, updatedAt: new Date().toISOString() };
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(tagsList[idx]),
          });
        }
      }
      if (method === 'DELETE' && tagId) {
        if (options.tagDeleteConflict) {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 409,
              message: 'Cannot delete tag: Tag is currently locked or referenced.',
            }),
          });
        }
        const idx = tagsList.findIndex((t) => t.id === tagId);
        if (idx >= 0) {
          tagsList.splice(idx, 1);
        }
        return route.fulfill({ status: 204 });
      }
    }

    // 12. Update Block: PATCH /api/v1/articles/:articleId/blocks/:blockId
    const blockUpdateMatch = path.match(/^\/api\/v1\/articles\/([^/]+)\/blocks\/([^/]+)$/);
    if (blockUpdateMatch && method === 'PATCH') {
      const body = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: blockUpdateMatch[2],
          articleId: blockUpdateMatch[1],
          type: 'RICH_TEXT',
          position: 2,
          content: body?.content || {},
          mediaAssetId: null,
          schemaVersion: 1,
          draftRevision: 2,
          createdAt: '2026-10-01T12:00:00.000Z',
          updatedAt: new Date().toISOString(),
        }),
      });
    }

    // 13. Publish Article: POST /api/v1/articles/:articleId/publish
    const publishMatch = path.match(/^\/api\/v1\/articles\/([^/]+)\/publish$/);
    if (publishMatch && method === 'POST') {
      const articleId = publishMatch[1];
      const existing = articlesMap.get(articleId) || { ...MOCK_EDITABLE_ARTICLE, id: articleId };
      const published = {
        ...existing,
        status: 'PUBLISHED',
        publishedSlug: existing.draftSlug,
        publishedRevision: (existing.draftRevision || 1),
        currentSnapshotId: `snap-${Date.now()}`,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      articlesMap.set(articleId, published);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(published),
      });
    }

    // 14. Duplicate Article: POST /api/v1/articles/:articleId/duplicate
    const duplicateMatch = path.match(/^\/api\/v1\/articles\/([^/]+)\/duplicate$/);
    if (duplicateMatch && method === 'POST') {
      const articleId = duplicateMatch[1];
      const existing = articlesMap.get(articleId) || { ...MOCK_EDITABLE_ARTICLE, id: articleId };
      const dupId = `art-dup-${Date.now()}`;
      const duplicated = {
        ...existing,
        id: dupId,
        title: `${existing.title} (Copy)`,
        draftSlug: `${existing.draftSlug}-copy`,
        publishedSlug: null,
        status: 'DRAFT',
        draftRevision: 1,
        publishedRevision: 0,
        publishedAt: null,
        currentSnapshotId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        blocks: (existing.blocks || []).map((b: any, idx: number) => ({
          ...b,
          id: `blk-dup-${idx + 1}-${Date.now()}`,
          articleId: dupId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      };
      articlesMap.set(dupId, duplicated);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(duplicated),
      });
    }

    // CRITICAL FIREWALL: Fail-closed for all other API requests to protect primary PostgreSQL
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'BLOCKED_BY_TEST_FIREWALL', path }),
    });
  });
}

