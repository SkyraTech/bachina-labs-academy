import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditRepository } from './audit.repository.js';
import {
  HIGH_RISK_INDEPENDENT_ACTIONS,
  MANDATORY_TRANSACTIONAL_ACTIONS,
  type AuditLogRecord,
  type IndependentAuditEvent,
  type IndependentAuditResult,
  type TransactionalAuditEvent,
} from './types/audit-event.types.js';
import { AuditValidator } from './validators/audit-validator.js';
import {
  AuditIndependentWriteError,
  AuditValidationError,
} from './errors/audit-validation.error.js';
import { RequestContextService } from '../../common/observability/request-context.service.js';

export interface IndependentWriteOptions {
  /** If true, rethrows AuditIndependentWriteError on failure instead of returning null */
  throwOnError?: boolean;
  /** Timeout budget in milliseconds for caller wait deadline (default: 5000ms) */
  timeoutMs?: number;
  /** Statement timeout in milliseconds for PostgreSQL query cancellation (default: 4000ms) */
  statementTimeoutMs?: number;
  /** Maximum wait time in milliseconds for database connection pool acquisition (default: 2000ms) */
  maxWaitMs?: number;
  /** Maximum lifetime in milliseconds for the database interactive transaction (default: 5000ms) */
  transactionTimeoutMs?: number;
}

