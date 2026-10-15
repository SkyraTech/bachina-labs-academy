import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-config';

export interface RequestOptions {
  headers?: HttpHeaders | Record<string, string | string[]>;
  params?: HttpParams | Record<string, string | number | boolean | readonly (string | number | boolean)[]>;
  reportProgress?: boolean;
  withCredentials?: boolean;
}

/**
 * ApiClientService — Foundation HTTP client wrapper.
 *
 * Enforces:
 * - Centralized API base URL composition (/api/v1).
 * - withCredentials: true by default to carry HttpOnly session cookies (academy_access, academy_refresh).
 * - Strongly typed request/response observables.
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * Resolves an absolute or relative path against the configured API_BASE_URL.
   */
  resolveUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const cleanBase = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
  }

  get<T>(path: string, options?: RequestOptions): Observable<T> {
    return this.http.get<T>(this.resolveUrl(path), {
      withCredentials: true,
      ...options,
    });
  }

  post<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.post<T>(this.resolveUrl(path), body, {
      withCredentials: true,
      ...options,
    });
  }

  put<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.put<T>(this.resolveUrl(path), body, {
      withCredentials: true,
      ...options,
    });
  }

  patch<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.patch<T>(this.resolveUrl(path), body, {
      withCredentials: true,
      ...options,
    });
  }

  delete<T>(path: string, options?: RequestOptions): Observable<T> {
    return this.http.delete<T>(this.resolveUrl(path), {
      withCredentials: true,
      ...options,
    });
  }
}
