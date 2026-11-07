import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserProfileApiService } from './user-profile-api.service';
import { ApiClientService } from '../../api/api-client.service';
import type { UserProfileResponse } from '../models/user-profile.model';

describe('UserProfileApiService', () => {
  let service: UserProfileApiService;
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };

  const sampleProfile: UserProfileResponse = {
    id: 'profile-uuid-1',
    userId: 'user-uuid-1',
    displayName: 'Dr. Jane PostgreSQL',
    isFallback: false,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  };

  beforeEach(() => {
    mockApiClient = {
      get: vi.fn(),
      put: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        UserProfileApiService,
        { provide: ApiClientService, useValue: mockApiClient },
      ],
    });

    service = TestBed.inject(UserProfileApiService);
  });

  it('retrieves profile via GET /account/profile', () => {
    mockApiClient.get.mockReturnValue(of(sampleProfile));

    let result: UserProfileResponse | undefined;
    service.getProfile().subscribe((res) => {
      result = res;
    });

    expect(mockApiClient.get).toHaveBeenCalledWith('/account/profile');
    expect(result).toEqual(sampleProfile);
  });

  it('updates profile via PUT /account/profile', () => {
    mockApiClient.put.mockReturnValue(of(sampleProfile));

    let result: UserProfileResponse | undefined;
    service.updateProfile({ displayName: 'Dr. Jane PostgreSQL' }).subscribe((res) => {
      result = res;
    });

    expect(mockApiClient.put).toHaveBeenCalledWith('/account/profile', {
      displayName: 'Dr. Jane PostgreSQL',
    });
    expect(result).toEqual(sampleProfile);
  });
});

