import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { of, throwError, BehaviorSubject, Subject } from 'rxjs';
import {
  PublicArticleReaderComponent,
  PUBLIC_SITE_ORIGIN,
} from './public-article-reader.component';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import { PublicArticleDetailResponse } from '../../models/public-article.models';

describe('PublicArticleReaderComponent', () => {
  let component: PublicArticleReaderComponent;
  let fixture: ComponentFixture<PublicArticleReaderComponent>;
  let apiSpy: { getPublishedArticleBySlug: ReturnType<typeof vi.fn> };
  let titleService: Title;
  let metaService: Meta;
  let doc: Document;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const mockDetailResponse: PublicArticleDetailResponse = {
    id: 'art-42',
    slug: 'architecting-event-driven-microservices',
    title: 'Architecting Event-Driven Microservices',
    summary: 'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    typographyPreset: 'EDITORIAL_SERIF',
    cover: null,
    revision: 5,
    publishedAt: '2026-10-25T09:00:00.000Z',
    taxonomyCaptured: true,
    category: null,
    tags: [],
    blocks: [
      {
        id: 'b-1',
        type: 'HEADING',
        position: 0,
        schemaVersion: 1,
        content: { text: 'Transactional Outbox Pattern', level: 2 },
        media: null,
      },
      {
        id: 'b-2',
        type: 'RICH_TEXT',
        position: 1,
        schemaVersion: 1,
        content: { html: '<p>The transactional outbox pattern guarantees at-least-once messaging.</p>' },
        media: null,
      },
      {
        id: 'b-3',
        type: 'HEADING',
        position: 2,
        schemaVersion: 1,
        content: { text: 'Idempotency Keys', level: 2 },
        media: null,
      },
      {
        id: 'b-4',
        type: 'CODE',
        position: 3,
        schemaVersion: 1,
        content: { code: 'SELECT * FROM idempotency_keys WHERE key = $1;', language: 'sql' },
        media: null,
      },
    ],
  };

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject(
      convertToParamMap({ slug: 'architecting-event-driven-microservices' }),
    );
    apiSpy = {
      getPublishedArticleBySlug: vi.fn().mockReturnValue(of(mockDetailResponse)),
    };

    await TestBed.configureTestingModule({
      imports: [PublicArticleReaderComponent],
      providers: [
        provideRouter([]),
        { provide: PublicArticleApiService, useValue: apiSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    titleService = TestBed.inject(Title);
    metaService = TestBed.inject(Meta);
    doc = TestBed.inject(DOCUMENT);

    fixture = TestBed.createComponent(PublicArticleReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    const canonical = doc.head.querySelector("link[rel='canonical']");
    if (canonical) {
      canonical.remove();
    }
    metaService.removeTag("name='description'");
    metaService.removeTag("property='og:image'");
    metaService.removeTag("property='og:url'");
    metaService.removeTag("name='twitter:image'");
  });

  it('should instantiate the component with external template and styles', () => {
    expect(component).toBeTruthy();
  });

  it('should fetch article by slug and render title, summary, and revision', () => {
    expect(apiSpy.getPublishedArticleBySlug).toHaveBeenCalledWith(
      'architecting-event-driven-microservices',
    );
    expect(component.article()).toEqual(mockDetailResponse);
    expect(titleService.getTitle()).toBe(
      'Architecting Event-Driven Microservices | Bachina Labs Academy',
    );

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Architecting Event-Driven Microservices',
    );
    expect(compiled.textContent).toContain(
      'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    );
    expect(compiled.textContent).toContain('Revision 5');
  });

  it('should apply the correct font-serif class for EDITORIAL_SERIF preset', () => {
    expect(component.typographyFontClass()).toBe('font-serif');
  });

  it('should apply font-mono for TECHNICAL_MINIMAL and font-sans for MODERN_SANS', () => {
    const techArt: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      typographyPreset: 'TECHNICAL_MINIMAL',
    };
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(techArt));
    component.loadArticle('test-slug');
    fixture.detectChanges();
    expect(component.typographyFontClass()).toBe('font-mono');

    const modernArt: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      typographyPreset: 'MODERN_SANS',
    };
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(modernArt));
    component.loadArticle('test-slug');
    fixture.detectChanges();
    expect(component.typographyFontClass()).toBe('font-sans');
  });

  it('should extract table of contents for headings with level <= 3', () => {
    const toc = component.tableOfContents();
    expect(toc.length).toBe(2);
    expect(toc[0]).toEqual({
      id: 'transactional-outbox-pattern',
      text: 'Transactional Outbox Pattern',
      level: 2,
    });
    expect(toc[1]).toEqual({
      id: 'idempotency-keys',
      text: 'Idempotency Keys',
      level: 2,
    });
  });

  it('should handle 404 gracefully with informative not-found UI', () => {
    apiSpy.getPublishedArticleBySlug.mockReturnValue(
      throwError(() => ({ status: 404, message: 'Article not found.' })),
    );
    component.loadArticle('non-existent-slug');
    fixture.detectChanges();

    expect(component.notFound()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(component.article()).toBeNull();
    expect(titleService.getTitle()).toBe('Article Not Found | Bachina Labs Academy');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Article Not Found or Moved');
    expect(compiled.textContent).toContain('Browse All Articles');
  });

  it('should handle server error with retry button', () => {
    apiSpy.getPublishedArticleBySlug.mockReturnValue(
      throwError(() => ({ status: 500, message: 'Internal Server Error' })),
    );
    component.loadArticle('broken-slug');
    fixture.detectChanges();

    expect(component.error()).toContain('Unable to load this article');
    expect(component.loading()).toBe(false);
    expect(titleService.getTitle()).toBe('Error Loading Article | Bachina Labs Academy');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unable to Load Article');
    const retryBtn = compiled.querySelector('button');
    expect(retryBtn?.textContent).toContain('Try Again');
  });

  it('should guard against network response races using monotonic requestId', () => {
    const responseSubject1 = new Subject<PublicArticleDetailResponse>();
    const responseSubject2 = new Subject<PublicArticleDetailResponse>();

    apiSpy.getPublishedArticleBySlug
      .mockReturnValueOnce(responseSubject1.asObservable())
      .mockReturnValueOnce(responseSubject2.asObservable());

    component.loadArticle('first-slug');
    expect(component.loading()).toBe(true);

    component.loadArticle('second-slug');

    const secondArticle: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      id: 'art-second',
      slug: 'second-slug',
      title: 'Second Article',
    };
    responseSubject2.next(secondArticle);
    responseSubject2.complete();
    fixture.detectChanges();

    expect(component.article()?.id).toBe('art-second');
    expect(component.article()?.title).toBe('Second Article');
    expect(titleService.getTitle()).toBe('Second Article | Bachina Labs Academy');

    const staleFirstArticle: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      id: 'art-first',
      slug: 'first-slug',
      title: 'Stale First Article',
    };
    responseSubject1.next(staleFirstArticle);
    responseSubject1.complete();
    fixture.detectChanges();

    expect(component.article()?.id).toBe('art-second');
    expect(component.article()?.title).toBe('Second Article');
    expect(titleService.getTitle()).toBe('Second Article | Bachina Labs Academy');
  });

  it('should discard stale error responses when newer request has settled', () => {
    const errorSubject1 = new Subject<PublicArticleDetailResponse>();
    const responseSubject2 = new Subject<PublicArticleDetailResponse>();

    apiSpy.getPublishedArticleBySlug
      .mockReturnValueOnce(errorSubject1.asObservable())
      .mockReturnValueOnce(responseSubject2.asObservable());

    component.loadArticle('first-slug');
    component.loadArticle('second-slug');

    const secondArticle: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      id: 'art-second',
      slug: 'second-slug',
      title: 'Second Article',
    };
    responseSubject2.next(secondArticle);
    responseSubject2.complete();
    fixture.detectChanges();

    expect(component.article()?.id).toBe('art-second');
    expect(component.notFound()).toBe(false);

    errorSubject1.error({ status: 404 });
    fixture.detectChanges();

    expect(component.article()?.id).toBe('art-second');
    expect(component.notFound()).toBe(false);
    expect(titleService.getTitle()).toBe('Second Article | Bachina Labs Academy');
  });

  it('should render taxonomy category and tags links when captured', () => {
    const categorizedArt: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      taxonomyCaptured: true,
      category: { id: 'cat-1', name: 'Software Architecture', slug: 'software-architecture' },
      tags: [
        { id: 'tag-1', name: 'Microservices', slug: 'microservices' },
        { id: 'tag-2', name: 'Idempotency', slug: 'idempotency' },
      ],
    };
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(categorizedArt));
    component.loadArticle('categorized-art');
    fixture.detectChanges();

    const categoryLink = fixture.nativeElement.querySelector('[data-testid="reader-category-link"]');
    expect(categoryLink).toBeTruthy();
    expect(categoryLink.textContent).toContain('Software Architecture');

    const tagLinks = fixture.nativeElement.querySelectorAll('[data-testid="reader-tag-link"]');
    expect(tagLinks.length).toBe(2);
    expect(tagLinks[0].textContent).toContain('#Microservices');
    expect(tagLinks[1].textContent).toContain('#Idempotency');
  });

  // --- Head Metadata & SEO Lifecycle Tests ---

  it('updates document title with article title and brand suffix', () => {
    expect(titleService.getTitle()).toBe(
      'Architecting Event-Driven Microservices | Bachina Labs Academy',
    );
  });

  it('updates meta description from article summary and sanitizes markdown whitespace', () => {
    const descTag = metaService.getTag("name='description'");
    expect(descTag).toBeTruthy();
    expect(descTag?.content).toBe(
      'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    );
  });

  it('truncates descriptions over 160 chars without corrupting UTF-16 surrogate pairs', () => {
    const longSummaryWithEmoji =
      'This is an extensively detailed technical overview of scalable architectural designs ' +
      'covering database replication, event streaming, distributed consensus, caching, and resiliency. ' +
      'Includes practical production guidance and modern patterns 🚀 and insights for high-load platforms.';

    const longArt: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      summary: longSummaryWithEmoji,
    };
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(longArt));
    component.loadArticle('long-art');
    fixture.detectChanges();

    const desc = metaService.getTag("name='description'")?.content ?? '';
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc.endsWith('...')).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(desc)).toBe(false);
  });

  it('emits standard Open Graph tags matching publication snapshot', () => {
    expect(metaService.getTag("property='og:type'")?.content).toBe('article');
    expect(metaService.getTag("property='og:site_name'")?.content).toBe('Bachina Labs Academy');
    expect(metaService.getTag("property='og:title'")?.content).toBe(
      'Architecting Event-Driven Microservices',
    );
    expect(metaService.getTag("property='og:description'")?.content).toBe(
      'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    );
  });

  it('emits Twitter/X card tags with summary card when cover image is absent', () => {
    expect(metaService.getTag("name='twitter:card'")?.content).toBe('summary');
    expect(metaService.getTag("name='twitter:title'")?.content).toBe(
      'Architecting Event-Driven Microservices',
    );
    expect(metaService.getTag("name='twitter:description'")?.content).toBe(
      'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    );
    expect(metaService.getTag("name='twitter:image'")).toBeNull();
  });

  it('emits summary_large_image and twitter:image when safe absolute cover media exists', () => {
    const artWithCover: PublicArticleDetailResponse = {
      ...mockDetailResponse,
      cover: {
        id: 'media-1',
        mimeType: 'image/png',
        width: 1200,
        height: 630,
        altText: 'Microservices diagram',
        url: 'https://images.bachinalabs.academy/media/cover-1.png',
      },
    };
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(artWithCover));
    component.loadArticle('with-cover');
    fixture.detectChanges();

    expect(metaService.getTag("property='og:image'")?.content).toBe(
      'https://images.bachinalabs.academy/media/cover-1.png',
    );
    expect(metaService.getTag("name='twitter:card'")?.content).toBe('summary_large_image');
    expect(metaService.getTag("name='twitter:image'")?.content).toBe(
      'https://images.bachinalabs.academy/media/cover-1.png',
    );

    // Now load article without cover and verify stale image is cleaned up
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(mockDetailResponse));
    component.loadArticle('article-without-cover');
    fixture.detectChanges();

    expect(metaService.getTag("property='og:image'")).toBeNull();
    expect(metaService.getTag("name='twitter:card'")?.content).toBe('summary');
    expect(metaService.getTag("name='twitter:image'")).toBeNull();
  });

  it('rejects unsafe cover image URLs (localhost, private IP, relative, credentials) and omits image tags', () => {
    const testCases = [
      'http://localhost:3000/image.png',
      'https://127.0.0.1/image.png',
      'https://192.168.1.100/image.png',
      'https://10.0.0.5/image.png',
      'https://user:pass@example.com/image.png',
      '/api/v1/articles/public/media/art-42',
    ];

    for (const unsafeUrl of testCases) {
      const artWithUnsafeCover: PublicArticleDetailResponse = {
        ...mockDetailResponse,
        cover: {
          id: 'media-unsafe',
          mimeType: 'image/png',
          width: 800,
          height: 600,
          altText: 'Diagram',
          url: unsafeUrl,
        },
      };
      apiSpy.getPublishedArticleBySlug.mockReturnValue(of(artWithUnsafeCover));
      component.loadArticle('unsafe-cover');
      fixture.detectChanges();

      expect(metaService.getTag("property='og:image'")).toBeNull();
      expect(metaService.getTag("name='twitter:image'")).toBeNull();
      expect(metaService.getTag("name='twitter:card'")?.content).toBe('summary');
    }
  });

  it('does NOT emit fake canonical link or og:url when PUBLIC_SITE_ORIGIN is not configured (null)', () => {
    expect(doc.head.querySelector("link[rel='canonical']")).toBeNull();
    expect(metaService.getTag("property='og:url'")).toBeNull();
  });

  it('clears article-specific metadata and canonical link on component destruction', () => {
    fixture.destroy();

    expect(metaService.getTag("property='og:type'")).toBeNull();
    expect(metaService.getTag("property='og:title'")).toBeNull();
    expect(metaService.getTag("property='og:description'")).toBeNull();
    expect(metaService.getTag("name='twitter:title'")).toBeNull();
    expect(metaService.getTag("name='twitter:image'")).toBeNull();
    expect(doc.head.querySelector("link[rel='canonical']")).toBeNull();
  });

  it('restores preexisting app description on destroy, or removes tag if none existed initially', () => {
    // In beforeEach, metaService had no description tag initially
    // Destroy component -> reader-owned description should be completely removed
    fixture.destroy();
    expect(metaService.getTag("name='description'")).toBeNull();
  });

  // --- Sharing UX Tests ---

  it('renders Copy Link button and handles successful copy to clipboard', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy },
    });

    const copyBtn = fixture.nativeElement.querySelector(
      '[data-testid="reader-copy-link-btn"]',
    ) as HTMLButtonElement;
    expect(copyBtn).toBeTruthy();

    await component.copyArticleLink();
    fixture.detectChanges();

    expect(writeTextSpy).toHaveBeenCalled();
    expect(component.shareStatus()).toBe('Link copied');

    const statusEl = fixture.nativeElement.querySelector('[data-testid="reader-share-status"]');
    expect(statusEl?.textContent).toContain('Link copied');
    expect(component.showManualCopy()).toBe(false);
  });

  it('shows accessible manual copy input when clipboard access rejects or is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    await component.copyArticleLink();
    fixture.detectChanges();

    expect(component.shareStatus()).toBe('Unable to copy link automatically');
    expect(component.showManualCopy()).toBe(true);

    const manualBox = fixture.nativeElement.querySelector(
      '[data-testid="reader-manual-copy-box"]',
    );
    expect(manualBox).toBeTruthy();

    const manualInput = fixture.nativeElement.querySelector(
      '[data-testid="reader-manual-copy-input"]',
    ) as HTMLInputElement;
    expect(manualInput).toBeTruthy();
    expect(manualInput.value).toContain('architecting-event-driven-microservices');
  });

  it('does not copy or share when article is not loaded', async () => {
    const writeTextSpy = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy },
    });

    component.article.set(null);
    await component.copyArticleLink();

    expect(writeTextSpy).not.toHaveBeenCalled();
    expect(component.resolvedShareUrl()).toBeNull();
  });

  it('invokes native navigator.share when available and handles benign cancellation', async () => {
    const shareSpy = vi.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError'));
    Object.assign(navigator, {
      share: shareSpy,
      canShare: vi.fn().mockReturnValue(true),
    });

    expect(component.hasNativeShare()).toBe(true);
    await component.shareArticle();

    expect(shareSpy).toHaveBeenCalledWith({
      title: mockDetailResponse.title,
      text: mockDetailResponse.summary,
      url: expect.stringContaining('architecting-event-driven-microservices'),
    });
    // On AbortError, user feedback remains clean (no false success or error)
    expect(component.shareStatus()).toBeNull();
  });

  describe('Reader Navigation & Accessibility Hardening (Checkpoint C-3D)', () => {
    it('provides accessible breadcrumb navigation with link to /articles', () => {
      const breadcrumb = fixture.nativeElement.querySelector('nav[aria-label="Breadcrumb"]');
      expect(breadcrumb).not.toBeNull();

      const backLink = breadcrumb.querySelector('a');
      expect(backLink).not.toBeNull();
      expect(backLink.getAttribute('href')).toContain('/articles');
      expect(backLink.textContent).toContain('Back to Articles');
    });

    it('renders role="alert" and browse link on 404 not found state', () => {
      component.notFound.set(true);
      component.article.set(null);
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('div[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain('Article Not Found or Moved');

      const browseLink = alert.querySelector('a');
      expect(browseLink).not.toBeNull();
      expect(browseLink.getAttribute('href')).toContain('/articles');
    });

    it('renders role="alert" and retry button on reader error state', () => {
      component.error.set('Network connection lost.');
      component.article.set(null);
      component.notFound.set(false);
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('div[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain('Unable to Load Article');

      const retryBtn = alert.querySelector('button');
      expect(retryBtn).not.toBeNull();
      expect(retryBtn.textContent).toContain('Try Again');
    });

    it('renders Table of Contents aside with aria-label="Table of Contents" when headings >= 2', () => {
      // The default mockDetailResponse in root describe has 2 headings: 'Transactional Outbox Pattern' and 'Idempotency Keys'
      component.loading.set(false);
      component.article.set(mockDetailResponse);
      component.notFound.set(false);
      component.error.set(null);
      fixture.detectChanges();

      const toc = fixture.nativeElement.querySelector('aside[aria-label="Table of Contents"]');
      expect(toc).not.toBeNull();

      const links = toc.querySelectorAll('a');
      expect(links.length).toBe(2);
      expect(links[0].textContent).toContain('Transactional Outbox Pattern');
      expect(links[1].textContent).toContain('Idempotency Keys');
    });

    it('renders accessible footer return link to all articles', () => {
      component.loading.set(false);
      component.article.set(mockDetailResponse);
      component.notFound.set(false);
      component.error.set(null);
      fixture.detectChanges();

      const footer = fixture.nativeElement.querySelector('footer');
      expect(footer).not.toBeNull();

      const returnLink = footer.querySelector('a');
      expect(returnLink).not.toBeNull();
      expect(returnLink.getAttribute('href')).toContain('/articles');
      expect(returnLink.textContent).toContain('Return to All Articles');
    });
  });
});

