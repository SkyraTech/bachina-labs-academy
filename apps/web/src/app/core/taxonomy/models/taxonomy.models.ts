export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedCategories {
  items: Category[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedTags {
  items: Tag[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateCategoryRequest {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  slug?: string;
  description?: string;
}

export interface CreateTagRequest {
  name: string;
  slug: string;
}

export interface UpdateTagRequest {
  name?: string;
  slug?: string;
}

