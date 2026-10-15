import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClientService } from './api-client.service';
import { API_BASE_URL } from './api-config';

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
});
