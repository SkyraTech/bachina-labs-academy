import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../../core/api/api-client.service';
import type {
  AdminCommentResponse,
  AdminRemoveCommentRequest,
  CommentStatus,
  PaginatedAdminCommentsResponse,
} from '../models/admin-comment.model';

@Injectable({
  providedIn: 'root',
})
export class AdminCommentsApiService {
  private readonly api = inject(ApiClientService);

  listComments(
    page = 1,
    limit = 20,
    status?: CommentStatus,
    articleId?: string,
  ): Observable<PaginatedAdminCommentsResponse> {
    const params = new URLSearchParams();
    params.set('page', page.toString());
    params.set('limit', limit.toString());
    if (status) {
      params.set('status', status);
    }
    if (articleId) {
      params.set('articleId', articleId);
    }

    return this.api.get<PaginatedAdminCommentsResponse>(
      `/admin/comments?${params.toString()}`,
    );
  }

  removeComment(
    commentId: string,
    payload: AdminRemoveCommentRequest,
  ): Observable<AdminCommentResponse> {
    return this.api.post<AdminCommentResponse>(
      `/admin/comments/${encodeURIComponent(commentId)}/remove`,
      payload,
    );
  }
}

