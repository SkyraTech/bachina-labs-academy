import { test, expect } from '@playwright/test';
import { setupAdminMock } from './fixtures/admin-fixtures';

test.describe('Checkpoint P8 — Admin Hub, User Oversight, Article Directory and Platform Metrics', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Part 1: Admin Overview Dashboard Scenarios (P8-D1 to P8-D10)
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('Admin Overview Hub (/admin)', () => {
    test('P8-D1: ADMIN visits /admin and renders authoritative platform metrics with cards', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await expect(page.locator('h1')).toContainText('Platform Administration');
      await expect(page.locator('[data-testid="metric-total-users"]')).toHaveText('12');
      await expect(page.locator('[data-testid="metric-total-articles"]')).toHaveText('35');
      await expect(page.locator('[data-testid="metric-total-categories"]')).toHaveText('6');
      await expect(page.locator('[data-testid="metric-total-tags"]')).toHaveText('18');
    });

    test('P8-D2: User Accounts card breaks down verified, unverified, authors, admins, active, suspended, and disabled counts', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await expect(page.locator('[data-testid="metric-verified-users"]')).toHaveText('10');
      await expect(page.locator('[data-testid="metric-unverified-users"]')).toHaveText('2');
      await expect(page.locator('[data-testid="metric-authors"]')).toHaveText('9');
      await expect(page.locator('[data-testid="metric-admins"]')).toHaveText('3');
      await expect(page.locator('[data-testid="metric-active-users"]')).toHaveText('11');
      await expect(page.locator('[data-testid="metric-suspended-users"]')).toHaveText('1');
      await expect(page.locator('[data-testid="metric-disabled-users"]')).toHaveText('0');
    });

    test('P8-D3: Articles & Publications card breaks down published, draft, archived, and snapshot counts', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await expect(page.locator('[data-testid="metric-published-articles"]')).toHaveText('20');
      await expect(page.locator('[data-testid="metric-draft-articles"]')).toHaveText('12');
      await expect(page.locator('[data-testid="metric-archived-articles"]')).toHaveText('3');
      await expect(page.locator('[data-testid="metric-snapshots"]')).toHaveText('20');
    });

    test('P8-D4: Taxonomy card renders total categories and tags counts', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await expect(page.locator('[data-testid="metric-total-categories"]')).toHaveText('6');
      await expect(page.locator('[data-testid="metric-total-tags"]')).toHaveText('18');
    });

    test('P8-D5: Manage User Directory link navigates to /admin/users', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await page.click('#link-users-directory');
      await expect(page).toHaveURL(/\/admin\/users/);
      await expect(page.locator('h1')).toContainText('User Directory');
    });

    test('P8-D6: Browse Article Oversight link navigates to /admin/articles', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await page.click('#link-articles-directory');
      await expect(page).toHaveURL(/\/admin\/articles/);
      await expect(page.locator('h1')).toContainText('Article Oversight');
    });

    test('P8-D7: Taxonomy quick links navigate to /admin/categories and /admin/tags', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin');

      await page.click('#link-admin-categories');
      await expect(page).toHaveURL(/\/admin\/categories/);

      await page.goto('/admin');
      await page.click('#link-admin-tags');
      await expect(page).toHaveURL(/\/admin\/tags/);
    });

    test('P8-D8: Error banner with retry button appears when metrics fetch fails and recovers on retry', async ({ page }) => {
      await setupAdminMock(page, { failOverview: true });
      await page.goto('/admin');

      const errorBanner = page.locator('.error-banner');
      await expect(errorBanner).toBeVisible();
      await expect(errorBanner).toContainText('Failed to load platform metrics');

      // Now restore backend mock and click Retry
      await setupAdminMock(page, { failOverview: false });
      await page.click('button.retry-btn');

      await expect(errorBanner).toBeHidden();
      await expect(page.locator('[data-testid="metric-total-users"]')).toHaveText('12');
    });

    test('P8-D9: Non-admin role (AUTHOR) is rejected from /admin and redirected', async ({ page }) => {
      await setupAdminMock(page, { role: 'AUTHOR' });
      await page.goto('/admin');

      // roleGuard redirects non-admin to home or appropriate landing
      await expect(page).not.toHaveURL(/\/admin$/);
    });

    test('P8-D10: Unauthenticated visitor is redirected to /login', async ({ page }) => {
      await setupAdminMock(page, { authenticated: false });
      await page.goto('/admin');

      await expect(page).toHaveURL(/\/login/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 2: User Directory Scenarios (P8-U1 to P8-U12)
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('Admin User Directory (/admin/users)', () => {
    test('P8-U1: Renders user table with email, role, status, verified pill, and registered date', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await expect(page.locator('h1')).toContainText('User Directory');
      const rows = page.locator('table.users-table tbody tr');
      await expect(rows).toHaveCount(6);

      const firstRow = rows.first();
      await expect(firstRow.locator('[data-testid="user-email"]')).toContainText('admin@skyra-tech.com');
      await expect(firstRow.locator('[data-testid="user-role"]')).toHaveText('ADMIN');
      await expect(firstRow.locator('[data-testid="user-status"]')).toHaveText('ACTIVE');
      await expect(firstRow.locator('[data-testid="user-verified"]')).toBeVisible();
    });

    test('P8-U2: Sensitive fields (password hashes, secret tokens) are strictly absent from DOM', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      const content = await page.content();
      expect(content).not.toContain('passwordHash');
      expect(content).not.toContain('argon2');
      expect(content).not.toContain('tokenSecret');
    });

    test('P8-U3: Filter by role updates table and synchronizes URL query params', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.selectOption('#users-role-filter', 'ADMIN');
      await expect(page).toHaveURL(/role=ADMIN/);

      const rows = page.locator('table.users-table tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('[data-testid="user-role"]')).toHaveText('ADMIN');
      await expect(rows.nth(1).locator('[data-testid="user-role"]')).toHaveText('ADMIN');
    });

    test('P8-U4: Filter by status updates table and synchronizes URL query params', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.selectOption('#users-status-filter', 'SUSPENDED');
      await expect(page).toHaveURL(/status=SUSPENDED/);

      const rows = page.locator('table.users-table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('[data-testid="user-email"]')).toContainText('suspended.user@skyra-tech.com');
    });

    test('P8-R-U1: Filter by status DISABLED updates table and displays Disabled badge', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.selectOption('#users-status-filter', 'DISABLED');
      await expect(page).toHaveURL(/status=DISABLED/);

      const rows = page.locator('table.users-table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('[data-testid="user-email"]')).toContainText('disabled.account@skyra-tech.com');
      await expect(rows.first().locator('[data-testid="user-status"]')).toHaveText('DISABLED');
    });

    test('P8-U5: Search by email input filters table and synchronizes URL', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.fill('#users-search-input', 'alex');
      await page.press('#users-search-input', 'Enter');
      await expect(page).toHaveURL(/q=alex/);

      const rows = page.locator('table.users-table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('[data-testid="user-email"]')).toContainText('author.alex@skyra-tech.com');
    });

    test('P8-U6: Clear filters button resets all filter criteria and restores table', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users?role=ADMIN&q=secops');

      await page.click('button.clear-filters-btn');
      await expect(page).not.toHaveURL(/role=ADMIN/);
      await expect(page).not.toHaveURL(/q=secops/);

      const rows = page.locator('table.users-table tbody tr');
      await expect(rows).toHaveCount(6);
    });

    test('P8-U7: Empty state rendered when search query produces 0 matches', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.fill('#users-search-input', 'nonexistent-user-query');
      await page.press('#users-search-input', 'Enter');

      await expect(page.locator('.empty-state-wrapper')).toBeVisible();
      await expect(page.locator('.empty-state-wrapper')).toContainText('No users found');
    });

    test('P8-U8: Pagination indicator displays total counts', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await expect(page.locator('[data-testid="users-total-count"]')).toHaveText('6');
      await expect(page.locator('[data-testid="users-page-indicator"]')).toContainText('Page 1 of 1');
    });

    test('P8-U9: Inspect button opens read-only details modal', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.click('#btn-view-user-usr-admin-001');
      const dialog = page.locator('.modal-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('h2')).toHaveText('User Account Details');
    });

    test('P8-U10: Inspect dialog displays ID, email, role, status, verification state', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.click('#btn-view-user-usr-admin-001');
      await expect(page.locator('[data-testid="modal-user-id"]')).toHaveText('usr-admin-001');
      await expect(page.locator('[data-testid="modal-user-email"]')).toHaveText('admin@skyra-tech.com');
      await expect(page.locator('[data-testid="modal-user-role"]')).toHaveText('ADMIN');
      await expect(page.locator('[data-testid="modal-user-status"]')).toHaveText('ACTIVE');
      await expect(page.locator('[data-testid="modal-user-verified"]')).toContainText('Verified');
    });

    test('P8-U11: Inspect dialog strictly contains zero mutation buttons (no delete, no change role, no suspend)', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.click('#btn-view-user-usr-admin-001');
      const dialog = page.locator('.modal-dialog');
      await expect(dialog.locator('button:has-text("Delete")')).toHaveCount(0);
      await expect(dialog.locator('button:has-text("Suspend")')).toHaveCount(0);
      await expect(dialog.locator('button:has-text("Change Role")')).toHaveCount(0);
    });

    test('P8-U12: Close button and Escape key dismiss the user details modal', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/users');

      await page.click('#btn-view-user-usr-admin-001');
      await expect(page.locator('.modal-dialog')).toBeVisible();

      await page.click('#btn-close-user-modal');
      await expect(page.locator('.modal-dialog')).toBeHidden();

      // Re-open and close with Escape
      await page.click('#btn-view-user-usr-admin-001');
      await expect(page.locator('.modal-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-dialog')).toBeHidden();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 3: Article Directory Scenarios (P8-A1 to P8-A12)
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('Admin Article Oversight (/admin/articles)', () => {
    test('P8-A1: Renders articles table with draft titles, authors, and statuses', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await expect(page.locator('h1')).toContainText('Article Oversight');
      const rows = page.locator('table.articles-table tbody tr');
      await expect(rows).toHaveCount(3);

      const firstRow = rows.first();
      await expect(firstRow.locator('[data-testid="article-title"]')).toContainText('High-Performance PostgreSQL Indexing');
      await expect(firstRow.locator('[data-testid="article-author-email"]')).toHaveText('author.alex@skyra-tech.com');
      await expect(firstRow.locator('[data-testid="article-status"]')).toHaveText('PUBLISHED');
      await expect(firstRow.locator('[data-testid="article-revisions"]')).toContainText('d:4 / p:2');
    });

    test('P8-A2: Published article displays public reader link with target="_blank"', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      const pubLink = page.locator('#link-public-article-art-001');
      await expect(pubLink).toBeVisible();
      await expect(pubLink).toHaveAttribute('target', '_blank');
      await expect(pubLink).toHaveAttribute('href', '/articles/high-performance-postgresql-indexing');
    });

    test('P8-A3: Draft article displays no public link and status is DRAFT', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      const draftRow = page.locator('[data-article-id="art-002"]');
      await expect(draftRow.locator('[data-testid="article-status"]')).toHaveText('DRAFT');
      await expect(draftRow.locator('[data-testid="article-public-link"]')).toHaveCount(0);
    });

    test('P8-A4: Archived article displays ARCHIVED status badge', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      const archRow = page.locator('[data-article-id="art-003"]');
      await expect(archRow.locator('[data-testid="article-status"]')).toHaveText('ARCHIVED');
    });

    test('P8-A5: Filter by status updates table and synchronizes URL query params', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await page.selectOption('#articles-status-filter', 'DRAFT');
      await expect(page).toHaveURL(/status=DRAFT/);

      const rows = page.locator('table.articles-table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('[data-testid="article-title"]')).toContainText('Distributed Consensus with Raft');
    });

    test('P8-A6: Search by title or slug filters table and synchronizes URL', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await page.fill('#articles-search-input', 'monolith');
      await page.press('#articles-search-input', 'Enter');
      await expect(page).toHaveURL(/q=monolith/);

      const rows = page.locator('table.articles-table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('[data-testid="article-title"]')).toContainText('Legacy Monolith Decomposition');
    });

    test('P8-A7: Clear filters button resets status filter and search query', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles?status=PUBLISHED&q=indexing');

      await page.click('button.clear-filters-btn');
      await expect(page).not.toHaveURL(/status=PUBLISHED/);
      await expect(page).not.toHaveURL(/q=indexing/);

      const rows = page.locator('table.articles-table tbody tr');
      await expect(rows).toHaveCount(3);
    });

    test('P8-A8: Empty state rendered when search produces zero matching articles', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await page.fill('#articles-search-input', 'nonexistent-topic-query');
      await page.press('#articles-search-input', 'Enter');

      await expect(page.locator('.empty-state-wrapper')).toBeVisible();
      await expect(page.locator('.empty-state-wrapper')).toContainText('No articles found');
    });

    test('P8-A9: Pagination indicator reflects total count', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await expect(page.locator('[data-testid="articles-total-count"]')).toHaveText('3');
      await expect(page.locator('[data-testid="articles-page-indicator"]')).toContainText('Page 1 of 1');
    });

    test('P8-A10: Inspect button opens read-only details modal', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await page.click('#btn-view-article-art-001');
      const dialog = page.locator('.modal-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('h2')).toHaveText('Article Oversight Details');
    });

    test('P8-A11: Inspect modal distinguishes draft title/slug from published title/slug', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await page.click('#btn-view-article-art-001');
      await expect(page.locator('[data-testid="modal-article-draft-title"]')).toContainText('(Draft)');
      await expect(page.locator('[data-testid="modal-article-pub-title"]')).toContainText('(Published)');
      await expect(page.locator('[data-testid="modal-article-draft-slug"]')).toHaveText('/high-performance-postgresql-indexing');
      await expect(page.locator('[data-testid="modal-article-pub-slug"]')).toHaveText('/high-performance-postgresql-indexing');
    });

    test('P8-A12: Inspect dialog contains Open Public Reader link and strictly zero mutation buttons', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/articles');

      await page.click('#btn-view-article-art-001');
      const pubReaderBtn = page.locator('#btn-modal-view-public');
      await expect(pubReaderBtn).toBeVisible();
      await expect(pubReaderBtn).toHaveAttribute('href', '/articles/high-performance-postgresql-indexing');

      const dialog = page.locator('.modal-dialog');
      await expect(dialog.locator('button:has-text("Unpublish")')).toHaveCount(0);
      await expect(dialog.locator('button:has-text("Delete")')).toHaveCount(0);
      await expect(dialog.locator('button:has-text("Archive")')).toHaveCount(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 3b: Admin Comment Moderation Scenarios (P9-B1)
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('Admin Comment Moderation (/admin/comments)', () => {
    test('P9-B1-E1: ADMIN visits /admin/comments and renders comment directory with moderation details', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/comments');

      await expect(page.locator('h1')).toContainText('Comment Moderation');
      await expect(page.locator('table')).toBeVisible();
      await expect(page.locator('text=Jane PostgreSQL')).toBeVisible();
      await expect(page.locator('text=Great article on row lock concurrency!')).toBeVisible();
      await expect(page.locator('table').getByText('Visible', { exact: true })).toBeVisible();
    });

    test('P9-B1-E2: ADMIN opens soft-remove modal and soft-removes comment', async ({ page }) => {
      await setupAdminMock(page);
      await page.goto('/admin/comments');

      await page.click('button:has-text("Soft Remove")');
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await expect(page.locator('#modal-title')).toContainText('Soft-Remove Comment');

      await page.click('button:has-text("Confirm Removal")');
      await expect(page.locator('text=Comment successfully removed from public visibility.')).toBeVisible();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 4: Viewport Responsiveness Across 7 Standard Resolutions
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('Responsive Viewport Verification (0 Horizontal Overflow)', () => {
    const VIEWPORTS = [
      { name: '320px (Small Mobile)', width: 320, height: 640 },
      { name: '360px (Standard Mobile)', width: 360, height: 800 },
      { name: '375px (iPhone SE)', width: 375, height: 667 },
      { name: '414px (Large Mobile)', width: 414, height: 896 },
      { name: '768px (Tablet Portrait)', width: 768, height: 1024 },
      { name: '1024px (Tablet Landscape / Desktop)', width: 1024, height: 768 },
      { name: '1280px (Standard Desktop)', width: 1280, height: 800 },
      { name: '1440px (Wide Desktop)', width: 1440, height: 900 },
    ];

    for (const vp of VIEWPORTS) {
      test(`Admin Overview Hub renders cleanly at ${vp.name} without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupAdminMock(page);
        await page.goto('/admin');

        await expect(page.locator('h1')).toBeVisible();

        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(hasHorizontalOverflow).toBe(false);
      });

      test(`Admin User Directory renders cleanly at ${vp.name} without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupAdminMock(page);
        await page.goto('/admin/users');

        await expect(page.locator('h1')).toBeVisible();

        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(hasHorizontalOverflow).toBe(false);
      });

      test(`Admin Article Directory renders cleanly at ${vp.name} without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupAdminMock(page);
        await page.goto('/admin/articles');

        await expect(page.locator('h1')).toBeVisible();

        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(hasHorizontalOverflow).toBe(false);
      });

      test(`Admin Comment Moderation renders cleanly at ${vp.name} without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupAdminMock(page);
        await page.goto('/admin/comments');

        await expect(page.locator('h1')).toBeVisible();

        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(hasHorizontalOverflow).toBe(false);
      });
    }
  });
});

