import { Injectable } from '@nestjs/common';
import type { UserProfile } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service.js';

@Injectable()
export class UserProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.prisma.userProfile.findUnique({
      where: { userId },
    });
  }

  async upsertProfile(userId: string, displayName: string): Promise<UserProfile> {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        displayName,
      },
      update: {
        displayName,
      },
    });
  }
}

