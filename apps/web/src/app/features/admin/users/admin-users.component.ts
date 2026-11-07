import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LoadingSkeletonComponent } from '../../../shared/ui/loading/loading-skeleton.component';
import { EmptyStateComponent } from '../../../shared/ui/feedback/empty-state.component';
import { AdminApiService } from '../services/admin-api.service';
import { AdminUserItem, PaginatedAdminUsersResponse } from '../models/admin.models';

/**
 * AdminUsersComponent — Administrative user account directory.
 *
 * Enforces:
 * - Read-only inspection (strictly no mutations permitted)
 * - Safe projection: passwordHash and secret tokens strictly excluded
 * - Server-side pagination, role filtering, status filtering, and email search
 * - URL query parameter synchronization
 */
@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    LoadingSkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly users = signal<readonly AdminUserItem[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(20);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  // Filter state
  readonly roleFilter = signal<string>('ALL');
  readonly statusFilter = signal<string>('ALL');
  readonly searchQuery = signal<string>('');

  // Selected user for modal inspection
  readonly selectedUser = signal<AdminUserItem | null>(null);

  readonly hasActiveFilters = computed(() => {
    return (
      this.roleFilter() !== 'ALL' ||
      this.statusFilter() !== 'ALL' ||
      this.searchQuery().trim() !== ''
    );
  });

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.selectedUser()) {
      this.closeModal();
    }
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const pageParam = Number(params.get('page')) || 1;
      const limitParam = Number(params.get('limit')) || 20;
      const roleParam = params.get('role') || 'ALL';
      const statusParam = params.get('status') || 'ALL';
      const qParam = params.get('q') || '';

      this.page.set(pageParam);
      this.limit.set(limitParam);
      this.roleFilter.set(roleParam);
      this.statusFilter.set(statusParam);
      this.searchQuery.set(qParam);

      this.fetchUsers();
    });
  }

  fetchUsers(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.adminApi
      .listUsers({
        page: this.page(),
        limit: this.limit(),
        role: this.roleFilter() !== 'ALL' ? this.roleFilter() : undefined,
        status: this.statusFilter() !== 'ALL' ? this.statusFilter() : undefined,
        q: this.searchQuery().trim() || undefined,
      })
      .subscribe({
        next: (res: PaginatedAdminUsersResponse) => {
          this.users.set(res.data);
          this.total.set(res.total);
          this.page.set(res.page);
          this.limit.set(res.limit);
          this.totalPages.set(res.totalPages || 1);
          this.loading.set(false);
        },
        error: () => {
          this.errorMessage.set('Failed to load user directory. Please try again.');
          this.loading.set(false);
        },
      });
  }

  onFilterChange(): void {
    this.updateQueryParams({ page: 1 });
  }

  onSearchSubmit(): void {
    this.updateQueryParams({ page: 1 });
  }

  clearFilters(): void {
    this.roleFilter.set('ALL');
    this.statusFilter.set('ALL');
    this.searchQuery.set('');
    this.updateQueryParams({ page: 1, role: 'ALL', status: 'ALL', q: '' });
  }

  goToPage(newPage: number): void {
    if (newPage < 1 || newPage > this.totalPages()) return;
    this.updateQueryParams({ page: newPage });
  }

  viewUser(user: AdminUserItem): void {
    this.selectedUser.set(user);
  }

  closeModal(): void {
    this.selectedUser.set(null);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  }

  private updateQueryParams(extra: Record<string, string | number | undefined>): void {
    const qParams: Record<string, string | number | null> = {
      page: extra['page'] ?? this.page(),
      limit: this.limit() !== 20 ? this.limit() : null,
      role: (extra['role'] ?? this.roleFilter()) !== 'ALL' ? (extra['role'] ?? this.roleFilter()) : null,
      status: (extra['status'] ?? this.statusFilter()) !== 'ALL' ? (extra['status'] ?? this.statusFilter()) : null,
      q: (extra['q'] ?? this.searchQuery().trim()) || null,
    };

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qParams,
      queryParamsHandling: 'merge',
    });
  }
}
