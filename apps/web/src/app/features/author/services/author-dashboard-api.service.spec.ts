import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthorDashboardApiService } from './author-dashboard-api.service';
import { ApiClientService } from '../../../core/api';
import { AuthorDashboardResponse } from '../models/author-dashboard.models';

describe('AuthorDashboardApiService', () => {
  let service: AuthorDashboardApiService;
  let apiMock: {
    get: ReturnType<typeof vi.fn>;
  };

  const MOCK_RESPONSE: AuthorDashboardResponse = {
    metrics: {
      total: 5,
      draft: 2,
      published: 2,
      archived: 1,
    },
    recentlyUpdated: [
      {
        id: '11111111-1111-4000-8000-000000000001',
        title: 'Reactive Angular Design',
        status: 'PUBLISHED',
        updatedAt: '2026-11-18T10:00:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    apiMock = {
      get: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AuthorDashboardApiService,
        { provide: ApiClientService, useValue: apiMock },
      ],
    });

    service = TestBed.inject(AuthorDashboardApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should call GET author/dashboard and return author operational metrics', () => {
    apiMock.get.mockReturnValueOnce(of(MOCK_RESPONSE));

    let receivedData: AuthorDashboardResponse | undefined;
    service.getDashboard().subscribe((res) => {
      receivedData = res;
    });

    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(apiMock.get).toHaveBeenCalledWith('author/dashboard');
    expect(receivedData).toEqual(MOCK_RESPONSE);
  });
});
