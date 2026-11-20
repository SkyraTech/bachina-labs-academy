import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EntitlementType,
  EntitlementSource,
  type EntitlementGrant,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateEntitlementGrantData {
  userId: string;
  entitlementType?: EntitlementType;
  source?: EntitlementSource;
  validFrom?: Date;
  validUntil: Date;
  grantedById?: string | null;
}

@Injectable()
export class EntitlementGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a new standalone entitlement grant.
   * Strictly requires an active Prisma interactive transaction client.
   * Validates chronological validity interval before insertion.
   */
  async createGrant(
    data: CreateEntitlementGrantData,
    tx: Prisma.TransactionClient,
  ): Promise<EntitlementGrant> {
    const validFrom = data.validFrom ?? new Date();
    if (data.validUntil <= validFrom) {
      throw new BadRequestException('validUntil must be strictly after validFrom.');
    }

    return tx.entitlementGrant.create({
      data: {
        userId: data.userId,
        entitlementType: data.entitlementType ?? EntitlementType.PREMIUM_CONTENT,
        source: data.source ?? EntitlementSource.COMPLIMENTARY,
        validFrom,
        validUntil: data.validUntil,
        grantedById: data.grantedById ?? null,
      },
    });
  }

  /**
   * Finds a grant by primary key.
   */
  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EntitlementGrant | null> {
    const client = tx ?? this.prisma;
    return client.entitlementGrant.findUnique({
      where: { id },
    });
  }

  /**
   * Finds all active, non-revoked grants for a given user at a specified server time.
   * Enforces half-open interval: validFrom <= atTime < validUntil AND revokedAt IS NULL.
   */
  async findActiveGrants(
    userId: string,
    atTime: Date = new Date(),
    entitlementType: EntitlementType = EntitlementType.PREMIUM_CONTENT,
    tx?: Prisma.TransactionClient,
  ): Promise<EntitlementGrant[]> {
    const client = tx ?? this.prisma;
    return client.entitlementGrant.findMany({
      where: {
        userId,
        entitlementType,
        validFrom: { lte: atTime },
        validUntil: { gt: atTime },
        revokedAt: null,
      },
      orderBy: { validUntil: 'desc' },
    });
  }

  /**
   * Soft-revokes an existing grant with a mandatory reasoned explanation.
   * Strictly requires an active Prisma interactive transaction client.
   * Atomically rejects repeated revocations and prevents concurrency overwrite.
   */
  async revokeGrant(
    id: string,
    reason: string,
    revokedAt: Date = new Date(),
    tx: Prisma.TransactionClient,
  ): Promise<EntitlementGrant> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('A non-empty revocation reason is required.');
    }

    // Atomic conditional update to prevent repeated or concurrent revocation overwrites
    const result = await tx.entitlementGrant.updateMany({
      where: { id, revokedAt: null },
      data: {
        revokedAt,
        revocationReason: reason.trim(),
      },
    });

    if (result.count === 0) {
      const existing = await tx.entitlementGrant.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Entitlement grant ${id} not found.`);
      }
      throw new BadRequestException(`Entitlement grant ${id} has already been revoked.`);
    }

    return tx.entitlementGrant.findUniqueOrThrow({
      where: { id },
    });
  }
}
