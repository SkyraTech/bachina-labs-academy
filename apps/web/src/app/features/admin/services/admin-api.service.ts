import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../core/api';
import {
  AdminOverviewResponse,
  AdminUserItem,
  PaginatedAdminUsersResponse,
  ListAdminUsersQuery,
  AdminArticleItem,
  PaginatedAdminArticlesResponse,
  ListAdminArticlesQuery,
} from '../models/admin.models';

/**
 * AdminApiService — Dedicated typed HTTP client for platform administrative oversight.
 *
 * Responsibilities:
 * - Consumption of /api/v1/admin/overview
 * - Consumption of /api/v1/admin/users and /api/v1/admin/users/:id
 * - Consumption of /api/v1/admin/articles and /api/v1/admin/articles/:id
 * - Cookie-authenticated and strictly role-protected (@Roles(UserRole.ADMIN)).
 */
@Injectable({
  providedIn: 'root',
})
export class AdminApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Retrieves authoritative platform overview metrics directly from database aggregates.
   * GET /api/v1/admin/overview
   */
  getOverview(): Observable<AdminOverviewResponse> {
    return this.api.get<AdminOverviewResponse>('admin/overview');
  }

  /**
   * Retrieves paginated directory of platform user accounts with optional role/status/search filters.
   * GET /api/v1/admin/users
   */
  listUsers(query?: ListAdminUsersQuery): Observable<PaginatedAdminUsersResponse> {
    const params: Record<string, string | number> = {};
    if (query?.page !== undefined) params['page'] = query.page;
    if (query?.limit !== undefined) params['limit'] = query.limit;
    if (query?.role !== undefined && query.role !== 'ALL' && query.role.trim() !== '') {
      params['role'] = query.role.trim();
    }
    if (query?.status !== undefined && query.status !== 'ALL' && query.status.trim() !== '') {
      params['status'] = query.status.trim();
    }
    if (query?.q !== undefined && query.q.trim() !== '') {
      params['q'] = query.q.trim();
    }

    return this.api.get<PaginatedAdminUsersResponse>('admin/users', { params });
  }

  /**
   * Retrieves single user details for read-only inspection.
   * GET /api/v1/admin/users/:id
   */
  getUserById(id: string): Observable<AdminUserItem> {
    return this.api.get<AdminUserItem>(`admin/users/${encodeURIComponent(id)}`);
  }

  /**
   * Retrieves paginated directory of articles across all lifecycle states.
   * GET /api/v1/admin/articles
   */
  listArticles(query?: ListAdminArticlesQuery): Observable<PaginatedAdminArticlesResponse> {
    const params: Record<string, string | number> = {};
    if (query?.page !== undefined) params['page'] = query.page;
    if (query?.limit !== undefined) params['limit'] = query.limit;
    if (query?.status !== undefined && query.status !== 'ALL' && query.status.trim() !== '') {
      params['status'] = query.status.trim();
    }
    if (query?.q !== undefined && query.q.trim() !== '') {
      params['q'] = query.q.trim();
    }

    return this.api.get<PaginatedAdminArticlesResponse>('admin/articles', { params });
  }

  /**
   * Retrieves single article oversight details.
   * GET /api/v1/admin/articles/:id
   */
  getArticleById(id: string): Observable<AdminArticleItem> {
    return this.api.get<AdminArticleItem>(`admin/articles/${encodeURIComponent(id)}`);
  }
}

