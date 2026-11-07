export type CommentStatus = 'VISIBLE' | 'REMOVED';

export type ModerationReason =
  | 'SPAM'
  | 'HARASSMENT'
  | 'HATE_SPEECH'
  | 'INAPPROPRIATE'
  | 'OFF_TOPIC'
  | 'POLICY_VIOLATION';

export interface AdminCommentResponse {
  id: string;
  articleId: string;
  articleSlug: string;
  articleTitle: string;
  authorId: string;
  authorDisplayName: string;
  body: string;
  status: CommentStatus;
  removalReason: ModerationReason | null;
  removedAt: string | null;
  removedByUserId: string | null;
  retentionRedacted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminCommentsResponse {
  items: AdminCommentResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AdminRemoveCommentRequest {
  reason: ModerationReason;
}

