import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  EntitlementType,
  EntitlementSource,
  type EntitlementGrant,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditActorFactory, type AuditActor } from '../../audit/types/audit-event.types.js';
import {
  EntitlementGrantRepository,
  type CreateEntitlementGrantData,
} from '../repositories/entitlement-grant.repository.js';

@Injectable()
export class EntitlementGrantService {
  private readonly logger = new Logger(EntitlementGrantService.name);

  constructor(
    private readonly repository: EntitlementGrantRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Internal / test helper to issue an entitlement grant.
   * Atomic with append-only audit logging: domain mutation + audit log insertion = 1 transaction.
   */
  async issueGrant(
    data: CreateEntitlementGrantData,
    actor?: AuditActor,
  ): Promise<EntitlementGrant> {
    this.logger.log(`Issuing grant for user ${data.userId} of type ${data.entitlementType ?? 'PREMIUM_CONTENT'}`);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create grant on tx (mandatory tx parameter)
      const grant = await this.repository.createGrant(data, tx);

      // 2. Resolve actor
      const resolvedActor =
        actor ??
        (data.grantedById
          ? AuditActorFactory.fromAuthenticatedPrincipal({ id: data.grantedById })
          : AuditActorFactory.forSystem());

      // 3. Record transactional audit event
      await this.auditService.recordTransactional(tx, {
        action: 'entitlement.issued',
        actor: resolvedActor,
        resourceType: 'ENTITLEMENT',
        resourceId: grant.id,
        outcome: 'SUCCESS',
        metadata: {
          grantId: grant.id,
          targetUserId: grant.userId,
          entitlementType: grant.entitlementType,
          source: grant.source,
          validFrom: grant.validFrom.toISOString(),
          validUntil: grant.validUntil.toISOString(),
        },
      });

      return grant;
    });
  }

  /**
   * Returns active, unrevoked grants for user at server-authoritative time.
   */
  async getActiveGrants(
    userId: string,
    atTime?: Date,
    entitlementType?: EntitlementType,
  ): Promise<EntitlementGrant[]> {
    return this.repository.findActiveGrants(userId, atTime, entitlementType);
  }

  /**
   * Internal / test helper to soft-revoke an entitlement grant.
   * Atomic with append-only audit logging: domain mutation + audit log insertion = 1 transaction.
   * Enforces idempotent revocation: already-revoked grants are rejected without duplicate audit logs.
   */
  async revokeGrant(
    id: string,
    reason: string,
    revokedAt?: Date,
    actor?: AuditActor,
  ): Promise<EntitlementGrant> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repository.findById(id, tx);
      if (!existing) {
        throw new NotFoundException(`Entitlement grant ${id} not found.`);
      }
      if (existing.revokedAt != null) {
        throw new BadRequestException(`Entitlement grant ${id} has already been revoked.`);
      }

      this.logger.log(`Revoking grant ${id} for reason: ${reason}`);
      const revokedGrant = await this.repository.revokeGrant(id, reason, revokedAt, tx);

      const resolvedActor = actor ?? AuditActorFactory.forSystem();

      await this.auditService.recordTransactional(tx, {
        action: 'entitlement.revoked',
        actor: resolvedActor,
        resourceType: 'ENTITLEMENT',
        resourceId: revokedGrant.id,
        outcome: 'SUCCESS',
        metadata: {
          grantId: revokedGrant.id,
          targetUserId: revokedGrant.userId,
          revocationReason: revokedGrant.revocationReason ?? reason.trim(),
          revokedAt: (revokedGrant.revokedAt ?? new Date()).toISOString(),
        },
      });

      return revokedGrant;
    });
  }
}
