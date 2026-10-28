import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticlePreviewComponent } from './article-preview.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { EditableArticle } from '../../models/article.models';

describe('ArticlePreviewComponent', () => {
  let component: ArticlePreviewComponent;
  let fixture: ComponentFixture<ArticlePreviewComponent>;
  let stateMock: {
    article: ReturnType<typeof vi.fn>;
    blocks: ReturnType<typeof vi.fn>;
    currentRevision: ReturnType<typeof vi.fn>;
  };
  let mediaApiMock: {
    getPrivateMediaPreviewUrl: ReturnType<typeof vi.fn>;
  };

  const previewArticle: EditableArticle = {
    id: 'art-preview',
    authorId: 'auth-1',
    title: 'Observability & Distributed Tracing',
    draftSlug: 'observability-distributed-tracing',
    publishedSlug: null,
    summary: 'A preview of tracing in microservices.',
    status: 'DRAFT',
    typographyPreset: 'EDITORIAL_SERIF',
    coverMediaId: 'cover-media-id-1',
    draftRevision: 4,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    publishedAt: null,
    blocks: [
      {
        id: 'b-h1',
        articleId: 'art-preview',
        type: 'HEADING',
        position: 0,
        content: { text: 'Core Concepts', level: 2 },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
      {
        id: 'b-rich',
        articleId: 'art-preview',
        type: 'RICH_TEXT',
        position: 1,
        content: { html: '<p>Standard <strong>HTML</strong> prose.</p>' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
      {
        id: 'b-code',
        articleId: 'art-preview',
        type: 'CODE',
        position: 2,
        content: { code: 'const traceId = "abc-123";', language: 'typescript' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
      {
        id: 'b-callout',
        articleId: 'art-preview',
        type: 'CALLOUT',
        position: 3,
        content: { variant: 'TIP', title: 'Pro Tip', body: 'Propagate trace headers.' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
      {
        id: 'b-img',
        articleId: 'art-preview',
        type: 'IMAGE',
        position: 4,
        content: { caption: 'Figure 1 - Tracing Flow', altText: 'Tracing diagram' },
        mediaAssetId: 'media-img-777',
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
    ],
  };

  beforeEach(async () => {
    stateMock = {
      article: vi.fn().mockReturnValue(previewArticle),
      blocks: vi.fn().mockReturnValue(previewArticle.blocks),
      currentRevision: vi.fn().mockReturnValue(4),
    };

    mediaApiMock = {
      getPrivateMediaPreviewUrl: vi.fn((id: string) => `/api/v1/articles/media/${id}/content`),
    };

    await TestBed.configureTestingModule({
      imports: [ArticlePreviewComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticlePreviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should apply typography preset font class accurately for EDITORIAL_SERIF', () => {
    expect(component.getTypographyFontClass()).toBe('font-serif');
  });

  it('1b. should apply typography font class for TECHNICAL_MINIMAL and MODERN_SANS', () => {
    stateMock.article.mockReturnValue({
      ...previewArticle,
      typographyPreset: 'TECHNICAL_MINIMAL',
    });
    expect(component.getTypographyFontClass()).toBe('font-mono');

    stateMock.article.mockReturnValue({
      ...previewArticle,
      typographyPreset: 'MODERN_SANS',
    });
    expect(component.getTypographyFontClass()).toBe('font-sans');
  });

  it('2. should render heading hierarchy and title', () => {
    const el: HTMLElement = fixture.nativeElement;
    const titleEl = el.querySelector('h1');
    expect(titleEl?.textContent?.trim()).toBe('Observability & Distributed Tracing');

    const h2El = el.querySelector('h2');
    expect(h2El?.textContent?.trim()).toBe('Core Concepts');
  });

  it('3. should render code safely as raw text inside pre code', () => {
    const el: HTMLElement = fixture.nativeElement;
    const codeEl = el.querySelector('pre code');
    expect(codeEl?.textContent).toContain('const traceId = "abc-123";');
  });

  it('4. should map callout classes based on variant', () => {
    expect(component.getCalloutClasses('TIP')).toContain('bg-emerald-500');
    expect(component.getCalloutClasses('WARNING')).toContain('bg-amber-500');
    expect(component.getCalloutClasses('INFO')).toContain('bg-sky-500');
    expect(component.getCalloutClasses('NOTE')).toContain('bg-neutral-500');
  });

  it('5. should safely render rich text html content through standard binding without trust bypass', () => {
    const el: HTMLElement = fixture.nativeElement;
    const strongEl = el.querySelector('strong');
    expect(strongEl?.textContent).toBe('HTML');
    expect(component.asHtml(previewArticle.blocks[1].content)).toBe('<p>Standard <strong>HTML</strong> prose.</p>');
  });

  it('6. should render private preview url for cover image when coverMediaId is present', () => {
    const el: HTMLElement = fixture.nativeElement;
    const coverImg = el.querySelector('header img') as HTMLImageElement;
    expect(coverImg).toBeTruthy();
    expect(coverImg.src).toContain('/api/v1/articles/media/cover-media-id-1/content');
  });

  it('7. should render private preview url and caption for IMAGE block when mediaAssetId is present', () => {
    const el: HTMLElement = fixture.nativeElement;
    const blockImg = el.querySelector('figure img') as HTMLImageElement;
    expect(blockImg).toBeTruthy();
    expect(blockImg.src).toContain('/api/v1/articles/media/media-img-777/content');

    const caption = el.querySelector('figcaption');
    expect(caption?.textContent).toContain('Figure 1 - Tracing Flow');
  });
});
