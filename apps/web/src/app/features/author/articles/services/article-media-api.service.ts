import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../../core/api';
import { MediaAssetDto, PaginatedMediaAssetsResponse } from '../models/article-media.models';

/**
 * ArticleMediaApiService — Typed HTTP client for author media upload, listing, and private preview.
 * Connects to endpoints under /api/v1/articles/media.
 */
@Injectable({
  providedIn: 'root',
})
export class ArticleMediaApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Uploads an image asset to the server.
   * POST /api/v1/articles/media
   */
  uploadMedia(file: File): Observable<MediaAssetDto> {
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<MediaAssetDto>('articles/media', formData);
  }

  /**
   * Lists media assets uploaded by the current authenticated author.
   * GET /api/v1/articles/media/mine
   */
  listMyMedia(params?: {
    page?: number;
    limit?: number;
  }): Observable<PaginatedMediaAssetsResponse> {
    const queryParams: Record<string, string | number> = {};
    if (params?.page) queryParams['page'] = params.page;
    if (params?.limit) queryParams['limit'] = params.limit;

    return this.api.get<PaginatedMediaAssetsResponse>('articles/media/mine', {
      params: queryParams,
    });
  }

  /**
   * Resolves the authenticated private media preview content URL.
   * GET /api/v1/articles/media/:mediaId/content
   */
  getPrivateMediaPreviewUrl(mediaId: string): string {
    return this.api.resolveUrl(`articles/media/${mediaId}/content`);
  }
}
