import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserProfilesController } from './user-profiles.controller.js';
import type { UserProfilesService } from '../services/user-profiles.service.js';
import type { AuthenticatedUser } from '../../../auth/types/jwt.types.js';
import { UserRole, UserStatus } from '@prisma/client';

describe('UserProfilesController', () => {
  let controller: UserProfilesController;
  let mockService: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
  };

  const testUser: AuthenticatedUser = {
    id: 'user-uuid-1',
    email: 'author@skyra-tech.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'session-author',
  };

  beforeEach(() => {
    mockService = {
      getProfile: vi.fn(),
      updateProfile: vi.fn(),
    };
    controller = new UserProfilesController(mockService as unknown as UserProfilesService);
  });

  it('delegates getProfile to service using authenticated caller ID', async () => {
    mockService.getProfile.mockResolvedValue({
      id: 'prof-1',
      userId: testUser.id,
      displayName: 'Jane Doe',
      isFallback: false,
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    });

    const result = await controller.getProfile(testUser);

    expect(mockService.getProfile).toHaveBeenCalledWith('user-uuid-1');
    expect(result.displayName).toBe('Jane Doe');
  });

  it('delegates updateProfile to service with DTO', async () => {
    mockService.updateProfile.mockResolvedValue({
      id: 'prof-1',
      userId: testUser.id,
      displayName: 'New Name',
      isFallback: false,
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    });

    const result = await controller.updateProfile(testUser, { displayName: 'New Name' });

    expect(mockService.updateProfile).toHaveBeenCalledWith('user-uuid-1', { displayName: 'New Name' });
    expect(result.displayName).toBe('New Name');
  });
});
