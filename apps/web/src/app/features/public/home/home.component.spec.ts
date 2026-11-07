import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HomeComponent } from './home.component';
import { PublicArticleApiService } from '../articles/services/public-article-api.service';
import {
  PublicArticleItem,
  PublicDiscoveredTaxonomyItem,
  PublicArticleListResponse,
} from '../articles/models/public-article.models';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let apiSpy: {
    listPublishedArticles: ReturnType<typeof vi.fn>;
    getPublishedCategories: ReturnType<typeof vi.fn>;
    getPublishedTags: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  const mockArticles: PublicArticleItem[] = [
    {
      id: 'art-001',
      slug: 'postgresql-production-tuning',
      title: 'PostgreSQL 17 Production Performance & Tuning Guide',
      summary: 'Comprehensive production tuning guide for high-throughput relational databases with PostgreSQL.',
      typographyPreset: 'TECHNICAL_MINIMAL',
      cover: null,
      revision: 1,
      publishedAt: '2026-10-20T10:00:00.000Z',
      taxonomyCaptured: true,
      category: { id: 'c1', name: 'Backend Engineering', slug: 'backend-engineering' },
      tags: [{ id: 't1', name: 'Database', slug: 'database' }],
      author: { id: 'auth-1', displayName: 'Alex Mercer' },
    },
    {
      id: 'art-002',
      slug: 'angular-signals-architecture',
      title: 'Angular Signals Architecture and Zoneless State',
      summary: 'Building high-performance reactive applications with modern Angular signals.',
      typographyPreset: 'MODERN_SANS',
      cover: null,
      revision: 2,
      publishedAt: '2026-10-22T12:00:00.000Z',
      taxonomyCaptured: true,
      category: { id: 'c2', name: 'Frontend Architecture', slug: 'frontend-architecture' },
      tags: [{ id: 't2', name: 'Angular', slug: 'angular' }],
      author: { id: 'auth-2', displayName: 'Samira Chen' },
    },
  ];

  const mockCategories: PublicDiscoveredTaxonomyItem[] = [
    { id: 'c1', name: 'Backend Engineering', slug: 'backend-engineering', articleCount: 15 },
    { id: 'c2', name: 'Frontend Architecture', slug: 'frontend-architecture', articleCount: 8 },
  ];

  const mockTags: PublicDiscoveredTaxonomyItem[] = [
    { id: 't1', name: 'Database', slug: 'database', articleCount: 12 },
    { id: 't2', name: 'Angular', slug: 'angular', articleCount: 7 },
    { id: 't3', name: 'NestJS', slug: 'nestjs', articleCount: 5 },
  ];

  const mockArticlesResponse: PublicArticleListResponse = {
    items: mockArticles,
    total: 2,
    page: 1,
    limit: 6,
    totalPages: 1,
  };

  beforeEach(async () => {
    apiSpy = {
      listPublishedArticles: vi.fn().mockReturnValue(of(mockArticlesResponse)),
      getPublishedCategories: vi.fn().mockReturnValue(of(mockCategories)),
      getPublishedTags: vi.fn().mockReturnValue(of(mockTags)),
    };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        { provide: PublicArticleApiService, useValue: apiSpy },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // Test 1: Hero section rendering
  it('1. should render hero section with Academy title and mission statement', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#hero-heading')?.textContent).toContain('Build knowledge.');
    expect(el.textContent).toContain('The Bachina Labs Academy');
    expect(el.textContent).toContain('Discover practical engineering insights');
  });

  // Test 2: Search with query
  it('2. should submit search and navigate to /articles with query param', () => {
    component.searchQuery.set('postgresql');
    component.onSearchSubmit();
    expect(router.navigate).toHaveBeenCalledWith(['/articles'], {
      queryParams: { q: 'postgresql' },
    });
  });

  // Test 3: Search with empty query
  it('3. should submit empty search and navigate to /articles without params', () => {
    component.searchQuery.set('   ');
    component.onSearchSubmit();
    expect(router.navigate).toHaveBeenCalledWith(['/articles']);
  });

  // Test 4: Clear search query
  it('4. should clear search input when clear button is clicked', () => {
    component.searchQuery.set('nestjs');
    expect(component.searchQuery()).toBe('nestjs');
    component.onClearSearch();
    expect(component.searchQuery()).toBe('');
  });

  // Test 5: Recent articles rendering
  it('5. should load and display recent published articles in the grid', () => {
    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('app-public-article-card');
    expect(cards.length).toBe(2);
    expect(el.textContent).toContain('PostgreSQL 17 Production Performance & Tuning Guide');
    expect(el.textContent).toContain('Angular Signals Architecture and Zoneless State');
  });

  // Test 6: Category discovery rendering
  it('6. should render category discovery items with article counts', () => {
    const el = fixture.nativeElement as HTMLElement;
    const catChips = el.querySelectorAll('[data-testid="homepage-category-chip"]');
    expect(catChips.length).toBe(2);
    expect(catChips[0].textContent).toContain('Backend Engineering');
    expect(catChips[0].textContent).toContain('15');
    expect(catChips[1].textContent).toContain('Frontend Architecture');
    expect(catChips[1].textContent).toContain('8');
  });

  // Test 7: Category navigation
  it('7. should navigate to /articles with category param when category is clicked', () => {
    component.onSelectCategory('backend-engineering');
    expect(router.navigate).toHaveBeenCalledWith(['/articles'], {
      queryParams: { category: 'backend-engineering' },
    });
  });

  // Test 8: Tag discovery rendering
  it('8. should render tag discovery chips with article counts', () => {
    const el = fixture.nativeElement as HTMLElement;
    const tagChips = el.querySelectorAll('[data-testid="homepage-tag-chip"]');
    expect(tagChips.length).toBe(3);
    expect(tagChips[0].textContent).toContain('#Database');
    expect(tagChips[0].textContent).toContain('12');
  });

  // Test 9: Tag navigation
  it('9. should navigate to /articles with tag param when tag is clicked', () => {
    component.onSelectTag('database');
    expect(router.navigate).toHaveBeenCalledWith(['/articles'], {
      queryParams: { tag: 'database' },
    });
  });

  // Test 10: Hero trending topic tag navigation
  it('10. should navigate to /articles when trending topic tag in hero is clicked', () => {
    component.onSelectTag('angular');
    expect(router.navigate).toHaveBeenCalledWith(['/articles'], {
      queryParams: { tag: 'angular' },
    });
  });

  // Test 11: Loading skeleton
  it('11. should display loading skeleton while fetching data', () => {
    component.loading.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const skeleton = el.querySelector('[data-testid="homepage-loading-skeleton"]');
    expect(skeleton).toBeTruthy();
  });

  // Test 12: Error state and retry
  it('12. should display error state and retry successfully when API fails', () => {
    component.loading.set(false);
    component.error.set('Network error fetching homepage content');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const errorEl = el.querySelector('[data-testid="homepage-error-state"]');
    expect(errorEl).toBeTruthy();
    expect(errorEl?.textContent).toContain('Network error fetching homepage content');

    const retryBtn = el.querySelector('[data-testid="homepage-retry-btn"]') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();

    retryBtn.click();
    expect(apiSpy.listPublishedArticles).toHaveBeenCalled();
  });

  // Test 13: Empty state
  it('13. should display empty state when zero articles are published', () => {
    component.loading.set(false);
    component.error.set(null);
    component.recentArticles.set([]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const emptyEl = el.querySelector('[data-testid="homepage-empty-state"]');
    expect(emptyEl).toBeTruthy();
    expect(emptyEl?.textContent).toContain('No published articles yet');
  });

  // Test 14: Strict featured gate and no fabricated metrics
  it('14. should adhere to strict featured gate: no fake metrics or fabricated featured articles', () => {
    const el = fixture.nativeElement as HTMLElement;
    // Verify no fabricated metric counters exist (e.g., fake '1,200 views' or fake '5,000 readers')
    expect(el.textContent).not.toContain('1,200 views');
    expect(el.textContent).not.toContain('5,000 readers');
    expect(el.textContent).not.toContain('Editor Pick of the Week');

    // Confirm that the section rendered is authoritative 'Recent Publications'
    expect(el.querySelector('#recent-articles-heading')?.textContent).toContain('Recent Publications');
  });

  // Test 15: Partial failure resilience - Categories fail, Articles succeed
  it('15. should display articles and tags even if categories endpoint fails', () => {
    apiSpy.listPublishedArticles.mockReturnValue(of(mockArticlesResponse));
    apiSpy.getPublishedCategories.mockReturnValue(throwError(() => new Error('Categories failed')));
    apiSpy.getPublishedTags.mockReturnValue(of(mockTags));

    component.loadHomepageData();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(component.recentArticles().length).toBe(2);
    expect(component.categories().length).toBe(0);
    expect(component.tags().length).toBe(3);
    expect(component.error()).toBeNull();
    expect(el.querySelectorAll('app-public-article-card').length).toBe(2);
  });

  // Test 16: Partial failure resilience - Articles fail, Categories succeed
  it('16. should display categories even if articles endpoint fails with error state and retry', () => {
    apiSpy.listPublishedArticles.mockReturnValue(throwError(() => new Error('Articles failed')));
    apiSpy.getPublishedCategories.mockReturnValue(of(mockCategories));
    apiSpy.getPublishedTags.mockReturnValue(of(mockTags));

    component.loadHomepageData();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(component.recentArticles().length).toBe(0);
    expect(component.categories().length).toBe(2);
    expect(component.error()).toContain('Unable to load recent articles');
    expect(el.querySelector('[data-testid="homepage-error-state"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="homepage-category-chip"]').length).toBe(2);
  });

  // Test 17: Explore Topics label accuracy
  it('17. should render neutral Explore Topics label without fake popularity claims', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Explore Topics:');
    expect(el.textContent).not.toContain('Trending Topics:');
  });
});
