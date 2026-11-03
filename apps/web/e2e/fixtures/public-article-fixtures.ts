import type { Page, Route } from '@playwright/test';
import type {
  PublicArticleDetailResponse,
  PublicArticleListResponse,
  PublicDiscoveredTaxonomyItem,
  PublicTaxonomyCategory,
  PublicTaxonomyTag,
} from '../../src/app/features/public/articles/models/public-article.models';

export const CATEGORY_BACKEND: PublicTaxonomyCategory = {
  id: 'cat-backend-001',
  name: 'Backend Engineering',
  slug: 'backend-engineering',
};

export const CATEGORY_FRONTEND: PublicTaxonomyCategory = {
  id: 'cat-frontend-002',
  name: 'Frontend Architecture',
  slug: 'frontend-architecture',
};

export const CATEGORY_DEVOPS: PublicTaxonomyCategory = {
  id: 'cat-devops-003',
  name: 'DevOps & SRE',
  slug: 'devops',
};

export const TAG_DATABASE: PublicTaxonomyTag = {
  id: 'tag-db-001',
  name: 'Database',
  slug: 'database',
};

export const TAG_PERFORMANCE: PublicTaxonomyTag = {
  id: 'tag-perf-002',
  name: 'Performance',
  slug: 'performance',
};

export const TAG_ANGULAR: PublicTaxonomyTag = {
  id: 'tag-ng-003',
  name: 'Angular',
  slug: 'angular',
};

export const TAG_SECURITY: PublicTaxonomyTag = {
  id: 'tag-sec-004',
  name: 'Security',
  slug: 'security',
};

export const MOCK_CATEGORIES: PublicDiscoveredTaxonomyItem[] = [
  { id: CATEGORY_BACKEND.id, name: CATEGORY_BACKEND.name, slug: CATEGORY_BACKEND.slug, articleCount: 21 },
  { id: CATEGORY_FRONTEND.id, name: CATEGORY_FRONTEND.name, slug: CATEGORY_FRONTEND.slug, articleCount: 3 },
  { id: CATEGORY_DEVOPS.id, name: CATEGORY_DEVOPS.name, slug: CATEGORY_DEVOPS.slug, articleCount: 1 },
];

export const MOCK_TAGS: PublicDiscoveredTaxonomyItem[] = [
  { id: TAG_DATABASE.id, name: TAG_DATABASE.name, slug: TAG_DATABASE.slug, articleCount: 21 },
  { id: TAG_ANGULAR.id, name: TAG_ANGULAR.name, slug: TAG_ANGULAR.slug, articleCount: 3 },
  { id: TAG_PERFORMANCE.id, name: TAG_PERFORMANCE.name, slug: TAG_PERFORMANCE.slug, articleCount: 1 },
  { id: TAG_SECURITY.id, name: TAG_SECURITY.name, slug: TAG_SECURITY.slug, articleCount: 1 },
];

