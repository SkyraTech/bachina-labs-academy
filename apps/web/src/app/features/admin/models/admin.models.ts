export interface AdminOverviewUsersMetrics {
  readonly total: number;
  readonly verified: number;
  readonly unverified: number;
  readonly byRole: {
    readonly author: number;
    readonly admin: number;
  };
  readonly byStatus: {
    readonly active: number;
    readonly suspended: number;
    readonly disabled: number;
  };
}

export interface AdminOverviewArticlesMetrics {
  readonly total: number;
  readonly published: number;
  readonly draft: number;
  readonly archived: number;
  readonly totalPublishedSnapshots: number;
}

export interface AdminOverviewTaxonomyMetrics {
  readonly totalCategories: number;
  readonly totalTags: number;
}

export interface AdminOverviewResponse {
  readonly users: AdminOverviewUsersMetrics;
  readonly articles: AdminOverviewArticlesMetrics;
  readonly taxonomy: AdminOverviewTaxonomyMetrics;
}

export interface AdminUserItem {
  readonly id: string;
  readonly email: string;
  readonly role: 'AUTHOR' | 'ADMIN';
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  readonly isEmailVerified: boolean;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaginatedAdminUsersResponse {
  readonly data: readonly AdminUserItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface ListAdminUsersQuery {
  page?: number;
  limit?: number;
  role?: string;
  status?: string;
  q?: string;
}

export interface AdminArticleItem {
  readonly id: string;
  readonly title: string;
  readonly draftSlug: string;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  readonly draftRevision: number;
  readonly publishedRevision: number;
  readonly authorId: string;
  readonly authorEmail: string;
  readonly publishedAt: string | null;
  readonly publishedSlug: string | null;
  readonly publishedTitle: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaginatedAdminArticlesResponse {
  readonly data: readonly AdminArticleItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface ListAdminArticlesQuery {
  page?: number;
  limit?: number;
  status?: string;
  q?: string;
}

