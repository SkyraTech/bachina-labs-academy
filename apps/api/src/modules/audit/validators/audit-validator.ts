import net from 'node:net';
import { Prisma } from '@prisma/client';
import {
  AuditActorFactory,
  AUDIT_ACTOR_TYPES,
  AUDIT_OUTCOMES,
  AUDIT_RESOURCE_TYPES,
  HIGH_RISK_INDEPENDENT_ACTIONS,
  MANDATORY_TRANSACTIONAL_ACTIONS,
  type AuditAction,
  type AuditActorProvenance,
  type AuditEvent,
  type AuditMetadataMap,
} from '../types/audit-event.types.js';
import { AuditValidationError } from '../errors/audit-validation.error.js';

export interface ValidatedAuditData {
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  traceId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Prisma.InputJsonValue;
}

const ACTION_FORMAT_REGEX = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const RESOURCE_TYPE_REGEX = /^[A-Z0-9_]{1,50}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE_ID_REGEX = /^[0-9a-f]{32}$/;
const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const RESOURCE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;
const JWT_REGEX = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HASH_REGEX = /^\$(?:argon2id|2[aby]|pbkdf2)/i;

/**
 * AuditValidator — enforces strict compile-time and runtime validation
 * for all durable audit events prior to database persistence.
 */
export class AuditValidator {
  /**
   * Validates an incoming audit event payload against canonical catalog rules,
   * verified actor provenance, resource identifiers, and event-specific metadata schemas.
   *
   * @param event The audit event to validate
   * @returns ValidatedAuditData ready for Prisma persistence
   * @throws AuditValidationError if any invariant is violated
   */
  static validate(event: AuditEvent): ValidatedAuditData {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new AuditValidationError('Audit event payload must be a non-null object');
    }

    // ── 1. Action Validation ──────────────────────────────────────────────────
    if (!event.action || typeof event.action !== 'string') {
      throw new AuditValidationError('Audit action is required and must be a string');
    }

    if (!ACTION_FORMAT_REGEX.test(event.action)) {
      throw new AuditValidationError(
        `Audit action '${event.action}' violates format requirement (lowercase dot-delimited alphanumeric)`,
      );
    }

    const allAllowedActions = [
      ...MANDATORY_TRANSACTIONAL_ACTIONS,
      ...HIGH_RISK_INDEPENDENT_ACTIONS,
    ];
    if (!allAllowedActions.includes(event.action as AuditAction)) {
      throw new AuditValidationError(`Unknown or unapproved audit action: '${event.action}'`);
    }

    // ── 2. Actor Attribution & Provenance Validation ──────────────────────────
    if (!event.actor || typeof event.actor !== 'object' || Array.isArray(event.actor)) {
      throw new AuditValidationError('Audit actor is required and must be an object');
    }

    if (!AuditActorFactory.isVerifiedActor(event.actor)) {
      throw new AuditValidationError(
        'Audit actor must be minted via trusted AuditActorFactory; unverified actor literals or forged provenance tokens are forbidden',
      );
    }

    const { type: actorType, id: actorId, provenance } = event.actor;

    if (!AUDIT_ACTOR_TYPES.includes(actorType)) {
      throw new AuditValidationError(`Invalid actorType: '${actorType}'. Must be USER, SYSTEM, or ANONYMOUS`);
    }

    let resolvedActorId: string | null = null;

    if (actorType === 'USER') {
      const allowedUserProvenances: AuditActorProvenance[] = [
        'AUTHENTICATED_SESSION',
        'DOMAIN_REGISTRATION',
        'DOMAIN_LOGIN_VERIFIED',
      ];
      if (!allowedUserProvenances.includes(provenance)) {
        throw new AuditValidationError(
          `USER actor has unapproved provenance '${provenance}'. Must be AUTHENTICATED_SESSION, DOMAIN_REGISTRATION, or DOMAIN_LOGIN_VERIFIED`,
        );
      }
      if (!actorId || typeof actorId !== 'string') {
        throw new AuditValidationError('USER actor requires a valid non-empty user ID');
      }
      if (!UUID_REGEX.test(actorId)) {
        throw new AuditValidationError(`USER actor ID '${actorId}' is not a valid canonical UUID v4`);
      }
      resolvedActorId = actorId;
    } else if (actorType === 'ANONYMOUS') {
      if (provenance !== 'ANONYMOUS_UNTRUSTED') {
        throw new AuditValidationError(`ANONYMOUS actor has invalid provenance '${provenance}'`);
      }
      if (actorId !== null && actorId !== undefined) {
        throw new AuditValidationError('ANONYMOUS actor must not supply an actor ID');
      }
    } else if (actorType === 'SYSTEM') {
      if (provenance !== 'SYSTEM_INTERNAL') {
        throw new AuditValidationError(`SYSTEM actor has invalid provenance '${provenance}'`);
      }
      if (actorId !== null && actorId !== undefined) {
        throw new AuditValidationError('SYSTEM actor must not supply an actor ID (cannot impersonate a user)');
      }
    }