describe('PublicArticleReaderComponent — Canonical Origin & Destination Safety', () => {
  let component: PublicArticleReaderComponent;
  let fixture: ComponentFixture<PublicArticleReaderComponent>;
  let doc: Document;
  let metaService: Meta;
  let titleService: Title;

  const mockDetailResponse: PublicArticleDetailResponse = {
    id: 'art-42',
    slug: 'architecting-event-driven-microservices',
    title: 'Architecting Event-Driven Microservices',
    summary: 'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    typographyPreset: 'EDITORIAL_SERIF',
    cover: null,
    revision: 5,
    publishedAt: '2026-10-25T09:00:00.000Z',
    taxonomyCaptured: true,
    category: null,
    tags: [],
    blocks: [],
  };

  beforeEach(async () => {
    // Pre-populate head with an app-level description and unrelated meta
    await TestBed.configureTestingModule({
      imports: [PublicArticleReaderComponent],
      providers: [
        provideRouter([]),
        {
          provide: PublicArticleApiService,
          useValue: {
            getPublishedArticleBySlug: vi.fn().mockReturnValue(of(mockDetailResponse)),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ slug: 'architecting-event-driven-microservices' })),
          },
        },
        {
          provide: PUBLIC_SITE_ORIGIN,
          useValue: 'https://bachinalabs.academy',
        },
      ],
    }).compileComponents();

    doc = TestBed.inject(DOCUMENT);
    metaService = TestBed.inject(Meta);
    titleService = TestBed.inject(Title);

    // Pre-set existing app description
    metaService.updateTag({ name: 'description', content: 'Preexisting Academy App Description' });

    fixture = TestBed.createComponent(PublicArticleReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    const canonical = doc.head.querySelector("link[rel='canonical']");
    if (canonical) {
      canonical.remove();
    }
    metaService.removeTag("name='description'");
  });

  it('creates absolute canonical link and og:url when PUBLIC_SITE_ORIGIN is configured', () => {
    const canonicalLink = doc.head.querySelector("link[rel='canonical']") as HTMLLinkElement;
    expect(canonicalLink).toBeTruthy();
    expect(canonicalLink.getAttribute('href')).toBe(
      'https://bachinalabs.academy/articles/architecting-event-driven-microservices',
    );
    expect(metaService.getTag("property='og:url'")?.content).toBe(
      'https://bachinalabs.academy/articles/architecting-event-driven-microservices',
    );
    expect(component.resolvedShareUrl()).toBe(
      'https://bachinalabs.academy/articles/architecting-event-driven-microservices',
    );
  });

  it('restores preexisting app description on destroy and does not overwrite destination title', () => {
    titleService.setTitle('Destination Page Title · Bachina Labs Academy');

    fixture.destroy();

    // Destination title must NOT be overwritten by component destroy
    expect(titleService.getTitle()).toBe('Destination Page Title · Bachina Labs Academy');

    // Preexisting app description must be restored
    expect(metaService.getTag("name='description'")?.content).toBe(
      'Preexisting Academy App Description',
    );

    // Reader-owned canonical link must be removed
    expect(doc.head.querySelector("link[rel='canonical']")).toBeNull();
  });
});

