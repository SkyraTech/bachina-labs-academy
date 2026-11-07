import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../../core/api';
import {
  PublicArticleListResponse,
  PublicArticlesQueryOptions,
} from '../../articles/models/public-article.models';
import { PublicAuthorProfile } from '../models/public-author.models';

/**
 * PublicAuthorApiService — Typed client for public author profile endpoints.
 *
 * Sourced strictly from /api/v1/authors
 * Accessible anonymously without credentials or sessions.
 * Never exposes private user attributes.
 */
@Injectable({
  providedIn: 'root',
})
export class PublicAuthorApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Retrieves public author identity and count of published articles.
   * GET /api/v1/authors/:authorId
   */
  getAuthorProfile(authorId: string): Observable<PublicAuthorProfile> {
    const cleanId = encodeURIComponent(authorId.trim());
    return this.api.get<PublicAuthorProfile>(`authors/${cleanId}`);
  }

  /**
   * Lists published articles authored exclusively by the specified author.
   * GET /api/v1/authors/:authorId/articles
   */
  getAuthorArticles(
    authorId: string,
    params?: PublicArticlesQueryOptions,
  ): Observable<PublicArticleListResponse> {
    const cleanId = encodeURIComponent(authorId.trim());
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

    return this.api.get<PublicArticleListResponse>(`authors/${cleanId}/articles`, {
      params: queryParams,
    });
  }
}