/**
 * AuditService — high-integrity audit logging coordinator.
 *
 * Provides strictly segregated entry points:
 * 1. recordTransactional: Mandatory transactional recording requiring an active Prisma transaction.
 * 2. recordIndependent: Bounded, independent recording for explicitly eligible high-risk incidents.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /** Maximum simultaneous independent audit write operations to prevent connection pool exhaustion */
  private static readonly MAX_CONCURRENT_INDEPENDENT_WRITES = 10;
  private activeIndependentWrites = 0;

  constructor(private readonly auditRepository: AuditRepository) {}

  /**
   * Records a mandatory transactional audit event within the caller's active Prisma transaction.
   *
   * Invariants:
   * - Requires an active Prisma transaction client (tx).
   * - Only mandatory transactional actions are accepted.
   * - Ingress and correlation identifiers are safely enriched from RequestContext if omitted.
   * - Strict runtime validation is executed before persistence.
   * - Errors are NOT swallowed; any failure propagates to roll back the outer business transaction.
   *
   * @param tx Active Prisma interactive transaction client
   * @param event The typed transactional audit event
   * @returns AuditLogRecord of the created audit entry
   */
  async recordTransactional(
    tx: Prisma.TransactionClient,
    event: TransactionalAuditEvent,
  ): Promise<AuditLogRecord> {
    if (!tx) {
      throw new AuditValidationError(
        'Active Prisma transaction client (tx) is required for mandatory transactional audit events',
      );
    }

    if (!MANDATORY_TRANSACTIONAL_ACTIONS.includes(event.action)) {
      throw new AuditValidationError(
        `Action '${event.action}' is not eligible for transactional recording. Allowed: [${MANDATORY_TRANSACTIONAL_ACTIONS.join(', ')}]`,
      );
    }

    // Enrich correlation context from server-controlled RequestContext if not supplied
    const enrichedEvent: TransactionalAuditEvent = {
      ...event,
      traceId: event.traceId ?? RequestContextService.getTraceId() ?? null,
      requestId: event.requestId ?? RequestContextService.getRequestId() ?? null,
      ipAddress: event.ipAddress ?? RequestContextService.get()?.clientIp ?? null,
    };

    // Strict validation
    const validatedData = AuditValidator.validate(enrichedEvent);

    try {
      return await this.auditRepository.create(validatedData, tx);
    } catch (error: unknown) {
      this.logger.error(
        `Transactional audit write failed [action=${event.action}, resourceType=${event.resourceType}, outcome=${event.outcome}]: ` +
          `${error instanceof Error ? error.message : 'Unknown database error'}`,
      );
      // Re-throw so caller's transaction rolls back atomically
      throw error;
    }
  }

  /**
   * Records an independent, high-risk security audit event without an enclosing transaction.
   *
   * Invariants & Concurrency Lifecycle:
   * - Permitted ONLY for explicitly approved actions in HIGH_RISK_INDEPENDENT_ACTIONS.
   * - Rejects mandatory transactional events to prevent silent downgrades to best-effort.
   * - Bounded concurrency limits simultaneous independent writes to avoid starving the pool.
   * - PostgreSQL execution bounds: Enforces statement cancellation at the database engine level
   *   via dedicated transaction-scoped SET LOCAL statement_timeout.
   * - CRITICAL: Concurrency capacity is held until the underlying database query ACTUALLY SETTLES,
   *   even if the caller-wait deadline elapses before PostgreSQL finishes.
   * - A caller-wait timeout does not release the concurrency slot prematurely.
   * - Returns an explicit IndependentAuditResult distinguishing:
   *   * PERSISTED: confirmed database write
   *   * REJECTED_VALIDATION: contract validation failure
   *   * REJECTED_CONCURRENCY: in-flight pool capacity exhausted
   *   * CONFIRMED_FAILURE: database operation settled with failure (or PostgreSQL statement timeout)
   *   * WAIT_TIMEOUT_PENDING: caller deadline expired while database execution remains in flight
   *
   * @param event The typed independent audit event
   * @param options Configuration for timeout and error propagation
   * @returns IndependentAuditResult describing the exact persistence outcome
   */
  async recordIndependent(
    event: IndependentAuditEvent,
    options: IndependentWriteOptions = {},
  ): Promise<IndependentAuditResult> {
    const {
      throwOnError = false,
      timeoutMs = 5000,
      transactionTimeoutMs = options.transactionTimeoutMs ?? Math.max(5000, timeoutMs),
      statementTimeoutMs = options.statementTimeoutMs ?? (transactionTimeoutMs > 1000 ? transactionTimeoutMs - 1000 : transactionTimeoutMs),
      maxWaitMs = options.maxWaitMs ?? Math.min(2000, transactionTimeoutMs),
    } = options;

    if (!HIGH_RISK_INDEPENDENT_ACTIONS.includes(event.action)) {
      const err = new AuditValidationError(
        `Action '${event.action}' is not approved for independent recording. Approved: [${HIGH_RISK_INDEPENDENT_ACTIONS.join(', ')}]`,
      );
      if (throwOnError) throw err;
      return { status: 'REJECTED_VALIDATION', record: null, error: err };
    }

    // Enrich correlation context from server-controlled RequestContext if not supplied
    const enrichedEvent: IndependentAuditEvent = {
      ...event,
      traceId: event.traceId ?? RequestContextService.getTraceId() ?? null,
      requestId: event.requestId ?? RequestContextService.getRequestId() ?? null,
      ipAddress: event.ipAddress ?? RequestContextService.get()?.clientIp ?? null,
    };

    let validatedData;
    try {
      validatedData = AuditValidator.validate(enrichedEvent);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (throwOnError) throw error;
      return { status: 'REJECTED_VALIDATION', record: null, error };
    }

    // Guard against concurrency exhaustion
    if (this.activeIndependentWrites >= AuditService.MAX_CONCURRENT_INDEPENDENT_WRITES) {
      this.logger.warn(
        `Independent audit write dropped: concurrency limit (${AuditService.MAX_CONCURRENT_INDEPENDENT_WRITES}) reached [action=${event.action}]`,
      );
      const err = new AuditIndependentWriteError('Independent audit write concurrency limit exceeded');
      if (throwOnError) throw err;
      return { status: 'REJECTED_CONCURRENCY', record: null, error: err };
    }

    // 1. Acquire in-flight concurrency slot
    this.activeIndependentWrites++;
    let callerTimedOut = false;

    // 2. Launch database write with PostgreSQL-side execution bounds
    const writePromise =
      typeof this.auditRepository.createIndependentBounded === 'function'
        ? this.auditRepository.createIndependentBounded(validatedData, {
            statementTimeoutMs,
            maxWaitMs,
            transactionTimeoutMs,
          })
        : this.auditRepository.create(validatedData);

    const sanitizeDbError = (err: Error): string => {
      if (err.message.includes('57014') || err.message.includes('statement timeout')) {
        return 'PostgreSQL statement execution timeout exceeded (57014)';
      }
      return err.message
        .replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[redacted]@')
        .replace(/\b(?:password|token|hash)\b[^\s,;)]+/gi, '[redacted]');
    };

    // 3. Track actual database settlement and release slot ONLY on settlement
    const settlementPromise: Promise<{
      status: 'PERSISTED' | 'CONFIRMED_FAILURE';
      record?: AuditLogRecord;
      error?: Error;
    }> = writePromise
      .then((record) => {
        if (callerTimedOut) {
          this.logger.log(
            `Independent audit write settled successfully after caller timeout [action=${event.action}, id=${record.id}]`,
          );
        }
        return { status: 'PERSISTED' as const, record };
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const safeMsg = sanitizeDbError(error);
        if (callerTimedOut) {
          this.logger.error(
            `Independent audit write failed after caller timeout [action=${event.action}]: ${safeMsg}`,
          );
        } else {
          this.logger.error(
            `Independent audit write failed [action=${event.action}, resourceType=${event.resourceType}]: ${safeMsg}`,
          );
        }
        return { status: 'CONFIRMED_FAILURE' as const, error };
      })
      .finally(() => {
        // Concurrency capacity is released ONLY when the database query genuinely finishes
        this.activeIndependentWrites = Math.max(0, this.activeIndependentWrites - 1);
      });

    // 4. Set caller wait deadline
    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ status: 'WAIT_TIMEOUT_PENDING'; timeoutMs: number }>((resolve) => {
      timeoutTimer = setTimeout(() => {
        callerTimedOut = true;
        this.logger.warn(
          `Independent audit write caller wait deadline (${timeoutMs}ms) exceeded; database operation remains in flight [action=${event.action}]`,
        );
        resolve({ status: 'WAIT_TIMEOUT_PENDING', timeoutMs });
      }, timeoutMs);
    });

    try {
      const outcome = await Promise.race([settlementPromise, timeoutPromise]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (outcome.status === 'PERSISTED') {
        return { status: 'PERSISTED', record: outcome.record! };
      }

      if (outcome.status === 'CONFIRMED_FAILURE') {
        if (throwOnError) {
          throw new AuditIndependentWriteError('Independent audit write failed', outcome.error);
        }
        return { status: 'CONFIRMED_FAILURE', record: null, error: outcome.error };
      }

      // outcome.status === 'WAIT_TIMEOUT_PENDING'
      const timeoutErr = new AuditIndependentWriteError(
        `Independent audit write wait deadline exceeded (${timeoutMs}ms); outcome pending in database`,
      );
      if (throwOnError) {
        throw timeoutErr;
      }
      return {
        status: 'WAIT_TIMEOUT_PENDING',
        record: null,
        error: timeoutErr,
        timeoutMs,
        settlementPromise,
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  /**
   * Helper to retrieve current active independent write count (useful for testing and monitoring).
   */
  getActiveIndependentWrites(): number {
    return this.activeIndependentWrites;
  }
}
