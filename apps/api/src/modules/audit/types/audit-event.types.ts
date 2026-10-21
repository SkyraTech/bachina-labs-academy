/**
 * Durable Database Audit Logging — Canonical Event Catalog & Strongly Typed Contracts
 * Phase Q-2.3B, Checkpoint 4A
 *
 * Defines bounded types, canonical event actions, verified actor attribution models,
 * resource types, outcomes, strict event-specific metadata schemas, and independent
 * audit execution outcome contracts.
 */

export const AUDIT_ACTOR_TYPES = ['USER', 'SYSTEM', 'ANONYMOUS'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_RESOURCE_TYPES = ['USER', 'SESSION', 'TOKEN', 'SYSTEM'] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

/**
 * Mandatory transactional events — MUST be recorded within the caller's Prisma transaction.
 * A failure of the audit write MUST abort the outer business transaction.
 */
export const MANDATORY_TRANSACTIONAL_ACTIONS = [
  'auth.user.registered',
  'auth.email.verified',
  'auth.login.succeeded',
  'auth.session.revoked',
  'auth.session.revoked_all',
] as const;
export type MandatoryTransactionalAction = (typeof MANDATORY_TRANSACTIONAL_ACTIONS)[number];

/**
 * High-risk independent events — permitted for independent database recording
 * under bounded concurrency and execution time limits.
 */
export const HIGH_RISK_INDEPENDENT_ACTIONS = [
  'auth.session.replay_detected',
  'auth.login.failed',
] as const;
export type HighRiskIndependentAction = (typeof HIGH_RISK_INDEPENDENT_ACTIONS)[number];

export type AuditAction = MandatoryTransactionalAction | HighRiskIndependentAction;

// ── Event-Specific Metadata Schemas (Strictly Non-Sensitive & Bounded) ───────

/**
 * Metadata for auth.user.registered.
 * Aligned strictly with Prisma UserRole enum ('AUTHOR' | 'ADMIN').
 */
export interface UserRegisteredMetadata {
  role: 'AUTHOR' | 'ADMIN';
  registrationMethod?: 'EMAIL_PASSWORD' | 'INVITE';
}

export interface EmailVerifiedMetadata {
  tokenCategory: 'EMAIL_VERIFICATION';
  verificationMethod?: 'LINK';
}

export interface LoginSucceededMetadata {
  authMethod: 'PASSWORD';
  rememberMe: boolean;
}

export interface SessionRevokedMetadata {
  revocationReason: 'USER_INITIATED' | 'TIMEOUT' | 'SECURITY';
}

export interface SessionRevokedAllMetadata {
  revocationReason: 'LOGOUT_ALL' | 'SECURITY';
  sessionsCount: number;
}

export interface SessionReplayDetectedMetadata {
  incidentClassification: 'SUSPICIOUS_REUSE';
  revocationReason: 'TOKEN_REUSE_DETECTED';
}

export interface LoginFailedMetadata {
  reason: 'RATE_LIMIT_EXCEEDED' | 'ABUSE_THRESHOLD_CROSSED';
  attemptCount: number;
}

export interface AuditMetadataMap {
  'auth.user.registered': UserRegisteredMetadata;
  'auth.email.verified': EmailVerifiedMetadata;
  'auth.login.succeeded': LoginSucceededMetadata;
  'auth.session.revoked': SessionRevokedMetadata;
  'auth.session.revoked_all': SessionRevokedAllMetadata;
  'auth.session.replay_detected': SessionReplayDetectedMetadata;
  'auth.login.failed': LoginFailedMetadata;
}

// ── Verified Actor Attribution & Provenance Model ────────────────────────────

/**
 * Symbol exported for type branding, but runtime validation requires the actor
 * instance to be registered in the unexported module-private PROVENANCE_REGISTRY.
 */
export const AUDIT_ACTOR_PROVENANCE: unique symbol = Symbol('AUDIT_ACTOR_PROVENANCE');

/**
 * Module-private symbol brand attached only by AuditActorFactory.
 * Inaccessible outside this module.
 */
const INTERNAL_PROVENANCE_BRAND = Symbol('INTERNAL_PROVENANCE_BRAND');

/**
 * Module-private WeakSet storing authentic actor instances minted by AuditActorFactory.
 * Unforgeable via JSON parsing, Object.assign, reflection, or prototype manipulation.
 */
const PROVENANCE_REGISTRY = new WeakSet<object>();

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuditActorProvenance =
  | 'AUTHENTICATED_SESSION'  // Principal verified by JwtAccessGuard / verified session
  | 'DOMAIN_REGISTRATION'    // Identity freshly created in RegistrationService
  | 'DOMAIN_LOGIN_VERIFIED'  // Identity verified during LoginService credential validation
  | 'SYSTEM_INTERNAL'        // Trusted server-internal background/security task
  | 'ANONYMOUS_UNTRUSTED';   // Unauthenticated ingress / anonymous attempt

export interface AuditActor {
  readonly [AUDIT_ACTOR_PROVENANCE]: true;
  readonly type: AuditActorType;
  readonly id: string | null;
  readonly provenance: AuditActorProvenance;
  readonly roles?: readonly ('AUTHOR' | 'ADMIN')[];
}

/**
 * AuditActorFactory — exclusive trusted authority for minting verified AuditActor instances.
 * Encapsulates the actor creation boundary and registers authentic actors in PROVENANCE_REGISTRY.
 */
export class AuditActorFactory {
  /**
   * Constructs an actor from a verified authenticated principal (e.g. from JwtAccessGuard / AuthenticatedRequest).
   */
  static fromAuthenticatedPrincipal(principal: {
    id: string;
    role?: 'AUTHOR' | 'ADMIN';
    roles?: readonly ('AUTHOR' | 'ADMIN')[];
    sessionId?: string;
  }): AuditActor {
    if (!principal || typeof principal !== 'object') {
      throw new Error('Authenticated principal must be a non-null object');
    }
    if (!principal.id || typeof principal.id !== 'string' || !UUID_V4_REGEX.test(principal.id)) {
      throw new Error('Authenticated principal must contain a valid UUID v4 id string');
    }
    const actor: AuditActor = Object.freeze({
      [AUDIT_ACTOR_PROVENANCE]: true as const,
      [INTERNAL_PROVENANCE_BRAND]: true,
      type: 'USER' as const,
      id: principal.id,
      provenance: 'AUTHENTICATED_SESSION' as const,
      roles: principal.roles ?? (principal.role ? [principal.role] : []),
    });
    PROVENANCE_REGISTRY.add(actor);
    return actor;
  }

  /**
   * Constructs an actor from a verified domain login operation AFTER credential verification succeeds.
   */
  static fromVerifiedLogin(user: { id: string; role?: 'AUTHOR' | 'ADMIN' }): AuditActor {
    if (!user || typeof user !== 'object') {
      throw new Error('Verified login user must be a non-null object');
    }
    if (!user.id || typeof user.id !== 'string' || !UUID_V4_REGEX.test(user.id)) {
      throw new Error('Verified login user must contain a valid UUID v4 id string');
    }
    const actor: AuditActor = Object.freeze({
      [AUDIT_ACTOR_PROVENANCE]: true as const,
      [INTERNAL_PROVENANCE_BRAND]: true,
      type: 'USER' as const,
      id: user.id,
      provenance: 'DOMAIN_LOGIN_VERIFIED' as const,
      roles: user.role ? [user.role] : [],
    });
    PROVENANCE_REGISTRY.add(actor);
    return actor;
  }

  /**
   * Constructs an actor from a newly registered user account within the registration domain boundary.
   */
  static fromRegistrationTarget(user: { id: string; role?: 'AUTHOR' | 'ADMIN' }): AuditActor {
    if (!user || typeof user !== 'object') {
      throw new Error('Registration target must be a non-null object');
    }
    if (!user.id || typeof user.id !== 'string' || !UUID_V4_REGEX.test(user.id)) {
      throw new Error('Registration target must contain a valid UUID v4 id string');
    }
    const actor: AuditActor = Object.freeze({
      [AUDIT_ACTOR_PROVENANCE]: true as const,
      [INTERNAL_PROVENANCE_BRAND]: true,
      type: 'USER' as const,
      id: user.id,
      provenance: 'DOMAIN_REGISTRATION' as const,
      roles: user.role ? [user.role] : [],
    });
    PROVENANCE_REGISTRY.add(actor);
    return actor;
  }

  /**
   * Constructs a trusted SYSTEM actor for internal background / security lifecycle tasks.
   */
  static forSystem(): AuditActor {
    const actor: AuditActor = Object.freeze({
      [AUDIT_ACTOR_PROVENANCE]: true as const,
      [INTERNAL_PROVENANCE_BRAND]: true,
      type: 'SYSTEM' as const,
      id: null,
      provenance: 'SYSTEM_INTERNAL' as const,
    });
    PROVENANCE_REGISTRY.add(actor);
    return actor;
  }

  /**
   * Constructs an ANONYMOUS actor for unauthenticated ingress or anonymous security events.
   */
  static forAnonymous(): AuditActor {
    const actor: AuditActor = Object.freeze({
      [AUDIT_ACTOR_PROVENANCE]: true as const,
      [INTERNAL_PROVENANCE_BRAND]: true,
      type: 'ANONYMOUS' as const,
      id: null,
      provenance: 'ANONYMOUS_UNTRUSTED' as const,
    });
    PROVENANCE_REGISTRY.add(actor);
    return actor;
  }

  /**
   * Validates whether an actor object was authentically minted by AuditActorFactory.
   * Returns true only if the object is registered in PROVENANCE_REGISTRY and carries the internal brand.
   */
  static isVerifiedActor(actor: unknown): actor is AuditActor {
    if (!actor || typeof actor !== 'object') {
      return false;
    }
    return (
      PROVENANCE_REGISTRY.has(actor) &&
      (actor as any)[INTERNAL_PROVENANCE_BRAND] === true
    );
  }
}

// ── Strongly Typed Audit Event Interfaces ─────────────────────────────────────

export interface BaseAuditEvent<TAction extends AuditAction = AuditAction> {
  action: TAction;
  actor: AuditActor;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  outcome: AuditOutcome;
  traceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: TAction extends keyof AuditMetadataMap ? AuditMetadataMap[TAction] : Record<string, unknown>;
}

export type TransactionalAuditEvent = {
  [K in MandatoryTransactionalAction]: BaseAuditEvent<K>;
}[MandatoryTransactionalAction];

export type IndependentAuditEvent = {
  [K in HighRiskIndependentAction]: BaseAuditEvent<K>;
}[HighRiskIndependentAction];

export type AuditEvent = TransactionalAuditEvent | IndependentAuditEvent;

/**
 * Persisted AuditLog record mapped from Prisma model.
 */
export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  traceId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ── Independent Audit Event Completion Contracts ──────────────────────────────

export type IndependentAuditStatus =
  | 'PERSISTED'
  | 'REJECTED_VALIDATION'
  | 'REJECTED_CONCURRENCY'
  | 'CONFIRMED_FAILURE'
  | 'WAIT_TIMEOUT_PENDING';

export interface IndependentAuditResult {
  status: IndependentAuditStatus;
  record: AuditLogRecord | null;
  error?: Error;
  timeoutMs?: number;
  settlementPromise?: Promise<{ status: 'PERSISTED' | 'CONFIRMED_FAILURE'; record?: AuditLogRecord; error?: Error }>;
}
