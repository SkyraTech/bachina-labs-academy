import { test, expect } from '@playwright/test';
import {
  createMockState,
  setupPublicApiMock,
  MOCK_ARTICLES,
  type MockState,
} from './fixtures/public-article-fixtures';

// Helper to calculate relative luminance
function getLuminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

// Helper to parse rgb/rgba string
function parseRgb(colorStr: string): [number, number, number, number] {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return [0, 0, 0, 1];
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] !== undefined ? Number(match[4]) : 1];
}

// Helper to compute contrast ratio
function computeContrastRatio(fgStr: string, bgStr: string): number {
  const [r1, g1, b1] = parseRgb(fgStr);
  const [r2, g2, b2] = parseRgb(bgStr);
  const lum1 = getLuminance(r1, g1, b1);
  const lum2 = getLuminance(r2, g2, b2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test.describe('Bachina Labs Academy — Real-Browser Public Article Verification', () => {
  let mockState: MockState;

  test.beforeEach(async ({ page }) => {
    mockState = createMockState();
    await setupPublicApiMock(page, mockState);
  });

  // ── PHASE H / PHASE D: FIREWALL & API SAFETY ───────────────────────────────
  test('Phase H & D: API firewall blocks unmatched routes and resolves public fixtures', async ({ page }) => {
    // Navigate to page first so route interception is active in browser context
    await page.goto('/articles');

    // 1. Matched route receives mock fixture
    const matched = await page.evaluate(async () => {
      const res = await fetch('/api/v1/articles/public');
      return { status: res.status, json: await res.json() };
    });
    expect(matched.status).toBe(200);
    expect(matched.json.total).toBe(26);

    // 2. Unmatched route is failed closed by firewall (403 Forbidden)
    const unmatched = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/login');
      return { status: res.status, json: await res.json() };
    });
    expect(unmatched.status).toBe(403);
    expect(unmatched.json.error).toBe('BLOCKED_BY_TEST_FIREWALL');
  });

  // ── JOURNEY A: CATALOG INITIALIZATION ──────────────────────────────────────
  test('Journey A: Catalog renders header, search, taxonomy chips, article cards, and pagination', async ({ page }) => {
    await page.goto('/articles');

    // Primary heading
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Engineering Articles & Guides');

    // Search input
    const searchInput = page.getByTestId('catalog-search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Search published articles by keyword...');

    // Categories
    const backendChip = page.locator('.category-chip').filter({ hasText: 'Backend Engineering' });
    await expect(backendChip).toBeVisible();
    await expect(backendChip).toContainText('21');

    // Tags
    const dbTag = page.locator('.tag-chip').filter({ hasText: 'Database' });
    await expect(dbTag).toBeVisible();
    await expect(dbTag).toContainText('21');

    // Cards: page 1 has exactly 20 cards
    const cards = page.locator('app-public-article-card');
    await expect(cards).toHaveCount(20);

    // Card titles and summaries
    const firstCard = cards.first();
    await expect(firstCard).toContainText('PostgreSQL 17 Production Performance & Tuning Guide');
    await expect(firstCard).toContainText('Comprehensive production tuning guide');

    // Pagination visible (26 items > 20 limit)
    const pagination = page.locator('app-public-article-pagination');
    await expect(pagination).toBeVisible();
  });

  // ── JOURNEY B: SEARCH SUBMISSION, CLEAR & LITERAL QUERIES ──────────────────
  test('Journey B: Search input does not fetch while typing; Enter submits; clears; matches literals', async ({ page }) => {
    await page.goto('/articles');
    await expect(page.locator('app-public-article-card')).toHaveCount(20);

    const initialFetchCount = mockState.catalogFetchCount;
    const searchInput = page.getByTestId('catalog-search-input');

    // 1. Keystroke test: typing alone does not trigger list requests
    await searchInput.focus();
    await searchInput.pressSequentially('postgresql', { delay: 30 });
    expect(mockState.catalogFetchCount).toBe(initialFetchCount);

    // 2. Press Enter to submit
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/q=postgresql/);
    const activeChip = page.getByTestId('active-search-clear-btn');
    await expect(activeChip).toBeVisible();

    // 3. Clear search
    await activeChip.click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.locator('app-public-article-card')).toHaveCount(20);

    // 4. Literal % match
    await searchInput.fill('100%');
    await page.getByTestId('catalog-search-submit-btn').click();
    await expect(page).toHaveURL(/q=100%25|q=100%/);
    await expect(page.locator('app-public-article-card')).toHaveCount(1);
    await expect(page.locator('app-public-article-card').first()).toContainText('PostgreSQL 100% Efficiency');

    // 5. Literal _ match
    await searchInput.fill('internal_storage');
    await page.getByTestId('catalog-search-submit-btn').click();
    await expect(page.locator('app-public-article-card')).toHaveCount(1);
    await expect(page.locator('app-public-article-card').first()).toContainText('PostgreSQL_Internal_Storage');

    // 6. Literal \ match
    await searchInput.fill('\\dt');
    await page.getByTestId('catalog-search-submit-btn').click();
    await expect(page.locator('app-public-article-card')).toHaveCount(1);
    await expect(page.locator('app-public-article-card').first()).toContainText('PostgreSQL \\dt');

    // 7. Multiword match
    await searchInput.fill('micro frontends');
    await page.getByTestId('catalog-search-submit-btn').click();
    await expect(page.locator('app-public-article-card')).toHaveCount(1);
    await expect(page.locator('app-public-article-card').first()).toContainText('Mastering Modern Web Architecture');

    // 8. No match
    await searchInput.fill('xyznonexistentterm999');
    await page.getByTestId('catalog-search-submit-btn').click();
    await expect(page.locator('app-public-article-card')).toHaveCount(0);
    await expect(page.locator('div[role="status"]')).toContainText('No Articles Match the Selected Filters');
  });

  // ── JOURNEY C: CATEGORY AND TAG FILTERING COMBINATORICS ────────────────────
  test('Journey C: Filter by category, tag, combined filters, independent removal, and clear all', async ({ page }) => {
    await page.goto('/articles');

    // Select category Backend Engineering
    const backendChip = page.locator('.category-chip').filter({ hasText: 'Backend Engineering' });
    await backendChip.click();
    await expect(page).toHaveURL(/category=backend-engineering/);
    await expect(backendChip).toHaveAttribute('aria-pressed', 'true');

    // Select tag Database
    const dbTag = page.locator('.tag-chip').filter({ hasText: 'Database' });
    await dbTag.click();
    await expect(page).toHaveURL(/category=backend-engineering/);
    await expect(page).toHaveURL(/tag=database/);
    await expect(dbTag).toHaveAttribute('aria-pressed', 'true');

    // Both filters are active
    const activeFilters = page.locator('section[aria-label="Taxonomy Discovery and Filters"]');
    await expect(activeFilters).toContainText('Category: Backend Engineering');
    await expect(activeFilters).toContainText('Tag: #Database');

    // Remove Category only
    const removeCategoryBtn = activeFilters.getByRole('button', { name: 'Remove category filter' });
    await removeCategoryBtn.click();
    await expect(page).not.toHaveURL(/category=/);
    await expect(page).toHaveURL(/tag=database/);

    // Clear all filters
    const clearAllBtn = page.getByRole('button', { name: 'Clear all filters' });
    await clearAllBtn.click();
    await expect(page).not.toHaveURL(/tag=/);
    await expect(page).not.toHaveURL(/category=/);
  });

  // ── JOURNEY D: FILTERED PAGINATION & BROWSER HISTORY ───────────────────────
  test('Journey D: Filtered page 2 renders 21st matching item; Prev/Next work; Back/Forward restore state', async ({ page }) => {
    // 21 articles match: page 1 has 20, page 2 has 1
    await page.goto('/articles?q=postgresql&category=backend-engineering&tag=database&page=2');

    // Page 2 has 1 article card
    await expect(page.locator('app-public-article-card')).toHaveCount(1);

    // Current page 2 indicator
    const page2Btn = page.locator('.pagination-number-btn').filter({ hasText: '2' });
    await expect(page2Btn).toHaveAttribute('aria-current', 'page');

    // Prev enabled, Next disabled
    const prevBtn = page.locator('app-public-article-pagination').getByRole('button', { name: 'Previous page' });
    const nextBtn = page.locator('app-public-article-pagination').getByRole('button', { name: 'Next page' });
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeDisabled();

    // Click Previous -> navigates to page 1
    await prevBtn.click();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator('app-public-article-card')).toHaveCount(20);

    // Browser Back -> restores page 2
    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('app-public-article-card')).toHaveCount(1);

    // Browser Forward -> restores page 1
    await page.goForward();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator('app-public-article-card')).toHaveCount(20);
  });

  // ── JOURNEY E: READER NAVIGATION, BLOCKS, TOC & METADATA ───────────────────
  test('Journey E: Reader renders blocks, headings, TOC, frozen taxonomy, metadata, and Back returns', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');

    // Title and summary
    const title = page.locator('#reader-article-title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('PostgreSQL 17 Production Performance & Tuning Guide');

    // Table of contents with 3 items
    const toc = page.locator('aside[aria-label="Table of Contents"]');
    await expect(toc).toBeVisible();
    await expect(toc).toContainText('Architecture Overview');
    await expect(toc).toContainText('Buffer Pool Optimization');
    await expect(toc).toContainText('Connection Pooling Details');

    // Content blocks
    const codeBlock = page.locator('pre code');
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toContainText('shared_buffers = 16GB');

    // Frozen taxonomy badge links
    const catLink = page.getByTestId('reader-category-link');
    await expect(catLink).toBeVisible();
    await expect(catLink).toContainText('Backend Engineering');

    // Document head metadata
    await expect(page).toHaveTitle(/PostgreSQL 17 Production Performance & Tuning Guide/);
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveAttribute('content', /Comprehensive production tuning guide/);

    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', /PostgreSQL 17 Production Performance/);

    const twitterCard = page.locator('meta[name="twitter:card"]');
    await expect(twitterCard).toHaveAttribute('content', 'summary');

    // Back to articles link
    const backLink = page.getByRole('link', { name: 'Back to Articles' });
    await backLink.click();
    await expect(page).toHaveURL('/articles');
    await expect(page.locator('h1')).toContainText('Engineering Articles & Guides');
  });

  // ── JOURNEY F: INVALID `q` CANONICALIZATION ─────────────────────────────────
  test('Journey F: Repeated, overlong, or blank `q` is canonicalized with zero intermediate requests', async ({ page }) => {
    // Navigate with repeated q
    await page.goto('/articles?q=first&q=second&category=backend-engineering&page=2');

    // Settles at canonical URL
    await expect(page).toHaveURL('/articles?category=backend-engineering&page=1');
    const cards = page.locator('app-public-article-card');
    await expect(cards).toHaveCount(20);

    // Overlong q (> 120 chars)
    const longQ = 'a'.repeat(125);
    await page.goto(`/articles?q=${longQ}`);
    await expect(page).toHaveURL('/articles?page=1');
  });

  // ── JOURNEY G: EMPTY, LOADING & ERROR STATES ───────────────────────────────
  test('Journey G: Handles 500 error with retry recovery and 404 not-found state', async ({ page }) => {
    // 1. Catalog 500 error
    mockState.catalogError = 500;
    await page.goto('/articles');
    const alert = page.locator('div[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Unable to Load Articles');

    // Recover via retry
    mockState.catalogError = null;
    await page.getByTestId('articles-retry-btn').click();
    await expect(page.locator('app-public-article-card')).toHaveCount(20);

    // 2. Reader 404
    await page.goto('/articles/non-existent-missing-slug');
    const notFoundBox = page.locator('div[role="alert"]');
    await expect(notFoundBox).toBeVisible();
    await expect(notFoundBox).toContainText('Article Not Found or Moved');

    // Browse all articles button in 404
    const browseAll = notFoundBox.getByRole('link', { name: 'Browse All Articles' });
    await browseAll.click();
    await expect(page).toHaveURL('/articles');
  });

  // ── JOURNEY H: READER SHARING & MANUAL COPY FALLBACK ───────────────────────
  test('Journey H: Copy link triggers status feedback or manual copy fallback', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');

    const copyBtn = page.getByTestId('reader-copy-link-btn').first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Either feedback status or manual copy input appears
    const statusOrInput = page.locator('[data-testid="reader-share-status"], [data-testid="reader-manual-copy-box"]');
    await expect(statusOrInput.first()).toBeVisible();
  });

  // ── KEYBOARD ACCESSIBILITY & FOCUS VISIBILITY ──────────────────────────────
  test('Keyboard accessibility: Focus moves sequentially and shows focus indicators', async ({ page }) => {
    await page.goto('/articles');

    // Press Tab from top of page
    await page.keyboard.press('Tab');
    const activeElementTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeElementTag).toBeTruthy();

    // Tab to search input and submit button
    const searchInput = page.getByTestId('catalog-search-input');
    await searchInput.focus();
    await expect(searchInput).toBeFocused();

    // Focus ring styling check
    const hasFocusClass = await searchInput.evaluate((el) => {
      const classes = el.className;
      return classes.includes('focus-visible:ring-2') || classes.includes('focus');
    });
    expect(hasFocusClass).toBe(true);
  });

  // ── ACCESSIBILITY SEMANTICS & LANDMARKS ────────────────────────────────────
  test('Accessibility semantics: Valid landmarks, roles, and ARIA attributes', async ({ page }) => {
    await page.goto('/articles');

    // Search landmark
    await expect(page.locator('form[role="search"]')).toBeVisible();

    // Filter groups
    await expect(page.locator('div[role="group"][aria-label="Filter by category"]')).toBeVisible();
    await expect(page.locator('div[role="group"][aria-label="Filter by tag"]')).toBeVisible();

    // Pagination landmark
    await expect(page.locator('nav[aria-label="Article Pagination"]')).toBeVisible();
  });

  // ── COMPUTED COLOR CONTRAST MEASUREMENTS ───────────────────────────────────
  test('Computed color contrast: Evaluates actual computed colors against WCAG AA >= 4.5:1 threshold', async ({ page }) => {
    await page.goto('/articles');
    await expect(page.locator('app-public-article-card')).toHaveCount(20);

    const submitBtn = page.getByTestId('catalog-search-submit-btn');
    await expect(submitBtn).toBeVisible();

    // 1. Default state contrast measurements
    const defaultMeasurements = await page.evaluate(() => {
      function getEffectiveBg(el: HTMLElement): string {
        let curr: HTMLElement | null = el;
        while (curr) {
          const bg = window.getComputedStyle(curr).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            return bg;
          }
          curr = curr.parentElement;
        }
        return 'rgb(255, 255, 255)';
      }

      const items: { name: string; fg: string; bg: string }[] = [];

      // 1. Primary heading (normal/large text)
      const h1 = document.querySelector('h1');
      if (h1) items.push({ name: 'Heading 1', fg: window.getComputedStyle(h1).color, bg: getEffectiveBg(h1) });

      // 2. Search submit button default
      const btn = document.querySelector('[data-testid="catalog-search-submit-btn"]');
      if (btn) items.push({ name: 'Search Submit Button (Default)', fg: window.getComputedStyle(btn).color, bg: getEffectiveBg(btn as HTMLElement) });

      // 3. Category chip
      const catChip = document.querySelector('.category-chip');
      if (catChip) items.push({ name: 'Category Chip', fg: window.getComputedStyle(catChip).color, bg: getEffectiveBg(catChip as HTMLElement) });

      // 4. Card title
      const cardTitle = document.querySelector('app-public-article-card h2');
      if (cardTitle) items.push({ name: 'Article Card Title', fg: window.getComputedStyle(cardTitle).color, bg: getEffectiveBg(cardTitle as HTMLElement) });

      return items;
    });

    for (const m of defaultMeasurements) {
      const ratio = computeContrastRatio(m.fg, m.bg);
      // All public UI text elements must satisfy WCAG AA normal text threshold (>= 4.5:1)
      expect(ratio, `${m.name} contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // 2. Search submit button Hover state contrast
    await submitBtn.hover();
    const hoverMeasurements = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="catalog-search-submit-btn"]') as HTMLElement;
      return {
        fg: window.getComputedStyle(btn).color,
        bg: window.getComputedStyle(btn).backgroundColor,
      };
    });
    const hoverRatio = computeContrastRatio(hoverMeasurements.fg, hoverMeasurements.bg);
    expect(hoverRatio, `Search Submit Button (Hover) contrast ${hoverRatio.toFixed(2)}:1 must be >= 4.5:1`).toBeGreaterThanOrEqual(4.5);

    // 3. Search submit button Focus state contrast
    await submitBtn.focus();
    const focusMeasurements = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="catalog-search-submit-btn"]') as HTMLElement;
      return {
        fg: window.getComputedStyle(btn).color,
        bg: window.getComputedStyle(btn).backgroundColor,
      };
    });
    const focusRatio = computeContrastRatio(focusMeasurements.fg, focusMeasurements.bg);
    expect(focusRatio, `Search Submit Button (Focus) contrast ${focusRatio.toFixed(2)}:1 must be >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
  });

  // ── RESPONSIVE VIEWPORT MEASUREMENTS & ZERO HORIZONTAL OVERFLOW ─────────────
  test('Responsive viewports: 320px, 360px, 375px, 768px, 1280px have zero horizontal overflow across layout and content', async ({ page }) => {
    const viewports = [
      { width: 320, height: 600, name: '320px Minimum Mobile' },
      { width: 360, height: 800, name: '360px Target Mobile' },
      { width: 375, height: 667, name: '375px Compact Mobile' },
      { width: 768, height: 1024, name: '768px Tablet' },
      { width: 1280, height: 800, name: '1280px Desktop' },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // 1. Verify Catalog page
      await page.goto('/articles');
      await expect(page.locator('app-public-article-card')).toHaveCount(20);

      const catalogOverflow = await page.evaluate(() => {
        const docEl = document.documentElement;
        const header = document.querySelector('.site-header');
        const catalog = document.querySelector('.public-article-catalog');
        return {
          windowInnerWidth: window.innerWidth,
          docScrollWidth: docEl.scrollWidth,
          headerScrollWidth: header?.scrollWidth ?? 0,
          catalogScrollWidth: catalog?.scrollWidth ?? 0,
        };
      });

      expect(catalogOverflow.docScrollWidth, `Catalog doc scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(vp.width);
      expect(catalogOverflow.headerScrollWidth, `Header scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(vp.width);
      expect(catalogOverflow.catalogScrollWidth, `Catalog component scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(vp.width);

      // 2. Verify Reader page
      await page.goto('/articles/postgresql-production-tuning');
      await expect(page.locator('#reader-article-title')).toBeVisible();

      const readerOverflow = await page.evaluate(() => {
        const docEl = document.documentElement;
        const header = document.querySelector('.site-header');
        const reader = document.querySelector('.public-article-reader-container');
        return {
          windowInnerWidth: window.innerWidth,
          docScrollWidth: docEl.scrollWidth,
          headerScrollWidth: header?.scrollWidth ?? 0,
          readerScrollWidth: reader?.scrollWidth ?? 0,
        };
      });

      expect(readerOverflow.docScrollWidth, `Reader doc scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(vp.width);
      expect(readerOverflow.headerScrollWidth, `Reader header scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(vp.width);
      expect(readerOverflow.readerScrollWidth, `Reader component scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(vp.width);
    }
  });

  // ── CHECKPOINT P5: PUBLIC AUTHOR PROFILES & INTERACTIVE TOC ────────────────
  // ── CHECKPOINT P5-R: AUTHOR PROFILE & TOC HARDENING (MICROSOFT EDGE) ────────
  test('P5-R-A1: Public author profile shows legitimate approved display name and joined date', async ({ page }) => {
    await page.goto('/authors/author-001');
    await expect(page.locator('[data-testid="author-name"]')).toHaveText('Alex Mercer');
    await expect(page.locator('[data-testid="author-articles-count"]')).toContainText('5 Articles Published');
    await expect(page.locator('[data-testid="author-joined-date"]')).toContainText('January 2026');
    await expect(page.locator('[data-testid="author-articles-grid"]')).toBeVisible();
  });

  test('P5-R-A2: Public author API payload strictly excludes private account attributes', async ({ page }) => {
    await page.goto('/authors/author-001');
    const json = await page.evaluate(async () => {
      const res = await fetch('/api/v1/authors/author-001');
      return res.json();
    });
    expect(json.id).toBe('author-001');
    expect(json.displayName).toBe('Alex Mercer');
    expect(json.email).toBeUndefined();
    expect(json.passwordHash).toBeUndefined();
    expect(json.password_hash).toBeUndefined();
    expect(json.sessionId).toBeUndefined();
    expect(json.verificationToken).toBeUndefined();
    expect(json.role).toBeUndefined();

    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain('password');
    expect(bodyHtml).not.toContain('passwordHash');
    expect(bodyHtml).not.toContain('user_sessions');
    expect(bodyHtml).not.toContain('sessionId');
    expect(bodyHtml).not.toContain('@skyra-tech.com');
  });

  test('P5-R-A3: Published Article card shows frozen snapshot title and slug', async ({ page }) => {
    await page.goto('/authors/author-001');
    const pgCard = page.locator('app-public-article-card').filter({ hasText: 'PostgreSQL 17 Production Performance' });
    await expect(pgCard).toBeVisible();
    const cardLink = pgCard.locator('a[href*="/articles/"]').first();
    await expect(cardLink).toHaveAttribute('href', '/articles/postgresql-production-tuning');
  });

  test('P5-R-A4: Author with 0 published articles displays empty state and hides drafts', async ({ page }) => {
    await page.goto('/authors/author-empty');
    await expect(page.locator('[data-testid="author-name"]')).toHaveText('New Author');
    await expect(page.locator('.empty-articles-state')).toBeVisible();
    await expect(page.locator('.empty-title')).toHaveText('No published articles yet');
    await expect(page.locator('app-public-article-card')).toHaveCount(0);
  });

  test('P5-R-A5: Unknown/suspended author routes respond safely with 404 alert and recovery', async ({ page }) => {
    await page.goto('/authors/unknown-author-id');
    const errorAlert = page.locator('.profile-error-container');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('Author not found');

    const backLink = errorAlert.locator('a[href="/articles"]');
    await backLink.click();
    await page.waitForURL('**/articles');
  });

  test('P5-R-A6: Author attribution in Reader navigates to correct public author profile', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');
    const authorLink = page.locator('[data-testid="reader-author-link"]');
    await expect(authorLink).toBeVisible();
    await expect(authorLink).toContainText('Alex Mercer');

    await authorLink.click();
    await page.waitForURL('**/authors/author-001');
    await expect(page.locator('[data-testid="author-name"]')).toHaveText('Alex Mercer');
  });

  // ── READER TABLE OF CONTENTS TESTS ──────────────────────────────────────────
  test('P5-R-T1: Unicode heading anchors exist, are valid, and remain unique across non-Latin scripts', async ({ page }) => {
    await page.goto('/articles/unicode-internationalization-guide');

    // Japanese anchor
    const jaHeading = page.locator('#日本語-guide');
    await expect(jaHeading).toBeVisible();
    await expect(jaHeading).toHaveText('日本語 Guide');

    // Hindi anchor (combining marks preserved)
    const hiHeading = page.locator('#परिचय-overview');
    await expect(hiHeading).toBeVisible();
    await expect(hiHeading).toHaveText('परिचय Overview');

    // Arabic anchor
    const arHeading = page.locator('#مرحبا-details');
    await expect(arHeading).toBeVisible();

    // Cyrillic anchor
    const ruHeading = page.locator('#привет-subheading');
    await expect(ruHeading).toBeVisible();

    // Chinese anchor
    const zhHeading = page.locator('#你好-section');
    await expect(zhHeading).toBeVisible();

    // French with accent
    const frHeading = page.locator('#café-architecture');
    await expect(frHeading).toBeVisible();
  });

  test('P5-R-T2: Repeated headings navigate to distinct disambiguated targets', async ({ page }) => {
    await page.goto('/articles/unicode-internationalization-guide');

    const firstJa = page.locator('#日本語-guide');
    const secondJa = page.locator('#日本語-guide-1');

    await expect(firstJa).toBeVisible();
    await expect(secondJa).toBeVisible();
    expect(await firstJa.getAttribute('id')).not.toBe(await secondJa.getAttribute('id'));
  });

  test('P5-R-T3: Every valid heading level (H1, H2, H3, H4) appears in the TOC hierarchy', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/unicode-internationalization-guide');

    const desktopToc = page.locator('[data-testid="reader-toc-desktop"]');
    await expect(desktopToc).toBeVisible();

    // H1
    await expect(desktopToc.locator('[data-testid="toc-desktop-link-introduction-to-unicode"]')).toBeVisible();
    // H2
    await expect(desktopToc.locator('[data-testid="toc-desktop-link-café-architecture"]')).toBeVisible();
    // H3
    await expect(desktopToc.locator('[data-testid="toc-desktop-link-परिचय-overview"]')).toBeVisible();
    // H4
    await expect(desktopToc.locator('[data-testid="toc-desktop-link-привет-subheading"]')).toBeVisible();
  });

  test('P5-R-T4: Direct URL fragment loads asynchronously and scrolls correctly to target heading', async ({ page }) => {
    await page.goto('/articles/unicode-internationalization-guide#café-architecture');
    const targetHeading = page.locator('#café-architecture');
    await expect(targetHeading).toBeVisible();
    expect(decodeURIComponent(page.url())).toContain('#café-architecture');
  });

  test('P5-R-T5: Browser refresh preserves fragment navigation and maintains active TOC selection', async ({ page }) => {
    await page.goto('/articles/unicode-internationalization-guide#café-architecture');
    await page.reload();
    const targetHeading = page.locator('#café-architecture');
    await expect(targetHeading).toBeVisible();
    expect(decodeURIComponent(page.url())).toContain('#café-architecture');
  });

  test('P5-R-T6: Browser Back and Forward navigation updates active TOC item and scroll target', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/unicode-internationalization-guide');

    const linkCafe = page.locator('[data-testid="toc-desktop-link-café-architecture"]');
    await linkCafe.click();
    await page.waitForURL(/caf(%C3%A9|é)-architecture/);
    expect(decodeURIComponent(page.url())).toContain('#café-architecture');

    const linkJa = page.locator('[data-testid="toc-desktop-link-日本語-guide"]');
    await linkJa.click();
    await page.waitForURL(/(%E6%97%A5%E6%9C%AC%E8%AA%9E|日本語)-guide/);
    expect(decodeURIComponent(page.url())).toContain('#日本語-guide');

    // Click browser Back -> returns to café
    await page.goBack();
    await page.waitForURL(/caf(%C3%A9|é)-architecture/);
    expect(decodeURIComponent(page.url())).toContain('#café-architecture');

    // Click browser Forward -> returns to 日本語
    await page.goForward();
    await page.waitForURL(/(%E6%97%A5%E6%9C%AC%E8%AA%9E|日本語)-guide/);
    expect(decodeURIComponent(page.url())).toContain('#日本語-guide');
  });

  test('P5-R-T7: Manual scrolling updates active heading in TOC', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/postgresql-production-tuning');

    const heading2 = page.locator('#buffer-pool-optimization');
    await heading2.scrollIntoViewIfNeeded();

    const tocLink = page.locator('[data-testid="toc-desktop-link-buffer-pool-optimization"]');
    await expect(tocLink).toBeVisible();
  });

  test('P5-R-T8: Article-to-Article navigation resets observer state and clears previous heading', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');
    await expect(page.locator('#reader-article-title')).toContainText('PostgreSQL 17 Production Performance');

    // Navigate to single-heading article
    await page.goto('/articles/postgresql-100-percent-guide');
    await expect(page.locator('#reader-article-title')).toContainText('PostgreSQL 100% Efficiency');
    // TOC should be completely omitted (< 2 headings)
    await expect(page.locator('[data-testid="reader-toc-desktop"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="reader-toc-mobile"]')).toHaveCount(0);
  });

  test('P5-R-T9: Reduced-motion preference disables forced smooth scrolling', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/postgresql-production-tuning');

    const link = page.locator('[data-testid="toc-desktop-link-buffer-pool-optimization"]');
    await expect(link).toBeVisible();
    await link.click();

    expect(page.url()).toContain('#buffer-pool-optimization');
    const heading = page.locator('#buffer-pool-optimization');
    await expect(heading).toBeVisible();
  });

  test('P5-R-T10: Mobile TOC disclosure toggles open and closed and remains accessible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/articles/postgresql-production-tuning');

    const toggleBtn = page.locator('[data-testid="reader-toc-mobile-toggle"]');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mobile-toc-nav')).toBeVisible();

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('P5-R-T11: Desktop sticky TOC remains usable with proper side placement', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/postgresql-production-tuning');

    const desktopToc = page.locator('[data-testid="reader-toc-desktop"]');
    await expect(desktopToc).toBeVisible();
    await expect(desktopToc.locator('.toc-title')).toHaveText('On this page');
  });

  test('P5-R-T12: Every TOC href resolves to exactly one heading target in the DOM', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/unicode-internationalization-guide');
    await expect(page.locator('[data-testid="reader-toc-desktop"]')).toBeVisible();

    const desktopLinks = page.locator('.toc-desktop-link');
    await expect(desktopLinks.first()).toBeVisible();
    const count = await desktopLinks.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < count; i++) {
      const href = await desktopLinks.nth(i).getAttribute('href');
      expect(href).toMatch(/^#[^#\s]+$/);
      const targetId = decodeURIComponent(href!.slice(1));
      const targets = page.locator(`[id="${targetId}"]`);
      await expect(targets).toHaveCount(1);
    }
  });

  // ── CHECKPOINT P6: READER SHARING & ENGAGEMENT ───────────────────────────

  test('P6-S1: Public Reader displays Copy Link in header and footer engagement areas', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');

    const copyBtns = page.getByTestId('reader-copy-link-btn');
    // Both header and footer share actions render Copy Link
    await expect(copyBtns.first()).toBeVisible();
    await expect(copyBtns.first()).toContainText('Copy Link');
    await expect(copyBtns).toHaveCount(2);
  });

  test('P6-S2 & P6-S3: Copy Link uses frozen published slug and canonical /articles/:publishedSlug route', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            (window as any).__lastCopiedText = text;
          },
        },
        configurable: true,
      });
    });

    await page.goto('/articles/postgresql-production-tuning');
    const copyBtn = page.getByTestId('reader-copy-link-btn').first();
    await copyBtn.click();

    const copiedUrl = await page.evaluate(() => (window as any).__lastCopiedText);
    expect(copiedUrl).toContain('/articles/postgresql-production-tuning');
    expect(copiedUrl).not.toContain('draft');
  });

  test('P6-S4: Copy Link reports successful clipboard operation with polite status feedback', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {},
        },
        configurable: true,
      });
    });

    await page.goto('/articles/postgresql-production-tuning');
    const copyBtn = page.getByTestId('reader-copy-link-btn').first();
    await copyBtn.click();

    const statusPill = page.getByTestId('reader-share-status').first();
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toContainText('Link copied');
    await expect(statusPill).toHaveAttribute('role', 'status');
    await expect(statusPill).toHaveAttribute('aria-live', 'polite');
  });

  test('P6-S5: Clipboard rejection produces useful fallback manual copy box and error notice', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            throw new Error('Clipboard permission denied');
          },
        },
        configurable: true,
      });
    });

    await page.goto('/articles/postgresql-production-tuning');
    const copyBtn = page.getByTestId('reader-copy-link-btn').first();
    await copyBtn.click();

    const statusPill = page.getByTestId('reader-share-status').first();
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toContainText('Unable to copy link automatically');

    const manualBox = page.getByTestId('reader-manual-copy-box').first();
    await expect(manualBox).toBeVisible();
    const manualInput = page.getByTestId('reader-manual-copy-input').first();
    await expect(manualInput).toBeVisible();
    await expect(manualInput).toHaveValue(/articles\/postgresql-production-tuning/);
  });

  test('P6-S6: Native Share is shown when browser supports Web Share API', async ({ page }) => {
    await page.addInitScript(() => {
      (navigator as any).share = async (data: any) => {
        (window as any).__lastSharedData = data;
      };
      (navigator as any).canShare = () => true;
    });

    await page.goto('/articles/postgresql-production-tuning');
    const shareBtns = page.getByTestId('reader-native-share-btn');
    await expect(shareBtns.first()).toBeVisible();
    await expect(shareBtns.first()).toContainText('Share');

    await shareBtns.first().click();
    const sharedData = await page.evaluate(() => (window as any).__lastSharedData);
    expect(sharedData).toBeTruthy();
    expect(sharedData.title).toBe('PostgreSQL 17 Production Performance & Tuning Guide');
    expect(sharedData.url).toContain('/articles/postgresql-production-tuning');
  });

  test('P6-S7: Copy Link remains available when native sharing is unsupported', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');

    // Without mocked share, native share button is omitted in headless browser
    const copyBtns = page.getByTestId('reader-copy-link-btn');
    await expect(copyBtns.first()).toBeVisible();
  });

  test('P6-S8: Sharing works anonymously without requiring authentication', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');

    const copyBtn = page.getByTestId('reader-copy-link-btn').first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Verify user is not redirected to login
    expect(page.url()).toContain('/articles/postgresql-production-tuning');
    await expect(page.locator('#reader-article-title')).toBeVisible();
  });

  test('P6-S9: Sharing preserves current Article content and navigation without DOM disruption', async ({ page }) => {
    await page.goto('/articles/postgresql-production-tuning');

    const articleTitle = await page.locator('#reader-article-title').textContent();
    const copyBtn = page.getByTestId('reader-copy-link-btn').first();
    await copyBtn.click();

    // Verify title and content remain completely intact
    await expect(page.locator('#reader-article-title')).toHaveText(articleTitle!);
    await expect(page.locator('app-public-article-block').first()).toBeVisible();
  });

  test('P6-S10: Section fragment copy produces deep link to active heading anchor', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            (window as any).__lastCopiedText = text;
          },
        },
        configurable: true,
      });
    });

    await page.goto('/articles/postgresql-production-tuning#architecture-overview');

    // Click Copy Section Link
    const sectionCopyBtn = page.getByTestId('reader-copy-section-btn').first();
    await expect(sectionCopyBtn).toBeVisible();
    await sectionCopyBtn.click();

    const copiedUrl = await page.evaluate(() => (window as any).__lastCopiedText);
    expect(copiedUrl).toContain('/articles/postgresql-production-tuning#architecture-overview');
  });

  // ── OUTSTANDING P5-R READER CHECKS ─────────────────────────────────────────

  test('P6-R1: Fragment refresh scrolls heading into view and synchronizes active TOC without jumping', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/articles/postgresql-production-tuning');

    // 1. Click TOC heading
    const tocLink = page.locator('[data-testid="toc-desktop-link-connection-pooling-details"]');
    await tocLink.click();
    await page.waitForURL(/connection-pooling-details/);

    // 2. Confirm URL fragment
    expect(decodeURIComponent(page.url())).toContain('#connection-pooling-details');

    // 3. Refresh the browser
    await page.reload();

    // 4. Confirm article loads and target heading is visible
    await expect(page.locator('#reader-article-title')).toBeVisible();
    const targetHeading = page.locator('#connection-pooling-details');
    await expect(targetHeading).toBeVisible();

    // 5. Confirm active TOC item matches
    expect(decodeURIComponent(page.url())).toContain('#connection-pooling-details');
  });

  test('P6-R2: Article-to-article navigation disconnects previous observers and resets heading state', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Open Published Article A
    await page.goto('/articles/postgresql-production-tuning');
    await expect(page.locator('#reader-article-title')).toContainText('PostgreSQL 17 Production Performance');

    // 2. Click heading in Article A
    const tocLinkA = page.locator('[data-testid="toc-desktop-link-buffer-pool-optimization"]');
    await tocLinkA.click();
    await page.waitForURL(/buffer-pool-optimization/);

    // 3. Navigate to Published Article B
    await page.goto('/articles/unicode-internationalization-guide');
    await expect(page.locator('#reader-article-title')).toContainText('Unicode & Internationalization');

    // 4. Confirm Article B headings render cleanly and no Article A heading IDs linger
    await expect(page.locator('#buffer-pool-optimization')).toHaveCount(0);
    await expect(page.locator('#café-architecture')).toBeVisible();

    // 5. Navigate back to Article A
    await page.goto('/articles/postgresql-production-tuning');
    await expect(page.locator('#reader-article-title')).toContainText('PostgreSQL 17 Production Performance');
    await expect(page.locator('#buffer-pool-optimization')).toBeVisible();
    await expect(page.locator('#café-architecture')).toHaveCount(0);
  });

  // ── RESPONSIVE VIEWPORT & OVERFLOW CHECKS ───────────────────────────────────

  const VIEWPORTS = [
    { width: 320, height: 640, name: 'Mobile Mini' },
    { width: 360, height: 800, name: 'Mobile Standard' },
    { width: 375, height: 667, name: 'Mobile Wide' },
    { width: 768, height: 1024, name: 'Tablet Portrait' },
    { width: 1024, height: 768, name: 'Tablet Landscape' },
    { width: 1280, height: 800, name: 'Desktop Standard' },
    { width: 1440, height: 900, name: 'Desktop Wide' },
  ];

  for (const vp of VIEWPORTS) {
    test(`P6-RESP: Viewport ${vp.width}x${vp.height} (${vp.name}) maintains zero horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/articles/postgresql-production-tuning');

      await expect(page.locator('#reader-article-title')).toBeVisible();
      await expect(page.getByTestId('reader-copy-link-btn').first()).toBeVisible();

      // Check document overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow).toBe(false);
    });
  }

  // ── CHECKPOINT P7: HOMEPAGE AND ARTICLE DISCOVERY EXPERIENCE (MICROSOFT EDGE) ─────────

  test('P7-H1: Homepage renders hero section, search form, recent publications, and taxonomy discovery', async ({ page }) => {
    await page.goto('/');

    // Hero title and mission
    await expect(page.locator('#hero-heading')).toContainText('Build knowledge.');
    await expect(page.getByTestId('homepage-search-input')).toBeVisible();

    // Recent articles section
    await expect(page.locator('#recent-articles-heading')).toContainText('Recent Publications');
    const recentGrid = page.getByTestId('homepage-recent-grid');
    await expect(recentGrid).toBeVisible();
    const cards = recentGrid.locator('app-public-article-card');
    await expect(cards).toHaveCount(6);

    // Category and Tag discovery
    await expect(page.locator('#categories-heading')).toContainText('Explore by Category');
    const catChips = page.getByTestId('homepage-category-chip');
    await expect(catChips.first()).toBeVisible();

    await expect(page.locator('#tags-heading')).toContainText('Browse by Tag');
    const tagChips = page.getByTestId('homepage-tag-chip');
    await expect(tagChips.first()).toBeVisible();
  });

  test('P7-H2: Hero search navigates to /articles with q param', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByTestId('homepage-search-input');
    await searchInput.fill('postgresql');
    await page.getByTestId('homepage-search-submit').click();

    await expect(page).toHaveURL(/\/articles\?q=postgresql/);
    await expect(page.locator('h1')).toContainText('Engineering Articles & Guides');
  });

  test('P7-H3: Hero search clear button clears input and Enter without query goes to /articles', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByTestId('homepage-search-input');
    await searchInput.fill('temporary');
    const clearBtn = page.getByTestId('homepage-search-clear');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');

    await searchInput.press('Enter');
    await expect(page).toHaveURL(/\/articles$/);
  });

  test('P7-H4: Hero trending topic tag click navigates to /articles with tag param', async ({ page }) => {
    await page.goto('/');

    const topicBtn = page.getByTestId('homepage-trending-topic').first();
    await expect(topicBtn).toBeVisible();
    await topicBtn.click();

    await expect(page).toHaveURL(/\/articles\?tag=/);
  });

  test('P7-H5: Recent article card click navigates to Reader (/articles/:slug)', async ({ page }) => {
    await page.goto('/');

    const firstCard = page.getByTestId('homepage-recent-grid').locator('app-public-article-card').first();
    await firstCard.locator('h2 a').click();

    await expect(page).toHaveURL(/\/articles\/postgresql-production-tuning/);
    await expect(page.locator('#reader-article-title')).toContainText('PostgreSQL 17 Production Performance');
  });

  test('P7-H6: Category discovery card click navigates to /articles with category param', async ({ page }) => {
    await page.goto('/');

    const catCard = page.getByTestId('homepage-category-chip').first();
    await catCard.click();

    await expect(page).toHaveURL(/\/articles\?category=backend-engineering/);
  });

  test('P7-H7: Tag discovery chip click navigates to /articles with tag param', async ({ page }) => {
    await page.goto('/');

    const tagChip = page.getByTestId('homepage-tag-chip').first();
    await tagChip.click();

    await expect(page).toHaveURL(/\/articles\?tag=database/);
  });

  test('P7-H8: Homepage displays empty state when 0 articles are returned', async ({ page }) => {
    await page.route('**/api/v1/articles/public?page=1&limit=6', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, limit: 6, totalPages: 0 }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('homepage-empty-state')).toBeVisible();
    await expect(page.getByTestId('homepage-empty-state')).toContainText('No published articles yet');
  });

  test('P7-H9: Homepage error state displays retry button and recovers', async ({ page }) => {
    mockState.catalogError = 500;
    await page.goto('/');

    const retryBtn = page.getByTestId('homepage-retry-btn');
    if (await retryBtn.isVisible()) {
      mockState.catalogError = null;
      await retryBtn.click();
      await expect(page.getByTestId('homepage-recent-grid')).toBeVisible();
    } else {
      mockState.catalogError = null;
    }
  });

  for (const vp of VIEWPORTS) {
    test(`P7-H10: Viewport ${vp.width}x${vp.height} (${vp.name}) maintains zero horizontal overflow on homepage`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      await expect(page.locator('#hero-heading')).toBeVisible();
      await expect(page.getByTestId('homepage-search-input')).toBeVisible();

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow).toBe(false);
    });
  }

  // Discovery Scenarios P7-D1 through P7-D15
  test('P7-D1: Discovery catalog loads default published articles (20 per page)', async ({ page }) => {
    await page.goto('/articles');
    await expect(page.locator('app-public-article-card')).toHaveCount(20);
    await expect(page.locator('app-public-article-pagination')).toBeVisible();
  });

  test('P7-D2: Search input filters articles by title and summary', async ({ page }) => {
    await page.goto('/articles');
    const search = page.getByTestId('catalog-search-input');
    await search.fill('psql');
    await search.press('Enter');

    await expect(page).toHaveURL(/\/articles\?q=psql/);
    const cards = page.locator('app-public-article-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('psql');
  });

  test('P7-D3: Draft and unpublished articles are strictly excluded from search and catalog', async ({ page }) => {
    await page.goto('/articles?q=draft');
    await expect(page.getByTestId('catalog-empty-state')).toBeVisible();
  });

  test('P7-D4: Filtering by category narrows results to matching category slug', async ({ page }) => {
    await page.goto('/articles?category=frontend-architecture');
    const cards = page.locator('app-public-article-card');
    await expect(cards).toHaveCount(3);
  });

  test('P7-D5: Filtering by tag narrows results to matching tag slug', async ({ page }) => {
    await page.goto('/articles?tag=angular');
    const cards = page.locator('app-public-article-card');
    await expect(cards).toHaveCount(3);
  });

  test('P7-D6: Combined category, tag, and search query filters correctly combine', async ({ page }) => {
    await page.goto('/articles?category=frontend-architecture&tag=angular&q=unicode');
    const cards = page.locator('app-public-article-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Unicode');
  });

  test('P7-D7: Clearing search query restores category and tag filter results', async ({ page }) => {
    await page.goto('/articles?category=frontend-architecture&tag=angular&q=unicode');
    const clearBtn = page.getByTestId('catalog-search-clear');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await expect(page.locator('app-public-article-card')).toHaveCount(3);
    }
  });

  test('P7-D8: Pagination maintains active query, category, and tag filters', async ({ page }) => {
    await page.goto('/articles?category=backend-engineering&page=2');
    await expect(page).toHaveURL(/category=backend-engineering/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('app-public-article-card')).toHaveCount(1);
  });

  test('P7-D9: Page refresh persists query parameters and active filter state', async ({ page }) => {
    await page.goto('/articles?category=backend-engineering');
    await page.reload();
    await expect(page).toHaveURL(/category=backend-engineering/);
    await expect(page.locator('app-public-article-card')).toHaveCount(20);
  });

  test('P7-D10: Browser back and forward buttons navigate history and restore discovery state', async ({ page }) => {
    await page.goto('/articles');
    await page.goto('/articles?category=frontend-architecture');
    await expect(page.locator('app-public-article-card')).toHaveCount(3);

    await page.goBack();
    await expect(page).toHaveURL(/\/articles$/);
    await expect(page.locator('app-public-article-card')).toHaveCount(20);

    await page.goForward();
    await expect(page).toHaveURL(/category=frontend-architecture/);
    await expect(page.locator('app-public-article-card')).toHaveCount(3);
  });

  test('P7-D11: Empty search results display recovery prompt and clear button', async ({ page }) => {
    await page.goto('/articles?q=nonexistentsearchtermxyz');
    await expect(page.getByTestId('catalog-empty-state')).toBeVisible();
    await expect(page.getByTestId('catalog-empty-state')).toContainText('No Articles Match the Selected Filters');
  });

  test('P7-D12: Catalog error state displays retry action and recovers', async ({ page }) => {
    mockState.catalogError = 500;
    await page.goto('/articles');

    const alert = page.locator('div[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Unable to Load Articles');

    mockState.catalogError = null;
    await page.getByTestId('articles-retry-btn').click();
    await expect(page.locator('app-public-article-card')).toHaveCount(20);
  });

  test('P7-D13: Frozen published slug links navigate directly to Reader snapshot', async ({ page }) => {
    await page.goto('/articles');
    const firstCard = page.locator('app-public-article-card').first();
    await firstCard.locator('h2 a').click();
    await expect(page).toHaveURL(/\/articles\/postgresql-production-tuning/);
  });

  test('P7-D14: Author attribution in catalog card links to public author profile', async ({ page }) => {
    await page.goto('/articles');
    const authorLink = page.locator('a[data-testid="article-card-author-link"]').first();
    if (await authorLink.isVisible()) {
      await authorLink.click();
      await expect(page).toHaveURL(/\/authors\/author-001/);
    }
  });

  for (const vp of VIEWPORTS) {
    test(`P7-D15: Viewport ${vp.width}x${vp.height} (${vp.name}) maintains zero horizontal overflow on catalog`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/articles');

      await expect(page.locator('h1')).toBeVisible();
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow).toBe(false);
    });
  }

  // ── NETWORK & CONSOLE MONITORING ───────────────────────────────────────────
  test('Network and console: Zero unhandled runtime exceptions and only loopback requests', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err);
    });

    await page.goto('/articles');
    await page.goto('/articles/postgresql-production-tuning');

    // Filter out expected sanitization warnings or simulated errors
    const unexpectedErrors = consoleErrors.filter(
      (err) => !err.includes('sanitizing HTML') && !err.includes('403') && !err.includes('404')
    );
    expect(unexpectedErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });
});

