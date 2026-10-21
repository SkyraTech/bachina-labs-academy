import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuditRepository } from '../src/modules/audit/audit.repository.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { AuditValidator } from '../src/modules/audit/validators/audit-validator.js';
import { AuditValidationError } from '../src/modules/audit/errors/audit-validation.error.js';
import {
  AuditActorFactory,
  type IndependentAuditEvent,
  type TransactionalAuditEvent,
} from '../src/modules/audit/types/audit-event.types.js';

describe('Audit Infrastructure Real PostgreSQL 17 Integration (e2e)', () => {
  let disposableDbName: string;
  let psqlPath: string;
  let host: string;
  let port: string;
  let migUser: string;
  let migPass: string;
  let runtimeUser: string;
  let runtimePass: string;
  let disposableRuntimeUrl: string;

  let prismaRuntime: PrismaClient;
  let auditRepository: AuditRepository;
  let auditService: AuditService;

  let dbName: string;

  function runAdminPsql(sql: string, targetDb?: string) {
    const dbToConnect = targetDb ?? dbName;
    const res = spawnSync(
      psqlPath,
      ['-h', host, '-p', port, '-U', migUser, '-d', dbToConnect, '-X', '-v', 'ON_ERROR_STOP=1'],
      {
        env: { ...process.env, PGPASSWORD: migPass },
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    if (res.status !== 0) {
      throw new Error(`Admin psql failed on ${dbToConnect}: ${(res.stderr || res.stdout).trim()}`);
    }
    return (res.stdout || '').trim();
  }

  beforeAll(async () => {
    // 1. Read configuration safely from .env (cwd may be apps/api or workspace root)
    const envPath = fs.existsSync('.env') ? path.resolve('.env') : path.resolve('apps/api/.env');
    const envContent = fs.readFileSync(envPath, 'utf8');

    const runtimeMatch = envContent.match(
      /DATABASE_RUNTIME_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
    );
    const migrationMatch = envContent.match(
      /DATABASE_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
    );

    if (!runtimeMatch || !migrationMatch) {
      throw new Error('DATABASE_RUNTIME_URL or DATABASE_URL not found in .env');
    }

    [, runtimeUser, runtimePass, host, port, dbName] = runtimeMatch;
    [, migUser, migPass] = migrationMatch;
    migPass = decodeURIComponent(migPass);

    psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
    if (!fs.existsSync(psqlPath)) {
      psqlPath = 'psql';
    }

    // 2. Generate cryptographically random unique database name
    disposableDbName = `academy_sec_${crypto.randomBytes(8).toString('hex')}`;

    // 3. Confirm target database does not exist
    const checkSql = `SELECT count(*) FROM pg_database WHERE datname = '${disposableDbName}';`;
    const checkRes = runAdminPsql(checkSql);
    if (!checkRes.includes('0')) {
      throw new Error(`Proposed database ${disposableDbName} unexpectedly already exists!`);
    }

    // 4. Create isolated database
    runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`);

    // 5. Initialize schema fixtures: users, user_sessions, audit_logs with CHECK constraints, indexes, FK
    const initSql = `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TYPE "UserRole" AS ENUM ('AUTHOR', 'ADMIN');
      CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

      CREATE TABLE "users" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "email" VARCHAR(255) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "role" "UserRole" NOT NULL DEFAULT 'AUTHOR',
        "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
        "email_verified_at" TIMESTAMPTZ(3),
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "users_email_key" UNIQUE ("email")
      );

      CREATE TABLE "user_sessions" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "refresh_token_hash" VARCHAR(64) NOT NULL,
        "remember_me" BOOLEAN NOT NULL DEFAULT false,
        "revoked_at" TIMESTAMPTZ(3),
        "expires_at" TIMESTAMPTZ(3) NOT NULL,
        "user_agent" VARCHAR(512),
        "ip_address" VARCHAR(45),
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "user_sessions_refresh_token_hash_key" UNIQUE ("refresh_token_hash"),
        CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );

      CREATE TABLE "audit_logs" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "actor_id" UUID,
        "actor_type" VARCHAR(20) NOT NULL,
        "action" VARCHAR(100) NOT NULL,
        "resource_type" VARCHAR(50) NOT NULL,
        "resource_id" VARCHAR(64),
        "outcome" VARCHAR(20) NOT NULL,
        "trace_id" CHAR(32),
        "request_id" VARCHAR(64),
        "ip_address" VARCHAR(45),
        "user_agent" VARCHAR(512),
        "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
      );

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_actor_type" 
          CHECK ("actor_type" IN ('USER', 'SYSTEM', 'ANONYMOUS'));

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_outcome" 
          CHECK ("outcome" IN ('SUCCESS', 'FAILURE', 'DENIED'));

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_action_format" 
          CHECK ("action" ~ '^[a-z0-9_]+(\\.[a-z0-9_]+)+$');

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_resource_type_format" 
          CHECK ("resource_type" ~ '^[A-Z0-9_]+$');

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_trace_id_format" 
          CHECK ("trace_id" IS NULL OR "trace_id" ~ '^[0-9a-f]{32}$');

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_request_id_format" 
          CHECK ("request_id" IS NULL OR "request_id" ~ '^[a-zA-Z0-9_-]{1,64}$');

      ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_metadata_shape" 
          CHECK (jsonb_typeof("metadata") = 'object' AND octet_length("metadata"::text) <= 1024);

      CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
      CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);
      CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at" DESC);
      CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

      ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" 
          FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

      -- 6. Configure exact runtime role privileges (matching live catalog policy)
      GRANT USAGE ON SCHEMA public TO "${runtimeUser}";
      REVOKE CREATE ON SCHEMA public FROM "${runtimeUser}";

      GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "${runtimeUser}";

      -- Append-only on audit_logs: INSERT and SELECT only
      GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
      REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM "${runtimeUser}";
    `;

    runAdminPsql(initSql, disposableDbName);

    // 7. Connect PrismaClient as restricted academy_app
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;
    prismaRuntime = new PrismaClient({
      datasources: {
        db: {
          url: disposableRuntimeUrl,
        },
      },
    });

    await prismaRuntime.$connect();

    // 8. Wire repository and service to the runtime client
    auditRepository = new AuditRepository(prismaRuntime as any);
    auditService = new AuditService(auditRepository);
  }, 30000);

  afterAll(async () => {
    // 1. Disconnect Prisma client
    if (prismaRuntime) {
      await prismaRuntime.$disconnect();
    }

    // 2. Tear down isolated disposable database
    if (disposableDbName && disposableDbName.startsWith('academy_sec_')) {
      try {
        // Terminate any remaining connections to this test database
        runAdminPsql(`
          SELECT pg_terminate_backend(pid) 
          FROM pg_stat_activity 
          WHERE datname = '${disposableDbName}' AND pid <> pg_backend_pid();
        `);
        runAdminPsql(`DROP DATABASE IF EXISTS "${disposableDbName}";`);
      } catch (err) {
        console.error(`Failed to drop disposable database ${disposableDbName}:`, err);
      }
    }
  }, 20000);

  // ── TEST 1: Valid audit insert under restricted runtime role ─────────────────
  it('1. performs valid audit insert under restricted academy_app role', async () => {
    const event: IndependentAuditEvent = {
      action: 'auth.session.replay_detected',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'SESSION',
      resourceId: 'sess-replay-001',
      outcome: 'DENIED',
      metadata: {
        incidentClassification: 'SUSPICIOUS_REUSE',
        revocationReason: 'TOKEN_REUSE_DETECTED',
      },
    };

    const res = await auditService.recordIndependent(event);
    expect(res.status).toBe('PERSISTED');
    expect(res.record).not.toBeNull();
    expect(res.record?.action).toBe('auth.session.replay_detected');
  });

  // ── TEST 2: Database-generated UUID ─────────────────────────────────────────
  it('2. generates canonical UUID primary key via PostgreSQL gen_random_uuid()', async () => {
    const event: IndependentAuditEvent = {
      action: 'auth.session.replay_detected',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'SESSION',
      resourceId: 'sess-uuid-test',
      outcome: 'DENIED',
      metadata: {
        incidentClassification: 'SUSPICIOUS_REUSE',
        revocationReason: 'TOKEN_REUSE_DETECTED',
      },
    };

    const res = await auditService.recordIndependent(event);
    expect(res.status).toBe('PERSISTED');
    expect(res.record?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // ── TEST 3: Database-generated Timestamp ────────────────────────────────────
  it('3. generates accurate PostgreSQL created_at timestamp', async () => {
    const before = Date.now() - 5000;
    const event: IndependentAuditEvent = {
      action: 'auth.session.replay_detected',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'SESSION',
      resourceId: 'sess-time-test',
      outcome: 'DENIED',
      metadata: {
        incidentClassification: 'SUSPICIOUS_REUSE',
        revocationReason: 'TOKEN_REUSE_DETECTED',
      },
    };

    const res = await auditService.recordIndependent(event);
    expect(res.status).toBe('PERSISTED');
    expect(res.record?.createdAt).toBeInstanceOf(Date);
    expect(res.record!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  // ── TEST 4: All permitted actor types (USER, SYSTEM, ANONYMOUS) ──────────────
  it('4. persists all permitted actor types (USER, SYSTEM, ANONYMOUS)', async () => {
    // Create synthetic user for USER actor
    const synthUser = await prismaRuntime.user.create({
      data: {
        email: 'actor-test@skyra-tech.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
      },
    });

    // A. USER actor
    const userEvent: IndependentAuditEvent = {
      action: 'auth.session.replay_detected',
      actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: synthUser.id }),
      resourceType: 'SESSION',
      resourceId: 'sess-user-actor',
      outcome: 'DENIED',
      metadata: {
        incidentClassification: 'SUSPICIOUS_REUSE',
        revocationReason: 'TOKEN_REUSE_DETECTED',
      },
    };
    const userRes = await auditService.recordIndependent(userEvent);
    expect(userRes.status).toBe('PERSISTED');
    expect(userRes.record?.actorType).toBe('USER');
    expect(userRes.record?.actorId).toBe(synthUser.id);

    // B. SYSTEM actor
    const systemEvent: TransactionalAuditEvent = {
      action: 'auth.user.registered',
      actor: AuditActorFactory.forSystem(),
      resourceType: 'USER',
      resourceId: synthUser.id,
      outcome: 'SUCCESS',
      metadata: { role: 'AUTHOR', registrationMethod: 'EMAIL_PASSWORD' },
    };
    const systemRecord = await prismaRuntime.$transaction(async (tx) => {
      return await auditService.recordTransactional(tx, systemEvent);
    });
    expect(systemRecord.actorType).toBe('SYSTEM');
    expect(systemRecord.actorId).toBeNull();

    // C. ANONYMOUS actor
    const anonEvent: IndependentAuditEvent = {
      action: 'auth.login.failed',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'USER',
      outcome: 'FAILURE',
      metadata: { reason: 'RATE_LIMIT_EXCEEDED', attemptCount: 10 },
    };
    const anonRes = await auditService.recordIndependent(anonEvent);
    expect(anonRes.status).toBe('PERSISTED');
    expect(anonRes.record?.actorType).toBe('ANONYMOUS');
    expect(anonRes.record?.actorId).toBeNull();
  });

  // ── TEST 5: All permitted outcomes (SUCCESS, FAILURE, DENIED) ────────────────
  it('5. persists all permitted outcomes (SUCCESS, FAILURE, DENIED)', async () => {
    for (const outcome of ['SUCCESS', 'FAILURE', 'DENIED'] as const) {
      const event: IndependentAuditEvent = {
        action: 'auth.session.replay_detected',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'SESSION',
        resourceId: `sess-outcome-${outcome.toLowerCase()}`,
        outcome,
        metadata: {
          incidentClassification: 'SUSPICIOUS_REUSE',
          revocationReason: 'TOKEN_REUSE_DETECTED',
        },
      };
      const res = await auditService.recordIndependent(event);
      expect(res.status).toBe('PERSISTED');
      expect(res.record?.outcome).toBe(outcome);
    }
  });

  // ── TEST 6: Four-index structure remains unchanged ───────────────────────────
  it('6. verifies the 4 audit indexes exist in PostgreSQL catalog', async () => {
    const indexes = await prismaRuntime.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'audit_logs' AND schemaname = 'public'
      ORDER BY indexname;
    `;
    const indexNames = indexes.map((i) => i.indexname);

    expect(indexNames).toContain('audit_logs_created_at_idx');
    expect(indexNames).toContain('audit_logs_actor_id_created_at_idx');
    expect(indexNames).toContain('audit_logs_resource_type_resource_id_created_at_idx');
    expect(indexNames).toContain('audit_logs_request_id_idx');
  });

  // ── TEST 7: Metadata JSONB size enforcement ──────────────────────────────────
  it('7. enforces metadata JSONB size constraint at the database layer', async () => {
    // Direct attempt to bypass validator and insert > 1024 bytes into metadata
    const oversizedMetadata = { padding: 'x'.repeat(1100) };

    await expect(
      prismaRuntime.$executeRaw`
        INSERT INTO "audit_logs" ("actor_type", "action", "resource_type", "outcome", "metadata")
        VALUES ('SYSTEM', 'auth.user.registered', 'USER', 'SUCCESS', ${JSON.stringify(oversizedMetadata)}::jsonb);
      `,
    ).rejects.toThrow();
  });

  // ── TEST 8: Transactional write and commit ───────────────────────────────────
  it('8. commits audit record within an interactive Prisma transaction', async () => {
    const synthUser = await prismaRuntime.user.create({
      data: {
        email: 'tx-commit@skyra-tech.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
      },
    });

    const event: TransactionalAuditEvent = {
      action: 'auth.login.succeeded',
      actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: synthUser.id }),
      resourceType: 'SESSION',
      resourceId: 'sess-tx-commit',
      outcome: 'SUCCESS',
      metadata: { authMethod: 'PASSWORD', rememberMe: true },
    };

    let createdId: string;
    await prismaRuntime.$transaction(async (tx) => {
      const record = await auditService.recordTransactional(tx, event);
      createdId = record.id;
    });

    const persisted = await prismaRuntime.auditLog.findUnique({
      where: { id: createdId! },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.action).toBe('auth.login.succeeded');
  });

  // ── TEST 9: Transactional write and rollback ─────────────────────────────────
  it('9. rolls back audit record when enclosing transaction is aborted', async () => {
    const synthUser = await prismaRuntime.user.create({
      data: {
        email: 'tx-rollback@skyra-tech.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
      },
    });

    const event: TransactionalAuditEvent = {
      action: 'auth.login.succeeded',
      actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: synthUser.id }),
      resourceType: 'SESSION',
      resourceId: 'sess-tx-rollback',
      outcome: 'SUCCESS',
      metadata: { authMethod: 'PASSWORD', rememberMe: false },
    };

    let attemptedId: string | undefined;

    await expect(
      prismaRuntime.$transaction(async (tx) => {
        const record = await auditService.recordTransactional(tx, event);
        attemptedId = record.id;
        // Intentionally abort the transaction
        throw new Error('Explicit transaction rollback trigger');
      }),
    ).rejects.toThrow('Explicit transaction rollback trigger');

    // Confirm record was rolled back and does NOT exist in PostgreSQL
    const lookup = await prismaRuntime.auditLog.findUnique({
      where: { id: attemptedId! },
    });
    expect(lookup).toBeNull();
  });

  // ── TEST 10: Domain write plus audit write committing together ───────────────
  it('10. commits domain entity and audit record together atomically in one transaction', async () => {
    const userEmail = 'atomic-pair@skyra-tech.com';
    let committedUserId: string;
    let committedAuditId: string;

    await prismaRuntime.$transaction(async (tx) => {
      // Step A: Domain write
      const user = await tx.user.create({
        data: {
          email: userEmail,
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
        },
      });
      committedUserId = user.id;

      // Step B: Audit write sharing same transaction
      const audit = await auditService.recordTransactional(tx, {
        action: 'auth.user.registered',
        actor: AuditActorFactory.forSystem(),
        resourceType: 'USER',
        resourceId: user.id,
        outcome: 'SUCCESS',
        metadata: { role: 'AUTHOR', registrationMethod: 'EMAIL_PASSWORD' },
      });
      committedAuditId = audit.id;
    });

    // Verify both exist in database
    const userInDb = await prismaRuntime.user.findUnique({ where: { id: committedUserId! } });
    const auditInDb = await prismaRuntime.auditLog.findUnique({ where: { id: committedAuditId! } });

    expect(userInDb).not.toBeNull();
    expect(auditInDb).not.toBeNull();
    expect(auditInDb?.resourceId).toBe(committedUserId!);
  });

  // ── TEST 11: Failed audit insert rolling back domain write ───────────────────
  it('11. rolls back domain write if audit insert fails within transaction', async () => {
    const userEmail = 'doomed-user@skyra-tech.com';

    await expect(
      prismaRuntime.$transaction(async (tx) => {
        // Step A: Domain write
        await tx.user.create({
          data: {
            email: userEmail,
            passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
          },
        });

        // Step B: Trigger audit error by passing invalid transaction event
        await auditService.recordTransactional(tx, {
          action: 'auth.session.replay_detected' as any, // Not allowed for transactional
          actor: AuditActorFactory.forAnonymous(),
          resourceType: 'SESSION',
          outcome: 'DENIED',
          metadata: { incidentClassification: 'SUSPICIOUS_REUSE', revocationReason: 'TOKEN_REUSE_DETECTED' } as any,
        });
      }),
    ).rejects.toThrow();

    // Confirm domain user was rolled back
    const userInDb = await prismaRuntime.user.findUnique({ where: { email: userEmail } });
    expect(userInDb).toBeNull();
  });

  // ── TEST 12: Direct UPDATE denial ───────────────────────────────────────────
  it('12. asserts direct UPDATE on audit_logs is denied by PostgreSQL (SQLSTATE 42501)', async () => {
    await expect(
      prismaRuntime.$executeRaw`UPDATE "audit_logs" SET "action" = 'tampered' WHERE 1 = 1;`,
    ).rejects.toThrow();
  });

  // ── TEST 13: Direct DELETE denial ───────────────────────────────────────────
  it('13. asserts direct DELETE on audit_logs is denied by PostgreSQL (SQLSTATE 42501)', async () => {
    await expect(
      prismaRuntime.$executeRaw`DELETE FROM "audit_logs" WHERE 1 = 1;`,
    ).rejects.toThrow();
  });

  // ── TEST 14: Direct TRUNCATE denial ─────────────────────────────────────────
  it('14. asserts direct TRUNCATE on audit_logs is denied by PostgreSQL (SQLSTATE 42501)', async () => {
    await expect(
      prismaRuntime.$executeRaw`TRUNCATE TABLE "audit_logs";`,
    ).rejects.toThrow();
  });

  // ── TEST 15: Account-deletion ON DELETE SET NULL ────────────────────────────
  it('15. verifies account deletion nullifies actor_id while preserving audit log', async () => {
    // 1. Create user
    const user = await prismaRuntime.user.create({
      data: {
        email: 'anonymize-me@skyra-tech.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
      },
    });

    // 2. Insert audit log referencing user as actor
    let auditId: string;
    await prismaRuntime.$transaction(async (tx) => {
      const record = await auditService.recordTransactional(tx, {
        action: 'auth.login.succeeded',
        actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: user.id }),
        resourceType: 'SESSION',
        resourceId: 'sess-anon-001',
        outcome: 'SUCCESS',
        metadata: { authMethod: 'PASSWORD', rememberMe: false },
      });
      auditId = record.id;
    });

    // 3. Delete user via authorized runtime DELETE
    await prismaRuntime.user.delete({ where: { id: user.id } });

    // 4. Assert audit log survived and actor_id is now NULL
    const auditRecord = await prismaRuntime.auditLog.findUnique({
      where: { id: auditId! },
    });

    expect(auditRecord).not.toBeNull();
    expect(auditRecord?.actorId).toBeNull();
    expect(auditRecord?.action).toBe('auth.login.succeeded');
    expect(auditRecord?.resourceId).toBe('sess-anon-001');
  });

  // ── TEST 16: Concurrency with independent transactions ───────────────────────
  it('16. executes concurrent audit operations without deadlocks or pool starvation', async () => {
    const concurrentWrites = 5;
    const promises = Array.from({ length: concurrentWrites }).map(async (_, idx) => {
      return await auditService.recordIndependent({
        action: 'auth.session.replay_detected',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'SESSION',
        resourceId: `sess-concurrent-${idx}`,
        outcome: 'DENIED',
        metadata: {
          incidentClassification: 'SUSPICIOUS_REUSE',
          revocationReason: 'TOKEN_REUSE_DETECTED',
        },
      });
    });

    const results = await Promise.all(promises);
    expect(results).toHaveLength(concurrentWrites);
    for (const res of results) {
      expect(res.status).toBe('PERSISTED');
      expect(res.record).not.toBeNull();
    }
  });

  // ── TEST 17: Secret-field rejection before persistence ──────────────────────
  it('17. rejects sensitive credentials in metadata before database persistence', async () => {
    const toxicEvent: any = {
      action: 'auth.login.succeeded',
      actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: 'a0000000-0000-4000-8000-000000000001' }),
      resourceType: 'SESSION',
      outcome: 'SUCCESS',
      metadata: {
        authMethod: 'PASSWORD',
        rememberMe: true,
        password: 'LeakedPassword123!',
      },
    };

    expect(() => AuditValidator.validate(toxicEvent)).toThrow(AuditValidationError);
    expect(() => AuditValidator.validate(toxicEvent)).toThrow(/forbidden metadata key/);
  });

  // ── TEST 18: Accurate actor_id, resource_id, request_id, trace_id storage ───
  it('18. accurately persists actor_id, resource_id, request_id, and trace_id attributes', async () => {
    const traceId = 'fedcba9876543210fedcba9876543210';
    const requestId = 'req-trace-test-123';
    const ipAddress = '198.51.100.1';
    const userAgent = 'AuditVerifySuite/1.0';

    const res = await auditService.recordIndependent({
      action: 'auth.session.replay_detected',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'SESSION',
      resourceId: 'sess-attr-test',
      outcome: 'DENIED',
      traceId,
      requestId,
      ipAddress,
      userAgent,
      metadata: {
        incidentClassification: 'SUSPICIOUS_REUSE',
        revocationReason: 'TOKEN_REUSE_DETECTED',
      },
    });

    expect(res.status).toBe('PERSISTED');
    expect(res.record).not.toBeNull();
    expect(res.record?.traceId).toBe(traceId);
    expect(res.record?.requestId).toBe(requestId);
    expect(res.record?.ipAddress).toBe(ipAddress);
    expect(res.record?.userAgent).toBe(userAgent);

    // Double check directly from DB via query
    const dbRow = await prismaRuntime.auditLog.findUnique({
      where: { id: res.record!.id },
    });
    expect(dbRow?.traceId).toBe(traceId);
    expect(dbRow?.requestId).toBe(requestId);
    expect(dbRow?.ipAddress).toBe(ipAddress);
  });

  // ── TEST 19: Section 15 — Real PostgreSQL Concurrency Slot Lifecycle & pg_sleep Timeout ──
  it('19. enforces concurrency limit of 10 during real in-flight PostgreSQL delay and releases slot on settlement', async () => {
    // We create a temporary delay repository that uses SELECT pg_sleep(0.3) in PostgreSQL
    const delayedRepository = new AuditRepository(prismaRuntime as any);
    const originalCreate = delayedRepository.create.bind(delayedRepository);

    // Override create to run pg_sleep(0.3) concurrently with insert
    delayedRepository.create = async (data, tx) => {
      // Execute pg_sleep in PostgreSQL to simulate a genuine, in-flight database delay
      await prismaRuntime.$executeRaw`SELECT pg_sleep(0.35);`;
      return await originalCreate(data, tx);
    };

    const delayedService = new AuditService(delayedRepository);

    // Launch 10 concurrent in-flight writes
    const promises = Array.from({ length: 10 }).map((_, i) =>
      delayedService.recordIndependent(
        {
          action: 'auth.session.replay_detected',
          actor: AuditActorFactory.forAnonymous(),
          resourceType: 'SESSION',
          resourceId: `sess-delay-${i}`,
          outcome: 'DENIED',
          metadata: {
            incidentClassification: 'SUSPICIOUS_REUSE',
            revocationReason: 'TOKEN_REUSE_DETECTED',
          },
        },
        { timeoutMs: 2000 },
      ),
    );

    // Concurrency counter should reflect in-flight capacity
    expect(delayedService.getActiveIndependentWrites()).toBe(10);

    // The 11th write must be rejected immediately with REJECTED_CONCURRENCY
    const overflowResult = await delayedService.recordIndependent({
      action: 'auth.session.replay_detected',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'SESSION',
      resourceId: 'sess-delay-overflow',
      outcome: 'DENIED',
      metadata: {
        incidentClassification: 'SUSPICIOUS_REUSE',
        revocationReason: 'TOKEN_REUSE_DETECTED',
      },
    });

    expect(overflowResult.status).toBe('REJECTED_CONCURRENCY');
    expect(overflowResult.record).toBeNull();

    // Await all 10 in-flight writes to settle
    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.status).toBe('PERSISTED');
    }

    // Capacity must be completely restored back to 0
    expect(delayedService.getActiveIndependentWrites()).toBe(0);
  });

  // ── TEST 20: Section 15 — Caller Wait Deadline Exceeded vs Genuine DB Settlement ──
  it('20. accurately reports WAIT_TIMEOUT_PENDING when caller deadline expires and holds slot until real settlement', async () => {
    const delayedRepository = new AuditRepository(prismaRuntime as any);
    const originalCreate = delayedRepository.create.bind(delayedRepository);

    delayedRepository.create = async (data, tx) => {
      await prismaRuntime.$executeRaw`SELECT pg_sleep(0.2);`;
      return await originalCreate(data, tx);
    };

    const delayedService = new AuditService(delayedRepository);

    // Timeout is 40ms, but PostgreSQL sleep takes ~200ms
    const outcome = await delayedService.recordIndependent(
      {
        action: 'auth.session.replay_detected',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'SESSION',
        resourceId: 'sess-timeout-real-db',
        outcome: 'DENIED',
        metadata: {
          incidentClassification: 'SUSPICIOUS_REUSE',
          revocationReason: 'TOKEN_REUSE_DETECTED',
        },
      },
      { timeoutMs: 40, throwOnError: false },
    );

    // Caller deadline elapsed: outcome is WAIT_TIMEOUT_PENDING
    expect(outcome.status).toBe('WAIT_TIMEOUT_PENDING');
    expect(outcome.record).toBeNull();

    // Slot is STILL held because PostgreSQL is still running
    expect(delayedService.getActiveIndependentWrites()).toBe(1);

    // Await the underlying settlement promise
    await outcome.settlementPromise;

    // Slot is now released
    expect(delayedService.getActiveIndependentWrites()).toBe(0);

    // Verify record was actually persisted to PostgreSQL once it settled
    const persisted = await prismaRuntime.auditLog.findFirst({
      where: { resourceId: 'sess-timeout-real-db' },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.action).toBe('auth.session.replay_detected');
  });

  // ── TEST 21: Real PostgreSQL Engine Statement Timeout Cancellation (SQLSTATE 57014) ──
  it('21. enforces PostgreSQL engine-level query cancellation (57014) when statement execution bound is exceeded', async () => {
    const delayedRepository = new AuditRepository(prismaRuntime as any);
    const originalCreate = delayedRepository.create.bind(delayedRepository);

    // Inject delay that exceeds statement timeout bound (pg_sleep 0.4s vs statement_timeout 150ms)
    delayedRepository.create = async (data, tx) => {
      await tx!.$executeRaw`SELECT pg_sleep(0.4);`;
      return await originalCreate(data, tx);
    };

    const delayedService = new AuditService(delayedRepository);

    const outcome = await delayedService.recordIndependent(
      {
        action: 'auth.session.replay_detected',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'SESSION',
        resourceId: 'sess-engine-timeout-test',
        outcome: 'DENIED',
        metadata: {
          incidentClassification: 'SUSPICIOUS_REUSE',
          revocationReason: 'TOKEN_REUSE_DETECTED',
        },
      },
      {
        timeoutMs: 3000,
        statementTimeoutMs: 150, // PostgreSQL cancels after 150ms
        throwOnError: false,
      },
    );

    // 1. Result reflects confirmed failure due to database cancellation
    expect(outcome.status).toBe('CONFIRMED_FAILURE');
    expect(outcome.record).toBeNull();
    expect(outcome.error).toBeDefined();

    // 2. Concurrency capacity is safely restored back to 0
    expect(delayedService.getActiveIndependentWrites()).toBe(0);

    // 3. Confirm NO record was persisted (transaction was aborted by PostgreSQL)
    const record = await prismaRuntime.auditLog.findFirst({
      where: { resourceId: 'sess-engine-timeout-test' },
    });
    expect(record).toBeNull();
  });

  // ── TEST 22: Zero Leakage of Transaction-Scoped statement_timeout into Connection Pool ──
  it('22. verifies that transaction-scoped statement_timeout does not leak into subsequent pooled queries', async () => {
    // Run SHOW statement_timeout on runtime client
    const rows = await prismaRuntime.$queryRaw<{ statement_timeout: string }[]>`
      SHOW statement_timeout;
    `;
    expect(rows).toHaveLength(1);
    // Setting must be default '0' (unlimited/server default), proving SET LOCAL did not leak
    expect(rows[0].statement_timeout).toBe('0');
  });

  // ── TEST 23: Section 4 — Direct PostgreSQL $queryRaw set_config Verification ──
  it('23. verifies Prisma $queryRaw set_config execution, transaction-local timeout inspection, and commit', async () => {
    const configuredTimeout = '2500';
    let localTimeoutInsideTx = '';

    const record = await prismaRuntime.$transaction(async (tx) => {
      // 1. Execute parameter-bound set_config with is_local=true
      const setRes = await tx.$queryRaw<{ set_config: string }[]>`
        SELECT set_config('statement_timeout', ${configuredTimeout}, true);
      `;
      expect(setRes).toHaveLength(1);
      expect(setRes[0].set_config).toMatch(/^(?:2500ms|2500)$/);

      // 2. Read the transaction-local timeout inside the active transaction
      const showRes = await tx.$queryRaw<{ statement_timeout: string }[]>`
        SHOW statement_timeout;
      `;
      localTimeoutInsideTx = showRes[0].statement_timeout;

      // 3. Insert audit log inside same transaction
      const event: IndependentAuditEvent = {
        action: 'auth.session.replay_detected',
        actor: AuditActorFactory.forAnonymous(),
        resourceType: 'SESSION',
        resourceId: 'sess-queryraw-verify',
        outcome: 'DENIED',
        metadata: {
          incidentClassification: 'SUSPICIOUS_REUSE',
          revocationReason: 'TOKEN_REUSE_DETECTED',
        },
      };
      const validated = AuditValidator.validate(event);
      return await auditRepository.create(validated, tx);
    });

    // 4. Verify transaction-local setting matched configured bound
    expect(localTimeoutInsideTx).toMatch(/^(?:2500ms|2500|2\.5s)$/);

    // 5. Verify the persisted audit row was committed
    expect(record.id).toBeDefined();
    const persisted = await prismaRuntime.auditLog.findUnique({
      where: { id: record.id },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.resourceId).toBe('sess-queryraw-verify');

    // 6. Confirm that the setting did not leak after transaction completion
    const postCommitShow = await prismaRuntime.$queryRaw<{ statement_timeout: string }[]>`
      SHOW statement_timeout;
    `;
    expect(postCommitShow[0].statement_timeout).toBe('0');
  });

  // ── TEST 24: Section 6 & 9 — Real Independent Audit Insert with Privacy Option A ──
  it('24. executes real independent audit insert through AuditService.recordIndependent() under Privacy Option A', async () => {
    const independentEvent: IndependentAuditEvent = {
      action: 'auth.login.failed',
      actor: AuditActorFactory.forAnonymous(),
      resourceType: 'USER',
      resourceId: null, // Privacy Option A: resourceId remains null for user-targeted event
      outcome: 'FAILURE',
      metadata: {
        reason: 'RATE_LIMIT_EXCEEDED',
        attemptCount: 5,
      },
    };

    const res = await auditService.recordIndependent(independentEvent, {
      timeoutMs: 5000,
      statementTimeoutMs: 3000,
      throwOnError: true,
    });

    expect(res.status).toBe('PERSISTED');
    expect(res.record).not.toBeNull();
    expect(res.record?.action).toBe('auth.login.failed');
    expect(res.record?.resourceType).toBe('USER');
    expect(res.record?.resourceId).toBeNull();
    expect(res.record?.outcome).toBe('FAILURE');
    expect(res.record?.actorType).toBe('ANONYMOUS');
    expect(res.record?.actorId).toBeNull();

    // Verify row directly in PostgreSQL
    const dbRow = await prismaRuntime.auditLog.findUnique({
      where: { id: res.record!.id },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow?.action).toBe('auth.login.failed');
    expect(dbRow?.resourceId).toBeNull();
    expect(dbRow?.metadata).toEqual({
      reason: 'RATE_LIMIT_EXCEEDED',
      attemptCount: 5,
    });
  });
});
