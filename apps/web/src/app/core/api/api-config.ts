import { InjectionToken } from '@angular/core';

/**
 * API configuration contract for Bachina Labs Academy.
 */
export interface ApiConfig {
  /** Base URL for REST API calls (defaults to '/api/v1'). */
  readonly baseUrl: string;
  /** Request timeout in milliseconds (defaults to 30000ms). */
  readonly timeoutMs?: number;
}

/**
 * Injection token for centralized API configuration.
 */
export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG', {
  providedIn: 'root',
  factory: () => ({
    baseUrl: '/api/v1',
    timeoutMs: 30000,
  }),
});

/**
 * Injection token specifically for the API base URL string.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api/v1',
});

/**
 * Injection token for transient cold-start / gateway retry delay (defaults to 1500ms).
 */
export const API_RETRY_DELAY = new InjectionToken<number>('API_RETRY_DELAY', {
  providedIn: 'root',
  factory: () => 1500,
});
