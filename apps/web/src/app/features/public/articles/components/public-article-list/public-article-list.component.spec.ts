import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { PublicArticleListComponent } from './public-article-list.component';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import { PublicArticleListResponse } from '../../models/public-article.models';

describe('PublicArticleListComponent', () => {
  let component: PublicArticleListComponent;
  let fixture: ComponentFixture<PublicArticleListComponent>;
  let apiSpy: { listPublishedArticles: ReturnType<typeof vi.fn> };
  let router: Router;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const mockResponse: PublicArticleListResponse = {
    items: [
      {
        id: 'art-1',
        slug: 'distributed-tracing-with-opentelemetry',
        title: 'Distributed Tracing with OpenTelemetry',
        summary: 'How to instrument microservices with distributed contexts.',
        typographyPreset: 'MODERN_SANS',
        cover: null,
        revision: 2,
        publishedAt: '2026-10-25T10:00:00.000Z',
      },
      {
        id: 'art-2',
        slug: 'high-performance-sql-indexing',
        title: 'High-Performance SQL Indexing Strategies',
        summary: 'B-tree vs BRIN vs GiST indexes evaluated.',
        typographyPreset: 'TECHNICAL_MINIMAL',
        cover: null,
        revision: 4,
        publishedAt: '2026-10-24T18:00:00.000Z',
      },
    ],
    page: 1,
    limit: 20,
    total: 2,
    totalPages: 1,
  };

  beforeEach(async () => {
    queryParamMap$ = new BehaviorSubject(convertToParamMap({ page: '1' }));
    apiSpy = {
      listPublishedArticles: vi.fn().mockReturnValue(of(mockResponse)),
    };

    await TestBed.configureTestingModule({
      imports: [PublicArticleListComponent],
      providers: [
        provideRouter([]),
        { provide: PublicArticleApiService, useValue: apiSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    fixture = TestBed.createComponent(PublicArticleListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should instantiate the component with external template and styles', () => {
    expect(component).toBeTruthy();
  });

  it('should load and render article cards on init', () => {
    expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(component.articles().length).toBe(2);
    expect(component.loading()).toBe(false);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Distributed Tracing with OpenTelemetry');
    expect(compiled.textContent).toContain('High-Performance SQL Indexing Strategies');
  });

  it('should render empty state when response has no items', () => {
    apiSpy.listPublishedArticles.mockReturnValue(
      of({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 }),
    );

    component.loadArticles(1);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No Articles Published Yet');
  });

  it('should render error state on network failure and allow retry', () => {
    apiSpy.listPublishedArticles.mockReturnValue(throwError(() => new Error('Server down')));

    component.loadArticles(1);
    fixture.detectChanges();

    expect(component.error()).not.toBeNull();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unable to Load Articles');

    // Retry
    apiSpy.listPublishedArticles.mockReturnValue(of(mockResponse));
    const retryBtn = compiled.querySelector('button') as HTMLButtonElement;
    retryBtn.click();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.articles().length).toBe(2);
  });

  it('should navigate with updated query param when page changes', () => {
    component.onPageChange(3);

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { page: 3 },
      queryParamsHandling: 'merge',
    });
  });

  it('should read page query param on route change', () => {
    apiSpy.listPublishedArticles.mockReturnValue(
      of({ ...mockResponse, page: 2 }),
    );
    queryParamMap$.next(convertToParamMap({ page: '2' }));

    expect(component.page()).toBe(2);
    expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({ page: 2, limit: 20 });
  });
});
