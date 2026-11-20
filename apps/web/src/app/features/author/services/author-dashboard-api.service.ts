import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../core/api';
import { AuthorDashboardResponse } from '../models/author-dashboard.models';

/**
 * AuthorDashboardApiService — Typed HTTP client for author studio dashboard metrics.
 * Connects to /api/v1/author/dashboard.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthorDashboardApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Retrieves authoritative operational metrics and recently updated articles
   * strictly scoped to the authenticated author.
   * GET /api/v1/author/dashboard
   */
  getDashboard(): Observable<AuthorDashboardResponse> {
    return this.api.get<AuthorDashboardResponse>('author/dashboard');
  }
}
