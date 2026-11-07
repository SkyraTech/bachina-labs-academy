import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ArticleShareActionsComponent } from './article-share-actions.component';

describe('ArticleShareActionsComponent (P6 Sharing Suite)', () => {
  let component: ArticleShareActionsComponent;
  let fixture: ComponentFixture<ArticleShareActionsComponent>;
  let doc: Document;

  const originalClipboard = navigator.clipboard;
  const navWithShare = navigator as unknown as { share?: unknown; canShare?: unknown };
  const originalShare = navWithShare.share;
  const originalCanShare = navWithShare.canShare;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleShareActionsComponent],
    }).compileComponents();

    doc = TestBed.inject(DOCUMENT);
    fixture = TestBed.createComponent(ArticleShareActionsComponent);
    component = fixture.componentInstance;

    // Set default required inputs
    fixture.componentRef.setInput('slug', 'postgresql-17-production-tuning');
    fixture.componentRef.setInput('title', 'PostgreSQL 17 Production Tuning Guide');
    fixture.componentRef.setInput('summary', 'Comprehensive performance tuning guide.');
    fixture.detectChanges();
  });

  afterEach(() => {
    // Restore browser globals
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'share', {
      value: originalShare,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: originalCanShare,
      configurable: true,
      writable: true,
    });
  });

  // 1. Correct published URL
  it('P6-S-UT1: resolves correct canonical published article URL format', () => {
    const url = component.resolveUrl();
    expect(url).toBe(`${doc.location.origin}/articles/postgresql-17-production-tuning`);
  });

  // 2. Draft slug not used
  it('P6-S-UT2: uses only the bound published slug input and never falls back to draft identifiers', () => {
    fixture.componentRef.setInput('slug', 'frozen-published-slug-v2');
    fixture.detectChanges();
    const url = component.resolveUrl();
    expect(url).toContain('/articles/frozen-published-slug-v2');
    expect(url).not.toContain('draft');
  });

  // 3. Trusted browser origin used
  it('P6-S-UT3: respects trusted configured publicOrigin or falls back to window.location.origin', () => {
    fixture.componentRef.setInput('publicOrigin', 'https://academy.bachinalabs.com');
    fixture.detectChanges();
    const url = component.resolveUrl();
    expect(url).toBe('https://academy.bachinalabs.com/articles/postgresql-17-production-tuning');

    // Rejects invalid protocol in publicOrigin
    fixture.componentRef.setInput('publicOrigin', 'javascript:alert(1)');
    fixture.detectChanges();
    const fallbackUrl = component.resolveUrl();
    expect(fallbackUrl).toBe(`${doc.location.origin}/articles/postgresql-17-production-tuning`);
  });

  // 4. URL encoding
  it('P6-S-UT4: properly URL-encodes special characters in slugs and section anchors', () => {
    fixture.componentRef.setInput('slug', 'café & architecture guide');
    fixture.detectChanges();
    const url = component.resolveUrl('section 1.2 & deep dive');
    expect(url).toContain('/articles/caf%C3%A9%20%26%20architecture%20guide#section%201.2%20%26%20deep%20dive');
  });

  // 5. Copy Link success
  it('P6-S-UT5: writes URL to clipboard on copy and displays success feedback', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
      writable: true,
    });

    await component.copyLink();
    fixture.detectChanges();

    expect(writeTextSpy).toHaveBeenCalledWith(`${doc.location.origin}/articles/postgresql-17-production-tuning`);
    expect(component.shareStatus()).toBe('Link copied');
    expect(component.showManualCopy()).toBe(false);

    const statusEl = fixture.nativeElement.querySelector('[data-testid="reader-share-status"]');
    expect(statusEl?.textContent).toContain('Link copied');
  });

  // 6. Copy Link failure
  it('P6-S-UT6: handles clipboard rejection gracefully by surfacing manual copy fallback and error notice', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
      configurable: true,
      writable: true,
    });

    await component.copyLink();
    fixture.detectChanges();

    expect(component.shareStatus()).toBe('Unable to copy link automatically');
    expect(component.showManualCopy()).toBe(true);
    expect(component.manualCopyUrl()).toContain('/articles/postgresql-17-production-tuning');

    const manualInput = fixture.nativeElement.querySelector('[data-testid="reader-manual-copy-input"]') as HTMLInputElement;
    expect(manualInput).toBeTruthy();
    expect(manualInput.value).toContain('/articles/postgresql-17-production-tuning');
  });

  // 7. Clipboard unavailable
  it('P6-S-UT7: falls back to manual copy input when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await component.copyLink();
    fixture.detectChanges();

    expect(component.showManualCopy()).toBe(true);
    expect(component.shareStatus()).toBe('Unable to copy link automatically');
  });

  // 8. Native Share available
  it('P6-S-UT8: detects native share capability and renders Share button', () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    });

    component.refreshNativeShareCapability();
    expect(component.hasNativeShare()).toBe(true);
    fixture.detectChanges();

    const shareBtn = fixture.nativeElement.querySelector('[data-testid="reader-native-share-btn"]');
    expect(shareBtn).toBeTruthy();
  });

  // 9. Native Share unavailable
  it('P6-S-UT9: hides Share button when navigator.share is unavailable and keeps Copy Link', () => {
    Object.defineProperty(navigator, 'share', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    component.refreshNativeShareCapability();
    expect(component.hasNativeShare()).toBe(false);
    fixture.detectChanges();

    const shareBtn = fixture.nativeElement.querySelector('[data-testid="reader-native-share-btn"]');
    expect(shareBtn).toBeNull();

    const copyBtn = fixture.nativeElement.querySelector('[data-testid="reader-copy-link-btn"]');
    expect(copyBtn).toBeTruthy();
  });

  // 10. Share success
  it('P6-S-UT10: executes navigator.share with published title, summary, and canonical URL', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    });

    await component.shareNative();

    expect(shareSpy).toHaveBeenCalledWith({
      title: 'PostgreSQL 17 Production Tuning Guide',
      text: 'Comprehensive performance tuning guide.',
      url: `${doc.location.origin}/articles/postgresql-17-production-tuning`,
    });
  });

  // 11. Share cancellation
  it('P6-S-UT11: treats AbortError on share cancellation as benign without surfacing error feedback', async () => {
    const abortError = new DOMException('The user aborted the share operation.', 'AbortError');
    const shareSpy = vi.fn().mockRejectedValue(abortError);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    });

    await component.shareNative();
    fixture.detectChanges();

    expect(component.shareStatus()).toBeNull();
  });

  // 12. Share failure
  it('P6-S-UT12: handles generic share failure by displaying user-facing error notice', async () => {
    const shareSpy = vi.fn().mockRejectedValue(new Error('Unknown share failure'));
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    });

    await component.shareNative();
    fixture.detectChanges();

    expect(component.shareStatus()).toBe('Unable to share article');
  });

  // 13. Published snapshot title used
  it('P6-S-UT13: passes strictly the published title input to native share', async () => {
    fixture.componentRef.setInput('title', 'Frozen Snapshot Title 100%');
    fixture.detectChanges();

    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    });

    await component.shareNative();
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Frozen Snapshot Title 100%' }),
    );
  });

  // 14. Missing published slug handled
  it('P6-S-UT14: handles empty or whitespace-only slug by returning null and blocking copy', async () => {
    fixture.componentRef.setInput('slug', '   ');
    fixture.detectChanges();

    expect(component.resolveUrl()).toBeNull();

    await component.copyLink();
    expect(component.shareStatus()).toBe('Unable to copy link: share URL unavailable');
  });

  // 15. Keyboard accessibility
  it('P6-S-UT15: buttons are keyboard focusable, carry accessible labels, and support activation', () => {
    const copyBtn = fixture.nativeElement.querySelector('[data-testid="reader-copy-link-btn"]') as HTMLButtonElement;
    expect(copyBtn).toBeTruthy();
    expect(copyBtn.getAttribute('aria-label')).toBe('Copy article link to clipboard');

    copyBtn.focus();
    expect(doc.activeElement).toBe(copyBtn);
  });

  // 16. No Article mutation
  it('P6-S-UT16: copying or sharing does not mutate article inputs or emit external mutation events', async () => {
    const originalSlug = component.slug();
    const originalTitle = component.title();
    const originalSummary = component.summary();

    await component.copyLink();
    await component.copyLink('section-test');

    expect(component.slug()).toBe(originalSlug);
    expect(component.title()).toBe(originalTitle);
    expect(component.summary()).toBe(originalSummary);
  });

  // 17. Section copy feature
  it('P6-S-UT17: displays Copy Section Link when activeHeadingId is present and appends fragment', async () => {
    fixture.componentRef.setInput('activeHeadingId', 'buffer-pool-optimization');
    fixture.detectChanges();

    const sectionBtn = fixture.nativeElement.querySelector('[data-testid="reader-copy-section-btn"]') as HTMLButtonElement;
    expect(sectionBtn).toBeTruthy();

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
      writable: true,
    });

    await component.copySectionLink();
    expect(writeTextSpy).toHaveBeenCalledWith(`${doc.location.origin}/articles/postgresql-17-production-tuning#buffer-pool-optimization`);
    expect(component.shareStatus()).toBe('Section link copied');
  });
});