    // ── 3. Outcome Validation ────────────────────────────────────────────────
    if (!event.outcome || !AUDIT_OUTCOMES.includes(event.outcome)) {
      throw new AuditValidationError(`Invalid outcome: '${event.outcome}'. Must be SUCCESS, FAILURE, or DENIED`);
    }

    // ── 4. Resource Type & ID Validation ─────────────────────────────────────
    if (!event.resourceType || typeof event.resourceType !== 'string') {
      throw new AuditValidationError('Audit resourceType is required');
    }

    if (!RESOURCE_TYPE_REGEX.test(event.resourceType)) {
      throw new AuditValidationError('resourceType must be uppercase alphanumeric/underscore between 1 and 50 characters');
    }

    if (!AUDIT_RESOURCE_TYPES.includes(event.resourceType as (typeof AUDIT_RESOURCE_TYPES)[number])) {
      throw new AuditValidationError(`Unsupported or unapproved resourceType: '${event.resourceType}'`);
    }

    let resolvedResourceId: string | null = null;
    if (event.resourceId !== null && event.resourceId !== undefined) {
      if (typeof event.resourceId !== 'string') {
        throw new AuditValidationError('resourceId must be a string when provided');
      }
      if (event.resourceId.length === 0 || event.resourceId.length > 64) {
        throw new AuditValidationError('resourceId must be between 1 and 64 characters');
      }
      if (event.resourceId.includes('@')) {
        throw new AuditValidationError('resourceId must not contain email addresses');
      }
      if (!RESOURCE_ID_REGEX.test(event.resourceId)) {
        throw new AuditValidationError('resourceId contains prohibited characters (allowed: [a-zA-Z0-9_-])');
      }
      resolvedResourceId = event.resourceId;
    }

    // ── 5. Correlation & Ingress Field Validation ─────────────────────────────
    let resolvedTraceId: string | null = null;
    if (event.traceId !== null && event.traceId !== undefined) {
      if (typeof event.traceId !== 'string' || !TRACE_ID_REGEX.test(event.traceId)) {
        throw new AuditValidationError('traceId must be exactly 32 lowercase hexadecimal characters');
      }
      resolvedTraceId = event.traceId;
    }

    let resolvedRequestId: string | null = null;
    if (event.requestId !== null && event.requestId !== undefined) {
      if (typeof event.requestId !== 'string' || !REQUEST_ID_REGEX.test(event.requestId)) {
        throw new AuditValidationError('requestId must be between 1 and 64 characters matching [a-zA-Z0-9_-]');
      }
      resolvedRequestId = event.requestId;
    }

    let resolvedIpAddress: string | null = null;
    if (event.ipAddress !== null && event.ipAddress !== undefined) {
      if (typeof event.ipAddress !== 'string' || net.isIP(event.ipAddress) === 0) {
        throw new AuditValidationError(`ipAddress '${event.ipAddress}' is not a valid IPv4 or IPv6 address`);
      }
      resolvedIpAddress = event.ipAddress;
    }

    let resolvedUserAgent: string | null = null;
    if (event.userAgent !== null && event.userAgent !== undefined) {
      if (typeof event.userAgent !== 'string' || event.userAgent.length > 512) {
        throw new AuditValidationError('userAgent must be a string with maximum length 512');
      }
      if (CONTROL_CHARS_REGEX.test(event.userAgent)) {
        throw new AuditValidationError('userAgent must not contain control characters');
      }
      resolvedUserAgent = event.userAgent;
    }

