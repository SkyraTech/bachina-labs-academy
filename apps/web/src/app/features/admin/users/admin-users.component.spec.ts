import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { AdminUsersComponent } from './admin-users.component';
import { AdminApiService } from '../services/admin-api.service';
import { AdminUserItem, PaginatedAdminUsersResponse } from '../models/admin.models';

describe('AdminUsersComponent', () => {
  let fixture: ComponentFixture<AdminUsersComponent>;
  let component: AdminUsersComponent;
  let adminApiMock: {
    listUsers: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  const sampleUsers: AdminUserItem[] = [
    {
      id: 'usr-1',
      email: 'admin@skyra-tech.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      isEmailVerified: true,
      emailVerifiedAt: '2026-10-15T10:00:00Z',
      createdAt: '2026-10-15T10:00:00Z',
      updatedAt: '2026-10-15T10:00:00Z',
    },
    {
      id: 'usr-2',
      email: 'author@skyra-tech.com',
      role: 'AUTHOR',
      status: 'ACTIVE',
      isEmailVerified: false,
      emailVerifiedAt: null,
      createdAt: '2026-10-16T12:00:00Z',
      updatedAt: '2026-10-16T12:00:00Z',
    },
    {
      id: 'usr-3',
      email: 'suspended@skyra-tech.com',
      role: 'AUTHOR',
      status: 'SUSPENDED',
      isEmailVerified: true,
      emailVerifiedAt: '2026-10-17T12:00:00Z',
      createdAt: '2026-10-17T12:00:00Z',
      updatedAt: '2026-10-17T12:00:00Z',
    },
    {
      id: 'usr-4',
      email: 'disabled@skyra-tech.com',
      role: 'AUTHOR',
      status: 'DISABLED',
      isEmailVerified: true,
      emailVerifiedAt: '2026-10-18T12:00:00Z',
      createdAt: '2026-10-18T12:00:00Z',
      updatedAt: '2026-10-18T12:00:00Z',
    },
  ];

  const sampleResponse: PaginatedAdminUsersResponse = {
    data: sampleUsers,
    total: 4,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  const queryParams$ = new BehaviorSubject(convertToParamMap({}));

  beforeEach(async () => {
    adminApiMock = {
      listUsers: vi.fn().mockReturnValue(of(sampleResponse)),
    };

    await TestBed.configureTestingModule({
      imports: [AdminUsersComponent],
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

    fixture = TestBed.createComponent(AdminUsersComponent);
    component = fixture.componentInstance;
  });

  it('1. should create and initialize', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('2. displays loading skeleton while fetching', () => {
    adminApiMock.listUsers.mockReturnValue(of());
    fixture.detectChanges();

    const skeleton = fixture.nativeElement.querySelector('.skeleton-table');
    expect(skeleton).toBeTruthy();
    expect(component.loading()).toBe(true);
  });

  it('3. renders users table with emails, roles and statuses', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.table-row');
    expect(rows.length).toBe(4);

    const firstEmail = fixture.nativeElement.querySelector('[data-testid="user-email"]');
    expect(firstEmail?.textContent?.trim()).toBe('admin@skyra-tech.com');
  });

  it('4. renders verified badge for verified user', () => {
    fixture.detectChanges();
    const verified = fixture.nativeElement.querySelectorAll('[data-testid="user-verified"]');
    expect(verified.length).toBe(3);
  });

  it('5. renders unverified badge for unverified user', () => {
    fixture.detectChanges();
    const unverified = fixture.nativeElement.querySelectorAll('[data-testid="user-unverified"]');
    expect(unverified.length).toBe(1);
  });

  it('6. displays empty state when no users are returned', () => {
    adminApiMock.listUsers.mockReturnValue(
      of({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    );
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.empty-state-wrapper');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No users found');
  });

  it('7. triggers navigation update on role filter change', () => {
    fixture.detectChanges();
    component.roleFilter.set('ADMIN');
    component.onFilterChange();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ role: 'ADMIN', page: 1 }),
      }),
    );
  });

  it('8. triggers navigation update on status filter change', () => {
    fixture.detectChanges();
    component.statusFilter.set('SUSPENDED');
    component.onFilterChange();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ status: 'SUSPENDED', page: 1 }),
      }),
    );
  });

  it('9. triggers navigation update on search submit', () => {
    fixture.detectChanges();
    component.searchQuery.set('skyra');
    component.onSearchSubmit();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ q: 'skyra', page: 1 }),
      }),
    );
  });

  it('10. clearFilters resets all filters and updates query params', () => {
    fixture.detectChanges();
    component.roleFilter.set('ADMIN');
    component.statusFilter.set('ACTIVE');
    component.searchQuery.set('test');

    component.clearFilters();

    expect(component.roleFilter()).toBe('ALL');
    expect(component.statusFilter()).toBe('ALL');
    expect(component.searchQuery()).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ role: null, status: null, q: null, page: 1 }),
      }),
    );
  });

  it('11. pagination Next button triggers navigation to next page', () => {
    adminApiMock.listUsers.mockReturnValue(
      of({ data: sampleUsers, total: 40, page: 1, limit: 20, totalPages: 2 }),
    );
    fixture.detectChanges();

    const nextBtn = fixture.nativeElement.querySelector('#btn-users-next-page');
    expect(nextBtn.disabled).toBe(false);

    component.goToPage(2);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ page: 2 }),
      }),
    );
  });

  it('12. pagination Prev button is disabled on page 1', () => {
    fixture.detectChanges();
    const prevBtn = fixture.nativeElement.querySelector('#btn-users-prev-page');
    expect(prevBtn.disabled).toBe(true);
  });

  it('13. renders total users count and page indicator', () => {
    fixture.detectChanges();
    const totalCount = fixture.nativeElement.querySelector('[data-testid="users-total-count"]');
    const indicator = fixture.nativeElement.querySelector('[data-testid="users-page-indicator"]');

    expect(totalCount?.textContent?.trim()).toBe('4');
    expect(indicator?.textContent?.trim()).toBe('Page 1 of 1');
  });

  it('14. clicking Inspect opens read-only details modal', () => {
    fixture.detectChanges();
    const viewBtn = fixture.nativeElement.querySelector('#btn-view-user-usr-1');
    viewBtn.click();
    fixture.detectChanges();

    expect(component.selectedUser()).toEqual(sampleUsers[0]);
    const modal = fixture.nativeElement.querySelector('.modal-dialog');
    expect(modal).toBeTruthy();
  });

  it('15. inspect modal displays safe projected user fields', () => {
    fixture.detectChanges();
    component.viewUser(sampleUsers[0]);
    fixture.detectChanges();

    const idEl = fixture.nativeElement.querySelector('[data-testid="modal-user-id"]');
    const emailEl = fixture.nativeElement.querySelector('[data-testid="modal-user-email"]');
    const roleEl = fixture.nativeElement.querySelector('[data-testid="modal-user-role"]');
    const statusEl = fixture.nativeElement.querySelector('[data-testid="modal-user-status"]');

    expect(idEl?.textContent?.trim()).toBe('usr-1');
    expect(emailEl?.textContent?.trim()).toBe('admin@skyra-tech.com');
    expect(roleEl?.textContent?.trim()).toBe('ADMIN');
    expect(statusEl?.textContent?.trim()).toBe('ACTIVE');
  });

  it('16. closing modal clears selectedUser and removes dialog', () => {
    fixture.detectChanges();
    component.viewUser(sampleUsers[0]);
    fixture.detectChanges();

    const closeBtn = fixture.nativeElement.querySelector('#btn-close-user-modal');
    closeBtn.click();
    fixture.detectChanges();

    expect(component.selectedUser()).toBeNull();
    const modal = fixture.nativeElement.querySelector('.modal-dialog');
    expect(modal).toBeNull();
  });

  it('17. displays error banner on API failure and retries successfully', () => {
    adminApiMock.listUsers.mockReturnValueOnce(throwError(() => new Error('Server error')));
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.error-banner');
    expect(banner).toBeTruthy();
    expect(component.errorMessage()).not.toBeNull();

    // Retry
    adminApiMock.listUsers.mockReturnValueOnce(of(sampleResponse));
    const retryBtn = fixture.nativeElement.querySelector('.retry-btn');
    retryBtn.click();
    fixture.detectChanges();

    expect(component.errorMessage()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.table-row').length).toBe(4);
  });

  it('18. displays disabled status badge when user status is DISABLED', () => {
    fixture.detectChanges();
    const badges = fixture.nativeElement.querySelectorAll('.status-badge');
    const disabledBadge = Array.from(badges).find((el) => (el as Element).textContent?.trim() === 'DISABLED');
    expect(disabledBadge).toBeTruthy();
    expect((disabledBadge as Element).classList.contains('badge-disabled')).toBe(true);
  });
});