// Build 26 articles
export const MOCK_ARTICLES: PublicArticleDetailResponse[] = [
  // Article 1: Complete article with headings, code, blocks, cover, multiple tags
  {
    id: 'art-001',
    slug: 'postgresql-production-tuning',
    title: 'PostgreSQL 17 Production Performance & Tuning Guide',
    summary: 'Comprehensive production tuning guide for high-throughput relational databases with PostgreSQL.',
    typographyPreset: 'TECHNICAL_MINIMAL',
    cover: {
      id: 'med-001',
      mimeType: 'image/webp',
      width: 1200,
      height: 630,
      altText: 'PostgreSQL Architecture and Buffer Pool Diagram',
      url: '/api/v1/media/public/med-001.webp',
    },
    revision: 1,
    publishedAt: '2026-10-15T10:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_BACKEND,
    tags: [TAG_DATABASE, TAG_PERFORMANCE],
    blocks: [
      {
        id: 'blk-001-1',
        type: 'HEADING',
        position: 0,
        schemaVersion: 1,
        content: { level: 2, text: 'Architecture Overview' },
        media: null,
      },
      {
        id: 'blk-001-2',
        type: 'RICH_TEXT',
        position: 1,
        schemaVersion: 1,
        content: { html: '<p>PostgreSQL 17 introduces enhanced query parallelism and memory optimizations.</p>' },
        media: null,
      },
      {
        id: 'blk-001-3',
        type: 'HEADING',
        position: 2,
        schemaVersion: 1,
        content: { level: 2, text: 'Buffer Pool Optimization' },
        media: null,
      },
      {
        id: 'blk-001-4',
        type: 'CODE',
        position: 3,
        schemaVersion: 1,
        content: { code: 'shared_buffers = 16GB\nwork_mem = 64MB\nmaintenance_work_mem = 2GB', language: 'ini' },
        media: null,
      },
      {
        id: 'blk-001-5',
        type: 'HEADING',
        position: 4,
        schemaVersion: 1,
        content: { level: 3, text: 'Connection Pooling Details' },
        media: null,
      },
      {
        id: 'blk-001-6',
        type: 'CALLOUT',
        position: 5,
        schemaVersion: 1,
        content: { variant: 'TIP', title: 'Connection Sizing', body: 'Keep pool size bounded to CPU count * 2.' },
        media: null,
      },
    ],
  },
  // Article 2: Literal % in title
  {
    id: 'art-002',
    slug: 'postgresql-100-percent-guide',
    title: 'PostgreSQL 100% Efficiency with Index Optimization',
    summary: 'Achieving 100% index coverage and zero sequence scans in PostgreSQL workloads.',
    typographyPreset: 'MODERN_SANS',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-16T11:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_BACKEND,
    tags: [TAG_DATABASE],
    blocks: [
      {
        id: 'blk-002-1',
        type: 'HEADING',
        position: 0,
        schemaVersion: 1,
        content: { level: 2, text: 'Index Coverage Basics' },
        media: null,
      },
    ],
  },
  // Article 3: Literal _ in title
  {
    id: 'art-003',
    slug: 'postgresql-internal-storage',
    title: 'PostgreSQL_Internal_Storage Engine Deep Dive',
    summary: 'Understanding postgresql_internal_storage and physical page layout mechanics.',
    typographyPreset: 'TECHNICAL_MINIMAL',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-17T12:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_BACKEND,
    tags: [TAG_DATABASE],
    blocks: [],
  },
  // Article 4: Literal \ in title
  {
    id: 'art-004',
    slug: 'postgresql-dt-commands',
    title: 'PostgreSQL \\dt and \\di Catalog Inspection Techniques',
    summary: 'Mastering psql meta-commands including \\dt and system catalogs for schema auditing.',
    typographyPreset: 'EDITORIAL_SERIF',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-18T13:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_BACKEND,
    tags: [TAG_DATABASE],
    blocks: [],
  },
  // Articles 5 to 21 (all matching backend-engineering, database, postgresql)
  ...Array.from({ length: 17 }, (_, i) => {
    const num = i + 5;
    const pad = String(num).padStart(3, '0');
    return {
      id: `art-${pad}`,
      slug: `postgresql-scaling-pattern-${pad}`,
      title: `PostgreSQL Distributed Scaling Pattern ${pad}`,
      summary: `Design patterns and operational practices for PostgreSQL data partitioning and sharding variant ${pad}.`,
      typographyPreset: 'TECHNICAL_MINIMAL',
      cover: null,
      revision: 1,
      publishedAt: `2026-10-19T${String(10 + (i % 12)).padStart(2, '0')}:00:00.000Z`,
      taxonomyCaptured: true,
      category: CATEGORY_BACKEND,
      tags: [TAG_DATABASE],
      blocks: [],
    } as PublicArticleDetailResponse;
  }),
  // Article 22: Long title and summary for responsive / layout testing
  {
    id: 'art-022',
    slug: 'long-title-layout-testing',
    title: 'A Very Long Technical Architecture Title Designed Explicitly For Responsive Layout Testing Across Mobile Viewports',
    summary: 'An extensive and comprehensive summary to evaluate responsive card height constraints, text truncation, and boundary conditions across varied browser display widths.',
    typographyPreset: 'MODERN_SANS',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-25T14:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_FRONTEND,
    tags: [TAG_ANGULAR],
    blocks: [
      {
        id: 'blk-022-1',
        type: 'HEADING',
        position: 0,
        schemaVersion: 1,
        content: { level: 2, text: 'Responsive Typography Evaluation' },
        media: null,
      },
    ],
  },
  // Article 23: Unicode content
  {
    id: 'art-023',
    slug: 'unicode-internationalization-guide',
    title: 'Unicode & Internationalization in Modern Web Apps: 🚀 日本語, Français, Español',
    summary: 'Handling UTF-8, multi-byte glyphs, emojis, and internationalization in technical web publishing platforms.',
    typographyPreset: 'EDITORIAL_SERIF',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-26T15:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_FRONTEND,
    tags: [TAG_ANGULAR],
    blocks: [],
  },
  // Article 24: Legacy article without captured taxonomy
  {
    id: 'art-024',
    slug: 'legacy-prototype-notes',
    title: 'Legacy Architecture Notes from Initial Prototype',
    summary: 'Historical documentation published prior to structured taxonomy capture.',
    typographyPreset: 'MODERN_SANS',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-27T16:00:00.000Z',
    taxonomyCaptured: false,
    category: null,
    tags: [],
    blocks: [],
  },
  // Article 25: Minimalist article without cover media
  {
    id: 'art-025',
    slug: 'minimalist-architecture-no-cover',
    title: 'Minimalist Architecture Without Cover Media',
    summary: 'A clean text-focused article containing zero cover media assets.',
    typographyPreset: 'TECHNICAL_MINIMAL',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-28T17:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_DEVOPS,
    tags: [TAG_SECURITY],
    blocks: [],
  },
  // Article 26: Multiword search target
  {
    id: 'art-026',
    slug: 'mastering-modern-micro-frontends',
    title: 'Mastering Modern Web Architecture with Micro Frontends',
    summary: 'Advanced micro frontend architecture patterns for scalable enterprise applications.',
    typographyPreset: 'MODERN_SANS',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-29T18:00:00.000Z',
    taxonomyCaptured: true,
    category: CATEGORY_FRONTEND,
    tags: [TAG_ANGULAR],
    blocks: [],
  },
];

