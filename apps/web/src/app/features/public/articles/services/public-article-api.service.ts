import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../../core/api';
import {
  PublicArticleDetailResponse,
  PublicArticleListResponse,
  PublicArticlesQueryOptions,
  PublicDiscoveredTaxonomyItem,
} from '../models/public-article.models';

/**
 * PublicArticleApiService — Typed client for public article reader endpoints.
 *
 * Responsibilities:
 * - Sourced exclusively from /api/v1/articles/public
 * - Accessible anonymously without credentials or sessions
 * - Reads published immutable snapshots only
 * - Enforces pagination parameters and safe slug encoding
 * - Consumes canonical taxonomy discovery and filtered listing endpoints
 */
@Injectable({
  providedIn: 'root',
})
export class PublicArticleApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Lists published articles with pagination and optional taxonomy filters.
   * GET /api/v1/articles/public
   */
  listPublishedArticles(
    params?: PublicArticlesQueryOptions,
  ): Observable<PublicArticleListResponse> {
    const queryParams: Record<string, string | number> = {};
    if (params?.page !== undefined) queryParams['page'] = params.page;
    if (params?.limit !== undefined) queryParams['limit'] = params.limit;
    if (params?.category !== undefined && params.category.trim() !== '') {
      queryParams['category'] = params.category.trim();
    }
    if (params?.tag !== undefined && params.tag.trim() !== '') {
      queryParams['tag'] = params.tag.trim();
    }
    if (params?.q !== undefined && params.q.trim() !== '') {
      queryParams['q'] = params.q.trim();
    }
    if (params?.authorId !== undefined && params.authorId.trim() !== '') {
      queryParams['authorId'] = params.authorId.trim();
    }

    return this.api.get<PublicArticleListResponse>('articles/public', {
      params: queryParams,
    });
  }

  /**
   * Discovers categories represented in active published snapshots.
   * GET /api/v1/articles/public/taxonomy/categories
   */
  getPublishedCategories(): Observable<readonly PublicDiscoveredTaxonomyItem[]> {
    return this.api.get<readonly PublicDiscoveredTaxonomyItem[]>(
      'articles/public/taxonomy/categories',
    );
  }

  /**
   * Discovers tags represented in active published snapshots.
   * GET /api/v1/articles/public/taxonomy/tags
   */
  getPublishedTags(): Observable<readonly PublicDiscoveredTaxonomyItem[]> {
    return this.api.get<readonly PublicDiscoveredTaxonomyItem[]>(
      'articles/public/taxonomy/tags',
    );
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
