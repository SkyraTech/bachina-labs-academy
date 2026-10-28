import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { PublicArticleReaderComponent } from './public-article-reader.component';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import { PublicArticleDetailResponse } from '../../models/public-article.models';

describe('PublicArticleReaderComponent', () => {
  let component: PublicArticleReaderComponent;
  let fixture: ComponentFixture<PublicArticleReaderComponent>;
  let apiSpy: { getPublishedArticleBySlug: ReturnType<typeof vi.fn> };
  let titleSpy: { setTitle: ReturnType<typeof vi.fn> };
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
    titleSpy = {
      setTitle: vi.fn(),
    };

  await TestBed.configureTestingModule({
      imports: [PublicArticleReaderComponent],
      providers: [
        provideRouter([]),
        { provide: PublicArticleApiService, useValue: apiSpy },
        { provide: Title, useValue: titleSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicArticleReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should instantiate the component with external template and styles', () => {
    expect(component).toBeTruthy();
  });

  it('should fetch article by slug and render title, summary, and revision', () => {
    expect(apiSpy.getPublishedArticleBySlug).toHaveBeenCalledWith(
      'architecting-event-driven-microservices',
    );
    expect(component.article()).toEqual(mockDetailResponse);
    expect(titleSpy.setTitle).toHaveBeenCalledWith(
      'Architecting Event-Driven Microservices · Bachina Labs Academy',
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

  it('should extract table of contents when >= 2 headings are present', () => {
    expect(component.tableOfContents().length).toBe(2);
    expect(component.tableOfContents()[0].text).toBe('Transactional Outbox Pattern');
    expect(component.tableOfContents()[0].id).toBe('transactional-outbox-pattern');
    expect(component.tableOfContents()[1].text).toBe('Idempotency Keys');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('aside')?.textContent).toContain('Table of Contents');
  });

  it('should render 404 not found state when slug does not exist or historical slug returns 404', () => {
    apiSpy.getPublishedArticleBySlug.mockReturnValue(
      throwError(() => ({ status: 404, message: 'Article not found.' })),
    );

    component.loadArticle('old-historical-slug');
    fixture.detectChanges();

    expect(component.notFound()).toBe(true);
    expect(component.loading()).toBe(false);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Article Not Found or Moved');
    expect(compiled.textContent).toContain('Browse All Articles');
  });

  it('should render network error state and allow retry', () => {
    apiSpy.getPublishedArticleBySlug.mockReturnValue(
      throwError(() => ({ status: 500, message: 'Internal Server Error' })),
    );

    component.loadArticle('test-slug');
    fixture.detectChanges();

    expect(component.error()).not.toBeNull();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unable to Load Article');

    // Retry
    apiSpy.getPublishedArticleBySlug.mockReturnValue(of(mockDetailResponse));
    const retryBtn = compiled.querySelector('button') as HTMLButtonElement;
    retryBtn.click();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.article()).toEqual(mockDetailResponse);
  });
});