    // ── 6. Metadata Validation & Sensitive Data Rejection ─────────────────────
    if (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)) {
      throw new AuditValidationError('metadata must be a non-null plain JSON object');
    }

    const serializedMetadata = JSON.stringify(event.metadata);
    if (Buffer.byteLength(serializedMetadata, 'utf8') > 1024) {
      throw new AuditValidationError(
        `metadata exceeds database limit of 1024 bytes (actual: ${Buffer.byteLength(serializedMetadata, 'utf8')} bytes)`,
      );
    }

    this.validateEventSpecificMetadata(
      event.action as AuditAction,
      event.metadata as unknown as Record<string, unknown>,
      resolvedActorId,
    );

    return {
      actorId: resolvedActorId,
      actorType,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: resolvedResourceId,
      outcome: event.outcome,
      traceId: resolvedTraceId,
      requestId: resolvedRequestId,
      ipAddress: resolvedIpAddress,
      userAgent: resolvedUserAgent,
      metadata: event.metadata as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Action-specific metadata schema enforcement and sensitive keyword/value scanning.
   */
  private static validateEventSpecificMetadata(
    action: AuditAction,
    metadata: Record<string, unknown>,
    actorId: string | null,
  ): void {
    const keys = Object.keys(metadata);

    // Global Prohibited Keyword Scanning
    const globallyForbiddenSubstrings = [
      'password',
      'hash',
      'token',
      'secret',
      'cookie',
      'email',
      'authorization',
      'jwt',
      'credential',
      'actorid',
      'actor_id',
      'userid',
      'user_id',
      'clientip',
      'client_ip',
      'ipaddress',
      'ip_address',
    ];

    // Allowed exceptions per action
    const allowedExceptions: Record<string, string[]> = {
      'auth.user.registered': ['role', 'registrationMethod'],
      'auth.email.verified': ['tokenCategory', 'verificationMethod'],
      'auth.login.succeeded': ['authMethod', 'rememberMe'],
      'auth.session.revoked': ['revocationReason'],
      'auth.session.revoked_all': ['revocationReason', 'sessionsCount'],
      'auth.session.replay_detected': ['incidentClassification', 'revocationReason'],
      'auth.login.failed': ['reason', 'attemptCount'],
    };

    const allowedKeys = allowedExceptions[action];
    if (!allowedKeys) {
      throw new AuditValidationError(`No metadata allowlist defined for action '${action}'`);
    }

    // 1. Strict Allowlist Enforcement
    for (const key of keys) {
      if (!allowedKeys.includes(key)) {
        throw new AuditValidationError(
          `Unknown or forbidden metadata key '${key}' for action '${action}'. Allowed keys: [${allowedKeys.join(', ')}]`,
        );
      }

      // Check against prohibited substrings unless explicitly allowed
      const lowerKey = key.toLowerCase();
      for (const forbidden of globallyForbiddenSubstrings) {
        if (lowerKey === forbidden || (lowerKey.includes(forbidden) && !allowedKeys.includes(key))) {
          throw new AuditValidationError(`Metadata key '${key}' contains forbidden keyword '${forbidden}'`);
        }
      }
    }

    // 2. Sensitive Content & Identity Leaks in Values
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') {
        if (value.includes('@')) {
          throw new AuditValidationError(`Metadata field '${key}' contains an email address, which is prohibited`);
        }
        if (JWT_REGEX.test(value)) {
          throw new AuditValidationError(`Metadata field '${key}' appears to contain a raw JWT token`);
        }
        if (HASH_REGEX.test(value)) {
          throw new AuditValidationError(`Metadata field '${key}' appears to contain a cryptographic password hash`);
        }
        if (actorId && value === actorId) {
          throw new AuditValidationError(`Metadata field '${key}' duplicates the actor ID, which is prohibited`);
        }
      }
    }

    // 3. Action-Specific Field-Type Validation
    switch (action) {
      case 'auth.user.registered': {
        const m = metadata as Partial<AuditMetadataMap['auth.user.registered']>;
        if (!m.role || !['AUTHOR', 'ADMIN'].includes(m.role)) {
          throw new AuditValidationError(
            "Action 'auth.user.registered' requires role to be AUTHOR or ADMIN (aligned with Prisma UserRole)",
          );
        }
        if (m.registrationMethod && !['EMAIL_PASSWORD', 'INVITE'].includes(m.registrationMethod)) {
          throw new AuditValidationError(
            "Action 'auth.user.registered' registrationMethod must be EMAIL_PASSWORD or INVITE",
          );
        }
        break;
      }

      case 'auth.email.verified': {
        const m = metadata as Partial<AuditMetadataMap['auth.email.verified']>;
        if (m.tokenCategory !== 'EMAIL_VERIFICATION') {
          throw new AuditValidationError(
            "Action 'auth.email.verified' requires tokenCategory to be 'EMAIL_VERIFICATION'",
          );
        }
        if (m.verificationMethod && m.verificationMethod !== 'LINK') {
          throw new AuditValidationError("Action 'auth.email.verified' verificationMethod must be 'LINK'");
        }
        break;
      }

      case 'auth.login.succeeded': {
        const m = metadata as Partial<AuditMetadataMap['auth.login.succeeded']>;
        if (m.authMethod !== 'PASSWORD') {
          throw new AuditValidationError("Action 'auth.login.succeeded' requires authMethod to be 'PASSWORD'");
        }
        if (typeof m.rememberMe !== 'boolean') {
          throw new AuditValidationError("Action 'auth.login.succeeded' requires rememberMe to be a boolean");
        }
        break;
      }

      case 'auth.session.revoked': {
        const m = metadata as Partial<AuditMetadataMap['auth.session.revoked']>;
        if (!m.revocationReason || !['USER_INITIATED', 'TIMEOUT', 'SECURITY'].includes(m.revocationReason)) {
          throw new AuditValidationError(
            "Action 'auth.session.revoked' requires revocationReason in ['USER_INITIATED', 'TIMEOUT', 'SECURITY']",
          );
        }
        break;
      }

      case 'auth.session.revoked_all': {
        const m = metadata as Partial<AuditMetadataMap['auth.session.revoked_all']>;
        if (!m.revocationReason || !['LOGOUT_ALL', 'SECURITY'].includes(m.revocationReason)) {
          throw new AuditValidationError(
            "Action 'auth.session.revoked_all' requires revocationReason in ['LOGOUT_ALL', 'SECURITY']",
          );
        }
        if (typeof m.sessionsCount !== 'number' || !Number.isInteger(m.sessionsCount) || m.sessionsCount < 0) {
          throw new AuditValidationError(
            "Action 'auth.session.revoked_all' requires sessionsCount to be a non-negative integer",
          );
        }
        if (m.sessionsCount > 10_000) {
          throw new AuditValidationError("Action 'auth.session.revoked_all' sessionsCount exceeds safe limit (10,000)");
        }
        break;
      }

      case 'auth.session.replay_detected': {
        const m = metadata as Partial<AuditMetadataMap['auth.session.replay_detected']>;
        if (m.incidentClassification !== 'SUSPICIOUS_REUSE') {
          throw new AuditValidationError(
            "Action 'auth.session.replay_detected' requires incidentClassification to be 'SUSPICIOUS_REUSE'",
          );
        }
        if (m.revocationReason !== 'TOKEN_REUSE_DETECTED') {
          throw new AuditValidationError(
            "Action 'auth.session.replay_detected' requires revocationReason to be 'TOKEN_REUSE_DETECTED'",
          );
        }
        break;
      }

      case 'auth.login.failed': {
        const m = metadata as Partial<AuditMetadataMap['auth.login.failed']>;
        if (!m.reason || !['RATE_LIMIT_EXCEEDED', 'ABUSE_THRESHOLD_CROSSED'].includes(m.reason)) {
          throw new AuditValidationError(
            "Action 'auth.login.failed' requires reason in ['RATE_LIMIT_EXCEEDED', 'ABUSE_THRESHOLD_CROSSED']",
          );
        }
        if (typeof m.attemptCount !== 'number' || !Number.isInteger(m.attemptCount) || m.attemptCount < 1) {
          throw new AuditValidationError(
            "Action 'auth.login.failed' requires attemptCount to be a positive integer >= 1",
          );
        }
        if (m.attemptCount > 1_000) {
          throw new AuditValidationError("Action 'auth.login.failed' attemptCount exceeds safe limit (1,000)");
        }
        break;
      }
    }
  }
}
