import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { AdminApiService } from '../services/admin-api.service';
import { AdminOverviewResponse } from '../models/admin.models';

describe('AdminDashboardComponent', () => {
  let fixture: ComponentFixture<AdminDashboardComponent>;
  let component: AdminDashboardComponent;
  let adminApiMock: {
    getOverview: ReturnType<typeof vi.fn>;
  };

  const sampleMetrics: AdminOverviewResponse = {
    users: {
      total: 12,
      verified: 10,
      unverified: 2,
      byRole: { author: 9, admin: 3 },
      byStatus: { active: 11, suspended: 1, disabled: 0 },
    },
    articles: {
      total: 35,
      published: 20,
      draft: 12,
      archived: 3,
      totalPublishedSnapshots: 20,
    },
    taxonomy: {
      totalCategories: 6,
      totalTags: 18,
    },
  };

  beforeEach(async () => {
    adminApiMock = {
      getOverview: vi.fn().mockReturnValue(of(sampleMetrics)),
    };

    await TestBed.configureTestingModule({
      imports: [AdminDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AdminApiService, useValue: adminApiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDashboardComponent);
    component = fixture.componentInstance;
  });

  it('1. should create and initialize', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('2. displays loading skeleton while fetching metrics', () => {
    // Override with slow observable
    adminApiMock.getOverview.mockReturnValue(of());
    fixture.detectChanges();

    const skeleton = fixture.nativeElement.querySelector('.skeleton-grid');
    expect(skeleton).toBeTruthy();
    expect(component.loading()).toBe(true);
  });

  it('3. renders authoritative total users count', () => {
    fixture.detectChanges();
    const totalUsersEl = fixture.nativeElement.querySelector('[data-testid="metric-total-users"]');
    expect(totalUsersEl?.textContent?.trim()).toBe('12');
  });

  it('4. renders complete user breakdown (verified, unverified, authors, admins, active, suspended, disabled)', () => {
    fixture.detectChanges();
    const verified = fixture.nativeElement.querySelector('[data-testid="metric-verified-users"]');
    const unverified = fixture.nativeElement.querySelector('[data-testid="metric-unverified-users"]');
    const authors = fixture.nativeElement.querySelector('[data-testid="metric-authors"]');
    const admins = fixture.nativeElement.querySelector('[data-testid="metric-admins"]');
    const active = fixture.nativeElement.querySelector('[data-testid="metric-active-users"]');
    const suspended = fixture.nativeElement.querySelector('[data-testid="metric-suspended-users"]');
    const disabled = fixture.nativeElement.querySelector('[data-testid="metric-disabled-users"]');

    expect(verified?.textContent?.trim()).toBe('10');
    expect(unverified?.textContent?.trim()).toBe('2');
    expect(authors?.textContent?.trim()).toBe('9');
    expect(admins?.textContent?.trim()).toBe('3');
    expect(active?.textContent?.trim()).toBe('11');
    expect(suspended?.textContent?.trim()).toBe('1');
    expect(disabled?.textContent?.trim()).toBe('0');
  });

  it('5. renders authoritative total articles count', () => {
    fixture.detectChanges();
    const totalArticlesEl = fixture.nativeElement.querySelector('[data-testid="metric-total-articles"]');
    expect(totalArticlesEl?.textContent?.trim()).toBe('35');
  });

  it('6. renders complete article breakdown (published, draft, archived, snapshots)', () => {
    fixture.detectChanges();
    const published = fixture.nativeElement.querySelector('[data-testid="metric-published-articles"]');
    const draft = fixture.nativeElement.querySelector('[data-testid="metric-draft-articles"]');
    const archived = fixture.nativeElement.querySelector('[data-testid="metric-archived-articles"]');
    const snapshots = fixture.nativeElement.querySelector('[data-testid="metric-snapshots"]');

    expect(published?.textContent?.trim()).toBe('20');
    expect(draft?.textContent?.trim()).toBe('12');
    expect(archived?.textContent?.trim()).toBe('3');
    expect(snapshots?.textContent?.trim()).toBe('20');
  });

  it('7. renders taxonomy metrics for categories and tags', () => {
    fixture.detectChanges();
    const categories = fixture.nativeElement.querySelector('[data-testid="metric-total-categories"]');
    const tags = fixture.nativeElement.querySelector('[data-testid="metric-total-tags"]');

    expect(categories?.textContent?.trim()).toBe('6');
    expect(tags?.textContent?.trim()).toBe('18');
  });

  it('8. provides navigation link to User Directory', () => {
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('#link-users-directory');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/admin/users');
  });

  it('9. provides navigation link to Article Oversight directory', () => {
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('#link-articles-directory');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/admin/articles');
  });

  it('10. provides navigation links to Categories and Tags management', () => {
    fixture.detectChanges();
    const catLink = fixture.nativeElement.querySelector('#link-admin-categories');
    const tagLink = fixture.nativeElement.querySelector('#link-admin-tags');

    expect(catLink).toBeTruthy();
    expect(catLink.getAttribute('href')).toBe('/admin/categories');
    expect(tagLink).toBeTruthy();
    expect(tagLink.getAttribute('href')).toBe('/admin/tags');
  });

  it('11. displays error banner when metrics fetch fails', () => {
    adminApiMock.getOverview.mockReturnValue(throwError(() => new Error('Network failure')));
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.error-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Failed to load platform metrics');
    expect(component.errorMessage()).not.toBeNull();
  });

  it('12. retry button re-triggers loadMetrics and clears error upon success', () => {
    adminApiMock.getOverview.mockReturnValueOnce(throwError(() => new Error('Initial fail')));
    fixture.detectChanges();

    expect(component.errorMessage()).not.toBeNull();

    // Now return success on retry
    adminApiMock.getOverview.mockReturnValueOnce(of(sampleMetrics));
    const retryBtn = fixture.nativeElement.querySelector('.retry-btn');
    retryBtn.click();
    fixture.detectChanges();

    expect(adminApiMock.getOverview).toHaveBeenCalledTimes(2);
    expect(component.errorMessage()).toBeNull();
    const totalUsersEl = fixture.nativeElement.querySelector('[data-testid="metric-total-users"]');
    expect(totalUsersEl?.textContent?.trim()).toBe('12');
  });
});

