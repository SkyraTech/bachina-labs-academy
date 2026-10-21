import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { AuditRepository } from '../src/modules/audit/audit.repository.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import {
  AuditActorFactory,
} from '../src/modules/audit/types/audit-event.types.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { SessionsRepository } from '../src/modules/sessions/sessions.repository.js';
import { SessionsService } from '../src/modules/sessions/sessions.service.js';
import { EmailVerificationTokenRepository } from '../src/modules/auth/repositories/email-verification-token.repository.js';
import { assertDisposableTestDatabase } from './test-db-isolation.js';

describe('Transactional Authentication Audit Integration Real PostgreSQL 17 (e2e)', () => {
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
  let usersRepository: UsersRepository;
  let sessionsRepository: SessionsRepository;
  let sessionsService: SessionsService;
  let emailVerificationTokenRepository: EmailVerificationTokenRepository;

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
    // 1. Read configuration safely from .env
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
    disposableDbName = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
    assertDisposableTestDatabase(disposableDbName);

    // 3. Confirm target database does not exist
    const checkSql = `SELECT count(*) FROM pg_database WHERE datname = '${disposableDbName}';`;
    const checkRes = runAdminPsql(checkSql);
    if (!checkRes.includes('0')) {
      throw new Error(`Proposed database ${disposableDbName} unexpectedly already exists!`);
    }

    // 4. Create isolated database
    runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`);

    // 5. Initialize schema fixtures: users, user_sessions, email_verification_tokens, audit_logs
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
        "revocation_reason" VARCHAR(50),
        "last_seen_at" TIMESTAMPTZ(3),
        "expires_at" TIMESTAMPTZ(3) NOT NULL,
        "user_agent" VARCHAR(512),
        "ip_address" VARCHAR(45),
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "user_sessions_refresh_token_hash_key" UNIQUE ("refresh_token_hash"),
        CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );

      CREATE TABLE "email_verification_tokens" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "token_hash" VARCHAR(64) NOT NULL,
        "expires_at" TIMESTAMPTZ(3) NOT NULL,
        "consumed_at" TIMESTAMPTZ(3),
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "email_verification_tokens_token_hash_key" UNIQUE ("token_hash"),
        CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX "email_verification_tokens_user_active_key" 
          ON "email_verification_tokens"("user_id") WHERE consumed_at IS NULL;

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

      -- 6. Grant restricted privileges to runtime user academy_app
      GRANT USAGE ON SCHEMA public TO "${runtimeUser}";
      REVOKE CREATE ON SCHEMA public FROM "${runtimeUser}";

      GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification_tokens" TO "${runtimeUser}";

      -- Append-only for audit_logs
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

    // 8. Instantiate repositories and services
    auditRepository = new AuditRepository(prismaRuntime as any);
    auditService = new AuditService(auditRepository);
    usersRepository = new UsersRepository(prismaRuntime as any);
    sessionsRepository = new SessionsRepository(prismaRuntime as any);
    sessionsService = new SessionsService(sessionsRepository);
    emailVerificationTokenRepository = new EmailVerificationTokenRepository(
      prismaRuntime as any,
      auditService,
    );
  }, 30000);

  afterAll(async () => {
    if (prismaRuntime) {
      await prismaRuntime.$disconnect();
    }
    // Clean up disposable database explicitly
    if (disposableDbName) {
      try {
        runAdminPsql(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${disposableDbName}' AND pid <> pg_backend_pid();`,
        );
        runAdminPsql(`DROP DATABASE IF EXISTS "${disposableDbName}";`);
      } catch (err) {
        console.error(`Failed to clean up disposable database ${disposableDbName}:`, err);
      }
    }
  });

  // ── PHASE C: TEST DATABASE ISOLATION SAFEGUARDS ───────────────────────────

  describe('Phase C: Test Database Isolation Safeguards', () => {
    it('refuses to operate when target is bachina_labs_academy, empty, or invalid', () => {
      expect(() => assertDisposableTestDatabase('bachina_labs_academy')).toThrow(
        /cannot be production or development database "bachina_labs_academy"/i,
      );
      expect(() => assertDisposableTestDatabase('BACHINA_LABS_ACADEMY')).toThrow(
        /cannot be production or development database "bachina_labs_academy"/i,
      );
      expect(() => assertDisposableTestDatabase('')).toThrow(/empty or undefined/i);
      expect(() => assertDisposableTestDatabase(null as any)).toThrow(/empty or undefined/i);
      expect(() => assertDisposableTestDatabase('postgres')).toThrow(/cannot be system database/i);
      expect(() => assertDisposableTestDatabase('random_other_db')).toThrow(
        /does not start with an? approved disposable prefix/i,
      );
      expect(() => assertDisposableTestDatabase('academy_auth_audit_nonhex')).toThrow(
        /valid collision-resistant hex suffix/i,
      );

      // Valid target passes
      expect(() =>
        assertDisposableTestDatabase(`academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`),
      ).not.toThrow();
    });
  });

  // ── EVENT 1: auth.user.registered ──────────────────────────────────────────

  describe('Event 1: auth.user.registered', () => {
    it('1. commits user and audit record atomically with Privacy Option A', async () => {
      const email = 'reg-success@skyra-tech.com';
      const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$registeredhash1';

      const user = await prismaRuntime.$transaction(async (tx) => {
        const created = await usersRepository.createUser(
          { email, passwordHash },
          tx,
        );

        await auditService.recordTransactional(tx, {
          action: 'auth.user.registered',
          actor: AuditActorFactory.fromRegistrationTarget({
            id: created.id,
            role: created.role,
          }),
          resourceType: 'USER',
          resourceId: null, // Option A: null resource ID for USER events
          outcome: 'SUCCESS',
          metadata: {
            role: created.role,
            registrationMethod: 'EMAIL_PASSWORD',
          },
        });

        return created;
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe(email);
      expect(user.role).toBe(UserRole.AUTHOR);

      // Verify audit record in PostgreSQL
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.user.registered', actorId: user.id },
      });
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit.actorType).toBe('USER');
      expect(audit.actorId).toBe(user.id);
      expect(audit.resourceType).toBe('USER');
      expect(audit.resourceId).toBeNull(); // Option A verified!
      expect(audit.outcome).toBe('SUCCESS');
      expect(audit.metadata).toEqual({
        role: 'AUTHOR',
        registrationMethod: 'EMAIL_PASSWORD',
      });
      expect(audit.createdAt).toBeInstanceOf(Date);
      expect(audit.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('2. rolls back user creation if audit record insertion fails', async () => {
      const email = 'reg-fail-audit@skyra-tech.com';
      const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$registeredhash2';

      await expect(
        prismaRuntime.$transaction(async (tx) => {
          const created = await usersRepository.createUser(
            { email, passwordHash },
            tx,
          );

          // Violate metadata constraint / schema: provide unauthorized key
          await auditService.recordTransactional(tx, {
            action: 'auth.user.registered',
            actor: AuditActorFactory.fromRegistrationTarget({
              id: created.id,
              role: created.role,
            }),
            resourceType: 'USER',
            resourceId: null,
            outcome: 'SUCCESS',
            metadata: {
              role: created.role,
              forbiddenField: 'leak',
            } as any,
          });
        }),
      ).rejects.toThrow();

      // Verify user was NOT persisted (atomicity rollback verified!)
      const foundUser = await prismaRuntime.user.findUnique({
        where: { email },
      });
      expect(foundUser).toBeNull();

      // Verify no audit log was created
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.user.registered', metadata: { path: ['forbiddenField'], equals: 'leak' } },
      });
      expect(auditRows).toHaveLength(0);
    });
  });

  // ── EVENT 2: auth.email.verified ────────────────────────────────────────────

  describe('Event 2: auth.email.verified', () => {
    it('3. commits token consumption, user verification, and audit log atomically', async () => {
      // Create user directly
      const createdUser = await prismaRuntime.user.create({
        data: {
          email: 'verify-success@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
        },
      });

      const tokenHash = crypto.createHash('sha256').update('valid-token-string').digest('hex');
      const token = await prismaRuntime.emailVerificationToken.create({
        data: {
          userId: createdUser.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const now = new Date();
      const result = await emailVerificationTokenRepository.consumeTokenAndVerifyUser(
        token.id,
        createdUser.id,
        now,
      );

      expect(result).toEqual({ consumed: true, newlyVerified: true });

      // Verify token consumed in DB
      const updatedToken = await prismaRuntime.emailVerificationToken.findUnique({
        where: { id: token.id },
      });
      expect(updatedToken?.consumedAt).not.toBeNull();

      // Verify user verified in DB
      const updatedUser = await prismaRuntime.user.findUnique({
        where: { id: createdUser.id },
      });
      expect(updatedUser?.emailVerifiedAt).not.toBeNull();

      // Verify audit record in DB
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.email.verified', actorId: createdUser.id },
      });
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit.actorType).toBe('USER');
      expect(audit.actorId).toBe(createdUser.id);
      expect(audit.resourceType).toBe('USER');
      expect(audit.resourceId).toBeNull(); // Option A verified!
      expect(audit.outcome).toBe('SUCCESS');
      expect(audit.metadata).toEqual({
        tokenCategory: 'EMAIL_VERIFICATION',
        verificationMethod: 'LINK',
      });
    });

    it('4. does NOT create an audit event when token is already consumed', async () => {
      const createdUser = await prismaRuntime.user.create({
        data: {
          email: 'verify-already-consumed@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const tokenHash = crypto.createHash('sha256').update('consumed-token-string').digest('hex');
      const token = await prismaRuntime.emailVerificationToken.create({
        data: {
          userId: createdUser.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 86400000),
          consumedAt: new Date(), // Already consumed
        },
      });

      const result = await emailVerificationTokenRepository.consumeTokenAndVerifyUser(
        token.id,
        createdUser.id,
        new Date(),
      );

      expect(result).toEqual({ consumed: false, newlyVerified: false });

      // Confirm no audit log created
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.email.verified', actorId: createdUser.id },
      });
      expect(auditRows).toHaveLength(0);
    });

    it('4b. concurrent token verification allows at most one state transition and one audit log', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'concurrent-verify@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
        },
      });

      const tokenHash = crypto.createHash('sha256').update('concurrent-token-str').digest('hex');
      const token = await prismaRuntime.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const now = new Date();
      // Execute two concurrent consumeTokenAndVerifyUser calls
      const [res1, res2] = await Promise.all([
        emailVerificationTokenRepository.consumeTokenAndVerifyUser(token.id, user.id, now),
        emailVerificationTokenRepository.consumeTokenAndVerifyUser(token.id, user.id, now),
      ]);

      // Exactly one must be consumed and newlyVerified, the other must be false
      const consumedCount = [res1, res2].filter((r) => r.consumed && r.newlyVerified).length;
      const rejectedCount = [res1, res2].filter((r) => !r.consumed && !r.newlyVerified).length;
      expect(consumedCount).toBe(1);
      expect(rejectedCount).toBe(1);

      // Exactly ONE audit row must be committed
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.email.verified', actorId: user.id },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].outcome).toBe('SUCCESS');
    });
  });

  // ── EVENT 3: auth.login.succeeded ──────────────────────────────────────────

  describe('Event 3: auth.login.succeeded', () => {
    it('5. creates session and audit log atomically with Privacy Option A session id', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'login-success@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const refreshTokenHash = crypto.createHash('sha256').update('opaque-refresh-1').digest('hex');

      const safeSession = await prismaRuntime.$transaction(async (tx) => {
        const session = await sessionsService.createSession(
          {
            userId: user.id,
            refreshTokenHash,
            rememberMe: true,
            userAgent: 'TestBrowser/1.0',
            ipAddress: '127.0.0.1',
          },
          tx,
        );

        await auditService.recordTransactional(tx, {
          action: 'auth.login.succeeded',
          actor: AuditActorFactory.fromVerifiedLogin({
            id: user.id,
            role: user.role,
          }),
          resourceType: 'SESSION',
          resourceId: session.id, // Option A: session UUID
          outcome: 'SUCCESS',
          metadata: {
            authMethod: 'PASSWORD',
            rememberMe: true,
          },
        });

        return session;
      });

      expect(safeSession.id).toBeDefined();

      // Verify audit record in DB
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.login.succeeded', actorId: user.id },
      });
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit.actorType).toBe('USER');
      expect(audit.actorId).toBe(user.id);
      expect(audit.resourceType).toBe('SESSION');
      expect(audit.resourceId).toBe(safeSession.id);
      expect(audit.outcome).toBe('SUCCESS');
      expect(audit.metadata).toEqual({
        authMethod: 'PASSWORD',
        rememberMe: true,
      });
    });

    it('6. rolls back session creation if audit insertion fails', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'login-fail-audit@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const refreshTokenHash = crypto.createHash('sha256').update('opaque-refresh-fail').digest('hex');

      await expect(
        prismaRuntime.$transaction(async (tx) => {
          const session = await sessionsService.createSession(
            {
              userId: user.id,
              refreshTokenHash,
              rememberMe: false,
            },
            tx,
          );

          // Force validation error: invalid rememberMe type
          await auditService.recordTransactional(tx, {
            action: 'auth.login.succeeded',
            actor: AuditActorFactory.fromVerifiedLogin({
              id: user.id,
              role: user.role,
            }),
            resourceType: 'SESSION',
            resourceId: session.id,
            outcome: 'SUCCESS',
            metadata: {
              authMethod: 'PASSWORD',
              rememberMe: 'not-a-boolean' as any,
            },
          });
        }),
      ).rejects.toThrow();

      // Verify session was NOT created (rollback verified!)
      const foundSession = await prismaRuntime.userSession.findUnique({
        where: { refreshTokenHash },
      });
      expect(foundSession).toBeNull();
    });
  });

  // ── EVENT 4: auth.session.revoked ──────────────────────────────────────────

  describe('Event 4: auth.session.revoked', () => {
    it('7. revokes designated session and records audit event atomically', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'revoke-single@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const session = await sessionsRepository.createSession({
        userId: user.id,
        refreshTokenHash: crypto.createHash('sha256').update('sess-to-revoke').digest('hex'),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const caller = {
        id: user.id,
        role: user.role,
        sessionId: session.id,
      };

      await prismaRuntime.$transaction(async (tx) => {
        const revoked = await sessionsService.revokeUserSession(
          session.id,
          user.id,
          'USER_LOGOUT',
          new Date(),
          tx,
        );

        expect(revoked).toBe(true);

        await auditService.recordTransactional(tx, {
          action: 'auth.session.revoked',
          actor: AuditActorFactory.fromAuthenticatedPrincipal(caller),
          resourceType: 'SESSION',
          resourceId: session.id, // Option A: session UUID
          outcome: 'SUCCESS',
          metadata: {
            revocationReason: 'USER_INITIATED',
          },
        });
      });

      // Verify session revoked in DB
      const dbSession = await prismaRuntime.userSession.findUnique({
        where: { id: session.id },
      });
      expect(dbSession?.revokedAt).not.toBeNull();

      // Verify audit record in DB
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.session.revoked', resourceId: session.id },
      });
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit.actorType).toBe('USER');
      expect(audit.actorId).toBe(user.id);
      expect(audit.resourceType).toBe('SESSION');
      expect(audit.resourceId).toBe(session.id);
      expect(audit.metadata).toEqual({
        revocationReason: 'USER_INITIATED',
      });
    });

    it('8. does NOT create audit event when target session belongs to another user', async () => {
      const userA = await prismaRuntime.user.create({
        data: { email: 'usera@skyra-tech.com', passwordHash: '$argon2id$v=19$mockhash' },
      });
      const userB = await prismaRuntime.user.create({
        data: { email: 'userb@skyra-tech.com', passwordHash: '$argon2id$v=19$mockhash' },
      });

      const sessionB = await sessionsRepository.createSession({
        userId: userB.id,
        refreshTokenHash: crypto.createHash('sha256').update('sess-user-b').digest('hex'),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      // User A attempts to revoke User B's session
      let recordedAudit = false;
      await prismaRuntime.$transaction(async (tx) => {
        const revoked = await sessionsService.revokeUserSession(
          sessionB.id,
          userA.id, // Wrong owner
          'USER_LOGOUT',
          new Date(),
          tx,
        );

        if (revoked) {
          recordedAudit = true;
          await auditService.recordTransactional(tx, {
            action: 'auth.session.revoked',
            actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: userA.id }),
            resourceType: 'SESSION',
            resourceId: sessionB.id,
            outcome: 'SUCCESS',
            metadata: { revocationReason: 'USER_INITIATED' },
          });
        }
      });

      expect(recordedAudit).toBe(false);

      // Verify User B's session was NOT revoked
      const dbSessionB = await prismaRuntime.userSession.findUnique({
        where: { id: sessionB.id },
      });
      expect(dbSessionB?.revokedAt).toBeNull();

      // Verify no audit log exists for session B
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { resourceId: sessionB.id },
      });
      expect(auditRows).toHaveLength(0);
    });

    it('8b. concurrent session revocation allows exactly one transition and one audit log', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'concurrent-revocation@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const session = await sessionsRepository.createSession({
        userId: user.id,
        refreshTokenHash: crypto.createHash('sha256').update('concurrent-sess-1').digest('hex'),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const caller = { id: user.id, role: user.role, sessionId: session.id };

      const attemptRevoke = async () => {
        return prismaRuntime.$transaction(async (tx) => {
          const revoked = await sessionsService.revokeUserSession(
            session.id,
            user.id,
            'USER_LOGOUT',
            new Date(),
            tx,
          );
          if (revoked) {
            await auditService.recordTransactional(tx, {
              action: 'auth.session.revoked',
              actor: AuditActorFactory.fromAuthenticatedPrincipal(caller),
              resourceType: 'SESSION',
              resourceId: session.id,
              outcome: 'SUCCESS',
              metadata: { revocationReason: 'USER_INITIATED' },
            });
            return true;
          }
          return false;
        });
      };

      const [revoked1, revoked2] = await Promise.all([attemptRevoke(), attemptRevoke()]);

      // Exactly one succeeded, one returned false
      expect([revoked1, revoked2].filter(Boolean)).toHaveLength(1);

      // Verify only 1 audit row in database
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.session.revoked', resourceId: session.id },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].outcome).toBe('SUCCESS');
    });
  });

  // ── EVENT 5: auth.session.revoked_all ──────────────────────────────────────

  describe('Event 5: auth.session.revoked_all', () => {
    it('9. bulk-revokes all user sessions and records audit log with actual count', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'bulk-revoke@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      // Create 3 active sessions
      for (let i = 1; i <= 3; i++) {
        await sessionsRepository.createSession({
          userId: user.id,
          refreshTokenHash: crypto.createHash('sha256').update(`bulk-sess-${i}`).digest('hex'),
          rememberMe: false,
          expiresAt: new Date(Date.now() + 86400000),
        });
      }

      const caller = {
        id: user.id,
        role: user.role,
      };

      const count = await prismaRuntime.$transaction(async (tx) => {
        const revokedCount = await sessionsService.revokeAllUserSessions(
          user.id,
          'USER_LOGOUT_ALL',
          undefined,
          new Date(),
          tx,
        );

        if (revokedCount > 0) {
          await auditService.recordTransactional(tx, {
            action: 'auth.session.revoked_all',
            actor: AuditActorFactory.fromAuthenticatedPrincipal(caller),
            resourceType: 'SESSION',
            resourceId: null, // Option A: null for bulk
            outcome: 'SUCCESS',
            metadata: {
              revocationReason: 'LOGOUT_ALL',
              sessionsCount: revokedCount,
            },
          });
        }

        return revokedCount;
      });

      expect(count).toBe(3);

      // Verify all 3 sessions revoked
      const activeSessions = await sessionsRepository.listActiveUserSessions(user.id);
      expect(activeSessions).toHaveLength(0);

      // Verify audit record
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.session.revoked_all', actorId: user.id },
      });
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit.actorType).toBe('USER');
      expect(audit.actorId).toBe(user.id);
      expect(audit.resourceType).toBe('SESSION');
      expect(audit.resourceId).toBeNull(); // Option A bulk verified!
      expect(audit.outcome).toBe('SUCCESS');
      expect(audit.metadata).toEqual({
        revocationReason: 'LOGOUT_ALL',
        sessionsCount: 3,
      });
    });

    it('10. does NOT record audit log when user has 0 active sessions (idempotent no-op)', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'bulk-noop@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const caller = {
        id: user.id,
        role: user.role,
      };

      const count = await prismaRuntime.$transaction(async (tx) => {
        const revokedCount = await sessionsService.revokeAllUserSessions(
          user.id,
          'USER_LOGOUT_ALL',
          undefined,
          new Date(),
          tx,
        );

        if (revokedCount > 0) {
          await auditService.recordTransactional(tx, {
            action: 'auth.session.revoked_all',
            actor: AuditActorFactory.fromAuthenticatedPrincipal(caller),
            resourceType: 'SESSION',
            resourceId: null,
            outcome: 'SUCCESS',
            metadata: {
              revocationReason: 'LOGOUT_ALL',
              sessionsCount: revokedCount,
            },
          });
        }

        return revokedCount;
      });

      expect(count).toBe(0);

      // Verify NO audit log was written for 0-count no-op
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.session.revoked_all', actorId: user.id },
      });
      expect(auditRows).toHaveLength(0);
    });

    it('10b. bulk-revocation supports current-session exclusion and records only affected count', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'bulk-exclude-current@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      const currentSession = await sessionsRepository.createSession({
        userId: user.id,
        refreshTokenHash: crypto.createHash('sha256').update('current-sess').digest('hex'),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      // Other sessions
      for (let i = 1; i <= 2; i++) {
        await sessionsRepository.createSession({
          userId: user.id,
          refreshTokenHash: crypto.createHash('sha256').update(`other-sess-${i}`).digest('hex'),
          rememberMe: false,
          expiresAt: new Date(Date.now() + 86400000),
        });
      }

      const caller = { id: user.id, role: user.role, sessionId: currentSession.id };

      const revokedCount = await prismaRuntime.$transaction(async (tx) => {
        const count = await sessionsService.revokeAllUserSessions(
          user.id,
          'USER_LOGOUT_ALL',
          currentSession.id, // Exclude current session!
          new Date(),
          tx,
        );

        if (count > 0) {
          await auditService.recordTransactional(tx, {
            action: 'auth.session.revoked_all',
            actor: AuditActorFactory.fromAuthenticatedPrincipal(caller),
            resourceType: 'SESSION',
            resourceId: null,
            outcome: 'SUCCESS',
            metadata: {
              revocationReason: 'LOGOUT_ALL',
              sessionsCount: count,
            },
          });
        }

        return count;
      });

      expect(revokedCount).toBe(2);

      // Current session must still be ACTIVE
      const activeSessions = await sessionsRepository.listActiveUserSessions(user.id);
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(currentSession.id);

      // Audit record shows sessionsCount = 2
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.session.revoked_all', actorId: user.id },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].metadata).toEqual({
        revocationReason: 'LOGOUT_ALL',
        sessionsCount: 2,
      });
    });

    it('10c. concurrent logout-all calls do not double-count revocations or double-record audit logs', async () => {
      const user = await prismaRuntime.user.create({
        data: {
          email: 'concurrent-logout-all@skyra-tech.com',
          passwordHash: '$argon2id$v=19$mockhash',
          emailVerifiedAt: new Date(),
        },
      });

      for (let i = 1; i <= 3; i++) {
        await sessionsRepository.createSession({
          userId: user.id,
          refreshTokenHash: crypto.createHash('sha256').update(`conc-logout-all-${i}`).digest('hex'),
          rememberMe: false,
          expiresAt: new Date(Date.now() + 86400000),
        });
      }

      const caller = { id: user.id, role: user.role };

      const attemptLogoutAll = async () => {
        return prismaRuntime.$transaction(async (tx) => {
          const count = await sessionsService.revokeAllUserSessions(
            user.id,
            'USER_LOGOUT_ALL',
            undefined,
            new Date(),
            tx,
          );

          if (count > 0) {
            await auditService.recordTransactional(tx, {
              action: 'auth.session.revoked_all',
              actor: AuditActorFactory.fromAuthenticatedPrincipal(caller),
              resourceType: 'SESSION',
              resourceId: null,
              outcome: 'SUCCESS',
              metadata: {
                revocationReason: 'LOGOUT_ALL',
                sessionsCount: count,
              },
            });
          }

          return count;
        });
      };

      const [count1, count2] = await Promise.all([attemptLogoutAll(), attemptLogoutAll()]);

      // One gets 3, one gets 0; sum = 3
      expect(count1 + count2).toBe(3);
      expect([count1, count2].sort((a, b) => a - b)).toEqual([0, 3]);

      // Exactly ONE audit row is created with sessionsCount = 3
      const auditRows = await prismaRuntime.auditLog.findMany({
        where: { action: 'auth.session.revoked_all', actorId: user.id },
      });
      expect(auditRows).toHaveLength(1);
      expect((auditRows[0].metadata as any).sessionsCount).toBe(3);
    });

    it('10d. bulk-revocation leaves another user active sessions completely untouched', async () => {
      const userA = await prismaRuntime.user.create({
        data: { email: 'user-a-bulk@skyra-tech.com', passwordHash: '$argon2id$v=19$mockhash', emailVerifiedAt: new Date() },
      });
      const userB = await prismaRuntime.user.create({
        data: { email: 'user-b-bulk@skyra-tech.com', passwordHash: '$argon2id$v=19$mockhash', emailVerifiedAt: new Date() },
      });

      await sessionsRepository.createSession({
        userId: userA.id,
        refreshTokenHash: crypto.createHash('sha256').update('user-a-sess').digest('hex'),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const sessionB = await sessionsRepository.createSession({
        userId: userB.id,
        refreshTokenHash: crypto.createHash('sha256').update('user-b-sess').digest('hex'),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      await prismaRuntime.$transaction(async (tx) => {
        const count = await sessionsService.revokeAllUserSessions(userA.id, 'USER_LOGOUT_ALL', undefined, new Date(), tx);
        expect(count).toBe(1);
        await auditService.recordTransactional(tx, {
          action: 'auth.session.revoked_all',
          actor: AuditActorFactory.fromAuthenticatedPrincipal({ id: userA.id }),
          resourceType: 'SESSION',
          resourceId: null,
          outcome: 'SUCCESS',
          metadata: { revocationReason: 'LOGOUT_ALL', sessionsCount: 1 },
        });
      });

      // User A has 0 active sessions
      const activeA = await sessionsRepository.listActiveUserSessions(userA.id);
      expect(activeA).toHaveLength(0);

      // User B STILL has 1 active session!
      const activeB = await sessionsRepository.listActiveUserSessions(userB.id);
      expect(activeB).toHaveLength(1);
      expect(activeB[0].id).toBe(sessionB.id);
    });
  });

  // ── PRIVACY OPTION A AND DATABASE IMMUTABILITY VERIFICATION ───────────────

  describe('Privacy Option A and Immutability Safeguards', () => {
    it('11. verifies zero secret leakage across all audit metadata rows', async () => {
      const allAuditRows = await prismaRuntime.auditLog.findMany();
      expect(allAuditRows.length).toBeGreaterThanOrEqual(4);

      for (const row of allAuditRows) {
        const metadataStr = JSON.stringify(row.metadata);
        // Secrets scanning: no cryptographic hashes, no raw JWTs, no email addresses, no cookies
        expect(metadataStr).not.toMatch(/\$argon2id/);
        expect(metadataStr).not.toMatch(/\$2[aby]\$/);
        expect(metadataStr).not.toMatch(/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        expect(metadataStr).not.toContain('@'); // no email addresses
        expect(metadataStr).not.toContain('cookie');
        expect(metadataStr).not.toContain('secret');
        expect(metadataStr).not.toContain('authorization');
        expect(metadataStr).not.toContain('password123'); // raw password

        // Privacy Option A rule: user-targeted events have null resourceId
        if (row.resourceType === 'USER') {
          expect(row.resourceId).toBeNull();
        }

        // Bulk session events have null resourceId
        if (row.action === 'auth.session.revoked_all') {
          expect(row.resourceId).toBeNull();
        }

        // Single session events have session UUID resourceId
        if (row.action === 'auth.login.succeeded' || row.action === 'auth.session.revoked') {
          expect(row.resourceId).toMatch(/^[0-9a-f-]{36}$/);
        }
      }
    });

    it('12. verifies append-only enforcement: academy_app cannot UPDATE or DELETE audit_logs', async () => {
      const anyRow = await prismaRuntime.auditLog.findFirst();
      expect(anyRow).not.toBeNull();

      // Direct SQL UPDATE must fail
      await expect(
        prismaRuntime.$executeRawUnsafe(
          `UPDATE "audit_logs" SET "outcome" = 'FAILURE' WHERE "id" = '${anyRow!.id}';`,
        ),
      ).rejects.toThrow(/permission denied/i);

      // Direct SQL DELETE must fail
      await expect(
        prismaRuntime.$executeRawUnsafe(
          `DELETE FROM "audit_logs" WHERE "id" = '${anyRow!.id}';`,
        ),
      ).rejects.toThrow(/permission denied/i);

      // Direct SQL TRUNCATE must fail
      await expect(
        prismaRuntime.$executeRawUnsafe('TRUNCATE TABLE "audit_logs";'),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
