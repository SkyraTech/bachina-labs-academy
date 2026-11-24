import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClientService } from './api-client.service';
import { API_BASE_URL, API_RETRY_DELAY } from './api-config';

describe('ApiClientService', () => {
  let service: ApiClientService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ApiClientService,
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: API_RETRY_DELAY, useValue: 0 },
      ],
    });

    service = TestBed.inject(ApiClientService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should resolve relative URLs against API_BASE_URL', () => {
    expect(service.resolveUrl('auth/me')).toBe('/api/v1/auth/me');
    expect(service.resolveUrl('/auth/me')).toBe('/api/v1/auth/me');
  });

  it('should preserve absolute URLs', () => {
    expect(service.resolveUrl('https://example.com/api')).toBe('https://example.com/api');
  });

  it('should send GET requests with withCredentials: true', () => {
    service.get<{ id: string }>('/users/profile').subscribe((data) => {
      expect(data.id).toBe('123');
    });

    const req = httpTesting.expectOne('/api/v1/users/profile');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ id: '123' });
  });

  it('should retry GET requests on gateway timeout (504) and succeed on recovery', async () => {
    let result: { id: string } | null = null;
    service.get<{ id: string }>('/articles/public').subscribe((data) => {
      result = data;
    });

    const req1 = httpTesting.expectOne('/api/v1/articles/public');
    req1.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    // Allow timer(0) to emit
    await new Promise((resolve) => setTimeout(resolve, 20));

    const req2 = httpTesting.expectOne('/api/v1/articles/public');
    req2.flush({ id: 'recovered-123' });

    expect(result).toEqual({ id: 'recovered-123' });
  });

  it('should not retry on client errors (e.g. 401)', () => {
    let errorStatus: number | null = null;
    service.get<{ id: string }>('/protected').subscribe({
      error: (err) => {
        errorStatus = err.status;
      },
    });

    const req1 = httpTesting.expectOne('/api/v1/protected');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    httpTesting.expectNone('/api/v1/protected');
    expect(errorStatus).toBe(401);
  });

  it('should send POST requests with body and withCredentials: true', () => {
    const payload = { email: 'user@example.com' };
    service.post<{ status: string }>('/auth/login', payload).subscribe((res) => {
      expect(res.status).toBe('ok');
    });

    const req = httpTesting.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual(payload);
    req.flush({ status: 'ok' });
  });

  it('should retry POST requests when retryOnGateway is true and 504 occurs', async () => {
    let result: { status: string } | null = null;
    service
      .post<{ status: string }>('/auth/login', { email: 'test@example.com' }, { retryOnGateway: true })
      .subscribe((data) => {
        result = data;
      });

    const req1 = httpTesting.expectOne('/api/v1/auth/login');
    req1.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const req2 = httpTesting.expectOne('/api/v1/auth/login');
    req2.flush({ status: 'ok' });

    expect(result).toEqual({ status: 'ok' });
  });
});
