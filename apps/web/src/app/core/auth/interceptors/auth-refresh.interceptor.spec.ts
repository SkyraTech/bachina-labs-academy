import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { authRefreshInterceptor } from './auth-refresh.interceptor';
import { AuthRefreshService } from '../services/auth-refresh.service';
import { AuthStateService } from '../services/auth-state.service';

describe('authRefreshInterceptor', () => {
  let httpClient: HttpClient;
  let httpTesting: HttpTestingController;
  let authRefreshMock: {
    refreshSession: ReturnType<typeof vi.fn>;
  };
  let authStateMock: {
    setUnauthenticated: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    authRefreshMock = {
      refreshSession: vi.fn(),
    };
    authStateMock = {
      setUnauthenticated: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authRefreshInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthRefreshService, useValue: authRefreshMock },
        { provide: AuthStateService, useValue: authStateMock },
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('1. should pass through successful GET requests without intercepting', () => {
    let result: unknown;
    httpClient.get('/api/v1/auth/sessions').subscribe((res) => (result = res));

    const req = httpTesting.expectOne('/api/v1/auth/sessions');
    req.flush([{ id: 'sess-1' }]);

    expect(result).toEqual([{ id: 'sess-1' }]);
    expect(authRefreshMock.refreshSession).not.toHaveBeenCalled();
  });

  it('2. should not intercept 401 on excluded endpoints like /api/v1/auth/login', () => {
    let errorResponse: unknown;
    httpClient.post('/api/v1/auth/login', {}).subscribe({
      error: (err) => (errorResponse = err),
    });

    const req = httpTesting.expectOne('/api/v1/auth/login');
    req.flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(errorResponse).toBeInstanceOf(HttpErrorResponse);
    expect(authRefreshMock.refreshSession).not.toHaveBeenCalled();
  });

  it('3. should not retry non-idempotent POST requests on 401', () => {
    let errorResponse: unknown;
    httpClient.post('/api/v1/articles', { title: 'Test' }).subscribe({
      error: (err) => (errorResponse = err),
    });

    const req = httpTesting.expectOne('/api/v1/articles');
    req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(errorResponse).toBeInstanceOf(HttpErrorResponse);
    expect(authRefreshMock.refreshSession).not.toHaveBeenCalled();
  });

  it('4. should refresh and retry eligible GET request on 401 when refresh succeeds', () => {
    authRefreshMock.refreshSession.mockReturnValue(of(true));

    let result: unknown;
    httpClient.get('/api/v1/author/articles').subscribe((res) => (result = res));

    // First attempt receives 401
    const req1 = httpTesting.expectOne('/api/v1/author/articles');
    req1.flush({ message: 'Access token expired' }, { status: 401, statusText: 'Unauthorized' });

    expect(authRefreshMock.refreshSession).toHaveBeenCalledTimes(1);

    // Retried request is sent
    const req2 = httpTesting.expectOne('/api/v1/author/articles');
    req2.flush([{ id: 'art-1', title: 'Article 1' }]);

    expect(result).toEqual([{ id: 'art-1', title: 'Article 1' }]);
  });

  it('5. should prevent infinite retry loops by limiting recovery to 1 attempt', () => {
    authRefreshMock.refreshSession.mockReturnValue(of(true));

    let errorResponse: unknown;
    httpClient.get('/api/v1/author/articles').subscribe({
      error: (err) => (errorResponse = err),
    });

    // First request receives 401
    const req1 = httpTesting.expectOne('/api/v1/author/articles');
    req1.flush({ message: 'Access token expired' }, { status: 401, statusText: 'Unauthorized' });

    expect(authRefreshMock.refreshSession).toHaveBeenCalledTimes(1);

    // Retry request also receives 401
    const req2 = httpTesting.expectOne('/api/v1/author/articles');
    req2.flush({ message: 'Still unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    // Should NOT attempt refresh again!
    expect(authRefreshMock.refreshSession).toHaveBeenCalledTimes(1);
    expect(errorResponse).toBeInstanceOf(HttpErrorResponse);
  });

  it('6. should call authState.setUnauthenticated and fail safely when refresh fails', () => {
    authRefreshMock.refreshSession.mockReturnValue(of(false));

    let errorResponse: unknown;
    httpClient.get('/api/v1/author/articles').subscribe({
      error: (err) => (errorResponse = err),
    });

    const req = httpTesting.expectOne('/api/v1/author/articles');
    req.flush({ message: 'Access token expired' }, { status: 401, statusText: 'Unauthorized' });

    expect(authRefreshMock.refreshSession).toHaveBeenCalledTimes(1);
    expect(authStateMock.setUnauthenticated).toHaveBeenCalledTimes(1);
    expect(errorResponse).toBeInstanceOf(HttpErrorResponse);
  });

  it('7. should coordinate three concurrent requests receiving 401 with a shared refresh and retry all three', () => {
    const refreshSubject = new Subject<boolean>();
    authRefreshMock.refreshSession.mockReturnValue(refreshSubject.asObservable());

    let res1: unknown;
    let res2: unknown;
    let res3: unknown;

    httpClient.get('/api/v1/author/articles').subscribe((res) => (res1 = res));
    httpClient.get('/api/v1/author/stats').subscribe((res) => (res2 = res));
    httpClient.get('/api/v1/auth/sessions').subscribe((res) => (res3 = res));

    // All three receive 401
    const req1 = httpTesting.expectOne('/api/v1/author/articles');
    const req2 = httpTesting.expectOne('/api/v1/author/stats');
    const req3 = httpTesting.expectOne('/api/v1/auth/sessions');

    req1.flush({ message: 'Expired' }, { status: 401, statusText: 'Unauthorized' });
    req2.flush({ message: 'Expired' }, { status: 401, statusText: 'Unauthorized' });
    req3.flush({ message: 'Expired' }, { status: 401, statusText: 'Unauthorized' });

    // Refresh succeeds
    refreshSubject.next(true);
    refreshSubject.complete();

    // All three retry requests are sent
    const retry1 = httpTesting.expectOne('/api/v1/author/articles');
    const retry2 = httpTesting.expectOne('/api/v1/author/stats');
    const retry3 = httpTesting.expectOne('/api/v1/auth/sessions');

    retry1.flush([{ id: 'art-1' }]);
    retry2.flush({ views: 42 });
    retry3.flush([{ id: 'sess-1' }]);

    expect(res1).toEqual([{ id: 'art-1' }]);
    expect(res2).toEqual({ views: 42 });
    expect(res3).toEqual([{ id: 'sess-1' }]);
  });
});
