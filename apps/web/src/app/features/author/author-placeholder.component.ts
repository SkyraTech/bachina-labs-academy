import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { LoadingSkeletonComponent } from '../../shared/ui/loading/loading-skeleton.component';
import { AuthorDashboardApiService } from './services/author-dashboard-api.service';
import {
  AuthorDashboardResponse,
  AuthorArticleStatus,
} from './models/author-dashboard.models';

/**
 * AuthorDashboardPlaceholderComponent — Author Studio overview and authoritative metrics dashboard.
 *
 * Implements:
 * - Server-backed operational metrics (Total, Published, Draft, Archived) scoped to the author.
 * - Author's Recently Updated Articles list with live database timestamps.
 * - Loading skeleton and resilient error/retry state.
 * - Responsive desktop and mobile layout with accessible semantic markup.
 * - Quick action links and educational workflow guide.
 */
@Component({
  selector: 'app-author-placeholder',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DatePipe,
    NgClass,
    PageHeaderComponent,
    LoadingSkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './author-placeholder.component.html',
  styleUrl: './author-placeholder.component.css',
})
export class AuthorDashboardPlaceholderComponent implements OnInit {
  private readonly dashboardApi = inject(AuthorDashboardApiService);

  readonly dashboard = signal<AuthorDashboardResponse | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.dashboardApi.getDashboard().subscribe({
      next: (data) => {
        this.dashboard.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to load author metrics. Please try again.');
        this.loading.set(false);
      },
    });
  }

  getStatusBadgeClass(status: AuthorArticleStatus): string {
    switch (status) {
      case 'PUBLISHED':
        return 'badge-published';
      case 'DRAFT':
        return 'badge-draft';
      case 'ARCHIVED':
        return 'badge-archived';
      default:
        return 'badge-default';
    }
  }
}

export const AuthorDashboardComponent = AuthorDashboardPlaceholderComponent;
