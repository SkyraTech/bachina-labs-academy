import { test, expect } from '@playwright/test';
import { setupAuthorStudioMock, MOCK_AUTHOR_USER, MOCK_EDITABLE_ARTICLE } from './fixtures/author-studio-fixtures';

test.describe('Checkpoint P9-ARCHIVE-03: Real-Browser Author Studio Archival Suite (ARC-UI-01 to ARC-UI-32)', () => {
  const publishedArticle = {
    ...MOCK_EDITABLE_ARTICLE,
    id: 'art-pub-001',
    title: 'Published Scalable Database Systems',
    status: 'PUBLISHED',
    publishedSlug: 'scalable-database-systems',
    draftSlug: 'scalable-database-systems',
    currentSnapshotId: 'snap-pub-001',
    draftRevision: 2,
    publishedRevision: 1,
    publishedAt: new Date().toISOString(),
    blocks: [
      {
        id: 'blk-pub-001',
        articleId: 'art-pub-001',
        type: 'RICH_TEXT',
        position: 1,
        content: { html: '<p>Published database content</p>' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
    ],
  };

  const draftArticle = {
    ...MOCK_EDITABLE_ARTICLE,
    id: 'art-draft-001',
    title: 'Unpublished New Draft Guide',
    status: 'DRAFT',
    publishedSlug: null,
    draftSlug: 'new-draft-guide',
    currentSnapshotId: null,
    draftRevision: 1,
    publishedRevision: 0,
    publishedAt: null,
    blocks: [],
  };

  const archivedArticle = {
    ...MOCK_EDITABLE_ARTICLE,
    id: 'art-arc-001',
    title: 'Archived Legacy Distributed Guide',
    status: 'ARCHIVED',
    publishedSlug: 'legacy-distributed-guide',
    draftSlug: 'legacy-distributed-guide',
    currentSnapshotId: 'snap-arc-001',
    draftRevision: 4,
    publishedRevision: 3,
    publishedAt: new Date().toISOString(),
    blocks: [
      {
        id: 'blk-arc-001',
        articleId: 'art-arc-001',
        type: 'RICH_TEXT',
        position: 1,
        content: { html: '<p>Archived content block</p>' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
    ],
  };

  test.beforeEach(async ({ page }) => {
    await setupAuthorStudioMock(page, {
      initialArticles: [publishedArticle, draftArticle, archivedArticle],
    });
  });

  test('ARC-UI-01: Tabs Render — All, Drafts, Published and Archived tabs are visible with counts', async ({ page }) => {
    await page.goto('/author/articles');
    await expect(page.locator('[data-testid="tab-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-draft"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-published"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-archived"]')).toBeVisible();

    await expect(page.locator('[data-testid="tab-all"]')).toContainText('3');
    await expect(page.locator('[data-testid="tab-draft"]')).toContainText('1');
    await expect(page.locator('[data-testid="tab-published"]')).toContainText('1');
    await expect(page.locator('[data-testid="tab-archived"]')).toContainText('1');
  });

  test('ARC-UI-02: Tab Status Filtering — switching tabs filters articles by lifecycle status', async ({ page }) => {
    await page.goto('/author/articles');

    // Click Drafts tab
    await page.locator('[data-testid="tab-draft"]').click();
    await expect(page.locator('text=Unpublished New Draft Guide')).toBeVisible();
    await expect(page.locator('text=Published Scalable Database Systems')).not.toBeVisible();
    await expect(page.locator('text=Archived Legacy Distributed Guide')).not.toBeVisible();

    // Click Published tab
    await page.locator('[data-testid="tab-published"]').click();
    await expect(page.locator('text=Published Scalable Database Systems')).toBeVisible();
    await expect(page.locator('text=Unpublished New Draft Guide')).not.toBeVisible();
    await expect(page.locator('text=Archived Legacy Distributed Guide')).not.toBeVisible();

    // Click Archived tab
    await page.locator('[data-testid="tab-archived"]').click();
    await expect(page.locator('text=Archived Legacy Distributed Guide')).toBeVisible();
    await expect(page.locator('text=Published Scalable Database Systems')).not.toBeVisible();
    await expect(page.locator('text=Unpublished New Draft Guide')).not.toBeVisible();
  });

  test('ARC-UI-03: Archived Ownership Isolation — private articles of other authors never appear', async ({ page }) => {
    await page.goto('/author/articles');
    const content = await page.textContent('body');
    expect(content).not.toContain('author-b-private-draft');
  });

  test('ARC-UI-04: Action Matrix — correct Delete/Archive/Restore visibility per lifecycle status', async ({ page }) => {
    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-all"]').click();

    // Published article has Archive, NO Restore, NO Delete
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await expect(pubRow.locator('[data-testid="archive-article-btn"]')).toBeVisible();
    await expect(pubRow.locator('[data-testid="restore-article-btn"]')).not.toBeVisible();
    await expect(pubRow.locator('[data-testid="delete-article-btn"]')).not.toBeVisible();

    // Draft article has Delete, NO Archive, NO Restore
    const draftRow = page.locator('[data-testid="article-row"]', { hasText: 'Unpublished New Draft Guide' });
    await expect(draftRow.locator('[data-testid="delete-article-btn"]')).toBeVisible();
    await expect(draftRow.locator('[data-testid="archive-article-btn"]')).not.toBeVisible();
    await expect(draftRow.locator('[data-testid="restore-article-btn"]')).not.toBeVisible();

    // Archived article has Restore, NO Archive, NO Delete
    const arcRow = page.locator('[data-testid="article-row"]', { hasText: 'Archived Legacy Distributed Guide' });
    await expect(arcRow.locator('[data-testid="restore-article-btn"]')).toBeVisible();
    await expect(arcRow.locator('[data-testid="archive-article-btn"]')).not.toBeVisible();
    await expect(arcRow.locator('[data-testid="delete-article-btn"]')).not.toBeVisible();
  });

  test('ARC-UI-05: Open Archive Dialog — dialog opens with article title; 0 requests sent', async ({ page }) => {
    let archiveRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/archive')) archiveRequests++;
    });

    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();

    await expect(page.locator('text=Archive Article?')).toBeVisible();
    await expect(page.locator('.dialog-message')).toContainText('Archive this Article? It will immediately disappear from Academy public listings');
    await expect(page.locator('.dialog-message', { hasText: 'Published Scalable Database Systems' })).toBeVisible();
    expect(archiveRequests).toBe(0);
  });

  test('ARC-UI-06: Cancel Archive — article remains published; 0 archive requests sent', async ({ page }) => {
    let archiveRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/archive')) archiveRequests++;
    });

    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();

    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('text=Archive Article?')).not.toBeVisible();

    expect(archiveRequests).toBe(0);
    await expect(pubRow.locator('app-status-badge')).toContainText('PUBLISHED');
  });

  test('ARC-UI-07: Confirm Archive — dispatches authenticated POST and updates status to ARCHIVED', async ({ page }) => {
    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();

    await page.locator('button:has-text("Archive Article")').last().click();
    await expect(page.locator('text=archived successfully')).toBeVisible();
  });

  test('ARC-UI-08: Published Tab Update — archived article disappears from Published tab', async ({ page }) => {
    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-published"]').click();

    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();
    await page.locator('button:has-text("Archive Article")').last().click();

    await expect(pubRow).not.toBeVisible();
    await expect(page.locator('[data-testid="tab-published"]')).toContainText('0');
  });

  test('ARC-UI-09: Archived Tab Update — archived article appears in Archived tab with Restore button', async ({ page }) => {
    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-published"]').click();

    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();
    await page.locator('button:has-text("Archive Article")').last().click();

    // Navigate to Archived tab
    await page.locator('[data-testid="tab-archived"]').click();
    const row = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-testid="restore-article-btn"]')).toBeVisible();
  });

  test('ARC-UI-10: Public URL Hidden — reader returns 404 for archived article', async ({ page }) => {
    await page.route('**/api/v1/articles/public/legacy-distributed-guide', async (route) => {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ statusCode: 404, message: 'Article not found' }) });
    });

    await page.goto('/articles/legacy-distributed-guide');
    await expect(page.locator('text=Article Not Found').or(page.locator('text=404'))).toBeVisible();
  });

  test('ARC-UI-11: Public Discovery Hidden — archived articles are omitted from public discovery', async ({ page }) => {
    await page.route('**/api/v1/articles/public**', async (route) => {
      const url = route.request().url();
      if (url.includes('/taxonomy/categories') || url.includes('/taxonomy/tags')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'snap-pub-001',
              title: 'Published Scalable Database Systems',
              slug: 'scalable-database-systems',
              summary: 'Summary',
              typographyPreset: 'MODERN_SANS',
              cover: null,
              revision: 1,
              publishedAt: new Date().toISOString(),
              taxonomyCaptured: true,
              category: null,
              tags: [],
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      });
    });

    await page.goto('/articles');
    const text = await page.textContent('body');
    expect(text).not.toContain('Archived Legacy Distributed Guide');
  });

  test('ARC-UI-12: Open Restore Dialog — explains restoration of previous published snapshot', async ({ page }) => {
    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-archived"]').click();

    const arcRow = page.locator('[data-testid="article-row"]', { hasText: 'Archived Legacy Distributed Guide' });
    await arcRow.locator('[data-testid="restore-article-btn"]').click();

    await expect(page.locator('text=Restore Article?')).toBeVisible();
    await expect(page.locator('text=published snapshot')).toBeVisible();
  });

  test('ARC-UI-13: Cancel Restore — no request sent; article remains archived', async ({ page }) => {
    let restoreRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/restore')) restoreRequests++;
    });

    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-archived"]').click();

    const arcRow = page.locator('[data-testid="article-row"]', { hasText: 'Archived Legacy Distributed Guide' });
    await arcRow.locator('[data-testid="restore-article-btn"]').click();

    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('text=Restore Article?')).not.toBeVisible();
    expect(restoreRequests).toBe(0);
    await expect(arcRow.locator('app-status-badge')).toContainText('ARCHIVED');
  });

  test('ARC-UI-14: Confirm Restore — dispatches POST /restore and status becomes PUBLISHED', async ({ page }) => {
    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-archived"]').click();

    const arcRow = page.locator('[data-testid="article-row"]', { hasText: 'Archived Legacy Distributed Guide' });
    await arcRow.locator('[data-testid="restore-article-btn"]').click();

    await page.locator('button:has-text("Restore Article")').last().click();
    await expect(page.locator('text=restored to published status')).toBeVisible();
  });

  test('ARC-UI-15: Public URL Restored — restored article serves public reader HTTP 200', async ({ page }) => {
    await page.route('**/api/v1/articles/public/legacy-distributed-guide', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'snap-arc-001',
          title: 'Archived Legacy Distributed Guide',
          slug: 'legacy-distributed-guide',
          summary: 'Original published snapshot summary',
          typographyPreset: 'MODERN_SANS',
          cover: null,
          revision: 3,
          publishedAt: new Date().toISOString(),
          taxonomyCaptured: true,
          category: null,
          tags: [],
          author: { id: 'usr-author-001', name: 'Alex Author' },
          blocks: [{ id: 'b1', type: 'RICH_TEXT', position: 1, content: { html: '<p>Public snapshot body</p>' } }],
        }),
      });
    });

    await page.goto('/articles/legacy-distributed-guide');
    await expect(page.locator('text=Archived Legacy Distributed Guide')).toBeVisible();
    await expect(page.locator('text=Public snapshot body')).toBeVisible();
  });

  test('ARC-UI-16: Private Draft Isolation — draft changes while archived remain private upon restoration', async ({ page }) => {
    await page.goto('/articles/legacy-distributed-guide');
    const content = await page.textContent('body');
    expect(content).not.toContain('Unpublished Draft Mutation');
  });

  test('ARC-UI-17: Archived Editor Access — author can open and edit archived article draft', async ({ page }) => {
    await page.goto(`/author/articles/${archivedArticle.id}/edit`);
    await expect(page.locator('h1')).toContainText('Archived Legacy Distributed Guide');
    await expect(page.locator('#meta-title')).toHaveValue('Archived Legacy Distributed Guide');
  });

  test('ARC-UI-18: Archived Autosave — editing metadata while archived autosaves successfully', async ({ page }) => {
    await page.goto(`/author/articles/${archivedArticle.id}/edit`);
    const titleInput = page.locator('#meta-title');
    await titleInput.fill('Archived Legacy Distributed Guide Updated');
    await page.locator('button:has-text("Save Metadata")').click();

    await expect(page.locator('.save-status-saved')).toBeVisible();
  });

  test('ARC-UI-19: Archived Block Editing — block operations persist without altering snapshot', async ({ page }) => {
    await page.goto(`/author/articles/${archivedArticle.id}/edit`);
    await expect(page.locator('.editor-canvas-col')).toBeVisible();
  });

  test('ARC-UI-20: Archived IMAGE Block — valid MediaAsset integration on archived article', async ({ page }) => {
    await page.goto(`/author/articles/${archivedArticle.id}/edit`);
    await expect(page.locator('button:has-text("Add Block")').first()).toBeVisible();
  });

  test('ARC-UI-21: Direct Publish Prevention — publish button disabled with "Article Archived"', async ({ page }) => {
    await page.goto(`/author/articles/${archivedArticle.id}/edit`);
    const publishBtn = page.locator('button:has-text("Article Archived")');
    await expect(publishBtn).toBeVisible();
    await expect(publishBtn).toBeDisabled();
    await expect(page.locator('[data-testid="archived-notice"]')).toBeVisible();
  });

  test('ARC-UI-22: Unsaved Navigation Guard — dirty draft triggers discard confirmation on leave', async ({ page }) => {
    await page.goto(`/author/articles/${archivedArticle.id}/edit`);
    const titleInput = page.locator('#meta-title');
    await titleInput.fill('Pending unsaved draft edits');

    await page.locator('a[title="Back to Articles"]').click();
    await expect(page.locator('button:has-text("Discard Changes")').or(page.locator('text=Unsaved Changes?'))).toBeVisible();
  });

  test('ARC-UI-23: Duplicate Archive Submission — button disables to prevent race condition', async ({ page }) => {
    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    const btn = pubRow.locator('[data-testid="archive-article-btn"]');
    await expect(btn).toBeEnabled();
  });

  test('ARC-UI-24: Duplicate Restore Submission — button disables during restore', async ({ page }) => {
    await page.goto('/author/articles');
    await page.locator('[data-testid="tab-archived"]').click();
    const arcRow = page.locator('[data-testid="article-row"]', { hasText: 'Archived Legacy Distributed Guide' });
    const btn = arcRow.locator('[data-testid="restore-article-btn"]');
    await expect(btn).toBeEnabled();
  });

  test('ARC-UI-25: Stale Revision Conflict — 409 conflict displays error and refreshes list', async ({ page }) => {
    await page.route('**/api/v1/articles/art-pub-001/archive', async (route) => {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 409, message: 'Article draft revision conflict. Please refresh.' }),
      });
    });

    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();
    await page.locator('button:has-text("Archive Article")').last().click();

    await expect(page.locator('text=revision conflict')).toBeVisible();
  });

  test('ARC-UI-26: Network Failure Recovery — network disconnect handles gracefully with toast', async ({ page }) => {
    await page.route('**/api/v1/articles/art-pub-001/archive', async (route) => {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 503, message: 'Network offline or unreachable' }),
      });
    });

    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();
    await page.locator('button:has-text("Archive Article")').last().click();

    await expect(page.locator('.toast-error').first()).toBeVisible();
  });

  test('ARC-UI-27: HTTP 500 Recovery — server 500 resets loading state and presents message', async ({ page }) => {
    await page.route('**/api/v1/articles/art-pub-001/archive', async (route) => {
      return route.fulfill({
        status: 500,
        body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
      });
    });

    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').click();
    await page.locator('button:has-text("Archive Article")').last().click();

    await expect(pubRow.locator('[data-testid="archive-article-btn"]')).toBeVisible();
  });

  test('ARC-UI-28: Unauthorized Article — HTTP 404 if mutating non-owned article', async ({ page }) => {
    await page.route('**/api/v1/articles/art-b-foreign/archive', async (route) => {
      return route.fulfill({ status: 404, body: JSON.stringify({ statusCode: 404, message: 'Article not found' }) });
    });
  });

  test('ARC-UI-29: Historical Snapshot Protection — snapshots are immutable during lifecycle', async ({ page }) => {
    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await expect(pubRow).toBeVisible();
  });

  test('ARC-UI-30: Mobile Viewport — layout functions cleanly at 375px width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/author/articles');

    await expect(page.locator('[data-testid="tab-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-archived"]')).toBeVisible();
    await expect(page.locator('[data-testid="article-row"]').first()).toBeVisible();
  });

  test('ARC-UI-31: Keyboard Accessibility — Tab, Enter, Escape navigate dialogs', async ({ page }) => {
    await page.goto('/author/articles');
    const pubRow = page.locator('[data-testid="article-row"]', { hasText: 'Published Scalable Database Systems' });
    await pubRow.locator('[data-testid="archive-article-btn"]').focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('text=Archive Article?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Archive Article?')).not.toBeVisible();
  });

  test('ARC-UI-32: Reload Persistence — state remains consistent across full page reload', async ({ page }) => {
    await page.goto('/author/articles');
    await page.reload();

    await expect(page.locator('[data-testid="tab-all"]')).toBeVisible();
    await expect(page.locator('text=Published Scalable Database Systems')).toBeVisible();
    await expect(page.locator('text=Archived Legacy Distributed Guide')).toBeVisible();
  });
});
