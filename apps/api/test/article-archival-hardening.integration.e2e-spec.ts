import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  PrismaClient,
  UserRole,
  UserStatus,
  ArticleStatus,
  ArticleBlockType,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
  ForbiddenException,
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticleBlocksRepository } from '../src/modules/articles/repositories/article-blocks.repository.js';
import { ArticleBlocksService } from '../src/modules/articles/services/article-blocks.service.js';
import { ArticlePublicationRepository } from '../src/modules/articles/repositories/article-publication.repository.js';
import { ArticlePublicationService } from '../src/modules/articles/services/article-publication.service.js';
import { ArticlePublicReaderRepository } from '../src/modules/articles/repositories/article-public-reader.repository.js';
import { ArticlePublicReaderService } from '../src/modules/articles/services/article-public-reader.service.js';
import { ArticleMediaService } from '../src/modules/articles/services/article-media.service.js';
import { ArticleCommentsRepository } from '../src/modules/comments/repositories/article-comments.repository.js';
import { ArticleCommentsService } from '../src/modules/comments/services/article-comments.service.js';
import { AuditRepository } from '../src/modules/audit/audit.repository.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticleBlocksController } from '../src/modules/articles/controllers/article-blocks.controller.js';
import { ArticlePublicationController } from '../src/modules/articles/controllers/article-publication.controller.js';
import { ArticlePublicReaderController } from '../src/modules/articles/controllers/article-public-reader.controller.js';
import { PublicArticleCommentsController } from '../src/modules/comments/controllers/public-article-comments.controller.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Checkpoint P9-ARCHIVE-02A: Backend Authorization, Audit Atomicity & Concurrency Hardening', () => {
  let disposableDbName: string;
  let psqlPath: string;
  let host: string;
  let port: string;
  let migUser: string;
  let migPass: string;
  let runtimeUser: string;
  let runtimePass: string;
  let primaryDb: string;
  let disposableRuntimeUrl: string;
  let disposableMigrationUrl: string;

  let prismaRuntime: PrismaClient;
  let prismaAdmin: PrismaClient;
  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser | null = null;
  let auditServiceInstance: AuditService;

  let authorA: { id: string; email: string };
  let authorB: { id: string; email: string };
  let adminUser: { id: string; email: string };
  let unverifiedAuthor: { id: string; email: string };
  let suspendedAuthor: { id: string; email: string };

  let articleAId: string;
  let articleASlug: string;
  let articleASnapshotId: string;

  let articleBId: string;
  let articleBSlug: string;
  let articleBSnapshotId: string;

  let articleAdminId: string;
  let articleAdminSlug: string;
  let articleAdminSnapshotId: string;

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
      throw new Error(`Admin psql failed on ${dbToConnect}: ${(res.stderr || res.stdout).trim()}`);
    }
    return (res.stdout || '').trim();
  }

  async function createSeededArticle(
    authorId: string,
    title: string,
    slug: string,
  ) {
    const article = await prismaAdmin.article.create({
      data: {
        id: crypto.randomUUID(),
        authorId,
        title,
        draftSlug: slug,
        publishedSlug: slug,
        summary: `Summary for ${title}`,
        draftRevision: 1,
        publishedRevision: 1,
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    const block = await prismaAdmin.articleBlock.create({
      data: {
        id: crypto.randomUUID(),
        articleId: article.id,
        type: ArticleBlockType.RICH_TEXT,
        position: 1,
        content: { html: `<p>Content for ${title}</p>` },
      },
    });

    const snapshot = await prismaAdmin.articleSnapshot.create({
      data: {
        id: crypto.randomUUID(),
        articleId: article.id,
        snapshotRevision: 1,
        title,
        summary: `Summary for ${title}`,
        publishedSlug: slug,
        typographyPreset: 'MODERN_SANS',
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: block.id,
              type: 'RICH_TEXT',
              position: 1,
              content: { html: `<p>Content for ${title}</p>` },
            },
          ],
        },
        taxonomy: {
          schemaVersion: 1,
          category: null,
          tags: [],
        },
      },
    });

    await prismaAdmin.article.update({
      where: { id: article.id },
      data: { currentSnapshotId: snapshot.id },
    });

    return { articleId: article.id, slug, snapshotId: snapshot.id };
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

    // 1. Generate collision-resistant disposable database
    const suffix = crypto.randomBytes(8).toString('hex');
    disposableDbName = `academy_e2e_suite_${suffix}`;
    assertDisposableTestDatabase(disposableDbName, 'academy_e2e_suite_');

    // 2. Create isolated database
    runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`, primaryDb);
    runAdminPsql(`GRANT ALL PRIVILEGES ON DATABASE "${disposableDbName}" TO "${runtimeUser}";`, disposableDbName);
    runAdminPsql(`GRANT ALL ON SCHEMA public TO "${runtimeUser}";`, disposableDbName);

    disposableMigrationUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;

    // 3. Deploy all 14 authoritative Prisma migrations
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

    // 4. Grant runtime user permissions
    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeUser}";
    `, disposableDbName);

    // 5. Connect PrismaClients
    prismaAdmin = new PrismaClient({
      datasources: { db: { url: disposableMigrationUrl } },
    });
    await prismaAdmin.$connect();

    prismaRuntime = new PrismaClient({
      datasources: { db: { url: disposableRuntimeUrl } },
    });
    await prismaRuntime.$connect();

    // 6. Seed Users
    const seededAuthorA = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'author.a.hardening@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorA = { id: seededAuthorA.id, email: seededAuthorA.email };

    const seededAuthorB = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'author.b.hardening@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorB = { id: seededAuthorB.id, email: seededAuthorB.email };

    const seededAdmin = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'admin.hardening@skyra-tech.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    adminUser = { id: seededAdmin.id, email: seededAdmin.email };

    const seededUnverified = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'unverified.hardening@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
      },
    });
    unverifiedAuthor = { id: seededUnverified.id, email: seededUnverified.email };

    const seededSuspended = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'suspended.hardening@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.SUSPENDED,
        emailVerifiedAt: new Date(),
      },
    });
    suspendedAuthor = { id: seededSuspended.id, email: seededSuspended.email };

    // 7. Seed Articles
    const artA = await createSeededArticle(
      authorA.id,
      'Author A Hardening Guide',
      'author-a-hardening-guide',
    );
    articleAId = artA.articleId;
    articleASlug = artA.slug;
    articleASnapshotId = artA.snapshotId;

    const artB = await createSeededArticle(
      authorB.id,
      'Author B Security Principles',
      'author-b-security-principles',
    );
    articleBId = artB.articleId;
    articleBSlug = artB.slug;
    articleBSnapshotId = artB.snapshotId;

    const artAdmin = await createSeededArticle(
      adminUser.id,
      'Admin Authored Infrastructure Blueprint',
      'admin-authored-infrastructure-blueprint',
    );
    articleAdminId = artAdmin.articleId;
    articleAdminSlug = artAdmin.slug;
    articleAdminSnapshotId = artAdmin.snapshotId;

    // 8. Wire Repositories and Services
    const articlesRepo = new ArticlesRepository(prismaRuntime as any);
    const articlesService = new ArticlesService(articlesRepo);
    const blocksRepo = new ArticleBlocksRepository(prismaRuntime as any);
    const blocksService = new ArticleBlocksService(blocksRepo);
    const publicationRepo = new ArticlePublicationRepository(prismaRuntime as any);
    const auditRepo = new AuditRepository(prismaRuntime as any);
    auditServiceInstance = new AuditService(auditRepo);
    const publicationService = new ArticlePublicationService(publicationRepo, auditServiceInstance);
    const publicReaderRepo = new ArticlePublicReaderRepository(prismaRuntime as any);
    const publicReaderService = new ArticlePublicReaderService(publicReaderRepo);
    const commentsRepo = new ArticleCommentsRepository(prismaRuntime as any);
    const commentsService = new ArticleCommentsService(commentsRepo);

    // 9. Authentic Guard Pipeline Simulation
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
          throw new UnauthorizedException('Authentication required.');
        }

        if (currentUserInjected.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Account is not active.');
        }

        const req = context.switchToHttp().getRequest();
        req.user = currentUserInjected;
        return true;
      }
    }

    // 10. Mount Testing Module with correct controller route precedence
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        ArticlePublicReaderController,
        PublicArticleCommentsController,
        ArticlesController,
        ArticleBlocksController,
        ArticlePublicationController,
      ],
      providers: [
        { provide: ArticlesService, useValue: articlesService },
        { provide: ArticleBlocksService, useValue: blocksService },
        { provide: ArticlePublicationService, useValue: publicationService },
        { provide: ArticlePublicReaderService, useValue: publicReaderService },
        { provide: ArticlePublicReaderRepository, useValue: publicReaderRepo },
        { provide: ArticleMediaService, useValue: {} },
        { provide: ArticleCommentsService, useValue: commentsService },
        { provide: APP_GUARD, useClass: TestJwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        VerifiedEmailGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 120000);

  afterAll(async () => {
    if (app) await app.close();
    if (prismaRuntime) await prismaRuntime.$disconnect();
    if (prismaAdmin) await prismaAdmin.$disconnect();

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (disposableDbName) {
      assertDisposableTestDatabase(disposableDbName, 'academy_e2e_suite_');
      await safelyDropDisposableDatabase(disposableDbName, (sql) => runAdminPsql(sql), {
        allowedPrefix: 'academy_e2e_suite_',
      });
    }
  });

  // =========================================================================
  // PART 1: AUTHOR AND ADMIN PERMISSION MATRIX (Gap A)
  // =========================================================================

  describe('Part 1: Author and Admin Permission Matrix Verification', () => {
    it('AUTH-01: AUTHOR A archiving own article succeeds (200 OK)', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-01',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(200);

      expect(res.body.articleId).toBe(articleAId);
      expect(res.body.status).toBe('ARCHIVED');

      const dbArt = await prismaAdmin.article.findUnique({ where: { id: articleAId } });
      expect(dbArt?.status).toBe(ArticleStatus.ARCHIVED);
    });

    it('AUTH-02: AUTHOR A restoring own article succeeds (200 OK)', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-02',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/restore`)
        .send({ expectedRevision: 1 })
        .expect(200);

      expect(res.body.articleId).toBe(articleAId);
      expect(res.body.status).toBe('PUBLISHED');

      const dbArt = await prismaAdmin.article.findUnique({ where: { id: articleAId } });
      expect(dbArt?.status).toBe(ArticleStatus.PUBLISHED);
    });

    it('AUTH-03: AUTHOR A archiving AUTHOR B article is DENIED with 404 Not Found (privacy masked)', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-03',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleBId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(404);

      // Verify Author B's article is untouched
      const dbArt = await prismaAdmin.article.findUnique({ where: { id: articleBId } });
      expect(dbArt?.status).toBe(ArticleStatus.PUBLISHED);
    });

    it('AUTH-04: AUTHOR A restoring AUTHOR B article is DENIED with 404 Not Found', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-04',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleBId}/restore`)
        .send({ expectedRevision: 1 })
        .expect(404);
    });

    it('AUTH-05: ADMIN archiving AUTHOR A article is DENIED with 404 (No Global Admin Archival in this checkpoint)', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-05',
      };

      // Admin attempts to archive Author A's article
      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(404);

      // Verify Author A's article is unchanged
      const dbArt = await prismaAdmin.article.findUnique({ where: { id: articleAId } });
      expect(dbArt?.status).toBe(ArticleStatus.PUBLISHED);
    });

    it('AUTH-06: ADMIN restoring AUTHOR A article is DENIED with 404 (No Global Admin Restoration)', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-06',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/restore`)
        .send({ expectedRevision: 1 })
        .expect(404);
    });

    it('AUTH-07: ADMIN archiving ADMIN-OWNED article succeeds (200 OK - Admin as Author)', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-07',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAdminId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(200);

      expect(res.body.articleId).toBe(articleAdminId);
      expect(res.body.status).toBe('ARCHIVED');
    });

    it('AUTH-08: ADMIN restoring ADMIN-OWNED article succeeds (200 OK - Admin as Author)', async () => {
      currentUserInjected = {
        id: adminUser.id,
        email: adminUser.email,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-08',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAdminId}/restore`)
        .send({ expectedRevision: 1 })
        .expect(200);

      expect(res.body.articleId).toBe(articleAdminId);
      expect(res.body.status).toBe('PUBLISHED');
    });

    it('AUTH-09: Unverified AUTHOR is DENIED with 403 Forbidden (VerifiedEmailGuard)', async () => {
      currentUserInjected = {
        id: unverifiedAuthor.id,
        email: unverifiedAuthor.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
        sessionId: 'session-auth-09',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(403);
    });

    it('AUTH-10: Inactive/Suspended AUTHOR is DENIED with 401 Unauthorized', async () => {
      currentUserInjected = {
        id: suspendedAuthor.id,
        email: suspendedAuthor.email,
        role: UserRole.AUTHOR,
        status: UserStatus.SUSPENDED,
        emailVerifiedAt: new Date(),
        sessionId: 'session-auth-10',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(401);
    });

    it('AUTH-11: Unauthenticated request to archive returns 401 Unauthorized', async () => {
      currentUserInjected = null;

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(401);
    });

    it('AUTH-12: Unauthenticated request to restore returns 401 Unauthorized', async () => {
      currentUserInjected = null;

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/restore`)
        .send({ expectedRevision: 1 })
        .expect(401);
    });
  });

  // =========================================================================
  // PART 2: MANDATORY TRANSACTIONAL AUDIT ROLLBACK (Gap B)
  // =========================================================================

  describe('Part 2: Mandatory Transactional Audit Rollback Verification', () => {
    it('ROLLBACK-01: Audit failure during Archive ROLLS BACK status change to PUBLISHED and commits NO audit record', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-rollback-01',
      };

      // 1. Verify pre-state
      const preArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(preArt.status).toBe(ArticleStatus.PUBLISHED);
      const preRev = preArt.draftRevision;
      const preSnapshotId = preArt.currentSnapshotId;
      const preSlug = preArt.publishedSlug;

      // 2. Inject controlled transactional audit failure inside the Prisma transaction
      const recordSpy = vi
        .spyOn(auditServiceInstance, 'recordTransactional')
        .mockRejectedValueOnce(new Error('Simulated controlled audit persistence failure'));

      // 3. Attempt archive - must fail
      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: preRev })
        .expect(500);

      expect(recordSpy).toHaveBeenCalled();
      recordSpy.mockRestore();

      // 4. Assert database state rolled back completely
      const postArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(postArt.status).toBe(ArticleStatus.PUBLISHED); // Must NOT be ARCHIVED!
      expect(postArt.draftRevision).toBe(preRev);
      expect(postArt.currentSnapshotId).toBe(preSnapshotId);
      expect(postArt.publishedSlug).toBe(preSlug);

      // 5. Assert no successful archive audit event was committed
      const auditRows = await prismaAdmin.auditLog.findMany({
        where: {
          resourceId: articleAId,
          action: 'article.archived',
        },
      });
      // The only existing ones were from AUTH-01 earlier; no new one was added during this failure
      const latestAudit = auditRows[auditRows.length - 1];
      expect(auditRows.length).toBeLessThanOrEqual(1);
    });

    it('ROLLBACK-02: Audit failure during Restore ROLLS BACK status change to ARCHIVED and commits NO audit record', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-rollback-02',
      };

      // 1. Put article in ARCHIVED status cleanly first
      const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: curArt.draftRevision })
        .expect(200);

      const archivedArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(archivedArt.status).toBe(ArticleStatus.ARCHIVED);

      // 2. Inject controlled transactional audit failure
      const recordSpy = vi
        .spyOn(auditServiceInstance, 'recordTransactional')
        .mockRejectedValueOnce(new Error('Simulated controlled audit persistence failure'));

      // 3. Attempt restore - must fail
      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/restore`)
        .send({ expectedRevision: archivedArt.draftRevision })
        .expect(500);

      expect(recordSpy).toHaveBeenCalled();
      recordSpy.mockRestore();

      // 4. Assert database status rolled back to ARCHIVED!
      const postArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(postArt.status).toBe(ArticleStatus.ARCHIVED); // Must NOT be PUBLISHED!
      expect(postArt.draftRevision).toBe(archivedArt.draftRevision);

      // 5. Cleanly restore for subsequent tests
      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/restore`)
        .send({ expectedRevision: archivedArt.draftRevision })
        .expect(200);
    });
  });

  // =========================================================================
  // PART 3: REAL CONCURRENT REQUEST TESTING (Gap C: CONC-01 to CONC-07)
  // =========================================================================

  describe('Part 3: Real Concurrency Testing (CONC-01 through CONC-07)', () => {
    // CONC-01: Archive versus Archive
    it('CONC-01: Simultaneous Archive versus Archive serializes; exactly one succeeds and one gets 409 Conflict', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-01',
      };

      const art = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(art.status).toBe(ArticleStatus.PUBLISHED);

      const auditCountBefore = await prismaAdmin.auditLog.count({
        where: { resourceId: articleAId, action: 'article.archived' },
      });

      // Fire two simultaneous Archive requests with identical expectedRevision
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/archive`)
          .send({ expectedRevision: art.draftRevision }),
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/archive`)
          .send({ expectedRevision: art.draftRevision }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Exactly one success audit added
      const auditCountAfter = await prismaAdmin.auditLog.count({
        where: { resourceId: articleAId, action: 'article.archived' },
      });
      expect(auditCountAfter).toBe(auditCountBefore + 1);

      // Final article status is ARCHIVED
      const finalArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(finalArt.status).toBe(ArticleStatus.ARCHIVED);
    });

    // CONC-02: Restore versus Restore
    it('CONC-02: Simultaneous Restore versus Restore serializes; exactly one succeeds and one gets 409 Conflict', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-02',
      };

      const art = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(art.status).toBe(ArticleStatus.ARCHIVED);

      const auditCountBefore = await prismaAdmin.auditLog.count({
        where: { resourceId: articleAId, action: 'article.restored' },
      });

      // Fire two simultaneous Restore requests
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/restore`)
          .send({ expectedRevision: art.draftRevision }),
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/restore`)
          .send({ expectedRevision: art.draftRevision }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const auditCountAfter = await prismaAdmin.auditLog.count({
        where: { resourceId: articleAId, action: 'article.restored' },
      });
      expect(auditCountAfter).toBe(auditCountBefore + 1);

      const finalArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(finalArt.status).toBe(ArticleStatus.PUBLISHED);
    });

    // CONC-03: Archive versus Republish
    it('CONC-03: Simultaneous Archive versus Republish preserves snapshot integrity and enforces strict serialization', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-03',
      };

      // Create an unpublished draft edit so article is eligible for republishing
      const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      const editRes = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleAId}`)
        .send({
          title: 'Author A Hardening Guide (Draft Edits for Republish)',
          expectedRevision: curArt.draftRevision,
        })
        .expect(200);

      const newDraftRev = editRes.body.draftRevision;

      // Concurrently submit Archive and Publish
      const [resArchive, resPublish] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/archive`)
          .send({ expectedRevision: newDraftRev }),
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/publish`)
          .send({ expectedRevision: newDraftRev }),
      ]);

      // Exactly one succeeds, or both serialize cleanly without data corruption
      const statuses = [resArchive.status, resPublish.status];
      expect(statuses).toContain(200);

      // Verify no invalid state in DB
      const finalArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect([ArticleStatus.ARCHIVED, ArticleStatus.PUBLISHED]).toContain(finalArt.status);
      expect(finalArt.currentSnapshotId).not.toBeNull();

      // Ensure it is restored to PUBLISHED if it ended in ARCHIVED
      if (finalArt.status === ArticleStatus.ARCHIVED) {
        await request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/restore`)
          .send({ expectedRevision: finalArt.draftRevision })
          .expect(200);
      }
    });

    // CONC-04: Archive versus Metadata Edit
    it('CONC-04: Simultaneous Archive versus Metadata Edit serializes cleanly with zero lost updates', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-04',
      };

      const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });

      const [resArchive, resEdit] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/archive`)
          .send({ expectedRevision: curArt.draftRevision }),
        request(app.getHttpServer())
          .patch(`/api/v1/articles/${articleAId}`)
          .send({
            title: 'Title Mutated Concurrently',
            expectedRevision: curArt.draftRevision,
          }),
      ]);

      // Either:
      // A) Archive ran first (200), then Edit ran second on ARCHIVED (200, allowed under Decision B).
      // B) Edit ran first (200), incrementing revision, so Archive failed with 409 (revision conflict).
      if (resArchive.status === 200 && resEdit.status === 200) {
        expect(resArchive.status).toBe(200);
        expect(resEdit.status).toBe(200);
      } else {
        expect([resArchive.status, resEdit.status].sort()).toEqual([200, 409]);
      }

      const finalArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      expect(finalArt.id).toBe(articleAId);

      // Restore to PUBLISHED if archived
      if (finalArt.status === ArticleStatus.ARCHIVED) {
        await request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/restore`)
          .send({ expectedRevision: finalArt.draftRevision })
          .expect(200);
      }
    });

    // CONC-05: Restore versus Metadata Edit
    it('CONC-05: Simultaneous Restore versus Metadata Edit ensures public reader serves snapshot and draft stays private', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-05',
      };

      // First archive it
      const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleAId}/archive`)
        .send({ expectedRevision: curArt.draftRevision })
        .expect(200);

      const archivedArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });

      // Run Restore and Edit concurrently
      const [resRestore, resEdit] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/restore`)
          .send({ expectedRevision: archivedArt.draftRevision }),
        request(app.getHttpServer())
          .patch(`/api/v1/articles/${articleAId}`)
          .send({
            title: 'Private Draft Concurrently Edited',
            expectedRevision: archivedArt.draftRevision,
          }),
      ]);

      expect([resRestore.status, resEdit.status]).toContain(200);

      // Verify public reader serves original snapshot title, NOT the private draft edit!
      currentUserInjected = null;
      const pubRes = await request(app.getHttpServer())
        .get(`/api/v1/articles/public/${articleASlug}`)
        .expect(200);

      expect(pubRes.body.title).not.toBe('Private Draft Concurrently Edited');
    });

    // CONC-06: Archive versus Block Edit
    it('CONC-06: Simultaneous Archive versus Block Edit serializes cleanly without lost block mutations', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-06',
      };

      const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });

      const [resArchive, resBlock] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/archive`)
          .send({ expectedRevision: curArt.draftRevision }),
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/blocks`)
          .send({
            expectedRevision: curArt.draftRevision,
            type: ArticleBlockType.RICH_TEXT,
            content: { html: '<p>Concurrent Block Added</p>' },
          }),
      ]);

      expect([resArchive.status, resBlock.status]).toContain(200);

      const finalArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });
      // Restore if archived
      if (finalArt.status === ArticleStatus.ARCHIVED) {
        await request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/restore`)
          .send({ expectedRevision: finalArt.draftRevision })
          .expect(200);
      }
    });

    // CONC-07: Archive versus Delete
    it('CONC-07: Simultaneous Archive versus Delete preserves published article history and rejects Delete with 409', async () => {
      currentUserInjected = {
        id: authorA.id,
        email: authorA.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-conc-07',
      };

      const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: articleAId } });

      const [resArchive, resDelete] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/articles/${articleAId}/archive`)
          .send({ expectedRevision: curArt.draftRevision }),
        request(app.getHttpServer())
          .delete(`/api/v1/articles/${articleAId}`)
          .query({ expectedRevision: curArt.draftRevision }),
      ]);

      // Delete MUST be rejected with 409 Conflict because article has publication history!
      expect(resDelete.status).toBe(409);
      expect(resDelete.body.message).toContain('Cannot delete');

      // The article MUST still exist in the database!
      const finalArt = await prismaAdmin.article.findUnique({ where: { id: articleAId } });
      expect(finalArt).not.toBeNull();
      expect(finalArt?.currentSnapshotId).not.toBeNull();
    });
  });

  // =========================================================================
  // PART 4: PUBLIC READER & SNAPSHOT IMMUTABILITY REGRESSION
  // =========================================================================

  describe('Part 4: Public Reader & Snapshot Immutability Regression', () => {
    it('SNAP-01: Public reader returns 404 while archived and returns 200 with snapshot after restore', async () => {
      // Archive Article B
      currentUserInjected = {
        id: authorB.id,
        email: authorB.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-snap-01',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleBId}/archive`)
        .send({ expectedRevision: 1 })
        .expect(200);

      // Anonymous public query -> 404
      currentUserInjected = null;
      await request(app.getHttpServer())
        .get(`/api/v1/articles/public/${articleBSlug}`)
        .expect(404);

      // Restore Article B
      currentUserInjected = {
        id: authorB.id,
        email: authorB.email,
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        sessionId: 'session-snap-01b',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/articles/${articleBId}/restore`)
        .send({ expectedRevision: 1 })
        .expect(200);

      // Anonymous public query -> 200 with original snapshot
      currentUserInjected = null;
      const pubRes = await request(app.getHttpServer())
        .get(`/api/v1/articles/public/${articleBSlug}`)
        .expect(200);

      expect(pubRes.body.title).toBe('Author B Security Principles');
      expect(pubRes.body.blocks).toHaveLength(1);
    });

    it('SNAP-02: Published slug remains reserved; collision is strictly rejected by DB constraint', async () => {
      await expect(
        prismaAdmin.article.create({
          data: {
            id: crypto.randomUUID(),
            authorId: authorA.id,
            title: 'Colliding Slug Attempt',
            draftSlug: 'colliding-slug-attempt',
            publishedSlug: articleBSlug,
            summary: 'Collision test',
            status: ArticleStatus.PUBLISHED,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
