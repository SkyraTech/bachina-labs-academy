import { BadRequestException, Injectable } from '@nestjs/common';
import { UserProfilesRepository } from '../repositories/user-profiles.repository.js';
import type { UpdateUserProfileDto } from '../dto/update-user-profile.dto.js';
import type { UserProfileResponseDto } from '../dto/user-profile-response.dto.js';

export const DEFAULT_FALLBACK_DISPLAY_NAME = 'Academy Member';

@Injectable()
export class UserProfilesService {
  constructor(private readonly repository: UserProfilesRepository) {}

  validateDisplayName(rawName: unknown): string {
    if (typeof rawName !== 'string') {
      throw new BadRequestException('Display name must be a string.');
    }
    const trimmed = rawName.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      throw new BadRequestException('Display name must be between 2 and 50 characters.');
    }
    for (let i = 0; i < trimmed.length; i++) {
      const code = trimmed.charCodeAt(i);
      if (code < 32 || code === 127) {
        throw new BadRequestException('Display name must not contain control characters.');
      }
    }
    if (/@.*\.[a-zA-Z]{2,}/.test(trimmed)) {
      throw new BadRequestException('Display name must not resemble an email address.');
    }
    const unicodeNameRegex = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}\s\-_'.]{0,48}[\p{L}\p{N}\p{M}.]?$/u;
    if (!unicodeNameRegex.test(trimmed)) {
      throw new BadRequestException('Display name contains invalid characters or punctuation.');
    }
    return trimmed;
  }

  async getProfile(userId: string): Promise<UserProfileResponseDto> {
    const profile = await this.repository.findByUserId(userId);
    if (!profile) {
      return {
        id: null,
        userId,
        displayName: DEFAULT_FALLBACK_DISPLAY_NAME,
        isFallback: true,
        createdAt: null,
        updatedAt: null,
      };
    }

    return {
      id: profile.id,
      userId: profile.userId,
      displayName: profile.displayName,
      isFallback: false,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async updateProfile(userId: string, dto: UpdateUserProfileDto): Promise<UserProfileResponseDto> {
    const sanitizedName = this.validateDisplayName(dto.displayName);
    const profile = await this.repository.upsertProfile(userId, sanitizedName);

    return {
      id: profile.id,
      userId: profile.userId,
      displayName: profile.displayName,
      isFallback: false,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
