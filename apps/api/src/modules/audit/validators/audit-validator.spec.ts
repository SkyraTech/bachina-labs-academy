import { describe, it, expect } from 'vitest';
import { AuditValidator } from './audit-validator.js';
import { AuditValidationError } from '../errors/audit-validation.error.js';
import {
  AUDIT_ACTOR_PROVENANCE,
  AuditActorFactory,
  type AuditEvent,
} from '../types/audit-event.types.js';

describe('AuditValidator', () => {
  const validUserUuid = 'a0000000-0000-4000-8000-000000000001';
  const validTraceId = '0123456789abcdef0123456789abcdef';
  const validRequestId = 'req-123_456-abc';

  const baseValidEvent: AuditEvent = {
    action: 'auth.user.registered',
    actor: AuditActorFactory.forSystem(),
    resourceType: 'USER',
    resourceId: validUserUuid,
    outcome: 'SUCCESS',
    traceId: validTraceId,
    requestId: validRequestId,
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    metadata: {
      role: 'AUTHOR',
      registrationMethod: 'EMAIL_PASSWORD',
    },
  };

  describe('Action Validation', () => {
    it('accepts valid registered action', () => {
      const validated = AuditValidator.validate(baseValidEvent);
      expect(validated.action).toBe('auth.user.registered');
    });

    it('rejects unknown action', () => {
      const event = { ...baseValidEvent, action: 'unapproved.custom.event' as any };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/Unknown or unapproved audit action/);
    });

    it('rejects action with uppercase characters', () => {
      const event = { ...baseValidEvent, action: 'Auth.User.Registered' as any };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/violates format requirement/);
    });

    it('rejects action without dot notation', () => {
      const event = { ...baseValidEvent, action: 'auth' as any };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
    });
  });

  describe('Actor Attribution & Provenance Validation (Section 8 & 9)', () => {
    it('1. rejects arbitrary valid user UUID without trusted AuditActorFactory provenance', () => {
      const unverifiedActorLiteral: any = {
        type: 'USER',
        id: validUserUuid,
      };
      const event: any = {
        ...baseValidEvent,
        actor: unverifiedActorLiteral,
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/Audit actor must be minted via trusted AuditActorFactory/);
    });

    it('2. accepts USER actor minted from a verified authenticated principal', () => {
      const verifiedPrincipal = { id: validUserUuid, role: 'AUTHOR' as const };
      const actor = AuditActorFactory.fromAuthenticatedPrincipal(verifiedPrincipal);

      const event: AuditEvent = {
        action: 'auth.login.succeeded',
        actor,
        resourceType: 'SESSION',
        resourceId: 'sess-1234',
        outcome: 'SUCCESS',
        metadata: { authMethod: 'PASSWORD', rememberMe: true },
      };
      const validated = AuditValidator.validate(event);
      expect(validated.actorType).toBe('USER');
      expect(validated.actorId).toBe(validUserUuid);
    });

    it('3. rejects arbitrary request-body user ID attempting to override principal', () => {
      const attackerSubmittedBody = { userId: 'b0000000-0000-4000-8000-000000000002' };
      // Attempting to construct an actor directly from raw request body without factory fails
      const rawActor: any = {
        type: 'USER',
        id: attackerSubmittedBody.userId,
      };
      const event: any = {
        ...baseValidEvent,
        actor: rawActor,
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
    });

    it('4. rejects conflicting HTTP header attempting to supply actor identity', () => {
      const spoofedHeaderActor: any = {
        type: 'USER',
        id: 'c0000000-0000-4000-8000-000000000003',
      };
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: spoofedHeaderActor })).toThrow(
        AuditValidationError,
      );
    });

    it('5. rejects bracketed logger text attempting to supply actor identity', () => {
      const loggerExtractedActor: any = {
        type: 'USER',
        id: '[userId=d0000000-0000-4000-8000-000000000004]',
      };
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: loggerExtractedActor })).toThrow(
        AuditValidationError,
      );
    });

    it('6. rejects ANONYMOUS actor attempting to supply a user ID or forged clone', () => {
      const forgedAnon: any = {
        ...AuditActorFactory.forAnonymous(),
        id: validUserUuid,
      };
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: forgedAnon })).toThrow(
        AuditValidationError,
      );
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: forgedAnon })).toThrow(
        /unverified actor literals or forged provenance tokens are forbidden/,
      );
    });

    it('7. rejects SYSTEM actor attempting to impersonate a human user or forged clone', () => {
      const forgedSystem: any = {
        ...AuditActorFactory.forSystem(),
        id: validUserUuid,
      };
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: forgedSystem })).toThrow(
        AuditValidationError,
      );
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: forgedSystem })).toThrow(
        /unverified actor literals or forged provenance tokens are forbidden/,
      );
    });

    it('7b. rejects forged actor literal created with imported AUDIT_ACTOR_PROVENANCE symbol', () => {
      const forgedWithSymbol: any = {
        [AUDIT_ACTOR_PROVENANCE]: true,
        type: 'USER',
        id: validUserUuid,
        provenance: 'AUTHENTICATED_SESSION',
      };
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: forgedWithSymbol })).toThrow(
        AuditValidationError,
      );
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: forgedWithSymbol })).toThrow(
        /unverified actor literals or forged provenance tokens are forbidden/,
      );
    });

    it('7c. rejects deserialized JSON actor (unforgeable WeakSet protection)', () => {
      const validActor = AuditActorFactory.fromAuthenticatedPrincipal({ id: validUserUuid });
      const serialized = JSON.parse(JSON.stringify(validActor));
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: serialized })).toThrow(
        AuditValidationError,
      );
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: serialized })).toThrow(
        /unverified actor literals or forged provenance tokens are forbidden/,
      );
    });

    it('8. prevents actor cross-contamination across concurrent requests', () => {
      const actorAlice = AuditActorFactory.fromAuthenticatedPrincipal({ id: '11111111-1111-4111-8111-111111111111' });
      const actorBob = AuditActorFactory.fromAuthenticatedPrincipal({ id: '22222222-2222-4222-8222-222222222222' });

      const eventAlice: AuditEvent = {
        action: 'auth.session.revoked',
        actor: actorAlice,
        resourceType: 'SESSION',
        resourceId: 'sess-alice',
        outcome: 'SUCCESS',
        metadata: { revocationReason: 'USER_INITIATED' },
      };

      const eventBob: AuditEvent = {
        action: 'auth.session.revoked',
        actor: actorBob,
        resourceType: 'SESSION',
        resourceId: 'sess-bob',
        outcome: 'SUCCESS',
        metadata: { revocationReason: 'USER_INITIATED' },
      };

      const valAlice = AuditValidator.validate(eventAlice);
      const valBob = AuditValidator.validate(eventBob);

      expect(valAlice.actorId).toBe('11111111-1111-4111-8111-111111111111');
      expect(valBob.actorId).toBe('22222222-2222-4222-8222-222222222222');
      expect(valAlice.actorId).not.toBe(valBob.actorId);
    });

    it('9. accepts trusted login identity minted only after credential verification', () => {
      const verifiedLoginActor = AuditActorFactory.fromVerifiedLogin({
        id: validUserUuid,
        role: 'AUTHOR',
      });
      expect(verifiedLoginActor.provenance).toBe('DOMAIN_LOGIN_VERIFIED');
      expect(verifiedLoginActor.type).toBe('USER');

      const loginEvent: AuditEvent = {
        action: 'auth.login.succeeded',
        actor: verifiedLoginActor,
        resourceType: 'SESSION',
        resourceId: 'sess-post-verify',
        outcome: 'SUCCESS',
        metadata: { authMethod: 'PASSWORD', rememberMe: false },
      };

      const val = AuditValidator.validate(loginEvent);
      expect(val.actorId).toBe(validUserUuid);
    });

    it('10. accepts registration trusted domain-operation identity without pre-existing session', () => {
      const registrationActor = AuditActorFactory.fromRegistrationTarget({
        id: validUserUuid,
        role: 'AUTHOR',
      });
      expect(registrationActor.provenance).toBe('DOMAIN_REGISTRATION');

      const regEvent: AuditEvent = {
        action: 'auth.user.registered',
        actor: registrationActor,
        resourceType: 'USER',
        resourceId: validUserUuid,
        outcome: 'SUCCESS',
        metadata: { role: 'AUTHOR', registrationMethod: 'EMAIL_PASSWORD' },
      };

      const val = AuditValidator.validate(regEvent);
      expect(val.actorId).toBe(validUserUuid);
    });

    it('11. throws when AuditActorFactory is passed an invalid, non-UUIDv4, or non-object principal', () => {
      expect(() => AuditActorFactory.fromAuthenticatedPrincipal(null as any)).toThrow(
        /Authenticated principal must be a non-null object/,
      );
      expect(() => AuditActorFactory.fromAuthenticatedPrincipal({ id: 'not-a-uuid' } as any)).toThrow(
        /Authenticated principal must contain a valid UUID v4 id string/,
      );
      expect(() => AuditActorFactory.fromVerifiedLogin({ id: '12345', role: 'AUTHOR' } as any)).toThrow(
        /Verified login user must contain a valid UUID v4 id string/,
      );
      expect(() => AuditActorFactory.fromRegistrationTarget({ id: '' } as any)).toThrow(
        /Registration target must contain a valid UUID v4 id string/,
      );
    });

    it('12. rejects actor attempts with conflicting user ID injected into plain object', () => {
      const spoofedPrincipal = { id: validUserUuid, extraField: 'injected' };
      // Passing object that did not undergo factory registration
      const unverified = {
        type: 'USER',
        id: spoofedPrincipal.id,
        provenance: 'AUTHENTICATED_SESSION',
      };
      expect(() => AuditValidator.validate({ ...baseValidEvent, actor: unverified as any })).toThrow(
        AuditValidationError,
      );
    });
  });

  describe('Outcome & Resource Validation', () => {
    it('accepts all valid outcomes: SUCCESS, FAILURE, DENIED', () => {
      for (const outcome of ['SUCCESS', 'FAILURE', 'DENIED'] as const) {
        const event: AuditEvent = {
          action: 'auth.session.revoked',
          actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: validUserUuid }),
          resourceType: 'SESSION',
          resourceId: 'sess-1',
          outcome,
          metadata: { revocationReason: 'SECURITY' },
        };
        const validated = AuditValidator.validate(event);
        expect(validated.outcome).toBe(outcome);
      }
    });

    it('rejects lowercase resource types (e.g. user, session) matching PostgreSQL check constraint', () => {
      for (const lowercaseType of ['user', 'session', 'token']) {
        const event: any = { ...baseValidEvent, resourceType: lowercaseType };
        expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
        expect(() => AuditValidator.validate(event)).toThrow(/resourceType/);
      }
    });

    it('rejects invalid outcome string', () => {
      const event: any = { ...baseValidEvent, outcome: 'PENDING' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/Invalid outcome/);
    });

    it('rejects invalid resourceType', () => {
      const event: any = { ...baseValidEvent, resourceType: 'INVALID_LOWER_CASE' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
    });

    it('rejects resourceId containing email', () => {
      const event: any = { ...baseValidEvent, resourceId: 'attacker@example.com' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/must not contain email/);
    });

    it('rejects resourceId exceeding 64 characters', () => {
      const event: any = { ...baseValidEvent, resourceId: 'a'.repeat(65) };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/between 1 and 64 characters/);
    });

    it('rejects resourceId with illegal characters', () => {
      const event: any = { ...baseValidEvent, resourceId: 'sess; DROP TABLE users;' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/prohibited characters/);
    });
  });

  describe('Correlation & Ingress Validation', () => {
    it('accepts valid traceId (32 hex)', () => {
      const validated = AuditValidator.validate(baseValidEvent);
      expect(validated.traceId).toBe(validTraceId);
    });

    it('rejects traceId that is not 32 hex chars', () => {
      const event = { ...baseValidEvent, traceId: 'too-short' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/exactly 32 lowercase hexadecimal/);
    });

    it('rejects traceId with uppercase hex', () => {
      const event = { ...baseValidEvent, traceId: validTraceId.toUpperCase() };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
    });

    it('accepts IPv4 and IPv6 addresses', () => {
      const ipv4Event = { ...baseValidEvent, ipAddress: '10.0.0.1' };
      expect(AuditValidator.validate(ipv4Event).ipAddress).toBe('10.0.0.1');

      const ipv6Event = { ...baseValidEvent, ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' };
      expect(AuditValidator.validate(ipv6Event).ipAddress).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    it('rejects invalid IP address', () => {
      const event = { ...baseValidEvent, ipAddress: '999.999.999.999' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/not a valid IPv4 or IPv6/);
    });

    it('rejects userAgent containing control characters', () => {
      const event = { ...baseValidEvent, userAgent: 'Mozilla/5.0\r\nInjected-Header: evil' };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/control characters/);
    });

    it('rejects userAgent exceeding 512 characters', () => {
      const event = { ...baseValidEvent, userAgent: 'x'.repeat(513) };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/maximum length 512/);
    });
  });

  describe('Role & Metadata Alignment (Section 10)', () => {
    it('accepts valid Prisma UserRole: AUTHOR and ADMIN', () => {
      for (const role of ['AUTHOR', 'ADMIN'] as const) {
        const event: AuditEvent = {
          action: 'auth.user.registered',
          actor: AuditActorFactory.forSystem(),
          resourceType: 'USER',
          outcome: 'SUCCESS',
          metadata: { role, registrationMethod: 'EMAIL_PASSWORD' },
        };
        const val = AuditValidator.validate(event);
        expect(val.action).toBe('auth.user.registered');
      }
    });

    it('rejects unapproved role MEMBER (not present in Prisma UserRole enum)', () => {
      const event: any = {
        action: 'auth.user.registered',
        actor: AuditActorFactory.forSystem(),
        resourceType: 'USER',
        outcome: 'SUCCESS',
        metadata: { role: 'MEMBER', registrationMethod: 'EMAIL_PASSWORD' },
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/requires role to be AUTHOR or ADMIN/);
    });

    it('rejects non-object metadata (e.g. array, string, null)', () => {
      expect(() => AuditValidator.validate({ ...baseValidEvent, metadata: [] as any })).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate({ ...baseValidEvent, metadata: 'string' as any })).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate({ ...baseValidEvent, metadata: null as any })).toThrow(AuditValidationError);
    });

    it('rejects metadata exceeding 1,024 serialized bytes', () => {
      const event: any = {
        ...baseValidEvent,
        metadata: {
          role: 'AUTHOR',
          registrationMethod: 'EMAIL_PASSWORD',
          padding: 'x'.repeat(1000),
        },
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
    });

    it('rejects unknown metadata keys', () => {
      const event: any = {
        ...baseValidEvent,
        metadata: {
          role: 'AUTHOR',
          unexpectedField: 'forbidden',
        },
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/Unknown or forbidden metadata key 'unexpectedField'/);
    });

    it('rejects password in metadata keys or values', () => {
      const eventWithKey: any = {
        ...baseValidEvent,
        metadata: {
          role: 'AUTHOR',
          password: 'SecretPassword123!',
        },
      };
      expect(() => AuditValidator.validate(eventWithKey)).toThrow(AuditValidationError);

      const eventWithHash: any = {
        ...baseValidEvent,
        metadata: {
          role: 'AUTHOR',
          registrationMethod: '$argon2id$v=19$m=65536,t=3,p=4$somehash',
        },
      };
      expect(() => AuditValidator.validate(eventWithHash)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(eventWithHash)).toThrow(/cryptographic password hash/);
    });

    it('rejects raw email in metadata values', () => {
      const event: any = {
        ...baseValidEvent,
        metadata: {
          role: 'AUTHOR',
          registrationMethod: 'user@example.com',
        },
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/contains an email address/);
    });

    it('rejects raw JWT tokens in metadata values', () => {
      const fakeJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const event: any = {
        ...baseValidEvent,
        metadata: {
          role: 'AUTHOR',
          registrationMethod: fakeJwt,
        },
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/raw JWT token/);
    });

    it('rejects duplicating actorId in metadata values', () => {
      const event: any = {
        action: 'auth.login.succeeded',
        actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: validUserUuid }),
        resourceType: 'SESSION',
        resourceId: 'sess-1234',
        outcome: 'SUCCESS',
        metadata: {
          authMethod: 'PASSWORD',
          rememberMe: true,
          leakedActor: validUserUuid,
        },
      };
      expect(() => AuditValidator.validate(event)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(event)).toThrow(/duplicates the actor ID|Unknown or forbidden metadata key/);
    });

    it('validates auth.email.verified specific metadata', () => {
      const validEvent: AuditEvent = {
        action: 'auth.email.verified',
        actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: validUserUuid }),
        resourceType: 'USER',
        outcome: 'SUCCESS',
        metadata: { tokenCategory: 'EMAIL_VERIFICATION', verificationMethod: 'LINK' },
      };
      expect(AuditValidator.validate(validEvent).action).toBe('auth.email.verified');

      const invalidEvent: any = {
        ...validEvent,
        metadata: { tokenCategory: 'WRONG_CATEGORY' },
      };
      expect(() => AuditValidator.validate(invalidEvent)).toThrow(AuditValidationError);
    });

    it('validates auth.session.revoked_all specific metadata', () => {
      const validEvent: AuditEvent = {
        action: 'auth.session.revoked_all',
        actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: validUserUuid }),
        resourceType: 'USER',
        outcome: 'SUCCESS',
        metadata: { revocationReason: 'LOGOUT_ALL', sessionsCount: 4 },
      };
      expect(AuditValidator.validate(validEvent).action).toBe('auth.session.revoked_all');

      const invalidCount: any = {
        ...validEvent,
        metadata: { revocationReason: 'LOGOUT_ALL', sessionsCount: -1 },
      };
      expect(() => AuditValidator.validate(invalidCount)).toThrow(AuditValidationError);
      expect(() => AuditValidator.validate(invalidCount)).toThrow(/non-negative integer/);
    });

    it('validates auth.session.replay_detected specific metadata', () => {
      const validEvent: AuditEvent = {
        action: 'auth.session.replay_detected',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'SESSION',
        resourceId: 'compromised-session-id',
        outcome: 'DENIED',
        metadata: {
          incidentClassification: 'SUSPICIOUS_REUSE',
          revocationReason: 'TOKEN_REUSE_DETECTED',
        },
      };
      expect(AuditValidator.validate(validEvent).action).toBe('auth.session.replay_detected');
    });

    it('validates auth.login.failed specific metadata and bounds attemptCount', () => {
      const validEvent: AuditEvent = {
        action: 'auth.login.failed',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'USER',
        outcome: 'FAILURE',
        metadata: { reason: 'ABUSE_THRESHOLD_CROSSED', attemptCount: 15 },
      };
      expect(AuditValidator.validate(validEvent).action).toBe('auth.login.failed');

      const invalidAttemptCount: any = {
        ...validEvent,
        metadata: { reason: 'RATE_LIMIT_EXCEEDED', attemptCount: 0 },
      };
      expect(() => AuditValidator.validate(invalidAttemptCount)).toThrow(AuditValidationError);
    });
  });
});
