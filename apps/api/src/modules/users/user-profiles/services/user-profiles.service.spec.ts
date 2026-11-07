import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UserProfilesService, DEFAULT_FALLBACK_DISPLAY_NAME } from './user-profiles.service.js';
import type { UserProfilesRepository } from '../repositories/user-profiles.repository.js';

describe('UserProfilesService', () => {
  let service: UserProfilesService;
  let mockRepo: {
    findByUserId: ReturnType<typeof vi.fn>;
    upsertProfile: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      findByUserId: vi.fn(),
      upsertProfile: vi.fn(),
    };
    service = new UserProfilesService(mockRepo as unknown as UserProfilesRepository);
  });

  describe('validateDisplayName', () => {
    it('accepts valid 2-50 Unicode character display names', () => {
      expect(service.validateDisplayName('Jane Doe')).toBe('Jane Doe');
      expect(service.validateDisplayName('  Jérôme-Étienne  ')).toBe('Jérôme-Étienne');
      expect(service.validateDisplayName('Akira 123')).toBe('Akira 123');
      expect(service.validateDisplayName('O\'Connor')).toBe('O\'Connor');
    });

    it('rejects names shorter than 2 characters after trimming', () => {
      expect(() => service.validateDisplayName('A')).toThrow(BadRequestException);
      expect(() => service.validateDisplayName('   A   ')).toThrow(BadRequestException);
      expect(() => service.validateDisplayName('')).toThrow(BadRequestException);
    });

    it('rejects names longer than 50 characters', () => {
      const longName = 'A'.repeat(51);
      expect(() => service.validateDisplayName(longName)).toThrow(BadRequestException);
    });

    it('rejects names containing control characters', () => {
      expect(() => service.validateDisplayName('Jane\x00Doe')).toThrow(BadRequestException);
      expect(() => service.validateDisplayName('Jane\x1FDoe')).toThrow(BadRequestException);
    });

    it('rejects email-shaped names to prevent public email disclosure', () => {
      expect(() => service.validateDisplayName('jane@example.com')).toThrow(BadRequestException);
      expect(() => service.validateDisplayName('test@sub.domain.org')).toThrow(BadRequestException);
    });
  });

  describe('getProfile', () => {
    it('returns safe fallback when no profile exists in database', async () => {
      mockRepo.findByUserId.mockResolvedValue(null);

      const result = await service.getProfile('user-uuid-1');

      expect(result.id).toBeNull();
      expect(result.userId).toBe('user-uuid-1');
      expect(result.displayName).toBe(DEFAULT_FALLBACK_DISPLAY_NAME);
      expect(result.isFallback).toBe(true);
      expect(result.createdAt).toBeNull();
      expect(result.updatedAt).toBeNull();
    });

    it('returns stored profile DTO when present', async () => {
      const now = new Date('2026-11-06T00:00:00.000Z');
      mockRepo.findByUserId.mockResolvedValue({
        id: 'profile-uuid-1',
        userId: 'user-uuid-1',
        displayName: 'Custom Name',
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.getProfile('user-uuid-1');

      expect(result.id).toBe('profile-uuid-1');
      expect(result.userId).toBe('user-uuid-1');
      expect(result.displayName).toBe('Custom Name');
      expect(result.isFallback).toBe(false);
      expect(result.createdAt).toBe(now.toISOString());
    });
  });

  describe('updateProfile', () => {
    it('validates and upserts profile safely', async () => {
      const now = new Date('2026-11-06T00:00:00.000Z');
      mockRepo.upsertProfile.mockResolvedValue({
        id: 'profile-uuid-1',
        userId: 'user-uuid-1',
        displayName: 'Validated Name',
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.updateProfile('user-uuid-1', {
        displayName: '  Validated Name  ',
      });

      expect(mockRepo.upsertProfile).toHaveBeenCalledWith('user-uuid-1', 'Validated Name');
      expect(result.displayName).toBe('Validated Name');
      expect(result.isFallback).toBe(false);
    });
  });
});

