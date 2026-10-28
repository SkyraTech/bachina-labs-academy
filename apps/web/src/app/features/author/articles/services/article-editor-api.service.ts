import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../../core/api';
import {
  ArticleBlock,
  ArticlePublicationResponse,
  ArticleStatus,
  CreateArticleRequest,
  CreateBlockRequest,
  EditableArticle,
  PaginatedAuthorArticlesResponse,
  PublishArticleRequest,
  ReorderBlocksRequest,
  UpdateArticleMetadataRequest,
  UpdateBlockRequest,
} from '../models/article.models';

export interface BlockWithRevisionResponse extends ArticleBlock {
  draftRevision: number;
}

export interface ReorderBlocksResponse {
  blocks: ArticleBlock[];
  draftRevision: number;
}

/**
 * ArticleEditorApiService — Typed HTTP client for author article management.
 * Connects to private authoring endpoints under /api/v1/articles.
 */
@Injectable({
  providedIn: 'root',
})
export class ArticleEditorApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Retrieves a single owned article draft by ID with its draft blocks.
   * GET /api/v1/articles/:articleId
   */
  getArticle(articleId: string): Observable<EditableArticle> {
    return this.api.get<EditableArticle>(`articles/${articleId}`);
  }

  /**
   * Lists articles owned by the authenticated author.
   * GET /api/v1/articles/mine
   */
  listMyArticles(params?: {
    page?: number;
    limit?: number;
    status?: ArticleStatus;
  }): Observable<PaginatedAuthorArticlesResponse> {
    const queryParams: Record<string, string | number> = {};
    if (params?.page) queryParams['page'] = params.page;
    if (params?.limit) queryParams['limit'] = params.limit;
    if (params?.status) queryParams['status'] = params.status;

    return this.api.get<PaginatedAuthorArticlesResponse>('articles/mine', {
      params: queryParams,
    });
  }

  /**
   * Creates a new draft article.
   * POST /api/v1/articles
   */
  createDraft(dto: CreateArticleRequest): Observable<EditableArticle> {
    return this.api.post<EditableArticle>('articles', dto);
  }

  /**
   * Updates mutable draft metadata using optimistic concurrency.
   * PATCH /api/v1/articles/:articleId
   */
  updateDraftMetadata(
    articleId: string,
    dto: UpdateArticleMetadataRequest,
  ): Observable<EditableArticle> {
    return this.api.patch<EditableArticle>(`articles/${articleId}`, dto);
  }

  /**
   * Appends a new content block to an article draft.
   * POST /api/v1/articles/:articleId/blocks
   */
  createBlock(
    articleId: string,
    dto: CreateBlockRequest,
  ): Observable<BlockWithRevisionResponse> {
    return this.api.post<BlockWithRevisionResponse>(`articles/${articleId}/blocks`, dto);
  }

  /**
   * Updates an existing content block's payload or media reference.
   * PATCH /api/v1/articles/:articleId/blocks/:blockId
   */
  updateBlock(
    articleId: string,
    blockId: string,
    dto: UpdateBlockRequest,
  ): Observable<BlockWithRevisionResponse> {
    return this.api.patch<BlockWithRevisionResponse>(
      `articles/${articleId}/blocks/${blockId}`,
      dto,
    );
  }

  /**
   * Deletes a draft block and compacts remaining positions.
   * DELETE /api/v1/articles/:articleId/blocks/:blockId?expectedRevision=N
   */
  deleteBlock(
    articleId: string,
    blockId: string,
    expectedRevision: number,
  ): Observable<void> {
    return this.api.delete<void>(`articles/${articleId}/blocks/${blockId}`, {
      params: { expectedRevision },
    });
  }

  /**
   * Reorders all draft blocks atomically.
   * PUT /api/v1/articles/:articleId/blocks/order
   */
  reorderBlocks(
    articleId: string,
    dto: ReorderBlocksRequest,
  ): Observable<ReorderBlocksResponse> {
    return this.api.put<ReorderBlocksResponse>(`articles/${articleId}/blocks/order`, dto);
  }

  /**
   * Publishes an owned article draft or republishes an edited published article.
   * POST /api/v1/articles/:articleId/publish
   */
  publishArticle(
    articleId: string,
    dto: PublishArticleRequest,
  ): Observable<ArticlePublicationResponse> {
    return this.api.post<ArticlePublicationResponse>(`articles/${articleId}/publish`, dto);
  }

  /**
   * Safely deletes an unpublished draft article.
   * DELETE /api/v1/articles/:articleId?expectedRevision=N
   */
  deleteArticle(articleId: string, expectedRevision: number): Observable<void> {
    return this.api.delete<void>(`articles/${articleId}`, {
      params: { expectedRevision },
    });
  }
}
