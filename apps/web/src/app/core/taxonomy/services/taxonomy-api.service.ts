import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../api/api-client.service';
import {
  Category,
  Tag,
  PaginatedCategories,
  PaginatedTags,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateTagRequest,
  UpdateTagRequest,
} from '../models/taxonomy.models';

@Injectable({
  providedIn: 'root',
})
export class TaxonomyApiService {
  private readonly api = inject(ApiClientService);

  /**
   * General Category catalog (Used by Authors for Article Category selection)
   * GET /api/v1/categories
   */
  getCategories(page = 1, limit = 100): Observable<PaginatedCategories> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.api.get<PaginatedCategories>('categories', { params });
  }

  /**
   * General Tag catalog (Used by Authors for Article Tag selection)
   * GET /api/v1/tags
   */
  getTags(page = 1, limit = 100): Observable<PaginatedTags> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.api.get<PaginatedTags>('tags', { params });
  }

  // --- Admin Category CRUD ---

  getAdminCategories(page = 1, limit = 20): Observable<PaginatedCategories> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.api.get<PaginatedCategories>('admin/categories', { params });
  }

  getAdminCategoryById(id: string): Observable<Category> {
    return this.api.get<Category>(`admin/categories/${id}`);
  }

  createCategory(dto: CreateCategoryRequest): Observable<Category> {
    return this.api.post<Category>('admin/categories', dto);
  }

  updateCategory(id: string, dto: UpdateCategoryRequest): Observable<Category> {
    return this.api.patch<Category>(`admin/categories/${id}`, dto);
  }

  deleteCategory(id: string): Observable<void> {
    return this.api.delete<void>(`admin/categories/${id}`);
  }

  // --- Admin Tag CRUD ---

  getAdminTags(page = 1, limit = 20): Observable<PaginatedTags> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.api.get<PaginatedTags>('admin/tags', { params });
  }

  getAdminTagById(id: string): Observable<Tag> {
    return this.api.get<Tag>(`admin/tags/${id}`);
  }

  createTag(dto: CreateTagRequest): Observable<Tag> {
    return this.api.post<Tag>('admin/tags', dto);
  }

  updateTag(id: string, dto: UpdateTagRequest): Observable<Tag> {
    return this.api.patch<Tag>(`admin/tags/${id}`, dto);
  }

  deleteTag(id: string): Observable<void> {
    return this.api.delete<void>(`admin/tags/${id}`);
  }
}