describe('PublicArticleReaderComponent — Unsafe Origin Rejection', () => {
  let doc: Document;
  let metaService: Meta;

  const mockDetailResponse: PublicArticleDetailResponse = {
    id: 'art-42',
    slug: 'architecting-event-driven-microservices',
    title: 'Architecting Event-Driven Microservices',
    summary: 'Patterns for outbox tables, idempotency, and asynchronous workflows.',
    typographyPreset: 'EDITORIAL_SERIF',
    cover: null,
    revision: 5,
    publishedAt: '2026-10-25T09:00:00.000Z',
    taxonomyCaptured: true,
    category: null,
    tags: [],
    blocks: [],
  };

  it('rejects credentials, query strings, and non-http protocols in configured origin', async () => {
    await TestBed.configureTestingModule({
      imports: [PublicArticleReaderComponent],
      providers: [
        provideRouter([]),
        {
          provide: PublicArticleApiService,
          useValue: {
            getPublishedArticleBySlug: vi.fn().mockReturnValue(of(mockDetailResponse)),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ slug: 'architecting-event-driven-microservices' })),
          },
        },
        {
          provide: PUBLIC_SITE_ORIGIN,
          useValue: 'https://user:password@malicious-origin.com/subpath?query=1#frag',
        },
      ],
    }).compileComponents();

    doc = TestBed.inject(DOCUMENT);
    metaService = TestBed.inject(Meta);
    const fixture = TestBed.createComponent(PublicArticleReaderComponent);
    fixture.detectChanges();

    // Canonical link and og:url must NOT be emitted with unsafe origin
    expect(doc.head.querySelector("link[rel='canonical']")).toBeNull();
    expect(metaService.getTag("property='og:url'")).toBeNull();
  });
});
