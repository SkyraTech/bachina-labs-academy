export type AuthorArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface AuthorDashboardArticleItem {
  id: string;
  title: string;
  status: AuthorArticleStatus;
  updatedAt: string;
}

export interface AuthorDashboardMetrics {
  total: number;
  draft: number;
  published: number;
  archived: number;
}

export interface AuthorDashboardResponse {
  metrics: AuthorDashboardMetrics;
  recentlyUpdated: AuthorDashboardArticleItem[];
}
