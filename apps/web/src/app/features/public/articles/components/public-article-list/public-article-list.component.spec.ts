import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { provideRouter, Router, ActivatedRoute, convertToParamMap, RouterOutlet } from '@angular/router';
import { of, throwError, BehaviorSubject, Subject } from 'rxjs';
import { PublicArticleListComponent } from './public-article-list.component';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import {
  PublicArticleListResponse,
  PublicDiscoveredTaxonomyItem,
} from '../../models/public-article.models';

describe('PublicArticleListComponent', () => {
  let component: PublicArticleListComponent;
  let fixture: ComponentFixture<PublicArticleListComponent>;
  let apiSpy: {
    listPublishedArticles: ReturnType<typeof vi.fn>;
    getPublishedCategories: ReturnType<typeof vi.fn>;
    getPublishedTags: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const mockCategories: PublicDiscoveredTaxonomyItem[] = [
    { id: 'cat-1', name: 'Software Architecture', slug: 'software-architecture', articleCount: 12 },
    { id: 'cat-2', name: 'Database Systems', slug: 'database-systems', articleCount: 8 },
  ];

  const mockTags: PublicDiscoveredTaxonomyItem[] = [
    { id: 'tag-1', name: 'PostgreSQL', slug: 'postgresql', articleCount: 10 },
    { id: 'tag-2', name: 'Microservices', slug: 'microservices', articleCount: 6 },
  ];

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
        taxonomyCaptured: true,
        category: { id: 'cat-1', name: 'Software Architecture', slug: 'software-architecture' },
        tags: [{ id: 'tag-2', name: 'Microservices', slug: 'microservices' }],
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
        taxonomyCaptured: true,
        category: { id: 'cat-2', name: 'Database Systems', slug: 'database-systems' },
        tags: [{ id: 'tag-1', name: 'PostgreSQL', slug: 'postgresql' }],
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
      getPublishedCategories: vi.fn().mockReturnValue(of(mockCategories)),
      getPublishedTags: vi.fn().mockReturnValue(of(mockTags)),
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

  it('should load categories, tags, and articles on init', () => {
    expect(apiSpy.getPublishedCategories).toHaveBeenCalled();
    expect(apiSpy.getPublishedTags).toHaveBeenCalled();
    expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      category: undefined,
      tag: undefined,
    });
    expect(component.articles().length).toBe(2);
    expect(component.categories().length).toBe(2);
    expect(component.tags().length).toBe(2);
    expect(component.loading()).toBe(false);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Software Architecture');
    expect(compiled.textContent).toContain('PostgreSQL');
    expect(compiled.textContent).toContain('Distributed Tracing with OpenTelemetry');
  });

  it('should render empty state when response has no items and no active filters', () => {
    apiSpy.listPublishedArticles.mockReturnValue(
      of({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 }),
    );

    component.loadArticles(1, null, null);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No Articles Published Yet');
  });

  it('should render filter-aware empty state when response has no items with active filters', () => {
    component.selectedCategory.set('software-architecture');
    component.total.set(0);
    component.articles.set([]);
    component.loading.set(false);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No Articles Match the Selected Filters');
    expect(compiled.querySelector('[data-testid="empty-clear-filters-btn"]')).toBeTruthy();
  });

  it('should navigate to clear all filters when clicking clear button in empty filtered state', () => {
    component.selectedCategory.set('software-architecture');
    component.total.set(0);
    component.articles.set([]);
    component.loading.set(false);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const clearBtn = compiled.querySelector('[data-testid="empty-clear-filters-btn"]') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    clearBtn.click();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { category: null, tag: null, q: null, page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should render error state on network failure and allow retry', () => {
    apiSpy.listPublishedArticles.mockReturnValue(throwError(() => new Error('Server down')));

    component.loadArticles(1, null, null);
    fixture.detectChanges();

    expect(component.error()).not.toBeNull();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unable to Load Articles');

    // Retry
    apiSpy.listPublishedArticles.mockReturnValue(of(mockResponse));
    const retryBtn = compiled.querySelector('[data-testid="articles-retry-btn"]') as HTMLButtonElement;
    retryBtn.click();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.articles().length).toBe(2);
  });

  it('should navigate with category and reset page to 1 when selecting a category', () => {
    component.onSelectCategory('software-architecture');

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { category: 'software-architecture', page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should toggle off category when clicking the currently active category', () => {
    component.selectedCategory.set('software-architecture');
    component.onSelectCategory('software-architecture');

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { category: null, page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should navigate with tag and reset page to 1 when selecting a tag', () => {
    component.onSelectTag('postgresql');

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { tag: 'postgresql', page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should toggle off tag when clicking the currently active tag', () => {
    component.selectedTag.set('postgresql');
    component.onSelectTag('postgresql');

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { tag: null, page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should clear category filter on onClearCategory', () => {
    component.onClearCategory();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { category: null, page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should clear tag filter on onClearTag', () => {
    component.onClearTag();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { tag: null, page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should clear all filters on onClearAllFilters', () => {
    component.onClearAllFilters();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { category: null, tag: null, q: null, page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('should preserve active category and tag filters when page changes', () => {
    component.onPageChange(3);

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { page: 3 },
      queryParamsHandling: 'merge',
    });
  });

  it('should read category and tag query params from route and fetch filtered articles', () => {
    apiSpy.listPublishedArticles.mockReturnValue(
      of({ ...mockResponse, page: 2 }),
    );
    queryParamMap$.next(
      convertToParamMap({
        category: 'software-architecture',
        tag: 'postgresql',
        page: '2',
      }),
    );

    expect(component.selectedCategory()).toBe('software-architecture');
    expect(component.selectedTag()).toBe('postgresql');
    expect(component.page()).toBe(2);

    expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      category: 'software-architecture',
      tag: 'postgresql',
    });
  });

  it('should safely ignore invalid slugs in query parameters', () => {
    queryParamMap$.next(
      convertToParamMap({
        category: 'INVALID__SLUG!!',
        tag: 'bad tag space',
        page: '1',
      }),
    );

    expect(component.selectedCategory()).toBeNull();
    expect(component.selectedTag()).toBeNull();

    expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      category: undefined,
      tag: undefined,
    });
  });

  it('should reject repeated query parameters and overlength or uppercase slugs', () => {
    queryParamMap$.next(
      convertToParamMap({
        category: ['software-architecture', 'database-systems'],
        tag: ['postgresql', 'microservices'],
        page: '-5',
      }),
    );

    expect(component.selectedCategory()).toBeNull();
    expect(component.selectedTag()).toBeNull();
    expect(component.page()).toBe(1);

    expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      category: undefined,
      tag: undefined,
    });
  });

  it('should handle discovery error and allow retry for categories and tags independently', () => {
    apiSpy.getPublishedCategories.mockReturnValue(throwError(() => new Error('Categories unavailable')));
    apiSpy.getPublishedTags.mockReturnValue(throwError(() => new Error('Tags unavailable')));

    component.loadCategories();
    component.loadTags();
    fixture.detectChanges();

    expect(component.categoriesError()).toBe('Unable to load categories.');
    expect(component.tagsError()).toBe('Unable to load tags.');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unable to load categories.');
    expect(compiled.textContent).toContain('Unable to load tags.');

    // Retry categories independently
    apiSpy.getPublishedCategories.mockReturnValue(of(mockCategories));
    component.loadCategories();
    expect(component.categoriesError()).toBeNull();
    expect(component.categories().length).toBe(2);
    expect(component.tagsError()).toBe('Unable to load tags.');

    // Retry tags independently
    apiSpy.getPublishedTags.mockReturnValue(of(mockTags));
    component.loadTags();
    expect(component.tagsError()).toBeNull();
    expect(component.tags().length).toBe(2);
  });

  it('should ignore responses from stale / superseded requests', () => {
    const subject1 = new Subject<PublicArticleListResponse>();
    const subject2 = new Subject<PublicArticleListResponse>();

    apiSpy.listPublishedArticles.mockReturnValueOnce(subject1.asObservable());
    component.loadArticles(1, 'cat-1', null); // requestId 2

    apiSpy.listPublishedArticles.mockReturnValueOnce(subject2.asObservable());
    component.loadArticles(1, 'cat-2', null); // requestId 3

    // Request 2 completes with new data
    subject2.next({
      items: [mockResponse.items[0]],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    subject2.complete();

    expect(component.articles().length).toBe(1);
    expect(component.articles()[0].id).toBe('art-1');

    // Request 1 now finishes late (stale response)
    subject1.next({
      items: [mockResponse.items[1], mockResponse.items[0]],
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
    subject1.complete();

    // Must still have data from request 2, not overwritten by stale request 1
    expect(component.articles().length).toBe(1);
    expect(component.articles()[0].id).toBe('art-1');
  });

  it('should prevent stale error from overwriting newer successful request', () => {
    const subject1 = new Subject<PublicArticleListResponse>();
    const subject2 = new Subject<PublicArticleListResponse>();

    apiSpy.listPublishedArticles.mockReturnValueOnce(subject1.asObservable());
    component.loadArticles(1, 'cat-1', null);

    apiSpy.listPublishedArticles.mockReturnValueOnce(subject2.asObservable());
    component.loadArticles(1, 'cat-2', null);

    // Request 2 succeeds first
    subject2.next({
      items: [mockResponse.items[1]],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    subject2.complete();

    expect(component.articles().length).toBe(1);
    expect(component.articles()[0].id).toBe('art-2');
    expect(component.error()).toBeNull();

    // Request 1 fails afterward
    subject1.error(new Error('Old request failed'));

    // State must remain successful from request 2
    expect(component.articles().length).toBe(1);
    expect(component.articles()[0].id).toBe('art-2');
    expect(component.error()).toBeNull();
  });

  it('should prevent stale success from overwriting newer failed request', () => {
    const subject1 = new Subject<PublicArticleListResponse>();
    const subject2 = new Subject<PublicArticleListResponse>();

    apiSpy.listPublishedArticles.mockReturnValueOnce(subject1.asObservable());
    component.loadArticles(1, 'cat-1', null);

    apiSpy.listPublishedArticles.mockReturnValueOnce(subject2.asObservable());
    component.loadArticles(1, 'cat-2', null);

    // Request 2 fails first
    subject2.error(new Error('Network disconnected'));

    expect(component.error()).not.toBeNull();
    expect(component.loading()).toBe(false);

    // Request 1 succeeds afterward
    subject1.next({
      items: [mockResponse.items[0]],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    subject1.complete();

    // Stale success must NOT overwrite error state
    expect(component.error()).not.toBeNull();
  });

  it('should handle simulated browser back and forward navigation history', () => {
    apiSpy.listPublishedArticles.mockClear();

    // 1. Initial unfiltered
    queryParamMap$.next(convertToParamMap({ page: '1' }));
    expect(apiSpy.listPublishedArticles).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      category: undefined,
      tag: undefined,
    });

    // 2. Select category
    queryParamMap$.next(convertToParamMap({ category: 'software-architecture', page: '1' }));
    expect(component.selectedCategory()).toBe('software-architecture');
    expect(component.selectedTag()).toBeNull();

    // 3. Select tag
    queryParamMap$.next(
      convertToParamMap({
        category: 'software-architecture',
        tag: 'postgresql',
        page: '1',
      }),
    );
    expect(component.selectedCategory()).toBe('software-architecture');
    expect(component.selectedTag()).toBe('postgresql');

    // 4. Change page to 2
    apiSpy.listPublishedArticles.mockReturnValue(of({ ...mockResponse, page: 2 }));
    queryParamMap$.next(
      convertToParamMap({
        category: 'software-architecture',
        tag: 'postgresql',
        page: '2',
      }),
    );
    expect(component.page()).toBe(2);

    // 5. Back to page 1
    apiSpy.listPublishedArticles.mockReturnValue(of({ ...mockResponse, page: 1 }));
    queryParamMap$.next(
      convertToParamMap({
        category: 'software-architecture',
        tag: 'postgresql',
        page: '1',
      }),
    );
    expect(component.page()).toBe(1);

    // 6. Back to Category only (no tag)
    queryParamMap$.next(convertToParamMap({ category: 'software-architecture', page: '1' }));
    expect(component.selectedCategory()).toBe('software-architecture');
    expect(component.selectedTag()).toBeNull();

    // 7. Forward back to Category + Tag
    queryParamMap$.next(
      convertToParamMap({
        category: 'software-architecture',
        tag: 'postgresql',
        page: '1',
      }),
    );
    expect(component.selectedCategory()).toBe('software-architecture');
    expect(component.selectedTag()).toBe('postgresql');
  });

  it('should clean up subscriptions safely on component destruction', () => {
    const subject = new Subject<PublicArticleListResponse>();
    apiSpy.listPublishedArticles.mockReturnValueOnce(subject.asObservable());

    component.loadArticles(1, 'cat-1', null);
    expect(component.loading()).toBe(true);

    // Destroy component
    fixture.destroy();

    // Emitting after destruction should not cause exceptions
    expect(() => {
      subject.next(mockResponse);
      subject.complete();
    }).not.toThrow();
  });

  describe('Search Keyword (q) UI, URL Synchronization, and Lifecycle', () => {
    it('renders the search input accessibly with placeholder, submit button, and accessible labels', () => {
      const searchInput = fixture.nativeElement.querySelector(
        '[data-testid="catalog-search-input"]',
      ) as HTMLInputElement;
      const submitBtn = fixture.nativeElement.querySelector(
        '[data-testid="catalog-search-submit-btn"]',
      ) as HTMLButtonElement;

      expect(searchInput).toBeTruthy();
      expect(searchInput.getAttribute('type')).toBe('search');
      expect(searchInput.getAttribute('placeholder')).toContain('Search published articles');
      expect(submitBtn).toBeTruthy();
      expect(submitBtn.textContent?.trim()).toBe('Search');
    });

    it('typing into the search input updates local signal without issuing API requests', () => {
      apiSpy.listPublishedArticles.mockClear();
      const searchInput = fixture.nativeElement.querySelector(
        '[data-testid="catalog-search-input"]',
      ) as HTMLInputElement;

      searchInput.value = 'distributed systems';
      searchInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component.searchQuery()).toBe('distributed systems');
      expect(component.appliedSearch()).toBeNull();
      expect(apiSpy.listPublishedArticles).not.toHaveBeenCalled();
    });

    it('submitting the search input via submit button trims term and navigates to URL with q and page 1', () => {
      const routerSpy = vi.spyOn(router, 'navigate');
      component.searchQuery.set('   postgresql indexing   ');

      component.onSearchSubmit();

      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          q: 'postgresql indexing',
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('submitting an empty or whitespace-only search term removes q from URL', () => {
      const routerSpy = vi.spyOn(router, 'navigate');
      component.searchQuery.set('     ');

      component.onSearchSubmit();

      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          q: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('clearing search resets searchQuery, removes q from URL, resets page to 1, and preserves taxonomy', () => {
      const routerSpy = vi.spyOn(router, 'navigate');
      component.searchQuery.set('postgresql');

      component.onClearSearch();

      expect(component.searchQuery()).toBe('');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          q: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('clearing all filters resets searchQuery, removes category, tag, and q from URL', () => {
      const routerSpy = vi.spyOn(router, 'navigate');
      component.searchQuery.set('acid transactions');

      component.onClearAllFilters();

      expect(component.searchQuery()).toBe('');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: null,
          tag: null,
          q: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('selecting category or tag preserves active search term via queryParamsHandling merge', () => {
      const routerSpy = vi.spyOn(router, 'navigate');

      component.onSelectCategory('software-architecture');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: 'software-architecture',
          page: 1,
        },
        queryParamsHandling: 'merge',
      });

      component.onSelectTag('postgresql');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          tag: 'postgresql',
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('URL initialization with q parameter sets appliedSearch, searchQuery, and passes q to listPublishedArticles', () => {
      apiSpy.listPublishedArticles.mockClear();
      apiSpy.listPublishedArticles.mockReturnValue(of({ ...mockResponse, page: 2 }));

      queryParamMap$.next(
        convertToParamMap({
          q: 'event driven',
          category: 'software-architecture',
          tag: 'microservices',
          page: '2',
        }),
      );
      fixture.detectChanges();

      expect(component.appliedSearch()).toBe('event driven');
      expect(component.searchQuery()).toBe('event driven');
      expect(component.selectedCategory()).toBe('software-architecture');
      expect(component.selectedTag()).toBe('microservices');
      expect(component.page()).toBe(2);

      expect(apiSpy.listPublishedArticles).toHaveBeenCalledWith({
        page: 2,
        limit: 20,
        category: 'software-architecture',
        tag: 'microservices',
        q: 'event driven',
      });
    });

    it('canonicalizes invalid or overlong q from URL without intermediate HTTP request', () => {
      apiSpy.listPublishedArticles.mockClear();
      const routerSpy = vi.spyOn(router, 'navigate');
      const overlong = 'a'.repeat(121);

      queryParamMap$.next(
        convertToParamMap({
          q: overlong,
          category: 'software-architecture',
          tag: 'postgresql',
          page: '3',
        }),
      );
      fixture.detectChanges();

      expect(component.appliedSearch()).toBeNull();
      expect(component.searchQuery()).toBe('');
      // Canonical navigation triggered with replaceUrl: true, resetting page to 1 and preserving taxonomy
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: 'software-architecture',
          tag: 'postgresql',
          page: 1,
          q: null,
        },
        replaceUrl: true,
      });
      // Zero intermediate HTTP requests dispatched for the invalid URL
      expect(apiSpy.listPublishedArticles).not.toHaveBeenCalled();
    });

    it('canonicalizes repeated q query parameters (e.g. ?q=a&q=b) from URL without intermediate HTTP request', () => {
      apiSpy.listPublishedArticles.mockClear();
      const routerSpy = vi.spyOn(router, 'navigate');

      queryParamMap$.next(
        convertToParamMap({
          q: ['first-term', 'second-term'],
          category: 'database-systems',
          page: '2',
        }),
      );
      fixture.detectChanges();

      expect(component.appliedSearch()).toBeNull();
      expect(component.searchQuery()).toBe('');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: 'database-systems',
          tag: null,
          page: 1,
          q: null,
        },
        replaceUrl: true,
      });
      // Zero intermediate HTTP requests
      expect(apiSpy.listPublishedArticles).not.toHaveBeenCalled();

      const searchInput = fixture.nativeElement.querySelector(
        '[data-testid="catalog-search-input"]',
      ) as HTMLInputElement;
      expect(searchInput.value).toBe('');

      const activeChip = fixture.nativeElement.querySelector(
        '[data-testid="active-search-clear-btn"]',
      );
      expect(activeChip).toBeNull();
    });

    it('canonicalizes control characters in q query parameter without intermediate HTTP request', () => {
      apiSpy.listPublishedArticles.mockClear();
      const routerSpy = vi.spyOn(router, 'navigate');

      queryParamMap$.next(
        convertToParamMap({
          q: 'clean\x00corrupt',
          page: '4',
        }),
      );
      fixture.detectChanges();

      expect(component.appliedSearch()).toBeNull();
      expect(component.searchQuery()).toBe('');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: null,
          tag: null,
          page: 1,
          q: null,
        },
        replaceUrl: true,
      });
      expect(apiSpy.listPublishedArticles).not.toHaveBeenCalled();
    });

    it('canonicalizes blank or whitespace-only q query parameter without intermediate HTTP request', () => {
      apiSpy.listPublishedArticles.mockClear();
      const routerSpy = vi.spyOn(router, 'navigate');

      queryParamMap$.next(
        convertToParamMap({
          q: '     ',
          page: '5',
        }),
      );
      fixture.detectChanges();

      expect(component.appliedSearch()).toBeNull();
      expect(component.searchQuery()).toBe('');
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: null,
          tag: null,
          page: 1,
          q: null,
        },
        replaceUrl: true,
      });
      expect(apiSpy.listPublishedArticles).not.toHaveBeenCalled();
    });

    it('invalidates pending in-flight search request when URL transitions to an invalid q state', () => {
      apiSpy.listPublishedArticles.mockClear();
      const subject1 = new Subject<PublicArticleListResponse>();
      const subject2 = new Subject<PublicArticleListResponse>();

      apiSpy.listPublishedArticles
        .mockReturnValueOnce(subject1.asObservable())
        .mockReturnValueOnce(subject2.asObservable());

      // 1. Initial valid search query in flight
      queryParamMap$.next(
        convertToParamMap({
          q: 'valid-search-term',
          page: '1',
        }),
      );
      fixture.detectChanges();

      expect(component.appliedSearch()).toBe('valid-search-term');
      expect(apiSpy.listPublishedArticles).toHaveBeenCalledTimes(1);

      // 2. URL changes to an invalid repeated q state while request 1 is still in flight
      queryParamMap$.next(
        convertToParamMap({
          q: ['repeated-1', 'repeated-2'],
          page: '2',
        }),
      );
      fixture.detectChanges();

      // State is safely reset and NO intermediate request is sent
      expect(component.appliedSearch()).toBeNull();
      expect(component.searchQuery()).toBe('');
      expect(apiSpy.listPublishedArticles).toHaveBeenCalledTimes(1);

      // 3. Router completes canonicalization to /articles?page=1
      queryParamMap$.next(
        convertToParamMap({
          page: '1',
        }),
      );
      fixture.detectChanges();
      expect(apiSpy.listPublishedArticles).toHaveBeenCalledTimes(2);

      // Request 2 completes with clean unfiltered response
      subject2.next(mockResponse);
      subject2.complete();
      expect(component.articles()).toHaveLength(2);

      // 4. Stale Request 1 completes afterwards with filtered item
      subject1.next({
        items: [mockResponse.items[0]],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      subject1.complete();

      // Stale response must NOT overwrite results
      expect(component.articles()).toHaveLength(2);
      expect(component.appliedSearch()).toBeNull();
    });

    it('renders active search chip in summary banner and triggers onClearSearch when removed', () => {
      queryParamMap$.next(
        convertToParamMap({
          q: 'distributed consensus',
          page: '1',
        }),
      );
      fixture.detectChanges();

      const clearSearchBtn = fixture.nativeElement.querySelector(
        '[data-testid="active-search-clear-btn"]',
      ) as HTMLButtonElement;
      expect(clearSearchBtn).toBeTruthy();

      const routerSpy = vi.spyOn(router, 'navigate');
      clearSearchBtn.click();
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          q: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('renders empty state safely when search yields 0 articles and allows clearing filters', () => {
      apiSpy.listPublishedArticles.mockReturnValue(
        of({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 }),
      );

      queryParamMap$.next(
        convertToParamMap({
          q: 'nonexistent-term',
          page: '1',
        }),
      );
      fixture.detectChanges();

      const emptyHeading = fixture.nativeElement.querySelector('h2');
      expect(emptyHeading).toBeTruthy();
      expect(emptyHeading.textContent).toContain('No Articles Match the Selected Filters');

      const emptyClearBtn = fixture.nativeElement.querySelector(
        '[data-testid="empty-clear-filters-btn"]',
      ) as HTMLButtonElement;
      expect(emptyClearBtn).toBeTruthy();

      const routerSpy = vi.spyOn(router, 'navigate');
      emptyClearBtn.click();
      expect(routerSpy).toHaveBeenCalledWith([], {
        relativeTo: expect.anything(),
        queryParams: {
          category: null,
          tag: null,
          q: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('re-executes search on retry when search request fails', () => {
      apiSpy.listPublishedArticles.mockReturnValueOnce(
        throwError(() => new Error('Search network error')),
      );

      queryParamMap$.next(
        convertToParamMap({
          q: 'resilience',
          page: '1',
        }),
      );
      fixture.detectChanges();

      expect(component.error()).toContain('Unable to load articles');

      // Now prepare success response and click retry
      apiSpy.listPublishedArticles.mockReturnValueOnce(of(mockResponse));
      const retryBtn = fixture.nativeElement.querySelector(
        '[data-testid="articles-retry-btn"]',
      ) as HTMLButtonElement;
      expect(retryBtn).toBeTruthy();
      retryBtn.click();
      fixture.detectChanges();

      expect(component.error()).toBeNull();
      expect(component.articles()).toHaveLength(2);
    });

    it('protects against stale search responses using request sequencing', () => {
      const subject1 = new Subject<PublicArticleListResponse>();
      const subject2 = new Subject<PublicArticleListResponse>();

      apiSpy.listPublishedArticles
        .mockReturnValueOnce(subject1.asObservable())
        .mockReturnValueOnce(subject2.asObservable());

      // Trigger first request (search 'term-1')
      component.loadArticles(1, null, null, 'term-1');

      // Trigger second request (search 'term-2')
      component.loadArticles(1, null, null, 'term-2');

      // Response 2 arrives first
      subject2.next({
        items: [mockResponse.items[0]],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      subject2.complete();
      expect(component.articles()[0].id).toBe('art-1');

      // Stale response 1 arrives afterwards with outdated items
      subject1.next({
        items: [mockResponse.items[1]],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      subject1.complete();

      // Must still show response 2, not stale response 1
      expect(component.articles()[0].id).toBe('art-1');
    });

    it('protects against stale search errors overwriting newer successful results', () => {
      const subject1 = new Subject<PublicArticleListResponse>();
      const subject2 = new Subject<PublicArticleListResponse>();

      apiSpy.listPublishedArticles
        .mockReturnValueOnce(subject1.asObservable())
        .mockReturnValueOnce(subject2.asObservable());

      // Request 1 issued
      component.loadArticles(1, null, null, 'term-slow');
      // Request 2 issued
      component.loadArticles(1, null, null, 'term-fast');

      // Request 2 succeeds
      subject2.next(mockResponse);
      subject2.complete();
      expect(component.articles()).toHaveLength(2);
      expect(component.error()).toBeNull();

      // Request 1 fails after request 2 succeeded
      subject1.error(new Error('Old timeout'));
      // Error from stale request 1 must NOT overwrite result
      expect(component.error()).toBeNull();
      expect(component.articles()).toHaveLength(2);
    });
  });

  describe('Checkpoint C-3D — Public Discovery & Accessibility Hardening', () => {
    it('renders accessible search input, clear button, and role="search" container', () => {
      const form = fixture.nativeElement.querySelector('form[role="search"]');
      expect(form).not.toBeNull();

      const label = fixture.nativeElement.querySelector('label[for="catalog-search-input"]');
      expect(label).not.toBeNull();
      expect(label?.textContent?.trim()).toBe('Search published articles');
      expect(label?.classList.contains('sr-only')).toBe(true);

      const input = fixture.nativeElement.querySelector('#catalog-search-input') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.getAttribute('type')).toBe('search');
      expect(input.getAttribute('maxlength')).toBe('120');

      // Set input value to display clear button
      component.searchQuery.set('kubernetes');
      fixture.detectChanges();

      const clearBtn = fixture.nativeElement.querySelector('[data-testid="search-input-clear-btn"]');
      expect(clearBtn).not.toBeNull();
      expect(clearBtn?.getAttribute('aria-label')).toBe('Clear search keyword');
    });

    it('renders category and tag discovery groups with aria-pressed and role="group"', () => {
      const categoryGroup = fixture.nativeElement.querySelector('div[role="group"][aria-label="Filter by category"]');
      expect(categoryGroup).not.toBeNull();

      const tagGroup = fixture.nativeElement.querySelector('div[role="group"][aria-label="Filter by tag"]');
      expect(tagGroup).not.toBeNull();

      // Verify unselected aria-pressed
      const catButtons = categoryGroup.querySelectorAll('button');
      expect(catButtons[0].getAttribute('aria-pressed')).toBe('false');

      // Set selected category and verify aria-pressed is true
      component.selectedCategory.set('software-architecture');
      fixture.detectChanges();
      expect(catButtons[0].getAttribute('aria-pressed')).toBe('true');
    });

    it('renders accessible alert containers and retry triggers on taxonomy errors', () => {
      component.categoriesError.set('Unable to load categories.');
      component.tagsError.set('Unable to load tags.');
      fixture.detectChanges();

      const alerts = fixture.nativeElement.querySelectorAll('div[role="alert"]');
      expect(alerts.length).toBeGreaterThanOrEqual(2);
      expect(fixture.nativeElement.textContent).toContain('Unable to load categories.');
      expect(fixture.nativeElement.textContent).toContain('Unable to load tags.');
    });

    it('renders role="status" and aria-live="polite" on empty state container', () => {
      component.articles.set([]);
      component.loading.set(false);
      component.error.set(null);
      fixture.detectChanges();

      const emptyContainer = fixture.nativeElement.querySelector('div[role="status"][aria-live="polite"]');
      expect(emptyContainer).not.toBeNull();
      expect(emptyContainer?.textContent).toContain('No Articles Published Yet');
    });

    it('displays contextual empty state message when active filters yield zero results', () => {
      component.articles.set([]);
      component.loading.set(false);
      component.error.set(null);
      component.appliedSearch.set('nonexistent-term');
      fixture.detectChanges();

      const emptyContainer = fixture.nativeElement.querySelector('div[role="status"][aria-live="polite"]');
      expect(emptyContainer).not.toBeNull();
      expect(emptyContainer?.textContent).toContain('No Articles Match the Selected Filters');
      expect(emptyContainer?.textContent).toContain('nonexistent-term');
    });

    it('toggles off category when clicking an already selected category chip', () => {
      component.selectedCategory.set('software-architecture');
      fixture.detectChanges();

      component.onSelectCategory('software-architecture');
      expect(router.navigate).toHaveBeenCalledWith([], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { category: null, page: 1 },
        queryParamsHandling: 'merge',
      });
    });

    it('toggles off tag when clicking an already selected tag chip', () => {
      component.selectedTag.set('postgresql');
      fixture.detectChanges();

      component.onSelectTag('postgresql');
      expect(router.navigate).toHaveBeenCalledWith([], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { tag: null, page: 1 },
        queryParamsHandling: 'merge',
      });
    });
  });
});

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
})
class RouterTestHostComponent {}

@Component({
  standalone: true,
  template: '<div id="detail-view">Article Detail</div>',
})
class DummyDetailComponent {}

describe('PublicArticleListComponent — Filtered Page-2 Catalog Return Journey (Router Integration)', () => {
  let hostFixture: ComponentFixture<RouterTestHostComponent>;
  let hostRouter: Router;
  let hostLocation: Location;
  let integrationApiSpy: {
    listPublishedArticles: ReturnType<typeof vi.fn>;
    getPublishedCategories: ReturnType<typeof vi.fn>;
    getPublishedTags: ReturnType<typeof vi.fn>;
  };

  const page2FilteredResponse: PublicArticleListResponse = {
    items: [
      {
        id: 'art-201',
        slug: 'advanced-postgresql-partitioning',
        title: 'Advanced PostgreSQL Partitioning',
        summary: 'Declarative range and hash partitioning in PostgreSQL 17.',
        typographyPreset: 'TECHNICAL_MINIMAL',
        cover: null,
        revision: 3,
        publishedAt: '2026-10-28T14:00:00.000Z',
        taxonomyCaptured: true,
        category: { id: 'cat-be', name: 'Backend Engineering', slug: 'backend-engineering' },
        tags: [{ id: 'tag-pg', name: 'PostgreSQL', slug: 'postgresql' }],
      },
    ],
    page: 2,
    limit: 20,
    total: 21,
    totalPages: 2,
  };

  beforeEach(async () => {
    integrationApiSpy = {
      listPublishedArticles: vi.fn().mockReturnValue(of(page2FilteredResponse)),
      getPublishedCategories: vi.fn().mockReturnValue(
        of([
          { id: 'cat-be', name: 'Backend Engineering', slug: 'backend-engineering', articleCount: 15 },
        ]),
      ),
      getPublishedTags: vi.fn().mockReturnValue(
        of([
          { id: 'tag-pg', name: 'PostgreSQL', slug: 'postgresql', articleCount: 12 },
        ]),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [RouterTestHostComponent, PublicArticleListComponent, DummyDetailComponent],
      providers: [
        provideRouter([
          { path: 'articles', component: PublicArticleListComponent },
          { path: 'articles/:slug', component: DummyDetailComponent },
        ]),
        { provide: PublicArticleApiService, useValue: integrationApiSpy },
      ],
    }).compileComponents();

    hostRouter = TestBed.inject(Router);
    hostLocation = TestBed.inject(Location);
    hostFixture = TestBed.createComponent(RouterTestHostComponent);
    hostFixture.detectChanges();
  });

  it('should initialize at page 2 with filters, navigate to article detail, and return via browser Back preserving category, tag, and page', async () => {
    // 1. Initialize the existing Angular Router at the exact starting URL
    await hostRouter.navigateByUrl(
      '/articles?category=backend-engineering&tag=postgresql&page=2',
    );
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 2-5. Verify location and query parameters
    expect(hostLocation.path()).toBe(
      '/articles?category=backend-engineering&tag=postgresql&page=2',
    );

    // 6. Verify outgoing Article list request includes page=2, category=backend-engineering, tag=postgresql
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      category: 'backend-engineering',
      tag: 'postgresql',
    });

    // 7. Verify rendered article cards
    const cardTitle = hostFixture.nativeElement.querySelector('h2 a') as HTMLAnchorElement;
    expect(cardTitle).toBeTruthy();
    expect(cardTitle.textContent?.trim()).toBe('Advanced PostgreSQL Partitioning');

    // 8. Click the actual Article title/card link
    cardTitle.click();
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 9-10. Confirm navigation to Article detail route with correct slug
    expect(hostLocation.path()).toBe('/articles/advanced-postgresql-partitioning');
    expect(hostFixture.nativeElement.querySelector('#detail-view')).toBeTruthy();

    // 11. Simulate browser Back using the existing Router test environment
    hostLocation.back();
    const popProvider = hostLocation as unknown as { simulateUrlPop?: (url: string) => void };
    if (typeof popProvider.simulateUrlPop === 'function') {
      popProvider.simulateUrlPop(hostLocation.path());
    } else {
      await hostRouter.navigateByUrl(hostLocation.path());
    }
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 12. Verify current catalog URL is restored
    expect(hostLocation.path()).toBe(
      '/articles?category=backend-engineering&tag=postgresql&page=2',
    );

    // 13-15. Verify list request contains original filters and page
    const calls = integrationApiSpy.listPublishedArticles.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall).toEqual({
      page: 2,
      limit: 20,
      category: 'backend-engineering',
      tag: 'postgresql',
    });

    // 16. Verify filtered article card renders correctly
    const restoredCardTitle = hostFixture.nativeElement.querySelector('h2 a') as HTMLAnchorElement;
    expect(restoredCardTitle).toBeTruthy();
    expect(restoredCardTitle.textContent?.trim()).toBe('Advanced PostgreSQL Partitioning');

    // 17. Verify pagination indicates page 2
    const paginationNav = hostFixture.nativeElement.querySelector('app-public-article-pagination');
    expect(paginationNav).toBeTruthy();
    expect(paginationNav.textContent?.toLowerCase()).toContain('page 2 of 2');

    // 18. Confirm exactly 2 list requests occurred (initial page 2 load + browser back page 2 restore)
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(2);
  });

  it('should initialize at page 2 with search keyword, category, and tag, navigate to detail, and restore all search/taxonomy parameters on browser Back', async () => {
    // 1. Initialize Angular Router at starting URL with q, category, tag, page 2
    await hostRouter.navigateByUrl(
      '/articles?q=postgresql&category=backend-engineering&tag=database&page=2',
    );
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 2. Verify location path
    expect(hostLocation.path()).toBe(
      '/articles?q=postgresql&category=backend-engineering&tag=database&page=2',
    );

    // 3. Verify outgoing list request contains all 4 parameters
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      category: 'backend-engineering',
      tag: 'database',
      q: 'postgresql',
    });

    // 4. Verify search input in DOM reflects 'postgresql'
    const searchInput = hostFixture.nativeElement.querySelector(
      '[data-testid="catalog-search-input"]',
    ) as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(searchInput.value).toBe('postgresql');

    // 5. Open article card
    const cardTitle = hostFixture.nativeElement.querySelector('h2 a') as HTMLAnchorElement;
    expect(cardTitle).toBeTruthy();
    cardTitle.click();
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 6. Confirm navigation to detail view
    expect(hostLocation.path()).toBe('/articles/advanced-postgresql-partitioning');
    expect(hostFixture.nativeElement.querySelector('#detail-view')).toBeTruthy();

    // 7. Simulate browser Back
    hostLocation.back();
    const popProvider = hostLocation as unknown as { simulateUrlPop?: (url: string) => void };
    if (typeof popProvider.simulateUrlPop === 'function') {
      popProvider.simulateUrlPop(hostLocation.path());
    } else {
      await hostRouter.navigateByUrl(hostLocation.path());
    }
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 8. Verify exact catalog URL is restored
    expect(hostLocation.path()).toBe(
      '/articles?q=postgresql&category=backend-engineering&tag=database&page=2',
    );

    // 9. Verify restored list request reissues with all 4 parameters
    const calls = integrationApiSpy.listPublishedArticles.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall).toEqual({
      page: 2,
      limit: 20,
      category: 'backend-engineering',
      tag: 'database',
      q: 'postgresql',
    });

    // 10. Verify search input still contains 'postgresql'
    const restoredInput = hostFixture.nativeElement.querySelector(
      '[data-testid="catalog-search-input"]',
    ) as HTMLInputElement;
    expect(restoredInput.value).toBe('postgresql');

    // 11. Confirm exactly 2 list requests occurred
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(2);
  });

  it('safely canonicalizes repeated q parameters, preserves valid taxonomy, resets page to 1, and issues exactly one list request', async () => {
    // 1. Direct navigation to URL with repeated q parameter, valid category, valid tag, and page=2
    await hostRouter.navigateByUrl(
      '/articles?q=postgresql&q=angular&category=backend-engineering&tag=postgresql&page=2',
    );
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // 2. Canonical URL must have invalid repeated q removed, taxonomy preserved, and page reset to 1
    expect(hostLocation.path()).toBe(
      '/articles?category=backend-engineering&tag=postgresql&page=1',
    );

    // 3. Exactly zero intermediate HTTP requests occurred, and exactly one canonical HTTP request occurred
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(1);
    const calls = integrationApiSpy.listPublishedArticles.mock.calls;
    expect(calls[0][0]).toEqual({
      page: 1,
      limit: 20,
      category: 'backend-engineering',
      tag: 'postgresql',
      q: undefined,
    });

    // 4. Search input is empty in the DOM
    const searchInput = hostFixture.nativeElement.querySelector(
      '[data-testid="catalog-search-input"]',
    ) as HTMLInputElement;
    expect(searchInput.value).toBe('');

    // 5. No search chip rendered in summary banner
    const searchChip = hostFixture.nativeElement.querySelector(
      '[data-testid="active-search-clear-btn"]',
    );
    expect(searchChip).toBeNull();
  });

  it('safely canonicalizes overlong q parameters, preserves valid taxonomy, and resets page to 1', async () => {
    const overlongTerm = 'a'.repeat(121);
    await hostRouter.navigateByUrl(
      `/articles?q=${overlongTerm}&category=backend-engineering&page=3`,
    );
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // Canonical destination preserves category, removes overlong q, and resets page to 1
    expect(hostLocation.path()).toBe('/articles?category=backend-engineering&page=1');
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(1);
    expect(integrationApiSpy.listPublishedArticles.mock.calls[0][0]).toEqual({
      page: 1,
      limit: 20,
      category: 'backend-engineering',
      tag: undefined,
      q: undefined,
    });
  });

  it('safely canonicalizes blank q parameters and handles browser Back navigation without redirect loops', async () => {
    // 1. Start from valid search route
    await hostRouter.navigateByUrl('/articles?q=postgresql&page=1');
    hostFixture.detectChanges();
    await hostFixture.whenStable();
    expect(hostLocation.path()).toBe('/articles?q=postgresql&page=1');
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(1);

    // 2. Navigate to invalid blank query with page=2
    await hostRouter.navigateByUrl('/articles?q=%20%20%20&page=2');
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    // Canonical destination replaced URL to /articles?page=1
    expect(hostLocation.path()).toBe('/articles?page=1');
    // Total API calls: 1 (initial) + 1 (canonical after blank recovery) = 2
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(2);

    // 3. Browser Back skips the replaced invalid URL and returns to the initial valid route
    hostLocation.back();
    const popProvider = hostLocation as unknown as { simulateUrlPop?: (url: string) => void };
    if (typeof popProvider.simulateUrlPop === 'function') {
      popProvider.simulateUrlPop(hostLocation.path());
    } else {
      await hostRouter.navigateByUrl(hostLocation.path());
    }
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    expect(hostLocation.path()).toBe('/articles?q=postgresql&page=1');
    expect(integrationApiSpy.listPublishedArticles).toHaveBeenCalledTimes(3);
  });
});
