import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { KeepAliveService } from './keep-alive.service';

describe('KeepAliveService', () => {
  let service: KeepAliveService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        KeepAliveService,
      ],
    });

    service = TestBed.inject(KeepAliveService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should send a health ping to /health', () => {
    service.ping();

    const req = httpTesting.expectOne('/health');
    expect(req.request.method).toBe('GET');
    req.flush('{"status":"ok"}');
  });

  it('should start keep-alive and send initial ping', () => {
    service.start();

    const req = httpTesting.expectOne('/health');
    expect(req.request.method).toBe('GET');
    req.flush('{"status":"ok"}');
  });

  it('should handle ping errors silently without throwing', () => {
    expect(() => {
      service.ping();
      const req = httpTesting.expectOne('/health');
      req.flush('Gateway error', { status: 502, statusText: 'Bad Gateway' });
    }).not.toThrow();
  });
});
