import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../../core/api/api-client.service';
import type {
  CreateCommentRequest,
  PaginatedPublicCommentsResponse,
  PublicCommentResponse,
  UpdateCommentRequest,
} from '../models/article-comment.model';

@Injectable({
  providedIn: 'root',
})
export class ArticleCommentsApiService {
  private readonly api = inject(ApiClientService);

  getPublicComments(
    publishedSlug: string,
    page = 1,
    limit = 20,
  ): Observable<PaginatedPublicCommentsResponse> {
    return this.api.get<PaginatedPublicCommentsResponse>(
      `/articles/public/${encodeURIComponent(publishedSlug)}/comments?page=${page}&limit=${limit}`,
    );
  }

  createComment(
    publishedSlug: string,
    payload: CreateCommentRequest,
  ): Observable<PublicCommentResponse> {
    return this.api.post<PublicCommentResponse>(
      `/articles/public/${encodeURIComponent(publishedSlug)}/comments`,
      payload,
    );
  }

  updateComment(
    commentId: string,
    payload: UpdateCommentRequest,
  ): Observable<PublicCommentResponse> {
    return this.api.patch<PublicCommentResponse>(
      `/comments/${encodeURIComponent(commentId)}`,
      payload,
    );
  }

  deleteComment(commentId: string): Observable<void> {
    return this.api.delete<void>(`/comments/${encodeURIComponent(commentId)}`);
  }
}

