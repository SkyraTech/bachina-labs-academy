import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuditLogRecord } from './types/audit-event.types.js';
import type { ValidatedAuditData } from './validators/audit-validator.js';

/**
 * AuditRepository — data access layer for durable audit logs.
 *
 * Enforces append-only access to public.audit_logs via Prisma ORM:
 * - Exposes INSERT only (create).
 * - Deliberately does NOT expose update, delete, truncate, or alter methods.
 * - Supports caller-provided Prisma interactive transaction clients (Prisma.TransactionClient).
 * - Honors provided transactions without opening independent sub-transactions.
 */
@Injectable()
export class AuditRepository {
  private readonly logger = new Logger(AuditRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a validated audit log entry.
   *
   * @param data Validated audit log payload
   * @param tx Optional active transaction client. When provided, the insert occurs
   *           within that exact transaction, ensuring all-or-nothing atomicity.
   * @returns AuditLogRecord containing the persisted audit row attributes
   */
  async create(
    data: ValidatedAuditData,
    tx?: Prisma.TransactionClient,
  ): Promise<AuditLogRecord> {
    const client = tx ?? this.prisma;

    this.logger.debug(
      `create: action=${data.action}, outcome=${data.outcome}, transactional=${Boolean(tx)}`,
    );

    const record = await client.auditLog.create({
      data: {
        actorId: data.actorId,
        actorType: data.actorType,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        outcome: data.outcome,
        traceId: data.traceId,
        requestId: data.requestId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata,
      },
    });

    return {
      id: record.id,
      actorId: record.actorId,
      actorType: record.actorType as AuditLogRecord['actorType'],
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      outcome: record.outcome as AuditLogRecord['outcome'],
      traceId: record.traceId,
      requestId: record.requestId,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      metadata: record.metadata as Record<string, unknown>,
      createdAt: record.createdAt,
    };
  }

  /**
   * Persists an independent audit log entry within a dedicated, database-bounded transaction.
   *
   * Enforces 3 distinct execution bounds:
   * 1. Connection-pool acquisition timeout (maxWait)
   * 2. PostgreSQL statement cancellation timeout (SET LOCAL statement_timeout)
   * 3. Prisma interactive transaction timeout (timeout)
   *
   * Invariants:
   * - Scoped strictly to this transaction; SET LOCAL is automatically reset upon commit/rollback.
   * - Does NOT leak into subsequent pooled queries on that connection.
   * - If PostgreSQL statement execution exceeds statementTimeoutMs, PostgreSQL cancels the statement
   *   with SQLSTATE 57014 (query_canceled).
   */
  async createIndependentBounded(
    data: ValidatedAuditData,
    options: {
      maxWaitMs?: number;
      statementTimeoutMs?: number;
      transactionTimeoutMs?: number;
    } = {},
  ): Promise<AuditLogRecord> {
    const sanitizeBound = (val: unknown, fallback: number, min: number, max: number): number => {
      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || val <= 0) {
        return fallback;
      }
      return Math.min(max, Math.max(min, Math.floor(val)));
    };

    const maxWait = sanitizeBound(options.maxWaitMs, 2000, 100, 10000);
    const statementTimeout = sanitizeBound(options.statementTimeoutMs, 4000, 100, 30000);
    const timeout = sanitizeBound(options.transactionTimeoutMs, 5000, 500, 60000);

    return await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${statementTimeout.toString()}, true);`;
        return await this.create(data, tx);
      },
      { maxWait, timeout },
    );
  }
}

