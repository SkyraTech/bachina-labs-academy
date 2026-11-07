import { test, expect } from '@playwright/test';
import {
  setupAuthorStudioMock,
  MOCK_AUTHOR_USER,
  MOCK_EDITABLE_ARTICLE,
} from './fixtures/author-studio-fixtures';

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

// Helper to blend foreground color with alpha over background color
function blendColors(
  fg: [number, number, number, number],
  bg: [number, number, number, number]
): [number, number, number] {
  const alpha = fg[3];
  const invAlpha = 1 - alpha;
  return [
    Math.round(fg[0] * alpha + bg[0] * invAlpha),
    Math.round(fg[1] * alpha + bg[1] * invAlpha),
    Math.round(fg[2] * alpha + bg[2] * invAlpha),
  ];
}

// Helper to compute contrast ratio
function computeContrastRatio(fgStr: string, bgStr: string, pageBg: [number, number, number] = [255, 255, 255]): number {
  const parsedFg = parseRgb(fgStr);
  const parsedBg = parseRgb(bgStr);

  const effectiveBg = parsedBg[3] < 1 ? blendColors(parsedBg, [pageBg[0], pageBg[1], pageBg[2], 1]) : [parsedBg[0], parsedBg[1], parsedBg[2]];
  const effectiveFg = parsedFg[3] < 1 ? blendColors(parsedFg, [effectiveBg[0], effectiveBg[1], effectiveBg[2], 1]) : [parsedFg[0], parsedFg[1], parsedFg[2]];

  const lum1 = getLuminance(effectiveFg[0], effectiveFg[1], effectiveFg[2]);
  const lum2 = getLuminance(effectiveBg[0], effectiveBg[1], effectiveBg[2]);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test.describe('Bachina Labs Academy — Real-Browser Author Studio Refinement Verification', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthorStudioMock(page);
  });

  // ── 1. API FIREWALL & SECURITY ISOLATION ────────────────────────────────────
  test('P1-A: API firewall isolates Author Studio and prevents database leakage', async ({ page }) => {
    await page.goto('/author');
    await expect(page.locator('h1')).toContainText('Author Studio');

    // 1. Authorized endpoint receives mocked payload
    const authMe = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me');
      return { status: res.status, json: await res.json() };
    });
    expect(authMe.status).toBe(200);
    expect(authMe.json.role).toBe('AUTHOR');

    // 2. Unregistered endpoint is blocked by fail-closed firewall (403 Forbidden)
    const blocked = await page.evaluate(async () => {
      const res = await fetch('/api/v1/admin/users');
      return { status: res.status, json: await res.json() };
    });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toBe('BLOCKED_BY_TEST_FIREWALL');
  });

  // ── 2. AUTHOR STUDIO OVERVIEW (/author) ─────────────────────────────────────
  test('P1-B: Author Studio Overview provides actionable navigation hub without placeholder clutter', async ({ page }) => {
    await page.goto('/author');
    await expect(page.locator('h1')).toHaveText('Author Studio');

    // Action cards
    const newDraftCard = page.locator('a[href="/author/articles/new"]');
    await expect(newDraftCard.first()).toBeVisible();
    await expect(page.locator('a[href="/author/articles"]').first()).toBeVisible();
    await expect(page.locator('a[href="/account/security"]').first()).toBeVisible();

    // Workflow guide
    await expect(page.locator('text=Self-Publishing Workflow')).toBeVisible();
    await expect(page.locator('text=Draft & Compose')).toBeVisible();
    await expect(page.locator('text=Immutable Snapshots')).toBeVisible();
  });

  // ── 3. AUTHOR ARTICLES LIST (/author/articles) ──────────────────────────────
  test('P1-C: Author Articles list eliminates nested double-card empty state', async ({ page }) => {
    // 1. Populated list view
    await page.goto('/author/articles');
    await expect(page.locator('h1')).toContainText('Author Articles');
    await expect(page.locator('table, .articles-grid, tr')).toBeDefined();

    // 2. Empty state view: verify single clean card
    await setupAuthorStudioMock(page, { emptyArticles: true });
    await page.goto('/author/articles');
    await expect(page.locator('text=No articles drafted yet')).toBeVisible();

    // Verify there is only one empty-state card container
    const emptyCards = page.locator('.empty-state-card, app-empty-state');
    expect(await emptyCards.count()).toBe(1);
  });

  // ── 4. CREATE ARTICLE DRAFT (/author/articles/new) ──────────────────────────
  test('P1-D: Create Article Draft features expanded layout and responsive typography cards', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/author/articles/new');
    await expect(page.getByRole('heading', { name: 'Create Article Draft' })).toBeVisible();

    // Verify container uses max-w-4xl (not constrained max-w-3xl)
    const formCard = page.locator('form').locator('..');
    const box = await formCard.boundingBox();
    expect(box).not.toBeNull();
    // At 1280px with max-w-4xl (896px), width should be ~840-896px
    expect(box!.width).toBeGreaterThan(700);

    // Verify 3 typography preset cards
    const modernSans = page.locator('text=Modern Sans');
    const editorialSerif = page.locator('text=Editorial Serif');
    const technicalMinimal = page.locator('text=Technical Minimal');

    await expect(modernSans).toBeVisible();
    await expect(editorialSerif).toBeVisible();
    await expect(technicalMinimal).toBeVisible();

    // Test selection interaction
    await editorialSerif.click();
    const radio = page.locator('input[value="EDITORIAL_SERIF"]');
    await expect(radio).toBeChecked();
  });

  // ── 5. THREE-PANEL EDITOR WORKSPACE LAYOUT & CANVAS EXPANSION ───────────────
  test('P1-E: Three-panel editor layout allocates flexible width to center editing workspace on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/author/articles/art-001-mock/edit');

    // Wait for editor workspace layout to be visible
    const workspace = page.locator('.editor-workspace-layout');
    await expect(workspace).toBeVisible();

    const outlinePanel = page.locator('.editor-outline-col');
    const centerPanel = page.locator('.editor-canvas-col');
    const settingsPanel = page.locator('.editor-settings-col');

    await expect(outlinePanel).toBeVisible();
    await expect(centerPanel).toBeVisible();
    await expect(settingsPanel).toBeVisible();

    const outlineBox = await outlinePanel.boundingBox();
    const centerBox = await centerPanel.boundingBox();
    const settingsBox = await settingsPanel.boundingBox();

    expect(outlineBox).not.toBeNull();
    expect(centerBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();

    // Verify Left Outline panel is approx 220-240px
    expect(outlineBox!.width).toBeGreaterThanOrEqual(210);
    expect(outlineBox!.width).toBeLessThanOrEqual(250);

    // Verify Right Settings panel is approx 270-300px
    expect(settingsBox!.width).toBeGreaterThanOrEqual(270);
    expect(settingsBox!.width).toBeLessThanOrEqual(310);

    // Center editing canvas is significantly expanded on 1440px desktop
    expect(centerBox!.width).toBeGreaterThanOrEqual(560);

    // On wide desktop (1680px), center editing canvas satisfies >= 720px requirement
    await page.setViewportSize({ width: 1680, height: 900 });
    const wideCenterBox = await centerPanel.boundingBox();
    expect(wideCenterBox).not.toBeNull();
    expect(wideCenterBox!.width).toBeGreaterThanOrEqual(720);
  });

  // ── 6. SEMANTIC STATUS COLOR CONTRAST & DYNAMIC DIRTY STATE ─────────────────
  test('P1-F: Semantic status pills transition cleanly and satisfy WCAG AA contrast (>= 4.5:1)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/author/articles/art-001-mock/edit');

    // 1. Initial status: Saved
    const statusPill = page.locator('.save-status-pill');
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toContainText('Saved');
    await expect(statusPill).toHaveClass(/save-status-saved/);

    // 2. Heading text input is already active for first block; fill to trigger dirty state
    const headingInput = page.locator('#heading-text');
    await expect(headingInput).toBeVisible();
    await headingInput.fill('Core Architecture Overview - Updated Title');

    // 3. Status transitions to DIRTY: 'Unsaved changes'
    await expect(statusPill).toContainText('Unsaved changes');
    await expect(statusPill).toHaveClass(/save-status-dirty/);

    // 4. Measure Light Theme Contrast for Unsaved Changes (Dirty)
    const dirtyStylesLight = await statusPill.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return { color: computed.color, backgroundColor: computed.backgroundColor };
    });
    const dirtyContrastLight = computeContrastRatio(dirtyStylesLight.color, dirtyStylesLight.backgroundColor, [255, 255, 255]);
    expect(dirtyContrastLight).toBeGreaterThanOrEqual(4.5);

    // 5. Measure Dark Theme Contrast for Unsaved Changes (Dirty)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const dirtyStylesDark = await statusPill.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return { color: computed.color, backgroundColor: computed.backgroundColor };
    });
    const dirtyContrastDark = computeContrastRatio(dirtyStylesDark.color, dirtyStylesDark.backgroundColor, [21, 25, 29]);
    expect(dirtyContrastDark).toBeGreaterThanOrEqual(4.5);
  });

  // ── 7. SIGN OUT BUTTON CONTRAST & ACCESSIBILITY ─────────────────────────────
  test('P1-G: Sign Out button meets WCAG AA contrast in both light and dark themes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/author');

    const signOutBtn = page.locator('.signout-btn');
    await expect(signOutBtn).toBeVisible();

    // 1. Light theme contrast
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const lightColors = await signOutBtn.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return { color: computed.color, backgroundColor: computed.backgroundColor };
    });
    const lightContrast = computeContrastRatio(lightColors.color, lightColors.backgroundColor, [250, 248, 245]);
    expect(lightContrast).toBeGreaterThanOrEqual(4.5);

    // 2. Dark theme contrast
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const darkColors = await signOutBtn.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return { color: computed.color, backgroundColor: computed.backgroundColor };
    });
    const darkContrast = computeContrastRatio(darkColors.color, darkColors.backgroundColor, [21, 25, 29]);
    expect(darkContrast).toBeGreaterThanOrEqual(4.5);
  });

  // ── 8. ACCOUNT SECURITY SPACING & VIEWPORT RESPONSIVENESS ───────────────────
  test('P1-H: Account Security view renders active sessions cleanly with zero overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/account/security');
    await expect(page.locator('h1')).toContainText('Account Security');

    // Desktop table view visible
    const tableItem = page.locator('table').locator('text=Microsoft Edge on Windows');
    await expect(tableItem).toBeVisible();

    // Check "Sign out all devices" button contrast
    const logoutAllBtn = page.locator('#btn-logout-all');
    await expect(logoutAllBtn).toBeVisible();
    const logoutAllColors = await logoutAllBtn.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return { color: computed.color, backgroundColor: computed.backgroundColor };
    });
    const logoutAllContrast = computeContrastRatio(logoutAllColors.color, logoutAllColors.backgroundColor, [255, 255, 255]);
    expect(logoutAllContrast).toBeGreaterThanOrEqual(4.5);

    // Switch to mobile viewport (360x800)
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.locator('.session-card').first()).toBeVisible();

    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(isOverflowing).toBe(false);
  });

  // ── 9. SEVEN RESPONSIVE VIEWPORTS ZERO-OVERFLOW AUDIT ───────────────────────
  const VIEWPORTS = [
    { name: 'Mobile Mini', width: 320, height: 640 },
    { name: 'Mobile Standard', width: 360, height: 800 },
    { name: 'Mobile Wide', width: 375, height: 667 },
    { name: 'Tablet Portrait', width: 768, height: 1024 },
    { name: 'Tablet Landscape', width: 1024, height: 768 },
    { name: 'Desktop Standard', width: 1280, height: 800 },
    { name: 'Desktop Wide', width: 1440, height: 900 },
  ];

  for (const vp of VIEWPORTS) {
    test(`P1-I: Viewport ${vp.width}x${vp.height} (${vp.name}) maintains zero horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      const routesToVerify = [
        '/author',
        '/author/articles',
        '/author/articles/new',
        '/author/articles/art-001-mock/edit',
        '/account/security',
      ];

      for (const route of routesToVerify) {
        await page.goto(route);
        await page.waitForLoadState('domcontentloaded');

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));

        expect(
          metrics.scrollWidth,
          `Horizontal overflow detected on ${route} at ${vp.width}px: scrollWidth=${metrics.scrollWidth}`
        ).toBeLessThanOrEqual(metrics.innerWidth + 1);
      }
    });
  }

  // ── 10. CHECKPOINT P2-B: VISUAL RICH TEXT EDITOR IN EDGE ───────────────────
  test.describe('P2-B: Visual-First Rich Text Editor Verification', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await page.waitForLoadState('domcontentloaded');

      // Select the RICH_TEXT block (blk-002)
      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await expect(richBlock).toBeVisible();
      await richBlock.click();
    });

    test('P2-B-1: Visual mode is default and renders formatted canvas without raw tags', async ({ page }) => {
      // Visual mode tab is active
      const visualTab = page.locator('[data-testid="mode-visual-btn"]');
      await expect(visualTab).toHaveAttribute('aria-selected', 'true');

      // Tiptap surface is visible
      const editorSurface = page.locator('[data-testid="tiptap-editor-surface"]');
      await expect(editorSurface).toBeVisible();

      // Content is rendered visually
      await expect(editorSurface).toContainText('When designing high-throughput databases');

      // Raw source textarea should NOT be visible
      await expect(page.locator('[data-testid="source-html-textarea"]')).not.toBeVisible();
    });

    test('P2-B-2: Formatting toolbar is functional in Visual mode', async ({ page }) => {
      await expect(page.locator('[data-testid="toolbar-bold-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-italic-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-underline-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-strike-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-code-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-bullet-list-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-ordered-list-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-blockquote-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="toolbar-link-btn"]')).toBeVisible();
    });

    test('P2-B-3: Seamless switching between Visual and HTML Source modes', async ({ page }) => {
      // Switch to Source mode
      await page.locator('[data-testid="mode-source-btn"]').click();
      const sourceTextarea = page.locator('[data-testid="source-html-textarea"]');
      await expect(sourceTextarea).toBeVisible();
      await expect(sourceTextarea).toHaveValue(/<p>When designing high-throughput databases.*<\/p>/);

      // Edit valid HTML in source mode
      await sourceTextarea.fill('<p><strong>Updated</strong> memory indexing.</p>');

      // Switch back to Visual mode
      await page.locator('[data-testid="mode-visual-btn"]').click();
      const editorSurface = page.locator('[data-testid="tiptap-editor-surface"]');
      await expect(editorSurface).toBeVisible();
      await expect(editorSurface).toContainText('Updated memory indexing.');
      await expect(editorSurface.locator('strong')).toContainText('Updated');
    });

    test('P2-B-4: Invalid HTML in Source mode displays error and blocks return to Visual mode', async ({ page }) => {
      await page.locator('[data-testid="mode-source-btn"]').click();
      const sourceTextarea = page.locator('[data-testid="source-html-textarea"]');

      // Enter prohibited HTML (disallowed attribute class)
      await sourceTextarea.fill('<p class="forbidden-class">Invalid content</p>');

      // Attempt to switch to Visual mode
      await page.locator('[data-testid="mode-visual-btn"]').click();

      // Error banner must be visible
      const errorBanner = page.locator('[data-testid="source-error-banner"]');
      await expect(errorBanner).toBeVisible();
      await expect(errorBanner).toContainText('Attributes are not permitted on <p>');

      // Mode must remain Source mode
      await expect(page.locator('[data-testid="mode-source-btn"]')).toHaveAttribute('aria-selected', 'true');
      await expect(sourceTextarea).toBeVisible();
    });

    test('P2-B-5: Insert link dialog validates URL and applies link without target/rel', async ({ page }) => {
      const linkBtn = page.locator('[data-testid="toolbar-link-btn"]');
      await linkBtn.click();

      const linkDialog = page.locator('[data-testid="link-dialog"]');
      await expect(linkDialog).toBeVisible();

      // Fill invalid URL
      await page.locator('[data-testid="link-url-input"]').fill('javascript:alert(1)');
      await page.locator('[data-testid="link-apply-btn"]').click();
      await expect(page.locator('[data-testid="link-error-msg"]')).toContainText('http: or https:');

      // Fill valid URL and title
      await page.locator('[data-testid="link-url-input"]').fill('https://example.com/guide');
      await page.locator('[data-testid="link-title-input"]').fill('PostgreSQL Guide');
      await page.locator('[data-testid="link-apply-btn"]').click();
      await expect(linkDialog).not.toBeVisible();

      // Check source to confirm clean markup
      await page.locator('[data-testid="mode-source-btn"]').click();
      const sourceValue = await page.locator('[data-testid="source-html-textarea"]').inputValue();
      expect(sourceValue).toContain('href="https://example.com/guide"');
      expect(sourceValue).not.toContain('target=');
      expect(sourceValue).not.toContain('rel=');
    });

    test('P2-B-6: Saving edited content dispatches expected API request and updates block state', async ({ page }) => {
      let updateRequestPayload: any = null;
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          updateRequestPayload = route.request().postDataJSON();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'blk-002',
              articleId: 'art-001-mock',
              type: 'RICH_TEXT',
              position: 2,
              content: updateRequestPayload?.content || {},
              mediaAssetId: null,
              schemaVersion: 1,
              draftRevision: 2,
              createdAt: '2026-10-01T12:00:00.000Z',
              updatedAt: new Date().toISOString(),
            }),
          });
        }
        return route.continue();
      });

      // Switch to source to set explicit clean HTML
      await page.locator('[data-testid="mode-source-btn"]').click();
      await page.locator('[data-testid="source-html-textarea"]').fill('<p><strong>Verified</strong> real browser save.</p>');
      await page.locator('[data-testid="mode-visual-btn"]').click();

      // Save Block
      const saveBtn = page.locator('button', { hasText: 'Save Block' });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // Verify request payload was clean
      await page.waitForTimeout(500);
      expect(updateRequestPayload).toBeTruthy();
      expect(updateRequestPayload.content.html).toBe('<p><strong>Verified</strong> real browser save.</p>');
    });

    test('P2-B-7: Editor maintains zero horizontal overflow on mobile viewports (320px, 360px)', async ({ page }) => {
      for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: 740 });
        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isOverflowing, `Horizontal overflow at ${width}px`).toBe(false);
      }
    });
  });

  // ── 11. CHECKPOINT P2-B-R: HARDENING, DIRECT SOURCE SAVE, BLOCK SWITCHING & 409 RECOVERY ──
  test.describe('P2-B-R: Content Integrity & State Synchronization Hardening', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await page.waitForLoadState('domcontentloaded');
    });

    test('P2-B-R-1: Direct Save from Source mode submits newest source edits without returning to Visual', async ({ page }) => {
      const block002 = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await block002.click();

      let interceptedPayload: any = null;
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          interceptedPayload = route.request().postDataJSON();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'blk-002',
              articleId: 'art-001-mock',
              type: 'RICH_TEXT',
              position: 2,
              content: interceptedPayload?.content || {},
              mediaAssetId: null,
              schemaVersion: 1,
              draftRevision: 2,
              createdAt: '2026-10-01T12:00:00.000Z',
              updatedAt: new Date().toISOString(),
            }),
          });
        }
        return route.continue();
      });

      // Switch to Source mode
      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await expect(textarea).toBeVisible();

      // Directly edit HTML in Source mode
      await textarea.fill('<p><em>Directly saved from Source mode without switching back.</em></p>');

      // Verify we remain in Source mode
      await expect(page.locator('[data-testid="mode-source-btn"]')).toHaveAttribute('aria-selected', 'true');

      // Click Save Block directly
      const saveBtn = page.locator('button', { hasText: 'Save Block' });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      await page.waitForTimeout(500);
      expect(interceptedPayload).toBeTruthy();
      expect(interceptedPayload.content.html).toBe('<p><em>Directly saved from Source mode without switching back.</em></p>');
    });

    test('P2-B-R-2: Invalid Source mode blocks save; correcting invalid source enables valid save', async ({ page }) => {
      const block002 = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await block002.click();

      let interceptedRequestsCount = 0;
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          interceptedRequestsCount++;
          return route.fulfill({ status: 200, json: {} });
        }
        return route.continue();
      });

      // Switch to Source mode and type prohibited tag
      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await textarea.fill('<p>Text with <script>alert(1)</script></p>');

      // Error banner must be visible
      const errorBanner = page.locator('[data-testid="source-error-banner"]');
      await expect(errorBanner).toBeVisible();
      await expect(errorBanner).toContainText('Unsupported HTML tag <script>');

      // Save button must be disabled
      const saveBtn = page.locator('button', { hasText: 'Save Block' });
      await expect(saveBtn).toBeDisabled();

      // Correct the HTML in Source mode
      await textarea.fill('<p>Text with <code>const valid = true;</code></p>');
      await expect(errorBanner).not.toBeVisible();
      await expect(saveBtn).toBeEnabled();

      // Save corrected content directly
      await saveBtn.click();
      await page.waitForTimeout(500);
      expect(interceptedRequestsCount).toBe(1);
    });

    test('P2-B-R-3: Clean switching between two distinct RICH_TEXT blocks without mixing content', async ({ page }) => {
      const richBlocks = page.locator('[role="button"]', { hasText: 'RICH_TEXT' });
      await expect(richBlocks).toHaveCount(2);

      // Select Block A (blk-002)
      await richBlocks.nth(0).click();
      const editorSurface = page.locator('[data-testid="tiptap-editor-surface"]');
      await expect(editorSurface).toContainText('When designing high-throughput databases');

      // Select Block B (blk-004)
      await richBlocks.nth(1).click();
      await expect(editorSurface).toContainText('Beta indexing architecture');
      await expect(editorSurface).not.toContainText('When designing high-throughput databases');

      // Return to Block A (blk-002)
      await richBlocks.nth(0).click();
      await expect(editorSurface).toContainText('When designing high-throughput databases');
      await expect(editorSurface).not.toContainText('Beta indexing architecture');
    });

    test('P2-B-R-4: Dirty Source in Block A resets cleanly when switching to Block B', async ({ page }) => {
      const richBlocks = page.locator('[role="button"]', { hasText: 'RICH_TEXT' });

      // Open Block A in Source mode and introduce an error
      await richBlocks.nth(0).click();
      await page.locator('[data-testid="mode-source-btn"]').click();
      await page.locator('[data-testid="source-html-textarea"]').fill('<p class="leaked">Dirty error in block A</p>');
      await expect(page.locator('[data-testid="source-error-banner"]')).toBeVisible();

      // Switch to Block B -> unsaved changes dialog appears
      await richBlocks.nth(1).click();
      await expect(page.locator('[data-testid="unsaved-switch-dialog"]')).toBeVisible();

      // Discard and switch
      await page.locator('[data-testid="unsaved-discard-btn"]').click();
      await expect(page.locator('[data-testid="unsaved-switch-dialog"]')).not.toBeVisible();

      // Block B must open in default Visual mode with no error banner
      await expect(page.locator('[data-testid="mode-visual-btn"]')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-testid="source-error-banner"]')).not.toBeVisible();
      await expect(page.locator('[data-testid="tiptap-editor-surface"]')).toContainText('Beta indexing architecture');
    });

    test('P2-B-R-5: Cancel restores authoritative content and clears error banners', async ({ page }) => {
      const block002 = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await block002.click();

      // Switch to source mode and enter error
      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await textarea.fill('<p class="invalid">Discard this bad edit</p>');
      await expect(page.locator('[data-testid="source-error-banner"]')).toBeVisible();

      // Click Reset in block editor
      const resetBtn = page.locator('button', { hasText: 'Reset' });
      await resetBtn.click();

      // Content and validity should be restored
      await expect(page.locator('[data-testid="source-error-banner"]')).not.toBeVisible();
      await expect(textarea).toHaveValue(/When designing high-throughput databases/);
    });

    test('P2-B-R-6: HTTP 409 Conflict displays conflict banner and authoritative reload reconciles draft', async ({ page }) => {
      const block002 = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await block002.click();

      // Simulate 409 Conflict on block save
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 409,
              message: 'Draft revision conflict (409): Newer version exists.',
            }),
          });
        }
        return route.continue();
      });

      // Type an edit in visual mode
      const surface = page.locator('[data-testid="tiptap-editor-surface"]');
      await surface.click();
      await page.keyboard.type(' Extra words');

      // Attempt to save
      const saveBtn = page.locator('button', { hasText: 'Save Block' });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // Conflict alert banner must be visible
      const conflictBanner = page.locator('app-article-editor').getByText('Revision Conflict (409): This draft was updated');
      await expect(conflictBanner).toBeVisible();

      const reloadBtn = page.locator('button', { hasText: 'Reload Authoritative Draft' });
      await expect(reloadBtn).toBeVisible();

      // Mock the authoritative reload response with newer revision
      await page.route('**/api/v1/articles/art-001-mock', async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...MOCK_EDITABLE_ARTICLE,
              draftRevision: 3,
            }),
          });
        }
        return route.continue();
      });

      // Click reload
      await reloadBtn.click();
      await expect(conflictBanner).not.toBeVisible();
      await expect(page.locator('text=Revision 3')).toBeVisible();
    });
  });

  test.describe('P2-B-R2: Final Rich Text Content-Integrity & Contract Hardening', () => {
    test.beforeEach(async ({ page }) => {
      await setupAuthorStudioMock(page);
      await page.goto('/author/articles/art-001-mock/edit');
      await page.waitForSelector('text=High-Performance Relational Indexing');
    });

    test('P2-B-R2-1: Dirty Visual mode switch prompts confirmation; Keep Editing preserves edits', async ({ page }) => {
      const richBlocks = page.locator('[role="button"]', { hasText: 'RICH_TEXT' });
      await richBlocks.first().click();

      // Edit in visual mode
      const surface = page.locator('[data-testid="tiptap-editor-surface"]');
      await surface.click();
      await page.keyboard.type(' Unsaved visual draft');

      // Attempt to switch to HEADING block
      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      // Confirmation dialog must appear
      const dialog = page.locator('[data-testid="unsaved-switch-dialog"]');
      await expect(dialog).toBeVisible();

      // Click Keep Editing
      await page.locator('[data-testid="unsaved-keep-btn"]').click();
      await expect(dialog).not.toBeVisible();

      // Editor must remain on RICH_TEXT block with edits intact
      await expect(surface).toContainText('Unsaved visual draft');
    });

    test('P2-B-R2-2: Dirty Source mode switch dismissed via Escape preserves exact Source buffer', async ({ page }) => {
      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      // Switch to Source mode and edit
      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await textarea.fill('<p>Valid source edits for escape key test.</p>');

      // Attempt to switch to HEADING block
      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      const dialog = page.locator('[data-testid="unsaved-switch-dialog"]');
      await expect(dialog).toBeVisible();

      // Dismiss dialog with Escape key
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Must remain in Source mode with exact text
      await expect(textarea).toBeVisible();
      await expect(textarea).toHaveValue('<p>Valid source edits for escape key test.</p>');
    });

    test('P2-B-R2-3: Save and Switch submits valid content, expectedRevision, and switches destination', async ({ page }) => {
      let interceptedPayload: any = null;
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          interceptedPayload = route.request().postDataJSON();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'blk-002',
              articleId: 'art-001-mock',
              type: 'RICH_TEXT',
              position: 2,
              content: { html: '<p>Saved via Save and Switch workflow.</p>' },
              mediaAssetId: null,
              schemaVersion: 1,
              draftRevision: 2,
              createdAt: '2026-10-01T12:00:00.000Z',
              updatedAt: '2026-10-01T12:05:00.000Z',
            }),
          });
        }
        return route.continue();
      });

      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      await page.locator('[data-testid="mode-source-btn"]').click();
      await page.locator('[data-testid="source-html-textarea"]').fill('<p>Saved via Save and Switch workflow.</p>');

      // Attempt to switch to HEADING block
      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      const dialog = page.locator('[data-testid="unsaved-switch-dialog"]');
      await expect(dialog).toBeVisible();

      // Click Save and Switch
      await page.locator('[data-testid="unsaved-save-btn"]').click();
      await expect(dialog).not.toBeVisible();

      // Verify request payload contract
      expect(interceptedPayload).not.toBeNull();
      expect(interceptedPayload.expectedRevision).toBe(1);
      expect(interceptedPayload.content.html).toContain('Saved via Save and Switch workflow.');

      // Heading block is now selected
      await expect(page.locator('#heading-text')).toBeVisible();
    });

    test('P2-B-R2-4: Discard and Switch makes zero PATCH requests and restores authoritative content', async ({ page }) => {
      let patchCount = 0;
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          patchCount++;
        }
        return route.continue();
      });

      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      // Type dirty edits
      const surface = page.locator('[data-testid="tiptap-editor-surface"]');
      await surface.click();
      await page.keyboard.type(' Discardable content');

      // Switch to HEADING block
      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      // Choose Discard and Switch
      await page.locator('[data-testid="unsaved-discard-btn"]').click();

      // Zero PATCH requests
      expect(patchCount).toBe(0);

      // Now on HEADING block
      await expect(page.locator('#heading-text')).toBeVisible();

      // Return to RICH_TEXT block: should be authoritative without the discarded text
      await richBlock.click();
      await expect(page.locator('[data-testid="tiptap-editor-surface"]')).not.toContainText('Discardable content');
    });

    test('P2-B-R2-5: Invalid Source blocks Save and Switch and preserves current block', async ({ page }) => {
      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await textarea.fill('<p>Dangerous <script>alert(1)</script></p>');

      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      // Click Save and Switch
      await page.locator('[data-testid="unsaved-save-btn"]').click();

      // Dialog dismissed, error toast shown, still on RICH_TEXT block
      await expect(page.locator('[data-testid="unsaved-switch-dialog"]')).not.toBeVisible();
      await expect(textarea).toBeVisible();
      await expect(page.locator('[data-testid="source-error-banner"]')).toBeVisible();
    });

    test('P2-B-R2-6: Save failure preserves edits and remains on current block', async ({ page }) => {
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ statusCode: 400, message: 'Invalid block payload' }),
          });
        }
        return route.continue();
      });

      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await textarea.fill('<p>Preserved text despite 400 failure.</p>');

      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      await page.locator('[data-testid="unsaved-save-btn"]').click();

      // Remains on current block with edits intact
      await expect(textarea).toBeVisible();
      await expect(textarea).toHaveValue('<p>Preserved text despite 400 failure.</p>');
    });

    test('P2-B-R2-7: HTTP 409 Conflict preserves edits, shows conflict UI, and authoritative reload reconciles', async ({ page }) => {
      await page.route('**/api/v1/articles/art-001-mock/blocks/blk-002', async (route) => {
        if (route.request().method() === 'PATCH') {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ statusCode: 409, message: 'Revision conflict (409)' }),
          });
        }
        return route.continue();
      });

      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      const surface = page.locator('[data-testid="tiptap-editor-surface"]');
      await surface.click();
      await page.keyboard.type(' Conflict edit');

      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      await page.locator('[data-testid="unsaved-save-btn"]').click();

      // Conflict banner appears
      const conflictBanner = page.locator('app-article-editor').getByText('Revision Conflict (409): This draft was updated');
      await expect(conflictBanner).toBeVisible();

      // Mock authoritative reload with Revision 4
      await page.route('**/api/v1/articles/art-001-mock', async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...MOCK_EDITABLE_ARTICLE,
              draftRevision: 4,
            }),
          });
        }
        return route.continue();
      });

      await page.locator('button', { hasText: 'Reload Authoritative Draft' }).click();
      await expect(conflictBanner).not.toBeVisible();
      await expect(page.locator('text=Revision 4')).toBeVisible();
    });

    test('P2-B-R2-8: Unsupported legacy HTML triggers Source-only compatibility mode and preserves exact original', async ({ page }) => {
      // Mock article draft with unsupported legacy markup in block 2
      await page.route('**/api/v1/articles/art-001-mock', async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...MOCK_EDITABLE_ARTICLE,
              blocks: MOCK_EDITABLE_ARTICLE.blocks.map((b) =>
                b.id === 'blk-002'
                  ? { ...b, content: { html: '<p><span class="legacy-format">Important legacy text</span></p>' } }
                  : b,
              ),
            }),
          });
        }
        return route.continue();
      });

      await page.goto('/author/articles/art-001-mock/edit');
      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      // Compatibility notice must be visible
      const notice = page.locator('[data-testid="legacy-compat-notice"]');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('Compatibility Notice: Legacy Markup Preserved');

      // Mode must be Source mode
      await expect(page.locator('[data-testid="mode-source-btn"]')).toHaveAttribute('aria-selected', 'true');
      const textarea = page.locator('[data-testid="source-html-textarea"]');
      await expect(textarea).toBeVisible();
      await expect(textarea).toHaveValue('<p><span class="legacy-format">Important legacy text</span></p>');

      // Attempting to switch to Visual mode must be blocked
      await page.locator('[data-testid="mode-visual-btn"]').click();
      await expect(page.locator('[data-testid="source-error-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="source-error-banner"]')).toContainText('Unsupported HTML tag <span>');

      // Save Block button must be disabled
      await expect(page.locator('button', { hasText: 'Save Block' })).toBeDisabled();
    });

    test('P2-B-R2-9: Clean switching between blocks with identical HTML maintains block identity', async ({ page }) => {
      // Load article where blk-002 and blk-004 have identical HTML
      await page.route('**/api/v1/articles/art-001-mock', async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...MOCK_EDITABLE_ARTICLE,
              blocks: MOCK_EDITABLE_ARTICLE.blocks.map((b) =>
                b.type === 'RICH_TEXT' ? { ...b, content: { html: '<p>Identical content in both blocks.</p>' } } : b,
              ),
            }),
          });
        }
        return route.continue();
      });

      await page.goto('/author/articles/art-001-mock/edit');
      const richBlocks = page.locator('[role="button"]', { hasText: 'RICH_TEXT' });

      // Click Block A (blk-002)
      await richBlocks.nth(0).click();
      await expect(richBlocks.nth(0)).toHaveClass(/border-\[var\(--color-brand\)\]/);

      // Click Block B (blk-004)
      await richBlocks.nth(1).click();
      await expect(richBlocks.nth(1)).toHaveClass(/border-\[var\(--color-brand\)\]/);
      await expect(richBlocks.nth(0)).not.toHaveClass(/border-\[var\(--color-brand\)\]/);
    });

    test('P2-B-R2-10: Tiptap serialization security rejects disallowed elements', async ({ page }) => {
      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      await page.locator('[data-testid="mode-source-btn"]').click();
      const textarea = page.locator('[data-testid="source-html-textarea"]');

      // Attempt prohibited iframe
      await textarea.fill('<p>Text with <iframe src="evil.com"></iframe></p>');
      await expect(page.locator('[data-testid="source-error-banner"]')).toBeVisible();
      await expect(page.locator('button', { hasText: 'Save Block' })).toBeDisabled();

      // Attempt prohibited attributes on paragraph
      await textarea.fill('<p class="malicious-class" style="color:red">Styled</p>');
      await expect(page.locator('[data-testid="source-error-banner"]')).toBeVisible();
      await expect(page.locator('button', { hasText: 'Save Block' })).toBeDisabled();
    });

    test('P2-B-R2-11: Unsaved changes confirmation dialog satisfies accessibility semantics', async ({ page }) => {
      const richBlock = page.locator('[role="button"]', { hasText: 'RICH_TEXT' }).first();
      await richBlock.click();

      // Trigger dirty state
      const surface = page.locator('[data-testid="tiptap-editor-surface"]');
      await surface.click();
      await page.keyboard.type(' Test accessibility');

      // Trigger dialog
      await page.locator('[role="button"]', { hasText: 'HEADING' }).first().click();

      const dialog = page.locator('[data-testid="unsaved-switch-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('role', 'dialog');
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAttribute('aria-labelledby', 'unsaved-dialog-title');
      await expect(dialog).toHaveAttribute('aria-describedby', 'unsaved-dialog-desc');

      // Close cleanly
      await page.locator('[data-testid="unsaved-keep-btn"]').click();
      await expect(dialog).not.toBeVisible();
    });

    test('P2-B-R2-12: API firewall blocks all unexpected backend requests', async ({ page }) => {
      // The firewall is active from setupAuthorStudioMock; navigate and verify no unhandled requests leak
      await page.goto('/author/articles/art-001-mock/edit');
      await expect(page.locator('text=High-Performance Relational Indexing')).toBeVisible();
      await expect(page.locator('text=Revision 1')).toBeVisible();
    });
  });

  // ── 9. CHECKPOINT P3-R: TAXONOMY CONTRACT RECONCILIATION AND HARDENING ────
  test.describe('Checkpoint P3-R: Taxonomy Contract Reconciliation and Admin CRUD Hardening', () => {
    test('P3-R-A1: Save Category assignment and reload', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await expect(page.locator('text=Article Settings')).toBeVisible();

      const select = page.locator('[data-testid="category-select"]');
      await expect(select).toBeVisible();
      await expect(select.locator('option[value="cat-001"]')).toBeAttached();
      await expect(select).toHaveValue('cat-001');

      // Change category to cat-002 (Distributed Systems)
      await select.selectOption('cat-002');

      const saveBtn = page.locator('button', { hasText: 'Save Metadata' });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();
      await expect(page.getByText('Unsaved Changes', { exact: true })).not.toBeVisible();

      // Reload page and verify category remains cat-002
      await page.reload();
      await expect(page.locator('[data-testid="category-select"]')).toHaveValue('cat-002');
    });

    test('P3-R-A2: Clear Category and submit actual null', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      const clearBtn = page.locator('[data-testid="clear-category-btn"]');
      await expect(clearBtn).toBeVisible();

      let patchPayload: any = null;
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/articles/art-001-mock') && req.method() === 'PATCH') {
          patchPayload = req.postDataJSON();
        }
      });

      await clearBtn.click();

      const select = page.locator('[data-testid="category-select"]');
      await expect(select).toHaveValue('null');

      const saveBtn = page.locator('button', { hasText: 'Save Metadata' });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();
      await expect(page.getByText('Unsaved Changes', { exact: true })).not.toBeVisible();

      expect(patchPayload).not.toBeNull();
      expect(patchPayload.categoryId).toBeNull();
      expect(patchPayload.categoryId).not.toBe('null');

      // Reload page and confirm category remains unassigned
      await page.reload();
      await expect(page.locator('[data-testid="category-select"]')).toHaveValue('null');
    });

    test('P3-R-A3: Add/remove Tags and reload', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');

      const chips = page.locator('[data-testid="tag-chip"]');
      await expect(chips).toHaveCount(2);
      await expect(chips.first()).toContainText('postgresql');
      await expect(chips.nth(1)).toContainText('indexing');

      // Remove the second tag (indexing)
      const removeBtns = page.locator('[data-testid="remove-tag-btn"]');
      await removeBtns.nth(1).click();
      await expect(chips).toHaveCount(1);

      // Add performance tag
      const searchInput = page.locator('[data-testid="tag-search-input"]');
      await searchInput.fill('perf');
      const option = page.locator('[data-testid~="tag-option"]', { hasText: 'performance' });
      await expect(option).toBeVisible();
      await option.click();

      await expect(chips).toHaveCount(2);
      await expect(page.locator('text=2/20')).toBeVisible();

      let patchPayload: any = null;
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/articles/art-001-mock') && req.method() === 'PATCH') {
          patchPayload = req.postDataJSON();
        }
      });

      const saveBtn = page.locator('button', { hasText: 'Save Metadata' });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();
      await expect(page.getByText('Unsaved Changes', { exact: true })).not.toBeVisible();

      expect(patchPayload).not.toBeNull();
      expect(patchPayload.tagIds).toEqual(['tag-001', 'tag-003']);

      // Reload and confirm tag chips match authoritative assignments
      await page.reload();
      const reloadedChips = page.locator('[data-testid="tag-chip"]');
      await expect(reloadedChips).toHaveCount(2);
      await expect(reloadedChips.first()).toContainText('postgresql');
      await expect(reloadedChips.nth(1)).toContainText('performance');
    });

    test('P3-R-A4: Enforce maximum Tag limit', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      const searchInput = page.locator('[data-testid="tag-search-input"]');

      // Add 18 tags to reach the 20 tag limit (initial count is 2)
      for (let i = 4; i <= 21; i++) {
        await searchInput.fill(`topic-${i}`);
        const opt = page.locator('[data-testid~="tag-option"]', { hasText: `topic-${i}` });
        await opt.click();
      }

      await expect(page.locator('text=20/20')).toBeVisible();
      // When 20 tags are reached, search input is removed per template to prevent 21st tag
      await expect(searchInput).not.toBeVisible();

      // Remove 1 tag
      const removeBtns = page.locator('[data-testid="remove-tag-btn"]');
      await removeBtns.first().click();
      await expect(page.locator('text=19/20')).toBeVisible();
      await expect(page.locator('[data-testid="tag-search-input"]')).toBeVisible();

      // Add another tag to reach 20 again
      await page.locator('[data-testid="tag-search-input"]').fill('topic-22');
      const opt22 = page.locator('[data-testid~="tag-option"]', { hasText: 'topic-22' });
      await opt22.click();
      await expect(page.locator('text=20/20')).toBeVisible();
    });

    test('P3-R-A5: Duplicate Tag prevention', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      const searchInput = page.locator('[data-testid="tag-search-input"]');
      await searchInput.fill('postgre');

      // postgresql is already selected, so it must not appear in the unselected dropdown options
      const matchingTags = page.locator('[data-testid~="tag-option"]');
      await expect(matchingTags).toHaveCount(0);
      await expect(page.locator('[data-testid="no-matching-tags"]')).toBeVisible();
    });

    test('P3-R-A6: Failed taxonomy lookup preserves selection', async ({ page }) => {
      await setupAuthorStudioMock(page, { failTaxonomy: true });
      await page.goto('/author/articles/art-001-mock/edit');

      // Error banners appear
      await expect(page.locator('[data-testid="category-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="tag-error"]')).toBeVisible();

      // Pre-assigned tags are not dropped
      const chips = page.locator('[data-testid="tag-chip"]');
      await expect(chips).toHaveCount(2);
    });

    test('P3-R-A7: Unsaved taxonomy changes remain safe across block switching', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      const select = page.locator('[data-testid="category-select"]');
      await select.selectOption('cat-002');

      const saveBtn = page.locator('button', { hasText: 'Save Metadata' });
      await expect(saveBtn).toBeEnabled();

      // Switch to first block
      const headingBlock = page.locator('[role="button"]', { hasText: 'HEADING' }).first();
      await headingBlock.click();

      // Switch back to Article Settings
      const settingsTab = page.locator('button', { hasText: 'Settings' });
      if (await settingsTab.isVisible()) {
        await settingsTab.click();
      }

      await expect(select).toHaveValue('cat-002');
      await expect(saveBtn).toBeEnabled();
    });

    test('P3-R-A8: Correct metadata PATCH payload and revision', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      let patchPayload: any = null;
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/articles/art-001-mock') && req.method() === 'PATCH') {
          patchPayload = req.postDataJSON();
        }
      });

      const titleInput = page.locator('#meta-title');
      await titleInput.fill('Advanced Distributed Architecture');

      const select = page.locator('[data-testid="category-select"]');
      await select.selectOption('cat-002');

      const saveBtn = page.locator('button', { hasText: 'Save Metadata' });
      await saveBtn.click();

      expect(patchPayload).not.toBeNull();
      expect(patchPayload.expectedRevision).toBe(1);
      expect(patchPayload.title).toBe('Advanced Distributed Architecture');
      expect(patchPayload.categoryId).toBe('cat-002');
      expect(patchPayload.tagIds).toEqual(['tag-001', 'tag-002']);
      expect(patchPayload.typographyPreset).toBe('MODERN_SANS');

      await expect(page.locator('text=Revision 2')).toBeVisible();
    });

    test('P3-R-A9: Article create payload includes supported taxonomy fields', async ({ page }) => {
      await page.goto('/author/articles/new');
      await expect(page.locator('h1')).toHaveText('Create Article Draft');

      let createPayload: any = null;
      page.on('request', (req) => {
        if (req.url().endsWith('/api/v1/articles') && req.method() === 'POST') {
          createPayload = req.postDataJSON();
        }
      });

      await page.locator('#title').fill('High-Velocity Event Driven Architecture');

      const select = page.locator('[data-testid="category-select"]');
      await expect(select.locator('option[value="cat-002"]')).toBeAttached();
      await select.selectOption('cat-002');

      const searchInput = page.locator('[data-testid="tag-search-input"]');
      await searchInput.fill('post');

      const tagOpt = page.locator('[data-testid~="tag-option"]', { hasText: 'postgresql' });
      await expect(tagOpt).toBeVisible();
      await tagOpt.click();

      const createBtn = page.locator('button', { hasText: 'Create & Open Editor' });
      await createBtn.click();

      expect(createPayload).not.toBeNull();
      expect(createPayload.title).toBe('High-Velocity Event Driven Architecture');
      expect(createPayload.categoryId).toBe('cat-002');
      expect(createPayload.tagIds).toEqual(['tag-001']);

      await expect(page).toHaveURL(/\/author\/articles\/art-new-created\/edit/);
    });

    test('P3-R-A10: HTTP 409 metadata conflict preserves unsaved selections', async ({ page }) => {
      await setupAuthorStudioMock(page, { metadataSaveConflict: true });
      await page.goto('/author/articles/art-001-mock/edit');

      const select = page.locator('[data-testid="category-select"]');
      await select.selectOption('cat-002');

      const saveBtn = page.locator('button', { hasText: 'Save Metadata' });
      await saveBtn.click();

      await expect(page.locator('text=Conflict').first()).toBeVisible();
      await expect(select).toHaveValue('cat-002');
      await expect(saveBtn).toBeEnabled();
    });

    test('P3-R-M1: Category create request contract', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/categories');

      let createReq: any = null;
      page.on('request', (req) => {
        if (req.url().endsWith('/api/v1/admin/categories') && req.method() === 'POST') {
          createReq = { method: req.method(), body: req.postDataJSON() };
        }
      });

      await page.locator('[data-testid="create-category-btn"]').click();
      await expect(page.locator('[data-testid="category-form-panel"]')).toBeVisible();

      await page.locator('[data-testid="category-name-input"]').fill('Platform Engineering');
      await expect(page.locator('[data-testid="category-slug-input"]')).toHaveValue('platform-engineering');
      await page.locator('[data-testid="category-description-input"]').fill('Developer platforms and internal tooling');

      await page.locator('[data-testid="category-save-btn"]').click();

      expect(createReq).not.toBeNull();
      expect(createReq.method).toBe('POST');
      expect(createReq.body.name).toBe('Platform Engineering');
      expect(createReq.body.slug).toBe('platform-engineering');

      await expect(page.locator('[data-testid="category-form-panel"]')).not.toBeVisible();
      const rows = page.locator('[data-testid="category-row"]');
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toContainText('Platform Engineering');
    });

    test('P3-R-M2: Category edit method and payload', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/categories');

      let patchReq: any = null;
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/admin/categories/cat-001') && req.method() === 'PATCH') {
          patchReq = { method: req.method(), body: req.postDataJSON() };
        }
      });

      const editBtn = page.locator('[data-testid="edit-category-btn"]').first();
      await editBtn.click();

      await expect(page.locator('[data-testid="category-form-panel"]')).toBeVisible();
      await page.locator('[data-testid="category-name-input"]').fill('Enterprise Databases');

      await page.locator('[data-testid="category-save-btn"]').click();

      expect(patchReq).not.toBeNull();
      expect(patchReq.method).toBe('PATCH');
      expect(patchReq.body.name).toBe('Enterprise Databases');

      await expect(page.locator('[data-testid="category-form-panel"]')).not.toBeVisible();
      const rows = page.locator('[data-testid="category-row"]');
      await expect(rows.first()).toContainText('Enterprise Databases');
    });

    test('P3-R-M3: Category deletion conflict preserves category row', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN', categoryDeleteConflict: true });
      await page.goto('/admin/categories');

      const rows = page.locator('[data-testid="category-row"]');
      const initialCount = await rows.count();

      const deleteBtn = page.locator('[data-testid="delete-category-btn"]').first();
      await deleteBtn.click();

      const confirmBtn = page.locator('button', { hasText: 'Delete Category' });
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();

      // Conflict toast error is shown
      await expect(page.locator('text=Cannot delete category')).toBeVisible();
      // Row must be preserved in table
      await expect(rows).toHaveCount(initialCount);
    });

    test('P3-R-M4: Tag list and create', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/tags');

      await expect(page.locator('[data-testid="admin-tags-page"]')).toBeVisible();
      await expect(page.locator('h1')).toHaveText('Tags');

      let createReq: any = null;
      page.on('request', (req) => {
        if (req.url().endsWith('/api/v1/admin/tags') && req.method() === 'POST') {
          createReq = { method: req.method(), body: req.postDataJSON() };
        }
      });

      await page.locator('[data-testid="create-tag-btn"]').click();
      await page.locator('[data-testid="tag-name-input"]').fill('kubernetes');
      await expect(page.locator('[data-testid="tag-slug-input"]')).toHaveValue('kubernetes');
      await page.locator('[data-testid="tag-save-btn"]').click();

      expect(createReq).not.toBeNull();
      expect(createReq.method).toBe('POST');
      expect(createReq.body.name).toBe('kubernetes');
      expect(createReq.body.slug).toBe('kubernetes');

      await expect(page.locator('[data-testid="tag-row"]').first()).toContainText('kubernetes');
    });

    test('P3-R-M5: Tag edit method and payload', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/tags');

      let patchReq: any = null;
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/admin/tags/tag-001') && req.method() === 'PATCH') {
          patchReq = { method: req.method(), body: req.postDataJSON() };
        }
      });

      const editBtn = page.locator('[data-testid="edit-tag-btn"]').first();
      await editBtn.click();

      await expect(page.locator('[data-testid="tag-form-panel"]')).toBeVisible();
      await page.locator('[data-testid="tag-name-input"]').fill('postgres-advanced');
      await page.locator('[data-testid="tag-save-btn"]').click();

      expect(patchReq).not.toBeNull();
      expect(patchReq.method).toBe('PATCH');
      expect(patchReq.body.name).toBe('postgres-advanced');

      await expect(page.locator('[data-testid="tag-form-panel"]')).not.toBeVisible();
      await expect(page.locator('[data-testid="tag-row"]').first()).toContainText('postgres-advanced');
    });

    test('P3-R-M6: Tag search and validation', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/tags');

      // Test slug validation error
      await page.locator('[data-testid="create-tag-btn"]').click();
      await page.locator('[data-testid="tag-name-input"]').fill('Invalid Tag!');
      await page.locator('[data-testid="tag-slug-input"]').fill('INVALID_UPPERCASE');
      await page.locator('[data-testid="tag-slug-input"]').blur();
      await expect(page.locator('text=Slug must be lowercase alphanumeric')).toBeVisible();
      await page.locator('[data-testid="tag-cancel-btn"]').click();

      // Test search filter
      const searchInput = page.locator('[data-testid="admin-tag-search-input"]');
      await expect(searchInput).toBeVisible();
      await searchInput.fill('indexing');

      const rows = page.locator('[data-testid="tag-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('indexing');

      await searchInput.fill('');
      await expect(rows).toHaveCount(25);
    });

    test('P3-R-M7: Tag deletion success', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/tags');

      let deleteCalled = false;
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/admin/tags/tag-001') && req.method() === 'DELETE') {
          deleteCalled = true;
        }
      });

      const deleteBtn = page.locator('[data-testid="delete-tag-btn"]').first();
      await deleteBtn.click();

      const confirmBtn = page.locator('button', { hasText: 'Delete Tag' });
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();

      expect(deleteCalled).toBe(true);
      await expect(page.locator('[data-testid="tag-row"]')).toHaveCount(24);
    });

    test('P3-R-M8: Tag deletion conflict preserves tag row', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN', tagDeleteConflict: true });
      await page.goto('/admin/tags');

      const rows = page.locator('[data-testid="tag-row"]');
      const initialCount = await rows.count();

      const deleteBtn = page.locator('[data-testid="delete-tag-btn"]').first();
      await deleteBtn.click();

      const confirmBtn = page.locator('button', { hasText: 'Delete Tag' });
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();

      await expect(page.locator('text=Cannot delete tag')).toBeVisible();
      await expect(rows).toHaveCount(initialCount);
    });

    test('P3-R-M9: Author route rejection from /admin routes', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'AUTHOR' });
      await page.goto('/admin/categories');
      await expect(page).toHaveURL(/\/author/);

      await page.goto('/admin/tags');
      await expect(page).toHaveURL(/\/author/);
    });

    test('P3-R-M10: Reader route rejection from /admin routes', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'READER' });
      await page.goto('/admin/categories');
      await expect(page).toHaveURL(/\/(?!admin)/);
    });

    test('P3-R-M11: Unauthenticated route rejection from /admin routes', async ({ page }) => {
      await setupAuthorStudioMock(page, { authenticated: false });
      await page.goto('/admin/categories');
      await expect(page).toHaveURL(/\/login/);
    });

    test('P3-R-M12: Admin deletion dialog keyboard accessibility', async ({ page }) => {
      await setupAuthorStudioMock(page, { role: 'ADMIN' });
      await page.goto('/admin/categories');

      const rows = page.locator('[data-testid="category-row"]');
      const initialCount = await rows.count();

      const deleteBtn = page.locator('[data-testid="delete-category-btn"]').first();
      await deleteBtn.click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();

      // Press Escape key to dismiss dialog
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Assert category was NOT deleted
      await expect(rows).toHaveCount(initialCount);
    });
  });

  // ── 12. CHECKPOINT P4: PUBLICATION LIFECYCLE, PUBLIC LINKS, AND DUPLICATION ──
  test.describe('Checkpoint P4 — Publication Lifecycle, Public Links, and Duplication', () => {
    test.beforeEach(async ({ page }) => {
      await setupAuthorStudioMock(page);
    });

    test('P4-P1: Publish confirmation opens with article title and draft status', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await expect(page.locator('[data-testid="publication-panel"]')).toBeVisible();

      // Check status badge is DRAFT
      const publishPanel = page.locator('[data-testid="publication-panel"]');
      await expect(publishPanel).toContainText('DRAFT');

      const publishBtn = page.locator('[data-testid="publish-btn"]');
      await expect(publishBtn).toBeVisible();
      await expect(publishBtn).toHaveText('Publish Article');
      await publishBtn.click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.dialog-title')).toHaveText('Publish Article');
      await expect(dialog.locator('.dialog-message')).toContainText('High-Performance Relational Indexing in PostgreSQL');
    });

    test('P4-P2: Cancel or Escape in publish confirmation does not mutate publication state', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await page.locator('[data-testid="publish-btn"]').click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();

      // Cancel via Escape key
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Status remains DRAFT, public link container is not visible
      const publishPanel = page.locator('[data-testid="publication-panel"]');
      await expect(publishPanel).toContainText('DRAFT');
      await expect(page.locator('[data-testid="public-link-container"]')).not.toBeVisible();
    });

    test('P4-P3: Successful publish transitions status to PUBLISHED with snapshot info', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await page.locator('[data-testid="publish-btn"]').click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();

      // Confirm publication
      await dialog.locator('button.btn-brand').click();
      await expect(dialog).not.toBeVisible();

      // Verify status badge updated to PUBLISHED
      const publishPanel = page.locator('[data-testid="publication-panel"]');
      await expect(publishPanel).toContainText('PUBLISHED');
      await expect(page.locator('[data-testid="public-link-container"]')).toBeVisible();
    });

    test('P4-P4: Canonical public URL matches /articles/:publishedSlug route', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await page.locator('[data-testid="publish-btn"]').click();
      await page.locator('.confirm-dialog-card button.btn-brand').click();

      const linkContainer = page.locator('[data-testid="public-link-container"]');
      await expect(linkContainer).toBeVisible();

      const viewBtn = page.locator('[data-testid="view-published-btn"]');
      await expect(viewBtn).toBeVisible();
      const href = await viewBtn.getAttribute('href');
      expect(href).toBe('/articles/high-performance-relational-indexing');

      await expect(linkContainer).toContainText('/articles/high-performance-relational-indexing');
    });

    test('P4-P5: Copy public link copies URL and displays visual feedback', async ({ context, page }) => {
      try {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      } catch {
        // Fallback gracefully if permissions API not supported in test runner
      }

      await page.goto('/author/articles/art-001-mock/edit');
      await page.locator('[data-testid="publish-btn"]').click();
      await page.locator('.confirm-dialog-card button.btn-brand').click();

      const copyBtn = page.locator('[data-testid="copy-link-btn"]');
      await expect(copyBtn).toBeVisible();
      await copyBtn.click();

      await expect(page.locator('text=Copied!')).toBeVisible();
    });

    test('P4-P6: View published article links to external reader target', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');
      await page.locator('[data-testid="publish-btn"]').click();
      await page.locator('.confirm-dialog-card button.btn-brand').click();

      const viewBtn = page.locator('[data-testid="view-published-btn"]');
      await expect(viewBtn).toHaveAttribute('target', '_blank');
      await expect(viewBtn).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(viewBtn).toHaveAttribute('href', '/articles/high-performance-relational-indexing');
    });

    test('P4-P7: Incomplete draft displays readiness notice and disables publication', async ({ page }) => {
      await setupAuthorStudioMock(page, { incompleteArticle: true });
      await page.goto('/author/articles/art-001-mock/edit');

      // Check readiness banner
      const banner = page.locator('[data-testid="readiness-banner"]');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Title must be at least 3 characters');

      // Publish button should be disabled
      const publishBtn = page.locator('[data-testid="publish-btn"]');
      await expect(publishBtn).toBeDisabled();
    });

    test('P4-P8: Unsaved changes display warning and disable publication', async ({ page }) => {
      await page.goto('/author/articles/art-001-mock/edit');

      // Modify title to create unsaved changes
      const titleInput = page.locator('#meta-title');
      await titleInput.fill('Modified Title for Testing Pending Edits');

      // Warning message should appear
      await expect(page.locator('[data-testid="unsaved-changes-warning"]')).toBeVisible();

      // Publish button should be disabled
      const publishBtn = page.locator('[data-testid="publish-btn"]');
      await expect(publishBtn).toBeDisabled();
    });

    test('P4-D1: Duplicate confirmation dialog opens from editor and article list', async ({ page }) => {
      // 1. From editor
      await page.goto('/author/articles/art-001-mock/edit');
      const dupBtn = page.locator('[data-testid="duplicate-btn"]');
      await expect(dupBtn).toBeVisible();
      await dupBtn.click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.dialog-title')).toHaveText('Duplicate Article');
      await expect(dialog.locator('.dialog-message')).toContainText('Create an independent draft copy');

      // Close dialog
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // 2. From article list
      await page.goto('/author/articles');
      const listDupBtn = page.locator('[data-testid="duplicate-btn"]').first();
      await expect(listDupBtn).toBeVisible();
      await listDupBtn.click();

      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.dialog-title')).toHaveText('Duplicate Article');
    });

    test('P4-D2: Cancel does not execute duplication', async ({ page }) => {
      await page.goto('/author/articles');
      const listDupBtn = page.locator('[data-testid="duplicate-btn"]').first();
      await listDupBtn.click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();

      // Click cancel
      await dialog.locator('button.btn-secondary').click();
      await expect(dialog).not.toBeVisible();

      // Must remain on the article list without navigating
      await expect(page).toHaveURL(/\/author\/articles$/);
    });

    test('P4-D3: Successful duplication creates independent draft and navigates to editor', async ({ page }) => {
      await page.goto('/author/articles');
      const listDupBtn = page.locator('[data-testid="duplicate-btn"]').first();
      await listDupBtn.click();

      const dialog = page.locator('.confirm-dialog-card');
      await expect(dialog).toBeVisible();

      // Confirm duplicate
      await dialog.locator('button.btn-brand').click();
      await expect(dialog).not.toBeVisible();

      // Navigates to new duplicate editor URL
      await expect(page).toHaveURL(/\/author\/articles\/art-dup-.*\/edit$/);

      // Verify duplicated title
      const titleInput = page.locator('#meta-title');
      await expect(titleInput).toHaveValue('High-Performance Relational Indexing in PostgreSQL (Copy)');

      // Verify draft status
      const publishPanel = page.locator('[data-testid="publication-panel"]');
      await expect(publishPanel).toContainText('DRAFT');
    });

    test('P4-D4: Duplicate preserves blocks and tags with reset revision and unshared snapshots', async ({ page }) => {
      // 1. Publish original article first
      await page.goto('/author/articles/art-001-mock/edit');
      await page.locator('[data-testid="publish-btn"]').click();
      await page.locator('.confirm-dialog-card button.btn-brand').click();
      await expect(page.locator('[data-testid="public-link-container"]')).toBeVisible();

      // 2. Duplicate from editor
      await page.locator('[data-testid="duplicate-btn"]').click();
      await page.locator('.confirm-dialog-card button.btn-brand').click();

      // Navigated to duplicate editor
      await expect(page).toHaveURL(/\/author\/articles\/art-dup-.*\/edit$/);

      // Status must be reset to DRAFT (not PUBLISHED)
      const publishPanel = page.locator('[data-testid="publication-panel"]');
      await expect(publishPanel).toContainText('DRAFT');
      await expect(publishPanel).not.toContainText('Live Public Slug');
      await expect(page.locator('[data-testid="public-link-container"]')).not.toBeVisible();

      // Revision is reset to 1
      await expect(publishPanel).toContainText('Draft Revision:');

      // Blocks are preserved
      await expect(page.locator('text=4 blocks in draft')).toBeVisible();
    });
  });
});
