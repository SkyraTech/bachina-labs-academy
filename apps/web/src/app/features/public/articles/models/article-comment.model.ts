export interface PublicCommentResponse {
  id: string;
  articleSlug: string;
  snapshotRevision: number;
  authorDisplayName: string;
  isArticleAuthor: boolean;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPublicCommentsResponse {
  items: PublicCommentResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateCommentRequest {
  body: string;
}

export interface UpdateCommentRequest {
  body: string;
}

