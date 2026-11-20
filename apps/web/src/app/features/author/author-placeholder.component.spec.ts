import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { AuthorDashboardPlaceholderComponent } from './author-placeholder.component';
import { AuthorDashboardApiService } from './services/author-dashboard-api.service';
import { AuthorDashboardResponse } from './models/author-dashboard.models';

describe('AuthorDashboardPlaceholderComponent', () => {
  let fixture: ComponentFixture<AuthorDashboardPlaceholderComponent>;
  let component: AuthorDashboardPlaceholderComponent;
  let apiMock: {
    getDashboard: ReturnType<typeof vi.fn>;
  };

  const MOCK_DATA: AuthorDashboardResponse = {
    metrics: {
      total: 10,
      draft: 3,
      published: 6,
      archived: 1,
    },
    recentlyUpdated: [
      {
        id: '11111111-1111-4000-8000-000000000001',
        title: 'Architecting High-Throughput Event Streams in Node.js',
        status: 'PUBLISHED',
        updatedAt: '2026-11-18T14:30:00.000Z',
      },
      {
        id: '11111111-1111-4000-8000-000000000002',
        title: 'Understanding Reactive Signals and Zoneless Change Detection in Modern Angular Applications With Deep Nested Component Hierarchies',
        status: 'DRAFT',
        updatedAt: '2026-11-18T13:15:00.000Z',
      },
      {
        id: '11111111-1111-4000-8000-000000000003',
        title: 'Legacy REST APIs vs Modern GraphQL Endpoints',
        status: 'ARCHIVED',
        updatedAt: '2026-11-17T09:00:00.000Z',
      },
    ],
  };

  const EMPTY_DATA: AuthorDashboardResponse = {
    metrics: {
      total: 0,
      draft: 0,
      published: 0,
      archived: 0,
    },
    recentlyUpdated: [],
  };

  beforeEach(async () => {
    apiMock = {
      getDashboard: vi.fn().mockReturnValue(of(MOCK_DATA)),
    };

    await TestBed.configureTestingModule({
      imports: [AuthorDashboardPlaceholderComponent],
      providers: [
        provideRouter([]),
        { provide: AuthorDashboardApiService, useValue: apiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthorDashboardPlaceholderComponent);
    component = fixture.componentInstance;
  });

  it('should create the author overview component', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Loading State', () => {
    it('should render loading skeleton while fetching data', () => {
      // Do not emit yet so loading remains true
      apiMock.getDashboard.mockReturnValue(of());
      component.loading.set(true);
      fixture.detectChanges();

      const skeleton = fixture.debugElement.query(By.css('[data-testid="dashboard-loading-skeleton"]'));
      expect(skeleton).toBeTruthy();
      expect(skeleton.attributes['aria-busy']).toBe('true');
    });
  });

  describe('Operational Metrics Rendering', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should render authoritative total articles count', () => {
      const totalEl = fixture.debugElement.query(By.css('[data-testid="metric-total-articles"]'));
      expect(totalEl.nativeElement.textContent.trim()).toBe('10');
    });

    it('should render authoritative published articles count', () => {
      const pubEl = fixture.debugElement.query(By.css('[data-testid="metric-published-articles"]'));
      expect(pubEl.nativeElement.textContent.trim()).toBe('6');
    });

    it('should render authoritative draft articles count', () => {
      const draftEl = fixture.debugElement.query(By.css('[data-testid="metric-draft-articles"]'));
      expect(draftEl.nativeElement.textContent.trim()).toBe('3');
    });

    it('should render authoritative archived articles count', () => {
      const archEl = fixture.debugElement.query(By.css('[data-testid="metric-archived-articles"]'));
      expect(archEl.nativeElement.textContent.trim()).toBe('1');
    });

    it('should not render any fabricated metrics (views, readers, revenue)', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).not.toContain('Page Views');
      expect(text).not.toContain('Total Readers');
      expect(text).not.toContain('Revenue');
      expect(text).not.toContain('Conversion Rate');
    });
  });

  describe('Recently Updated Articles List', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should render recent article rows with real titles and status badges', () => {
      const rows = fixture.debugElement.queryAll(By.css('[data-testid="recent-article-row"]'));
      expect(rows.length).toBe(3);

      const firstTitle = fixture.debugElement.query(
        By.css('[data-testid="recent-article-title-11111111-1111-4000-8000-000000000001"]')
      );
      expect(firstTitle.nativeElement.textContent.trim()).toBe(
        'Architecting High-Throughput Event Streams in Node.js'
      );

      const firstBadge = fixture.debugElement.query(
        By.css('[data-testid="status-badge-11111111-1111-4000-8000-000000000001"]')
      );
      expect(firstBadge.nativeElement.textContent.trim()).toBe('PUBLISHED');
      expect(firstBadge.classes['badge-published']).toBe(true);
    });

    it('should map draft and archived status badges to their designated CSS classes', () => {
      const draftBadge = fixture.debugElement.query(
        By.css('[data-testid="status-badge-11111111-1111-4000-8000-000000000002"]')
      );
      expect(draftBadge.nativeElement.textContent.trim()).toBe('DRAFT');
      expect(draftBadge.classes['badge-draft']).toBe(true);

      const archBadge = fixture.debugElement.query(
        By.css('[data-testid="status-badge-11111111-1111-4000-8000-000000000003"]')
      );
      expect(archBadge.nativeElement.textContent.trim()).toBe('ARCHIVED');
      expect(archBadge.classes['badge-archived']).toBe(true);
    });

    it('should link each recent article to its author editor route', () => {
      const editBtn = fixture.debugElement.query(
        By.css('[data-testid="edit-article-btn-11111111-1111-4000-8000-000000000001"]')
      );
      expect(editBtn).toBeTruthy();
    });

    it('should render long article titles safely without breaking layout', () => {
      const longTitleEl = fixture.debugElement.query(
        By.css('[data-testid="recent-article-title-11111111-1111-4000-8000-000000000002"]')
      );
      expect(longTitleEl.nativeElement.textContent.trim()).toContain('Deep Nested Component Hierarchies');
      expect(longTitleEl.classes['line-clamp-1']).toBe(true);
    });
  });

  describe('Empty Dashboard State (0 Articles)', () => {
    it('should render zeroes and empty recent articles placeholder when author has 0 articles', () => {
      apiMock.getDashboard.mockReturnValue(of(EMPTY_DATA));
      component.loadDashboard();
      fixture.detectChanges();

      const totalEl = fixture.debugElement.query(By.css('[data-testid="metric-total-articles"]'));
      expect(totalEl.nativeElement.textContent.trim()).toBe('0');

      const pubEl = fixture.debugElement.query(By.css('[data-testid="metric-published-articles"]'));
      expect(pubEl.nativeElement.textContent.trim()).toBe('0');

      const emptyCard = fixture.debugElement.query(By.css('[data-testid="empty-recent-articles"]'));
      expect(emptyCard).toBeTruthy();
      expect(emptyCard.nativeElement.textContent).toContain('No articles yet');

      const createFirstBtn = fixture.debugElement.query(By.css('[data-testid="empty-create-draft-btn"]'));
      expect(createFirstBtn).toBeTruthy();
    });
  });

  describe('Error State and Retry Behavior', () => {
    it('should render error banner with retry button on API failure', () => {
      apiMock.getDashboard.mockReturnValue(throwError(() => new Error('Network error')));
      fixture.detectChanges();

      const errorBanner = fixture.debugElement.query(By.css('[data-testid="dashboard-error-banner"]'));
      expect(errorBanner).toBeTruthy();
      expect(errorBanner.nativeElement.textContent).toContain('Failed to load author metrics');

      const retryBtn = fixture.debugElement.query(By.css('[data-testid="retry-dashboard-btn"]'));
      expect(retryBtn).toBeTruthy();
    });

    it('should retry fetching dashboard metrics when retry button is clicked', () => {
      apiMock.getDashboard.mockReturnValue(throwError(() => new Error('Server error')));
      fixture.detectChanges();

      expect(component.errorMessage()).toBe('Failed to load author metrics. Please try again.');

      // Next call succeeds
      apiMock.getDashboard.mockReturnValue(of(MOCK_DATA));
      const retryBtn = fixture.debugElement.query(By.css('[data-testid="retry-dashboard-btn"]'));
      retryBtn.nativeElement.click();
      fixture.detectChanges();

      expect(component.errorMessage()).toBeNull();
      expect(component.dashboard()).toEqual(MOCK_DATA);
    });

    it('should trigger reload when refresh header button is clicked', () => {
      fixture.detectChanges();
      apiMock.getDashboard.mockClear();

      const refreshBtn = fixture.debugElement.query(By.css('[data-testid="refresh-dashboard-btn"]'));
      refreshBtn.nativeElement.click();

      expect(apiMock.getDashboard).toHaveBeenCalledTimes(1);
    });
  });

  describe('Preserved Quick Action Cards & Editorial Guide', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should render navigation links to New Draft, My Articles, and Account Security', () => {
      const links = fixture.debugElement.queryAll(By.css('a[routerLink]'));
      const hrefs = links.map((el) => el.attributes['routerLink']);

      expect(hrefs).toContain('/author/articles/new');
      expect(hrefs).toContain('/author/articles');
      expect(hrefs).toContain('/account/security');
    });

    it('should display the editorial workflow guide', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Self-Publishing Workflow');
      expect(text).toContain('Draft & Compose');
      expect(text).toContain('Private Preview');
      expect(text).toContain('Immutable Snapshots');
    });
  });
});
