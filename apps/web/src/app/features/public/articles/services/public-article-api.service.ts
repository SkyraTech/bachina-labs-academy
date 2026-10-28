import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../../core/api';
import {
  PublicArticleDetailResponse,
  PublicArticleListResponse,
} from '../models/public-article.models';

/**
 * PublicArticleApiService — Typed client for public article reader endpoints.
 *
 * Responsibilities:
 * - Sourced exclusively from /api/v1/articles/public
 * - Accessible anonymously without credentials or sessions
 * - Reads published immutable snapshots only
 * - Enforces pagination parameters and safe slug encoding
 */
@Injectable({
  providedIn: 'root',
})
export class PublicArticleApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Lists published articles with pagination.
   * GET /api/v1/articles/public
   */
  listPublishedArticles(params?: {
    page?: number;
    limit?: number;
  }): Observable<PublicArticleListResponse> {
    const queryParams: Record<string, string | number> = {};
    if (params?.page !== undefined) queryParams['page'] = params.page;
    if (params?.limit !== undefined) queryParams['limit'] = params.limit;

    return this.api.get<PublicArticleListResponse>('articles/public', {
      params: queryParams,
    });
  }

  /**
   * Retrieves an immutable published article snapshot by its current published slug.
   * GET /api/v1/articles/public/:slug
   */
  getPublishedArticleBySlug(slug: string): Observable<PublicArticleDetailResponse> {
    const cleanSlug = encodeURIComponent(slug.trim());
    return this.api.get<PublicArticleDetailResponse>(`articles/public/${cleanSlug}`);
  }
}