export interface FixtureQueryOptions {
  page?: number;
  limit?: number;
  category?: string;
  tag?: string;
  q?: string;
}

export function filterArticles(
  articles: PublicArticleDetailResponse[],
  query: FixtureQueryOptions
): PublicArticleListResponse {
  const page = query.page ? Math.max(1, Number(query.page)) : 1;
  const limit = query.limit ? Math.max(1, Number(query.limit)) : 20;
  const q = query.q?.trim().toLowerCase();
  const category = query.category?.trim();
  const tag = query.tag?.trim();

  const filtered = articles.filter((a) => {
    if (q) {
      const titleMatch = a.title.toLowerCase().includes(q);
      const summaryMatch = a.summary ? a.summary.toLowerCase().includes(q) : false;
      if (!titleMatch && !summaryMatch) return false;
    }
    if (category) {
      if (!a.taxonomyCaptured || !a.category || a.category.slug !== category) return false;
    }
    if (tag) {
      if (!a.taxonomyCaptured || !a.tags.some((t) => t.slug === tag)) return false;
    }
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit).map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    typographyPreset: a.typographyPreset,
    cover: a.cover,
    revision: a.revision,
    publishedAt: a.publishedAt,
    taxonomyCaptured: a.taxonomyCaptured,
    category: a.category,
    tags: a.tags,
  }));

  return {
    items: paginated,
    page,
    limit,
    total,
    totalPages,
  };
}

export interface MockState {
  catalogError: number | null; // e.g. 500
  taxonomyError: number | null; // e.g. 500
  readerError: number | null; // e.g. 500 or 404
  catalogDelayMs: number;
  requestLog: { url: string; method: string }[];
  catalogFetchCount: number;
}

export function createMockState(): MockState {
  return {
    catalogError: null,
    taxonomyError: null,
    readerError: null,
    catalogDelayMs: 0,
    requestLog: [],
    catalogFetchCount: 0,
  };
}

/**
 * Installs fail-closed route interception on the Playwright page.
 * Strictly fulfills only the 4 public Article API endpoint families.
 * Blocks all unmatched /api/ traffic with 403 Forbidden.
 */
export async function setupPublicApiMock(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const urlStr = req.url();
    const url = new URL(urlStr);
    const path = url.pathname;

    state.requestLog.push({ url: urlStr, method: req.method() });

    // 1. Categories discovery: GET /api/v1/articles/public/taxonomy/categories
    if (path === '/api/v1/articles/public/taxonomy/categories') {
      if (state.taxonomyError) {
        return route.fulfill({
          status: state.taxonomyError,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: state.taxonomyError, message: 'Taxonomy discovery error' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CATEGORIES),
      });
    }

    // 2. Tags discovery: GET /api/v1/articles/public/taxonomy/tags
    if (path === '/api/v1/articles/public/taxonomy/tags') {
      if (state.taxonomyError) {
        return route.fulfill({
          status: state.taxonomyError,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: state.taxonomyError, message: 'Taxonomy discovery error' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TAGS),
      });
    }

    // 3. Public article catalog: GET /api/v1/articles/public
    if (path === '/api/v1/articles/public') {
      state.catalogFetchCount++;
      if (state.catalogDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.catalogDelayMs));
      }
      if (state.catalogError) {
        return route.fulfill({
          status: state.catalogError,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: state.catalogError, message: 'Internal Server Error' }),
        });
      }

      const query: FixtureQueryOptions = {
        page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : 1,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 20,
        category: url.searchParams.get('category') || undefined,
        tag: url.searchParams.get('tag') || undefined,
        q: url.searchParams.get('q') || undefined,
      };

      const response = filterArticles(MOCK_ARTICLES, query);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    }

    // 4. Public article detail: GET /api/v1/articles/public/:slug
    const detailMatch = path.match(/^\/api\/v1\/articles\/public\/([^/]+)$/);
    if (detailMatch) {
      const slug = decodeURIComponent(detailMatch[1]);
      if (state.readerError) {
        return route.fulfill({
          status: state.readerError,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: state.readerError, message: 'Reader error' }),
        });
      }

      const article = MOCK_ARTICLES.find((a) => a.slug === slug);
      if (!article) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 404, message: 'Article not found' }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(article),
      });
    }

    // CRITICAL API FIREWALL: Fail-closed for any other API traffic
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'BLOCKED_BY_TEST_FIREWALL', path }),
    });
  });
}

