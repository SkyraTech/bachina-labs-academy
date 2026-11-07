import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LoadingSkeletonComponent } from '../../../shared/ui/loading/loading-skeleton.component';
import { AdminApiService } from '../services/admin-api.service';
import { AdminOverviewResponse } from '../models/admin.models';

/**
 * AdminDashboardComponent — Platform overview metrics and admin workspace hub.
 *
 * Enforces:
 * - Direct database aggregates from /api/v1/admin/overview
 * - Zero simulated metrics
 * - Loading skeleton and error recovery state
 * - Quick navigation to User directory, Article oversight, and Taxonomy management
 */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    PageHeaderComponent,
    LoadingSkeletonComponent,
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  readonly metrics = signal<AdminOverviewResponse | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadMetrics();
  }

  loadMetrics(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.adminApi.getOverview().subscribe({
      next: (data) => {
        this.metrics.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to load platform metrics. Please try again.');
        this.loading.set(false);
      },
    });
  }
}

