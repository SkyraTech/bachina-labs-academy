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

  it('should send POST requests with body and withCredentials: true and default to NO retry', () => {
    const payload = { email: 'user@example.com' };
    let errorStatus: number | null = null;
    service.post<{ status: string }>('/auth/login', payload).subscribe({
      error: (err) => {
        errorStatus = err.status;
      },
    });

    const req = httpTesting.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual(payload);
    req.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    // Invariant: POST must not retry by default
    httpTesting.expectNone('/api/v1/auth/login');
    expect(errorStatus).toBe(504);
  });

  it('should never retry /auth/login POST requests even if retryOnGateway: true is passed', () => {
    let errorStatus: number | null = null;
    service
      .post<{ status: string }>('/auth/login', { email: 'test@example.com' }, { retryOnGateway: true })
      .subscribe({
        error: (err) => {
          errorStatus = err.status;
        },
      });

    const req1 = httpTesting.expectOne('/api/v1/auth/login');
    req1.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    // Defensive invariant check: login must not retry even with explicit flag
    httpTesting.expectNone('/api/v1/auth/login');
    expect(errorStatus).toBe(504);
  });

  it('should not retry PUT, PATCH, or DELETE requests on gateway error', () => {
    let putError: number | null = null;
    let patchError: number | null = null;
    let deleteError: number | null = null;

    service.put('/test', {}).subscribe({ error: (e) => (putError = e.status) });
    const reqPut = httpTesting.expectOne('/api/v1/test');
    reqPut.flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    httpTesting.expectNone('/api/v1/test');
    expect(putError).toBe(502);

    service.patch('/test', {}).subscribe({ error: (e) => (patchError = e.status) });
    const reqPatch = httpTesting.expectOne('/api/v1/test');
    reqPatch.flush('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    httpTesting.expectNone('/api/v1/test');
    expect(patchError).toBe(503);

    service.delete('/test').subscribe({ error: (e) => (deleteError = e.status) });
    const reqDelete = httpTesting.expectOne('/api/v1/test');
    reqDelete.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });
    httpTesting.expectNone('/api/v1/test');
    expect(deleteError).toBe(504);
  });

  it('should retry idempotent POST requests when retryOnGateway is explicitly enabled on non-auth paths', async () => {
    let result: { status: string } | null = null;
    service
      .post<{ status: string }>('/catalog/query', { filter: 'all' }, { retryOnGateway: true })
      .subscribe((data) => {
        result = data;
      });

    const req1 = httpTesting.expectOne('/api/v1/catalog/query');
    req1.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const req2 = httpTesting.expectOne('/api/v1/catalog/query');
    req2.flush({ status: 'ok' });

    expect(result).toEqual({ status: 'ok' });
  });
});
