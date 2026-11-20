import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Title, Meta } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArticleFullPreviewComponent,
  mapDraftBlockToPublicBlock,
} from './article-full-preview.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { EditableArticle, ArticleBlock } from '../../models/article.models';

describe('ArticleFullPreviewComponent', () => {
  let component: ArticleFullPreviewComponent;
  let fixture: ComponentFixture<ArticleFullPreviewComponent>;
  let apiService: {
    getArticle: ReturnType<typeof vi.fn>;
  };
  let mediaService: {
    getPrivateMediaPreviewUrl: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let titleService: Title;
  let metaService: Meta;

  const mockArticle: EditableArticle = {
    id: 'test-art-1',
    authorId: 'author-1',
    title: 'Modern Architecture Patterns',
    draftSlug: 'modern-architecture-patterns',
    publishedSlug: null,
    summary: 'A deep dive into architecture.',
    status: 'DRAFT',
    typographyPreset: 'EDITORIAL_SERIF',
    coverMediaId: 'media-cover-1',
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Software Architecture', slug: 'software-architecture' },
    tagIds: ['tag-1'],
    tags: [{ id: 'tag-1', name: 'Architecture', slug: 'architecture' }],
    draftRevision: 5,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    publishedAt: null,
    blocks: [
      {
        id: 'block-h1',
        articleId: 'test-art-1',
        type: 'HEADING',
        position: 0,
        content: { level: 1, text: 'Introduction' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'block-p1',
        articleId: 'test-art-1',
        type: 'RICH_TEXT',
        position: 1,
        content: { html: '<p>This is draft content.</p>' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'block-h2',
        articleId: 'test-art-1',
        type: 'HEADING',
        position: 2,
        content: { level: 2, text: 'Core Principles' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'block-img1',
        articleId: 'test-art-1',
        type: 'IMAGE',
        position: 3,
        content: { caption: 'System Diagram', altText: 'Architecture diagram', mimeType: 'image/png' },
        mediaAssetId: 'media-diag-1',
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  beforeEach(async () => {
    apiService = {
      getArticle: vi.fn().mockReturnValue(of(mockArticle)),
    };
    mediaService = {
      getPrivateMediaPreviewUrl: vi
        .fn()
        .mockImplementation((id: string) => `/api/v1/articles/media/${id}/content`),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleFullPreviewComponent],
      providers: [
        provideRouter([
          { path: 'author/articles/:articleId/preview', component: ArticleFullPreviewComponent },
          { path: 'author/articles/:articleId/edit', component: ArticleFullPreviewComponent },
          { path: 'author/articles', component: ArticleFullPreviewComponent },
          { path: 'login', component: ArticleFullPreviewComponent },
        ]),
        { provide: ArticleEditorApiService, useValue: apiService },
        { provide: ArticleMediaApiService, useValue: mediaService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleFullPreviewComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    titleService = TestBed.inject(Title);
    metaService = TestBed.inject(Meta);
  });

  it('should create the full preview component', () => {
    expect(component).toBeTruthy();
  });

  it('should load article draft on init and set title and meta robots', () => {
    component.loadDraft('test-art-1');
    fixture.detectChanges();

    expect(apiService.getArticle).toHaveBeenCalledWith('test-art-1');
    expect(component.article()?.id).toBe('test-art-1');
    expect(titleService.getTitle()).toBe(
      'Modern Architecture Patterns (Draft Preview) · Bachina Labs Academy',
    );
    expect(metaService.getTag('name="robots"')?.content).toBe('noindex, nofollow');
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
  });

  it('should map draft blocks to public blocks correctly with real MIME metadata', () => {
    const rawBlock: ArticleBlock = {
      id: 'img-1',
      articleId: 'test-art-1',
      type: 'IMAGE',
      position: 0,
      content: { caption: 'Chart', altText: 'Chart diagram', mimeType: 'image/webp' },
      mediaAssetId: 'media-123',
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const mapped = mapDraftBlockToPublicBlock(rawBlock, mediaService as unknown as ArticleMediaApiService);
    expect(mapped.id).toBe('img-1');
    expect(mapped.type).toBe('IMAGE');
    expect(mapped.media).toBeTruthy();
    expect(mapped.media?.url).toBe('/api/v1/articles/media/media-123/content');
    expect(mapped.media?.mimeType).toBe('image/webp');
    expect(mapped.media?.altText).toBe('Chart diagram');
  });

  it('should render DRAFT status banner when article status is DRAFT', () => {
    component.article.set(mockArticle);
    component.loading.set(false);
    fixture.detectChanges();

    const bannerEl = fixture.nativeElement.querySelector('[data-testid="preview-status-banner"]');
    expect(bannerEl.textContent).toContain('Draft Preview · Revision 5 (Unpublished Draft)');
  });

  it('should render PUBLISHED with edits banner when draftRevision > publishedRevision', () => {
    const publishedWithEdits: EditableArticle = {
      ...mockArticle,
      status: 'PUBLISHED',
      draftRevision: 40,
      publishedRevision: 37,
      publishedSlug: 'modern-architecture-patterns',
    };

    component.article.set(publishedWithEdits);
    component.loading.set(false);
    fixture.detectChanges();

    const bannerEl = fixture.nativeElement.querySelector('[data-testid="preview-status-banner"]');
    expect(bannerEl.textContent).toContain(
      'Draft Preview · Revision 40 (Unpublished Changes — Public Live is Revision 37)',
    );
  });

  it('should render PUBLISHED without edits banner when synchronized', () => {
    const syncedArticle: EditableArticle = {
      ...mockArticle,
      status: 'PUBLISHED',
      draftRevision: 37,
      publishedRevision: 37,
      publishedSlug: 'modern-architecture-patterns',
    };

    component.article.set(syncedArticle);
    component.loading.set(false);
    fixture.detectChanges();

    const bannerEl = fixture.nativeElement.querySelector('[data-testid="preview-status-banner"]');
    expect(bannerEl.textContent).toContain('Synchronized with Public Live Article');
  });

  it('should render ARCHIVED status banner when article status is ARCHIVED', () => {
    const archivedArticle: EditableArticle = {
      ...mockArticle,
      status: 'ARCHIVED',
      draftRevision: 10,
      publishedRevision: 8,
    };

    component.article.set(archivedArticle);
    component.loading.set(false);
    fixture.detectChanges();

    const bannerEl = fixture.nativeElement.querySelector('[data-testid="preview-status-banner"]');
    expect(bannerEl.textContent).toContain('Archived Article Preview · Revision 10');
  });

  it('should navigate back to editor on backToEditor click', () => {
    const navSpy = vi.spyOn(router, 'navigate');
    component.articleId.set('test-art-1');

    component.backToEditor();
    expect(navSpy).toHaveBeenCalledWith(['/author/articles', 'test-art-1', 'edit']);
  });

  it('should render Table of Contents when 2 or more headings exist', () => {
    component.article.set(mockArticle);
    component.loading.set(false);
    fixture.detectChanges();

    expect(component.tableOfContents().length).toBe(2);
    expect(component.tableOfContents()[0].text).toBe('Introduction');
    expect(component.tableOfContents()[1].text).toBe('Core Principles');

    const desktopToc = fixture.nativeElement.querySelector('[data-testid="preview-desktop-toc"]');
    expect(desktopToc).toBeTruthy();
  });

  it('should handle 404 error by displaying not-found state', () => {
    apiService.getArticle.mockReturnValue(throwError(() => ({ status: 404 })));

    component.loadDraft('missing-art-id');
    fixture.detectChanges();

    expect(component.notFound()).toBe(true);
    expect(component.loading()).toBe(false);
    const notFoundEl = fixture.nativeElement.querySelector('[data-testid="preview-not-found"]');
    expect(notFoundEl).toBeTruthy();
  });

  it('should handle 401 error by navigating to login with returnUrl', () => {
    const navSpy = vi.spyOn(router, 'navigate');
    apiService.getArticle.mockReturnValue(throwError(() => ({ status: 401 })));

    component.loadDraft('unauthorized-art-id');
    fixture.detectChanges();

    expect(navSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/author/articles/unauthorized-art-id/preview' },
    });
  });

  it('should handle 500 error by displaying error banner with retry option', () => {
    apiService.getArticle.mockReturnValue(
      throwError(() => ({ status: 500, error: { message: 'Database connection failed' } })),
    );

    component.loadDraft('error-art-id');
    fixture.detectChanges();

    expect(component.error()).toBe('Database connection failed');
    const errorEl = fixture.nativeElement.querySelector('[data-testid="preview-error"]');
    expect(errorEl).toBeTruthy();
  });

  it('should render empty state message when article has no blocks', () => {
    const emptyArticle: EditableArticle = {
      ...mockArticle,
      blocks: [],
    };

    component.article.set(emptyArticle);
    component.loading.set(false);
    fixture.detectChanges();

    expect(component.mappedBlocks().length).toBe(0);
    const container = fixture.nativeElement.querySelector(
      '[data-testid="preview-blocks-container"]',
    );
    expect(container.textContent).toContain(
      'This draft does not have any content blocks yet. Switch back to the editor to add content.',
    );
  });
});
