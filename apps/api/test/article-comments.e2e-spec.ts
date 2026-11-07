import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  UserRole,
  UserStatus,
  ArticleStatus,
  CommentStatus,
  ModerationReason,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ConfigModule } from '@nestjs/config';
import { UserProfilesModule } from '../src/modules/users/user-profiles/user-profiles.module.js';
import { CommentsModule } from '../src/modules/comments/comments.module.js';
import { ModerationCleanupService } from '../src/modules/comments/services/moderation-cleanup.service.js';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import { OriginGuard } from '../src/modules/auth/guards/origin.guard.js';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/services/cookie.service.js';
// @ts-expect-error Untyped JS script import for CLI entry point verification
import { assertDatabaseSafe } from '../scripts/cleanup-moderated-comments.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Checkpoint P9-B1 Stage 2 Flat Comments, User Profiles & Admin Moderation (e2e)', () => {
  let disposableDbName: string;
  let psqlPath: string;
  let host: string;
  let port: string;
  let migUser: string;
  let migPass: string;
  let runtimeUser: string;
  let runtimePass: string;
  let disposableRuntimeUrl: string;
  let disposableMigrationUrl: string;
  let primaryDb: string;

  let prisma: PrismaClient;
  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser | null = null;

  let adminUser: { id: string; email: string };
  let authorUser1: { id: string; email: string };
  let authorUser2: { id: string; email: string };
  let unverifiedUser: { id: string; email: string };
  let publishedArticle: { id: string; publishedSlug: string; currentSnapshotId: string };
  let publishedSnapshot: { id: string; snapshotRevision: number };
  let draftArticle: { id: string; draftSlug: string };

  function runAdminPsql(sql: string, targetDb?: string) {
    const dbToConnect = targetDb ?? primaryDb;
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
      throw new Error(`runAdminPsql failed on ${dbToConnect}: ${res.stderr || res.stdout}`);
    }
    return (res.stdout || '').trim();
  }

  beforeAll(async () => {
    psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
    if (!fs.existsSync(psqlPath)) {
      psqlPath = 'psql';
    }

    const envPath = fs.existsSync('.env') ? path.resolve('.env') : path.resolve('apps/api/.env');
    const envContent = fs.readFileSync(envPath, 'utf8');

    const runtimeMatch = envContent.match(
      /DATABASE_RUNTIME_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
    );
    const migrationMatch = envContent.match(
      /DATABASE_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
    );

    if (!runtimeMatch || !migrationMatch) {
      throw new Error('Database connection strings missing in .env');
    }

    [, runtimeUser, runtimePass, host, port, primaryDb] = runtimeMatch;
    [, migUser, migPass] = migrationMatch;
    migPass = decodeURIComponent(migPass);
    runtimePass = decodeURIComponent(runtimePass);

    // 1. Setup disposable database with verified prefix
    const suffix = crypto.randomBytes(8).toString('hex');
    disposableDbName = `academy_e2e_suite_${suffix}`;
    assertDisposableTestDatabase(disposableDbName, 'academy_e2e_suite_');

    runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`, primaryDb);
    runAdminPsql(`GRANT ALL PRIVILEGES ON DATABASE "${disposableDbName}" TO "${runtimeUser}";`, disposableDbName);
    runAdminPsql(`GRANT ALL ON SCHEMA public TO "${runtimeUser}";`, disposableDbName);

    disposableMigrationUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;

    // 2. Deploy migrations (including P9-B1 migration)
    const prismaBin = fs.existsSync('node_modules/prisma/build/index.js')
      ? path.resolve('node_modules/prisma/build/index.js')
      : path.resolve('apps/api/node_modules/prisma/build/index.js');
    const apiCwd = fs.existsSync('prisma') ? '.' : 'apps/api';
    execSync(`node "${prismaBin}" migrate deploy`, {
      cwd: apiCwd,
      env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeUser}";
    `, disposableDbName);

    prisma = new PrismaClient({ datasources: { db: { url: disposableRuntimeUrl } } });
    await prisma.$connect();

    // 3. Seed accounts
    adminUser = await prisma.user.create({
      data: {
        email: `admin_${Date.now()}@bachinalabs.com`,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    authorUser1 = await prisma.user.create({
      data: {
        email: `author1_${Date.now()}@bachinalabs.com`,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    authorUser2 = await prisma.user.create({
      data: {
        email: `author2_${Date.now()}@bachinalabs.com`,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    unverifiedUser = await prisma.user.create({
      data: {
        email: `unverified_${Date.now()}@bachinalabs.com`,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
      },
    });

    // 4. Seed published article with snapshot
    const art = await prisma.article.create({
      data: {
        authorId: authorUser1.id,
        title: 'Concurrency in Modern PostgreSQL',
        draftSlug: 'concurrency-in-modern-postgresql',
        publishedSlug: 'concurrency-in-modern-postgresql',
        summary: 'Deep dive into row locks, snapshot isolation, and audit trails.',
        status: ArticleStatus.PUBLISHED,
        draftRevision: 1,
        publishedRevision: 1,
        publishedAt: new Date(),
      },
    });

    publishedSnapshot = await prisma.articleSnapshot.create({
      data: {
        articleId: art.id,
        snapshotRevision: 1,
        title: 'Concurrency in Modern PostgreSQL',
        publishedSlug: 'concurrency-in-modern-postgresql',
        summary: 'Deep dive into row locks, snapshot isolation, and audit trails.',
        typographyPreset: 'TECHNICAL_MINIMAL',
        blocks: {
          schemaVersion: 1,
          blocks: [{ type: 'HEADING', content: { level: 1, text: 'Introduction' } }],
        },
      },
    });

    await prisma.article.update({
      where: { id: art.id },
      data: { currentSnapshotId: publishedSnapshot.id },
    });

    publishedArticle = {
      id: art.id,
      publishedSlug: art.publishedSlug!,
      currentSnapshotId: publishedSnapshot.id,
    };

    const draft = await prisma.article.create({
      data: {
        authorId: authorUser1.id,
        title: 'Unpublished Draft Article',
        draftSlug: 'unpublished-draft-article',
        summary: 'Work in progress.',
        status: ArticleStatus.DRAFT,
      },
    });
    draftArticle = { id: draft.id, draftSlug: draft.draftSlug };

    // 5. Mount NestJS testing module
    @Injectable()
    class TestJwtAccessGuard implements CanActivate {
      constructor(private readonly reflector: Reflector) {}

      canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
          IS_PUBLIC_KEY,
          [context.getHandler(), context.getClass()],
        );
        if (isPublic) return true;

        if (!currentUserInjected) {
          throw new UnauthorizedException('Authentication required');
        }

        if (currentUserInjected.status && currentUserInjected.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Account is not active');
        }

        const req = context.switchToHttp().getRequest();
        req.user = currentUserInjected;
        return true;
      }
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        UserProfilesModule,
        CommentsModule,
      ],
      providers: [
        OriginGuard,
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useClass: TestJwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.enableCors({
      origin: ['http://localhost:4200'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();

    await safelyDropDisposableDatabase(disposableDbName, runAdminPsql, {
      allowedPrefix: 'academy_e2e_suite_',
      maxWaitMs: 5000,
    });
  });

  describe('A. UserProfile API and Safe Attribution', () => {
    it('1. GET /api/v1/account/profile returns safe fallback representation when profile is absent', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const res = await request(app.getHttpServer())
        .get('/api/v1/account/profile')
        .expect(200);

      expect(res.body.id).toBeNull();
      expect(res.body.userId).toBe(authorUser1.id);
      expect(res.body.displayName).toBe('Academy Member');
      expect(res.body.isFallback).toBe(true);
      expect(res.body.email).toBeUndefined(); // Strict email exclusion
    });

    it('2. PUT /api/v1/account/profile explicitly creates display name and enforces validation', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      // Invalid name: resembles email
      await request(app.getHttpServer())
        .put('/api/v1/account/profile')
        .send({ displayName: 'author@skyra-tech.com' })
        .expect(400);

      // Valid name
      const res = await request(app.getHttpServer())
        .put('/api/v1/account/profile')
        .send({ displayName: 'Dr. Jane PostgreSQL' })
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.userId).toBe(authorUser1.id);
      expect(res.body.displayName).toBe('Dr. Jane PostgreSQL');
      expect(res.body.isFallback).toBe(false);

      // Subsequent GET returns saved profile
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/account/profile')
        .expect(200);

      expect(getRes.body.displayName).toBe('Dr. Jane PostgreSQL');
      expect(getRes.body.isFallback).toBe(false);
    });

    it('3. UserProfile table enforces 1:1 uniqueness per user', async () => {
      await expect(
        prisma.userProfile.create({
          data: {
            userId: authorUser1.id,
            displayName: 'Duplicate Attempt',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('B. Article Comment Creation and Snapshot Integrity', () => {
    it('1. Anonymous comment submission is rejected with 401 Unauthorized', async () => {
      currentUserInjected = null;

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .send({ body: 'Anonymous should not be allowed to post.' })
        .expect(401);
    });

    it('2. Unverified user comment submission is rejected with 403 Forbidden', async () => {
      currentUserInjected = {
        id: unverifiedUser.id,
        email: unverifiedUser.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .send({ body: 'Unverified email attempt.' })
        .expect(403);
    });

    it('3. Comment submission on draft or archived article is rejected with 404', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${draftArticle.draftSlug}/comments`)
        .send({ body: 'Draft commenting attempt.' })
        .expect(404);
    });

    it('4. Active verified user creates comment linked to article and current snapshot', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .send({ body: 'First comment discussing snapshot consistency.' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.articleSlug).toBe(publishedArticle.publishedSlug);
      expect(res.body.snapshotRevision).toBe(1);
      expect(res.body.authorDisplayName).toBe('Dr. Jane PostgreSQL');
      expect(res.body.isArticleAuthor).toBe(true);
      expect(res.body.body).toBe('First comment discussing snapshot consistency.');
      expect(res.body.authorEmail).toBeUndefined(); // Email privacy guaranteed
      expect(res.body.status).toBeUndefined(); // Status hidden from public DTO
    });

    it('5. Independent identical submissions are allowed', async () => {
      currentUserInjected = {
        id: authorUser2.id,
        email: authorUser2.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const post1 = await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .send({ body: 'Duplicate message text' })
        .expect(201);

      const post2 = await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .send({ body: 'Duplicate message text' })
        .expect(201);

      expect(post1.body.id).not.toBe(post2.body.id);
      expect(post1.body.body).toBe(post2.body.body);
      expect(post1.body.authorDisplayName).toBe('Academy Member'); // Fallback when profile absent
    });

    it('6. Composite foreign key rejects snapshot referencing another article', async () => {
      // Create a second article with its own snapshot
      const otherArt = await prisma.article.create({
        data: {
          authorId: authorUser1.id,
          title: 'Second Article',
          draftSlug: 'second-article',
          publishedSlug: 'second-article',
          status: ArticleStatus.PUBLISHED,
          draftRevision: 1,
          publishedRevision: 1,
          publishedAt: new Date(),
        },
      });

      const otherSnap = await prisma.articleSnapshot.create({
        data: {
          articleId: otherArt.id,
          snapshotRevision: 1,
          title: 'Second Article Snapshot',
          publishedSlug: 'second-article',
          typographyPreset: 'MODERN_SANS',
          blocks: { schemaVersion: 1, blocks: [] },
        },
      });

      // Attempting to create an ArticleComment with articleId = publishedArticle.id,
      // but snapshotId = otherSnap.id MUST violate the composite foreign key!
      await expect(
        prisma.articleComment.create({
          data: {
            articleId: publishedArticle.id,
            snapshotId: otherSnap.id, // Mismatched snapshot!
            userId: authorUser1.id,
            body: 'Mismatched snapshot injection attempt',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('C. Public Comment Listing and Anonymous Access', () => {
    it('1. GET /api/v1/articles/public/:slug/comments lists visible comments for anonymous readers', async () => {
      currentUserInjected = null;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments?page=1&limit=20`)
        .expect(200);

      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(3);

      for (const item of res.body.items) {
        expect(item.id).toBeDefined();
        expect(item.body).toBeDefined();
        expect(item.authorDisplayName).toBeDefined();
        expect(item.email).toBeUndefined();
        expect(item.status).toBeUndefined();
      }
    });
  });

  describe('D. Owner Edit and Delete Operations', () => {
    let commentToEdit: string;
    let commentToDelete: string;

    beforeAll(async () => {
      const c1 = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Original comment before edit',
        },
      });
      commentToEdit = c1.id;

      const c2 = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Comment destined for deletion',
        },
      });
      commentToDelete = c2.id;
    });

    it('1. Owner can edit own visible comment', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/comments/${commentToEdit}`)
        .send({ body: 'Successfully edited comment body.' })
        .expect(200);

      expect(res.body.body).toBe('Successfully edited comment body.');
    });

    it('2. Non-owner cannot edit another user\'s comment (403 Forbidden)', async () => {
      currentUserInjected = {
        id: authorUser2.id,
        email: authorUser2.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .patch(`/api/v1/comments/${commentToEdit}`)
        .send({ body: 'Malicious edit attempt.' })
        .expect(403);
    });

    it('3. Non-owner cannot delete another user\'s comment (403 Forbidden)', async () => {
      currentUserInjected = {
        id: authorUser2.id,
        email: authorUser2.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .delete(`/api/v1/comments/${commentToDelete}`)
        .expect(403);
    });

    it('4. Owner can physically delete own comment (204 No Content)', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .delete(`/api/v1/comments/${commentToDelete}`)
        .expect(204);

      // Verify physical deletion from database
      const row = await prisma.articleComment.findUnique({
        where: { id: commentToDelete },
      });
      expect(row).toBeNull();
    });
  });

  describe('E. Admin Moderation and 30-Day Retention Redaction', () => {
    let commentToModerate: string;

    beforeAll(async () => {
      const c = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser2.id,
          body: 'Offensive spam comment to be moderated',
        },
      });
      commentToModerate = c.id;
    });

    it('1. Author cannot access GET /api/v1/admin/comments (403 Forbidden)', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .get('/api/v1/admin/comments')
        .expect(403);
    });

    it('2. Admin can list comments with moderation metadata', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/comments')
        .expect(200);

      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('3. Admin soft-removes comment, emitting audit log without body text', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/comments/${commentToModerate}/remove`)
        .send({ reason: ModerationReason.SPAM })
        .expect(200);

      expect(res.body.status).toBe(CommentStatus.REMOVED);
      expect(res.body.removalReason).toBe(ModerationReason.SPAM);
      expect(res.body.removedAt).toBeDefined();
      expect(res.body.removedByUserId).toBe(adminUser.id);

      // Verify AuditLog record in database
      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          action: 'comment.removed',
          resourceId: commentToModerate,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditEntry).toBeDefined();
      expect(auditEntry?.actorId).toBe(adminUser.id);
      expect(auditEntry?.metadata).toMatchObject({
        reason: ModerationReason.SPAM,
      });
      // CRITICAL PRIVACY ASSERTION: Body text MUST NOT be in audit log metadata
      expect((auditEntry?.metadata as any)?.body).toBeUndefined();
    });

    it('4. Moderated comment is completely hidden from public lists and counts', async () => {
      currentUserInjected = null;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .expect(200);

      const found = res.body.items.find((c: any) => c.id === commentToModerate);
      expect(found).toBeUndefined(); // Completely absent, no tombstones
    });

    it('5. Author cannot edit a comment that has been removed by admin (409 Conflict)', async () => {
      currentUserInjected = {
        id: authorUser2.id,
        email: authorUser2.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      await request(app.getHttpServer())
        .patch(`/api/v1/comments/${commentToModerate}`)
        .send({ body: 'Attempting to revive moderated comment.' })
        .expect(409);
    });

    it('6. Admin API redacts expired removed comment bodies (>30 days)', async () => {
      // Create a comment removed 35 days ago
      const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      const expiredComment = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Secret offensive content from 35 days ago',
          status: CommentStatus.REMOVED,
          removedAt: thirtyFiveDaysAgo,
          removedByUserId: adminUser.id,
          removalReason: ModerationReason.HARASSMENT,
        },
      });

      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-e2e',
      };

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/comments?status=REMOVED')
        .expect(200);

      const target = res.body.items.find((c: any) => c.id === expiredComment.id);
      expect(target).toBeDefined();
      expect(target.body).toBe(''); // Body redacted in API response!
      expect(target.isRetentionExpired).toBe(true);
      expect(target.removalReason).toBe(ModerationReason.HARASSMENT);
    });

    it('7. Moderation cleanup maintenance command scrubs expired bodies in database', async () => {
      const cleanupService = app.get(ModerationCleanupService);

      // Verify dry run
      const dryResult = await cleanupService.runCleanup({ dryRun: true });
      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.scrubbedCount).toBeGreaterThanOrEqual(1);

      // Execute actual batch scrubbing
      const scrubResult = await cleanupService.runCleanup({ dryRun: false });
      expect(scrubResult.dryRun).toBe(false);
      expect(scrubResult.scrubbedCount).toBeGreaterThanOrEqual(1);

      // Confirm in database that expired rows now have empty body
      const scrubbedRows = await prisma.articleComment.findMany({
        where: {
          status: CommentStatus.REMOVED,
          removedAt: { lte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      });

      for (const row of scrubbedRows) {
        expect(row.body).toBe('');
      }
    });

    it('8. Database CHECK constraint enforces conditional body length and display name length', async () => {
      // Direct raw SQL test on disposable database:
      // A. Empty body on VISIBLE comment is rejected by PostgreSQL CHECK constraint chk_article_comments_body_len
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO article_comments (id, article_id, snapshot_id, user_id, body, status)
          VALUES (gen_random_uuid(), '${publishedArticle.id}', '${publishedArticle.currentSnapshotId}', '${authorUser1.id}', '', 'VISIBLE');
        `),
      ).rejects.toThrow();

      // B. Empty body on REMOVED comment is permitted by PostgreSQL CHECK constraint chk_article_comments_body_len
      const removedId = crypto.randomUUID();
      await prisma.$executeRawUnsafe(`
        INSERT INTO article_comments (id, article_id, snapshot_id, user_id, body, status, removed_at, removal_reason)
        VALUES ('${removedId}', '${publishedArticle.id}', '${publishedArticle.currentSnapshotId}', '${authorUser1.id}', '', 'REMOVED', NOW(), 'SPAM');
      `);
      const inserted = await prisma.articleComment.findUnique({ where: { id: removedId } });
      expect(inserted).toBeDefined();
      expect(inserted?.body).toBe('');
      expect(inserted?.status).toBe(CommentStatus.REMOVED);

      // C. UserProfile display_name < 2 chars is rejected by chk_user_profiles_display_name_len
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO user_profiles (id, user_id, display_name)
          VALUES (gen_random_uuid(), '${crypto.randomUUID()}', 'X');
        `),
      ).rejects.toThrow();
    });

    it('9. Moderation cleanup maintenance command is strictly idempotent on repeat executions', async () => {
      const cleanupService = app.get(ModerationCleanupService);

      // Run 2: Since all expired comments were scrubbed in test 7 and 8, running cleanup again must find 0 remaining
      const repeatResult = await cleanupService.runCleanup({ dryRun: false });
      expect(repeatResult.dryRun).toBe(false);
      expect(repeatResult.scrubbedCount).toBe(0);
    });

    it('10. CORS preflight verification on public comment endpoints', async () => {
      // 1. Authorized origin receives CORS headers
      const resAllowed = await request(app.getHttpServer())
        .options(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'http://localhost:4200')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(resAllowed.headers['access-control-allow-origin']).toBe('http://localhost:4200');
      expect(resAllowed.headers['access-control-allow-credentials']).toBe('true');

      // 2. Unauthorized cross-origin is denied CORS access headers
      const resDenied = await request(app.getHttpServer())
        .options(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'http://malicious-attacker.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(resDenied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('F. Server-Side Origin & CSRF Mutation Security Matrix (P9-B1)', () => {
    let testComment: { id: string; body: string };

    beforeAll(async () => {
      testComment = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Security baseline comment text for CSRF testing.',
          status: CommentStatus.VISIBLE,
        },
      });
    });

    it('Test A — Approved origin: Valid authenticated mutation succeeds from trusted frontend origin', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-a',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Legitimate comment from trusted frontend origin.' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.body).toBe('Legitimate comment from trusted frontend origin.');
    });

    it('Test B — Untrusted external origin: Rejected on all 5 mutation routes with 0 database mutations', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-b',
      };

      const auditCountBefore = await prisma.auditLog.count();
      const commentCountBefore = await prisma.articleComment.count();

      // 1. PUT /api/v1/account/profile
      await request(app.getHttpServer())
        .put('/api/v1/account/profile')
        .set('Origin', 'https://malicious.example')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ displayName: 'Hacked Name' })
        .expect(403);

      // 2. POST /api/v1/articles/public/:slug/comments
      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'https://malicious.example')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Malicious CSRF comment.' })
        .expect(403);

      // 3. PATCH /api/v1/comments/:commentId
      await request(app.getHttpServer())
        .patch(`/api/v1/comments/${testComment.id}`)
        .set('Origin', 'https://malicious.example')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Tampered comment body.' })
        .expect(403);

      // 4. DELETE /api/v1/comments/:commentId
      await request(app.getHttpServer())
        .delete(`/api/v1/comments/${testComment.id}`)
        .set('Origin', 'https://malicious.example')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .expect(403);

      // Verify zero mutations in database
      const auditCountAfter = await prisma.auditLog.count();
      const commentCountAfter = await prisma.articleComment.count();
      expect(auditCountAfter).toBe(auditCountBefore);
      expect(commentCountAfter).toBe(commentCountBefore);

      const unchangedComment = await prisma.articleComment.findUnique({ where: { id: testComment.id } });
      expect(unchangedComment?.body).toBe('Security baseline comment text for CSRF testing.');
      expect(unchangedComment?.status).toBe(CommentStatus.VISIBLE);
    });

    it('Test C — Same-site untrusted origin: Rejected with 0 database mutations (e.g. localhost:4300)', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-c',
      };

      const commentCountBefore = await prisma.articleComment.count();

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'http://localhost:4300')
        .set('Host', 'localhost:4300')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Same-site untrusted origin attack.' })
        .expect(403);

      const commentCountAfter = await prisma.articleComment.count();
      expect(commentCountAfter).toBe(commentCountBefore);
    });

    it('Test D — Null origin: Sandboxed iframe origin rejected with 403 and 0 database mutations', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-d',
      };

      const commentCountBefore = await prisma.articleComment.count();

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'null')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Sandboxed null origin attack.' })
        .expect(403);

      const commentCountAfter = await prisma.articleComment.count();
      expect(commentCountAfter).toBe(commentCountBefore);
    });

    it('Test E — Missing Origin: Cookie-authenticated state-changing mutation blocked', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-e',
      };

      const commentCountBefore = await prisma.articleComment.count();

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Missing origin attack.' })
        .expect(403);

      const commentCountAfter = await prisma.articleComment.count();
      expect(commentCountAfter).toBe(commentCountBefore);
    });

    it('Test F — Malformed Origin: Invalid scheme and unparseable origins rejected with 403', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-f',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'not-a-valid-url')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Malformed origin attack.' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/articles/public/${publishedArticle.publishedSlug}/comments`)
        .set('Origin', 'file:///etc/passwd')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ body: 'Unsupported scheme attack.' })
        .expect(403);
    });

    it('Test H — ADMIN mutation: Untrusted origin rejected with 403, 0 status mutations, 0 audit events', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-admin',
      };

      const auditCountBefore = await prisma.auditLog.count();

      await request(app.getHttpServer())
        .post(`/api/v1/admin/comments/${testComment.id}/remove`)
        .set('Origin', 'https://malicious.example')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ reason: ModerationReason.SPAM })
        .expect(403);

      const unchangedComment = await prisma.articleComment.findUnique({ where: { id: testComment.id } });
      expect(unchangedComment?.status).toBe(CommentStatus.VISIBLE);

      const auditCountAfter = await prisma.auditLog.count();
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('Test I — Authorization matrix preserved: Trusted origin still enforces role checks', async () => {
      currentUserInjected = {
        id: authorUser1.id,
        email: authorUser1.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-csrf-author',
      };

      // Author with approved origin trying to call ADMIN endpoint is rejected with 403 Forbidden
      await request(app.getHttpServer())
        .post(`/api/v1/admin/comments/${testComment.id}/remove`)
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', `${ACCESS_COOKIE_NAME}=valid-session-jwt`)
        .send({ reason: ModerationReason.SPAM })
        .expect(403);
    });
  });

  describe('G. Real Retention CLI Entry Point Verification', () => {
    let expiredCliCommentId: string;
    let unexpiredCliCommentId: string;
    let visibleCliCommentId: string;

    beforeAll(async () => {
      // Fixture 1: Expired removed comment (>30 days)
      const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      const expired = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Offensive comment text to be scrubbed by real CLI.',
          status: CommentStatus.REMOVED,
          removedAt: thirtyFiveDaysAgo,
          removedByUserId: adminUser.id,
          removalReason: ModerationReason.SPAM,
        },
      });
      expiredCliCommentId = expired.id;

      // Fixture 2: Unexpired removed comment (<30 days)
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const unexpired = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Recent removal text to remain preserved by real CLI.',
          status: CommentStatus.REMOVED,
          removedAt: fiveDaysAgo,
          removedByUserId: adminUser.id,
          removalReason: ModerationReason.HARASSMENT,
        },
      });
      unexpiredCliCommentId = unexpired.id;

      // Fixture 3: Visible comment
      const visible = await prisma.articleComment.create({
        data: {
          articleId: publishedArticle.id,
          snapshotId: publishedArticle.currentSnapshotId,
          userId: authorUser1.id,
          body: 'Active visible comment to remain untouched by real CLI.',
          status: CommentStatus.VISIBLE,
        },
      });
      visibleCliCommentId = visible.id;
    });

    it('Phase A — Dry-run: Executes pnpm --filter api cleanup:moderated-comments --dry-run without modifying DB', () => {
      const dryRes = spawnSync(
        'pnpm',
        ['--filter', 'api', 'cleanup:moderated-comments', '--dry-run'],
        {
          env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
          encoding: 'utf8',
          shell: true,
        },
      );

      expect(dryRes.status).toBe(0);
      expect(dryRes.stdout).toContain('[Dry Run]');
      expect(dryRes.stdout).toContain('expired comments eligible for body scrubbing');

      // Verify DB body was NOT scrubbed
      const row = runAdminPsql(
        `SELECT body FROM article_comments WHERE id = '${expiredCliCommentId}';`,
        disposableDbName,
      );
      expect(row).toContain('Offensive comment text to be scrubbed');
    });

    it('Phase B — Active cleanup: Executes pnpm --filter api cleanup:moderated-comments and scrubs expired bodies', async () => {
      const activeRes = spawnSync(
        'pnpm',
        ['--filter', 'api', 'cleanup:moderated-comments'],
        {
          env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
          encoding: 'utf8',
          shell: true,
        },
      );

      expect(activeRes.status).toBe(0);
      expect(activeRes.stdout).toContain('[Cleanup Complete]');
      expect(activeRes.stdout).toContain('Successfully scrubbed');

      // 1. Expired comment body scrubbed to empty string
      const expiredRow = runAdminPsql(
        `SELECT body, status, removal_reason FROM article_comments WHERE id = '${expiredCliCommentId}';`,
        disposableDbName,
      );
      expect(expiredRow).toContain('REMOVED');
      expect(expiredRow).toContain('SPAM');
      // Body is empty
      const expiredPrisma = await prisma.articleComment.findUnique({ where: { id: expiredCliCommentId } });
      expect(expiredPrisma).toMatchObject({
        body: '',
        status: CommentStatus.REMOVED,
        removalReason: ModerationReason.SPAM,
      });

      // 2. Unexpired comment body preserved
      const unexpiredPrisma = await prisma.articleComment.findUnique({ where: { id: unexpiredCliCommentId } });
      expect(unexpiredPrisma).toMatchObject({
        body: 'Recent removal text to remain preserved by real CLI.',
        status: CommentStatus.REMOVED,
      });

      // 3. Visible comment body untouched
      const visiblePrisma = await prisma.articleComment.findUnique({ where: { id: visibleCliCommentId } });
      expect(visiblePrisma).toMatchObject({
        body: 'Active visible comment to remain untouched by real CLI.',
        status: CommentStatus.VISIBLE,
      });
    });

    it('Phase C — Idempotency: Running real CLI cleanup second time yields 0 scrubbed', () => {
      const secondRes = spawnSync(
        'pnpm',
        ['--filter', 'api', 'cleanup:moderated-comments'],
        {
          env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
          encoding: 'utf8',
          shell: true,
        },
      );

      expect(secondRes.status).toBe(0);
      expect(secondRes.stdout).toContain('Successfully scrubbed 0 expired comment bodies');
    });

    it('Phase D — Forbidden target rejection: Fails loud on protected primary database or bypass flags', () => {
      // 1. Primary DB target rejected
      expect(() => {
        assertDatabaseSafe(
          'postgresql://academy_dev_user:pass@127.0.0.1:5432/bachina_labs_academy',
          [],
        );
      }).toThrow(/Refusing to run cleanup against protected primary database/);

      // 2. Bypass flags rejected
      expect(() => {
        assertDatabaseSafe(disposableMigrationUrl, ['--force-primary']);
      }).toThrow(/Attempted bypass flag "--force-primary" is strictly forbidden/);

      expect(() => {
        assertDatabaseSafe(disposableMigrationUrl, ['--allow-production']);
      }).toThrow(/Attempted bypass flag "--allow-production" is strictly forbidden/);

      expect(() => {
        assertDatabaseSafe(disposableMigrationUrl, ['--bypass']);
      }).toThrow(/Attempted bypass flag "--bypass" is strictly forbidden/);
    });
  });
});
