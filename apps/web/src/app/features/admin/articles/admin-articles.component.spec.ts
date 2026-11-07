import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { AdminArticlesComponent } from './admin-articles.component';
import { AdminApiService } from '../services/admin-api.service';
import { AdminArticleItem, PaginatedAdminArticlesResponse } from '../models/admin.models';

describe('AdminArticlesComponent', () => {
  let fixture: ComponentFixture<AdminArticlesComponent>;
  let component: AdminArticlesComponent;
  let adminApiMock: {
    listArticles: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  const sampleArticles: AdminArticleItem[] = [
    {
      id: 'art-1',
      title: 'PostgreSQL 17 Deep Dive (Draft Title)',
      draftSlug: 'postgresql-17-deep-dive',
      status: 'PUBLISHED',
      draftRevision: 3,
      publishedRevision: 1,
      authorId: 'auth-1',
      authorEmail: 'author@skyra-tech.com',
      publishedAt: '2026-10-20T10:00:00Z',
      publishedSlug: 'postgresql-17-deep-dive-published',
      publishedTitle: 'PostgreSQL 17 Deep Dive (Published Snapshot)',
      createdAt: '2026-10-15T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    },
    {
      id: 'art-2',
      title: 'Upcoming Distributed Systems',
      draftSlug: 'upcoming-distributed-systems',
      status: 'DRAFT',
      draftRevision: 1,
      publishedRevision: 0,
      authorId: 'auth-1',
      authorEmail: 'author@skyra-tech.com',
      publishedAt: null,
      publishedSlug: null,
      publishedTitle: null,
      createdAt: '2026-10-21T12:00:00Z',
      updatedAt: '2026-10-21T12:00:00Z',
    },
    {
      id: 'art-3',
      title: 'Legacy Architecture',
      draftSlug: 'legacy-architecture',
      status: 'ARCHIVED',
      draftRevision: 2,
      publishedRevision: 1,
      authorId: 'auth-2',
      authorEmail: 'archived@skyra-tech.com',
      publishedAt: null,
      publishedSlug: null,
      publishedTitle: null,
      createdAt: '2026-09-01T12:00:00Z',
      updatedAt: '2026-10-01T12:00:00Z',
    },
  ];

  const sampleResponse: PaginatedAdminArticlesResponse = {
    data: sampleArticles,
    total: 3,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  const queryParams$ = new BehaviorSubject(convertToParamMap({}));

  beforeEach(async () => {
    adminApiMock = {
      listArticles: vi.fn().mockReturnValue(of(sampleResponse)),
    };

    await TestBed.configureTestingModule({
      imports: [AdminArticlesComponent],
      providers: [
        provideRouter([]),
        { provide: AdminApiService, useValue: adminApiMock },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParams$.asObservable(),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(AdminArticlesComponent);
    component = fixture.componentInstance;
  });

  it('1. should create and initialize', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('2. displays loading skeleton while fetching articles', () => {
    adminApiMock.listArticles.mockReturnValue(of());
    fixture.detectChanges();

    const skeleton = fixture.nativeElement.querySelector('.skeleton-table');
    expect(skeleton).toBeTruthy();
    expect(component.loading()).toBe(true);
  });

  it('3. renders articles table with draft titles, authors, and statuses', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.table-row');
    expect(rows.length).toBe(3);

    const firstTitle = fixture.nativeElement.querySelector('[data-testid="article-title"]');
    expect(firstTitle?.textContent?.trim()).toBe('PostgreSQL 17 Deep Dive (Draft Title)');
  });

  it('4. renders published status badge with link to public reader', () => {
    fixture.detectChanges();
    const pubLink = fixture.nativeElement.querySelector('[data-testid="article-public-link"]');
    expect(pubLink).toBeTruthy();
    expect(pubLink.getAttribute('href')).toBe('/articles/postgresql-17-deep-dive-published');
  });

  it('5. renders draft status badge without public link', () => {
    fixture.detectChanges();
    const draftRow = fixture.nativeElement.querySelector('[data-article-id="art-2"]');
    const pubLink = draftRow.querySelector('[data-testid="article-public-link"]');
    expect(pubLink).toBeNull();
  });

  it('6. renders archived status badge', () => {
    fixture.detectChanges();
    const archivedRow = fixture.nativeElement.querySelector('[data-article-id="art-3"]');
    const statusBadge = archivedRow.querySelector('[data-testid="article-status"]');
    expect(statusBadge?.textContent?.trim()).toBe('ARCHIVED');
  });

  it('7. renders draft revision and published revision indicators', () => {
    fixture.detectChanges();
    const revs = fixture.nativeElement.querySelector('[data-testid="article-revisions"]');
    expect(revs?.textContent?.trim()).toBe('d:3 / p:1');
  });

  it('8. displays empty state when no articles are returned', () => {
    adminApiMock.listArticles.mockReturnValue(
      of({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    );
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.empty-state-wrapper');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No articles found');
  });

  it('9. triggers navigation update on status filter change', () => {
    fixture.detectChanges();
    component.statusFilter.set('PUBLISHED');
    component.onFilterChange();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ status: 'PUBLISHED', page: 1 }),
      }),
    );
  });

  it('10. triggers navigation update on search query submit', () => {
    fixture.detectChanges();
    component.searchQuery.set('deep dive');
    component.onSearchSubmit();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ q: 'deep dive', page: 1 }),
      }),
    );
  });

  it('11. clearFilters resets all filters and updates query params', () => {
    fixture.detectChanges();
    component.statusFilter.set('DRAFT');
    component.searchQuery.set('test');

    component.clearFilters();

    expect(component.statusFilter()).toBe('ALL');
    expect(component.searchQuery()).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ status: null, q: null, page: 1 }),
      }),
    );
  });

  it('12. pagination Next button triggers navigation to next page', () => {
    adminApiMock.listArticles.mockReturnValue(
      of({ data: sampleArticles, total: 30, page: 1, limit: 20, totalPages: 2 }),
    );
    fixture.detectChanges();

    const nextBtn = fixture.nativeElement.querySelector('#btn-articles-next-page');
    expect(nextBtn.disabled).toBe(false);

    component.goToPage(2);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ page: 2 }),
      }),
    );
  });

  it('13. pagination Prev button is disabled on page 1', () => {
    fixture.detectChanges();
    const prevBtn = fixture.nativeElement.querySelector('#btn-articles-prev-page');
    expect(prevBtn.disabled).toBe(true);
  });

  it('14. renders total count and page indicator', () => {
    fixture.detectChanges();
    const totalCount = fixture.nativeElement.querySelector('[data-testid="articles-total-count"]');
    const indicator = fixture.nativeElement.querySelector('[data-testid="articles-page-indicator"]');

    expect(totalCount?.textContent?.trim()).toBe('3');
    expect(indicator?.textContent?.trim()).toBe('Page 1 of 1');
  });

  it('15. clicking Inspect opens read-only details modal', () => {
    fixture.detectChanges();
    const viewBtn = fixture.nativeElement.querySelector('#btn-view-article-art-1');
    viewBtn.click();
    fixture.detectChanges();

    expect(component.selectedArticle()).toEqual(sampleArticles[0]);
    const modal = fixture.nativeElement.querySelector('.modal-dialog');
    expect(modal).toBeTruthy();
  });

  it('16. inspect modal distinguishes draft title/slug from published title/slug', () => {
    fixture.detectChanges();
    component.viewArticle(sampleArticles[0]);
    fixture.detectChanges();

    const draftTitleEl = fixture.nativeElement.querySelector('[data-testid="modal-article-draft-title"]');
    const pubTitleEl = fixture.nativeElement.querySelector('[data-testid="modal-article-pub-title"]');
    const draftSlugEl = fixture.nativeElement.querySelector('[data-testid="modal-article-draft-slug"]');
    const pubSlugEl = fixture.nativeElement.querySelector('[data-testid="modal-article-pub-slug"]');

    expect(draftTitleEl?.textContent?.trim()).toBe('PostgreSQL 17 Deep Dive (Draft Title)');
    expect(pubTitleEl?.textContent?.trim()).toBe('PostgreSQL 17 Deep Dive (Published Snapshot)');
    expect(draftSlugEl?.textContent?.trim()).toBe('/postgresql-17-deep-dive');
    expect(pubSlugEl?.textContent?.trim()).toBe('/postgresql-17-deep-dive-published');
  });

  it('17. inspect modal includes link to open public reader when published', () => {
    fixture.detectChanges();
    component.viewArticle(sampleArticles[0]);
    fixture.detectChanges();

    const publicModalLink = fixture.nativeElement.querySelector('#btn-modal-view-public');
    expect(publicModalLink).toBeTruthy();
    expect(publicModalLink.getAttribute('href')).toBe('/articles/postgresql-17-deep-dive-published');
  });

  it('18. displays error banner on API failure and retries successfully', () => {
    adminApiMock.listArticles.mockReturnValueOnce(throwError(() => new Error('Server error')));
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.error-banner');
    expect(banner).toBeTruthy();
    expect(component.errorMessage()).not.toBeNull();

    // Retry
    adminApiMock.listArticles.mockReturnValueOnce(of(sampleResponse));
    const retryBtn = fixture.nativeElement.querySelector('.retry-btn');
    retryBtn.click();
    fixture.detectChanges();

    expect(component.errorMessage()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.table-row').length).toBe(3);
  });
});

