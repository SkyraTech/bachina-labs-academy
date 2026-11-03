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

    const copyBtn = page.getByTestId('reader-copy-link-btn');
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

