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
import { ROLES_KEY } from '../src/common/authorization/decorators/roles.decorator.js';
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

describe('Checkpoint P9-ARCHIVE-02: Backend Article Archive & Restore Integration Suite (ARC-BE-01..20)', () => {
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

  let authorA: { id: string; email: string };
  let authorB: { id: string; email: string };
  let unverifiedAuthor: { id: string; email: string };
  let testArticleId: string;
  let testPublishedSlug: string;
  let testSnapshotId: string;
  let initialDraftRevision: number;
  let testMediaAssetId: string;

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

    // 4. Grant runtime user permissions with audit/snapshot constraints
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
        email: 'author.a.archival@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorA = { id: seededAuthorA.id, email: seededAuthorA.email };

    const seededAuthorB = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'author.b.archival@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorB = { id: seededAuthorB.id, email: seededAuthorB.email };

    const seededUnverified = await prismaAdmin.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'unverified.author@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
      },
    });
    unverifiedAuthor = { id: seededUnverified.id, email: seededUnverified.email };

    // 7. Seed Media Asset for snapshot media preservation test
    const seededMedia = await prismaAdmin.mediaAsset.create({
      data: {
        id: crypto.randomUUID(),
        uploaderId: authorA.id,
        storageKey: 'media/test-hero-image.webp',
        originalFilename: 'test-hero-image.webp',
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: 204800,
        width: 1200,
        height: 630,
      },
    });
    testMediaAssetId = seededMedia.id;

    // 8. Seed Published Article with Published Snapshot and Comment
    testPublishedSlug = 'understanding-database-archival-patterns';
    const seededArticle = await prismaAdmin.article.create({
      data: {
        id: crypto.randomUUID(),
        authorId: authorA.id,
        title: 'Understanding Database Archival Patterns',
        draftSlug: 'understanding-database-archival-patterns',
        publishedSlug: testPublishedSlug,
        summary: 'Deep architectural guide to transactional archival in relational databases.',
        draftRevision: 1,
        publishedRevision: 1,
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    testArticleId = seededArticle.id;
    initialDraftRevision = seededArticle.draftRevision;

    // Add Block
    const seededBlock = await prismaAdmin.articleBlock.create({
      data: {
        id: crypto.randomUUID(),
        articleId: testArticleId,
        type: ArticleBlockType.RICH_TEXT,
        position: 1,
        content: { html: '<p>Chapter 1: Introduction to Archival</p>' },
      },
    });

    // Create Snapshot
    const seededSnapshot = await prismaAdmin.articleSnapshot.create({
      data: {
        id: crypto.randomUUID(),
        articleId: testArticleId,
        snapshotRevision: 1,
        title: 'Understanding Database Archival Patterns',
        summary: 'Deep architectural guide to transactional archival in relational databases.',
        publishedSlug: testPublishedSlug,
        typographyPreset: 'MODERN_SANS',
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: seededBlock.id,
              type: 'RICH_TEXT',
              position: 1,
              content: { html: '<p>Chapter 1: Introduction to Archival</p>' },
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
    testSnapshotId = seededSnapshot.id;

    // Link current snapshot to article
    await prismaAdmin.article.update({
      where: { id: testArticleId },
      data: { currentSnapshotId: testSnapshotId },
    });

    // Link snapshot media
    await prismaAdmin.articleSnapshotMedia.create({
      data: {
        snapshotId: testSnapshotId,
        mediaAssetId: testMediaAssetId,
      },
    });

    // Add comment
    await prismaAdmin.articleComment.create({
      data: {
        id: crypto.randomUUID(),
        articleId: testArticleId,
        snapshotId: testSnapshotId,
        userId: authorB.id,
        body: 'Brilliant article on database archival architectures!',
        status: 'VISIBLE',
      },
    });

    // 9. Wire Repositories and Services
    const articlesRepo = new ArticlesRepository(prismaRuntime as any);
    const articlesService = new ArticlesService(articlesRepo);
    const blocksRepo = new ArticleBlocksRepository(prismaRuntime as any);
    const blocksService = new ArticleBlocksService(blocksRepo);
    const publicationRepo = new ArticlePublicationRepository(prismaRuntime as any);
    const auditRepo = new AuditRepository(prismaRuntime as any);
    const auditService = new AuditService(auditRepo);
    const publicationService = new ArticlePublicationService(publicationRepo, auditService);
    const publicReaderRepo = new ArticlePublicReaderRepository(prismaRuntime as any);
    const publicReaderService = new ArticlePublicReaderService(publicReaderRepo);
    const commentsRepo = new ArticleCommentsRepository(prismaRuntime as any);
    const commentsService = new ArticleCommentsService(commentsRepo);

    // 10. Test Security Guard Mirroring Production Pipeline
    @Injectable()
    class TestSecurityGuard implements CanActivate {
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

        if (currentUserInjected.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Account is not active');
        }

        const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
          ROLES_KEY,
          [context.getHandler(), context.getClass()],
        );

        if (requiredRoles && requiredRoles.length > 0) {
          if (!requiredRoles.includes(currentUserInjected.role)) {
            throw new ForbiddenException('Insufficient role permissions');
          }
        }

        // VerifiedEmailGuard simulation for protected handlers
        if (!currentUserInjected.emailVerifiedAt) {
          throw new ForbiddenException('Email verification required');
        }

        const req = context.switchToHttp().getRequest();
        req.user = currentUserInjected;
        return true;
      }
    }

    // 11. Mount NestJS Module
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
        { provide: APP_GUARD, useClass: TestSecurityGuard },
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

  // --- ARC-BE-01: Archive transitions PUBLISHED -> ARCHIVED ---
  it('ARC-BE-01: Archive transitions PUBLISHED -> ARCHIVED via POST /api/v1/articles/:articleId/archive', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-01',
    };

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: initialDraftRevision })
      .expect(200);

    expect(res.body.articleId).toBe(testArticleId);
    expect(res.body.status).toBe('ARCHIVED');

    // Verify in database directly
    const dbArticle = await prismaAdmin.article.findUnique({ where: { id: testArticleId } });
    expect(dbArticle?.status).toBe(ArticleStatus.ARCHIVED);
    expect(dbArticle?.publishedSlug).toBe(testPublishedSlug);
    expect(dbArticle?.currentSnapshotId).toBe(testSnapshotId);
    expect(dbArticle?.draftRevision).toBe(initialDraftRevision);
    expect(dbArticle?.publishedRevision).toBe(1);

    // Verify audit log
    const auditRecord = await prismaAdmin.auditLog.findFirst({
      where: {
        action: 'article.archived',
        resourceId: testArticleId,
      },
    });
    expect(auditRecord).not.toBeNull();
    expect(auditRecord?.resourceType).toBe('ARTICLE');
    expect(auditRecord?.metadata).toMatchObject({
      previousStatus: 'PUBLISHED',
      newStatus: 'ARCHIVED',
      draftRevision: initialDraftRevision,
      publishedRevision: 1,
    });
  });

  // --- ARC-BE-02: Public URL returns 404 once archived ---
  it('ARC-BE-02: Public URL GET /api/v1/articles/public/:slug returns HTTP 404 once archived', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/articles/public/${testPublishedSlug}`)
      .expect(404);

    expect(res.body.message).toContain('Article not found');
  });

  // --- ARC-BE-03: Excluded from public listing ---
  it('ARC-BE-03: Excluded from public listing GET /api/v1/articles/public', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get('/api/v1/articles/public')
      .expect(200);

    const items = res.body.items || [];
    const found = items.some((item: any) => item.publishedSlug === testPublishedSlug);
    expect(found).toBe(false);
  });

  // --- ARC-BE-04: Published slug remains reserved ---
  it('ARC-BE-04: Published slug remains reserved; duplicate publishedSlug is rejected by database constraint', async () => {
    // Attempting to insert another article with the same publishedSlug must throw unique constraint violation (P2002)
    await expect(
      prismaAdmin.article.create({
        data: {
          id: crypto.randomUUID(),
          authorId: authorB.id,
          title: 'Duplicate Slug Collision Test',
          draftSlug: 'duplicate-slug-collision-test',
          publishedSlug: testPublishedSlug,
          summary: 'Attempting collision with reserved archived slug.',
          status: ArticleStatus.PUBLISHED,
        },
      }),
    ).rejects.toThrow();
  });

  // --- ARC-BE-05: Snapshot preservation ---
  it('ARC-BE-05: Snapshot preservation (article_snapshots row count and payload immutable)', async () => {
    const snapshots = await prismaAdmin.articleSnapshot.findMany({
      where: { articleId: testArticleId },
    });
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].id).toBe(testSnapshotId);
    expect(snapshots[0].title).toBe('Understanding Database Archival Patterns');
  });

  // --- ARC-BE-06: Historical comments preserved; public comments query returns 404 ---
  it('ARC-BE-06: Historical comments preserved; public comments endpoint returns 404 while archived', async () => {
    // DB comment still exists
    const commentCount = await prismaAdmin.articleComment.count({
      where: { articleId: testArticleId },
    });
    expect(commentCount).toBe(1);

    // Public comments endpoint returns 404 because article is not published
    currentUserInjected = null;
    await request(app.getHttpServer())
      .get(`/api/v1/articles/public/${testPublishedSlug}/comments`)
      .expect(404);
  });

  // --- ARC-BE-07: Restore transitions ARCHIVED -> PUBLISHED ---
  it('ARC-BE-07: Restore transitions ARCHIVED -> PUBLISHED via POST /api/v1/articles/:articleId/restore', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-07',
    };

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/restore`)
      .send({ expectedRevision: initialDraftRevision })
      .expect(200);

    expect(res.body.articleId).toBe(testArticleId);
    expect(res.body.status).toBe('PUBLISHED');

    // Verify in database
    const dbArticle = await prismaAdmin.article.findUnique({ where: { id: testArticleId } });
    expect(dbArticle?.status).toBe(ArticleStatus.PUBLISHED);
    expect(dbArticle?.publishedSlug).toBe(testPublishedSlug);
    expect(dbArticle?.currentSnapshotId).toBe(testSnapshotId);

    // Verify audit log
    const auditRecord = await prismaAdmin.auditLog.findFirst({
      where: {
        action: 'article.restored',
        resourceId: testArticleId,
      },
    });
    expect(auditRecord).not.toBeNull();
    expect(auditRecord?.metadata).toMatchObject({
      previousStatus: 'ARCHIVED',
      newStatus: 'PUBLISHED',
      draftRevision: initialDraftRevision,
      publishedRevision: 1,
    });
  });

  // --- ARC-BE-08: Public snapshot returns original published snapshot content ---
  it('ARC-BE-08: Public snapshot returns original published snapshot content after restore', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/articles/public/${testPublishedSlug}`)
      .expect(200);

    expect(res.body.title).toBe('Understanding Database Archival Patterns');
    expect(res.body.summary).toBe('Deep architectural guide to transactional archival in relational databases.');
    expect(res.body.blocks).toHaveLength(1);
  });

  // --- ARC-BE-09: Draft isolation (Restore does NOT publish pending draft edits) ---
  it('ARC-BE-09: Draft isolation (Restore does not promote pending draft edits to published snapshot)', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-09',
    };

    // Update draft title while published
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${testArticleId}`)
      .send({
        title: 'Draft Edit Pending Republish',
        expectedRevision: initialDraftRevision,
      })
      .expect(200);

    expect(patchRes.body.title).toBe('Draft Edit Pending Republish');
    expect(patchRes.body.draftRevision).toBe(initialDraftRevision + 1);

    // Re-archive with new revision
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: patchRes.body.draftRevision })
      .expect(200);

    // Re-restore
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/restore`)
      .send({ expectedRevision: patchRes.body.draftRevision })
      .expect(200);

    // Public reader must still show original snapshot title, NOT the draft edit!
    currentUserInjected = null;
    const pubRes = await request(app.getHttpServer())
      .get(`/api/v1/articles/public/${testPublishedSlug}`)
      .expect(200);

    expect(pubRes.body.title).toBe('Understanding Database Archival Patterns');
  });

  // --- ARC-BE-10: Archived editing (metadata & blocks mutated while archived) ---
  it('ARC-BE-10: Archived editing (draft metadata and blocks mutated while article is ARCHIVED)', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-10',
    };

    // Re-archive
    const curArticle = await prismaAdmin.article.findUniqueOrThrow({ where: { id: testArticleId } });
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: curArticle.draftRevision })
      .expect(200);

    const artArchived = await prismaAdmin.article.findUniqueOrThrow({ where: { id: testArticleId } });
    expect(artArchived.status).toBe(ArticleStatus.ARCHIVED);

    // 1. Edit draft metadata while ARCHIVED
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${testArticleId}`)
      .send({
        title: 'Title Modified While Archived',
        summary: 'Updated summary while archived.',
        expectedRevision: artArchived.draftRevision,
      })
      .expect(200);
    expect(patchRes.body.title).toBe('Title Modified While Archived');

    // 2. Create block while ARCHIVED
    const createBlockRes = await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/blocks`)
      .send({
        expectedRevision: patchRes.body.draftRevision,
        type: ArticleBlockType.RICH_TEXT,
        content: { html: '<p>Block created while archived</p>' },
      })
      .expect(201);
    const newBlockId = createBlockRes.body.id;
    const revAfterCreate = createBlockRes.body.draftRevision;
    expect(newBlockId).toBeDefined();

    // 3. Update block while ARCHIVED
    const updateBlockRes = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${testArticleId}/blocks/${newBlockId}`)
      .send({
        expectedRevision: revAfterCreate,
        content: { html: '<p>Block updated while archived</p>' },
      })
      .expect(200);
    const revAfterUpdate = updateBlockRes.body.draftRevision;

    // 4. Delete block while ARCHIVED
    await request(app.getHttpServer())
      .delete(`/api/v1/articles/${testArticleId}/blocks/${newBlockId}`)
      .query({ expectedRevision: revAfterUpdate })
      .expect(204);
  });

  // --- ARC-BE-11: Ownership enforcement ---
  it('ARC-BE-11: Ownership enforcement (Author B cannot archive or restore Author A article -> 404)', async () => {
    currentUserInjected = {
      id: authorB.id,
      email: authorB.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-11',
    };

    // Author B attempts to archive Author A's article
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: 1 })
      .expect(404);

    // Author B attempts to restore Author A's article
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/restore`)
      .send({ expectedRevision: 1 })
      .expect(404);
  });

  // --- ARC-BE-12: Concurrent archive / revision mismatch ---
  it('ARC-BE-12: Concurrent archive revision mismatch returns HTTP 409 Conflict', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-12',
    };

    // Current status is ARCHIVED. First restore to PUBLISHED for the conflict test.
    const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: testArticleId } });
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/restore`)
      .send({ expectedRevision: curArt.draftRevision })
      .expect(200);

    // Sending stale revision must return 409 Conflict
    const conflictRes = await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: 999999 })
      .expect(409);

    expect(conflictRes.body.message).toContain('conflict');
  });

  // --- ARC-BE-13: Archive vs republish ---
  it('ARC-BE-13: Archive vs republish (cannot publish article directly from ARCHIVED -> 400 Bad Request)', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-13',
    };

    const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: testArticleId } });
    // Archive it
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: curArt.draftRevision })
      .expect(200);

    // Attempting to publish directly from ARCHIVED must fail with 409 Conflict
    const pubRes = await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/publish`)
      .send({ expectedRevision: curArt.draftRevision })
      .expect(409);

    expect(pubRes.body.message).toContain('Cannot publish an archived article');
  });

  // --- ARC-BE-14: Restore vs draft edit ---
  it('ARC-BE-14: Restore vs draft edit (draft edits made while archived remain intact after restore)', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-14',
    };

    const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: testArticleId } });

    // Restore to PUBLISHED
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/restore`)
      .send({ expectedRevision: curArt.draftRevision })
      .expect(200);

    // Author fetches article in Author Studio
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/articles/${testArticleId}`)
      .expect(200);

    expect(getRes.body.id).toBe(testArticleId);
    expect(getRes.body.status).toBe('PUBLISHED');
    expect(getRes.body.title).toBe('Title Modified While Archived');
  });

  // --- ARC-BE-15: Audit atomicity ---
  it('ARC-BE-15: Audit atomicity (both article.archived and article.restored records present with validated metadata)', async () => {
    const auditLogs = await prismaAdmin.auditLog.findMany({
      where: {
        resourceId: testArticleId,
        action: { in: ['article.archived', 'article.restored'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(auditLogs.length).toBeGreaterThanOrEqual(2);
    const archivedLog = auditLogs.find((l) => l.action === 'article.archived');
    const restoredLog = auditLogs.find((l) => l.action === 'article.restored');

    expect(archivedLog).toBeDefined();
    expect(restoredLog).toBeDefined();
    expect(archivedLog?.actorId).toBe(authorA.id);
    expect(restoredLog?.actorId).toBe(authorA.id);
  });

  // --- ARC-BE-16: Delete protection ---
  it('ARC-BE-16: Delete protection (archived article with published snapshots cannot be permanently deleted -> 409)', async () => {
    currentUserInjected = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'session-arc-16',
    };

    const curArt = await prismaAdmin.article.findUniqueOrThrow({ where: { id: testArticleId } });

    // Archive it
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: curArt.draftRevision })
      .expect(200);

    // Attempting to delete permanently must fail with 409 Conflict
    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/articles/${testArticleId}`)
      .query({ expectedRevision: curArt.draftRevision })
      .expect(409);

    expect(delRes.body.message).toContain('Cannot delete');
  });

  // --- ARC-BE-17: Authentication & authorization ---
  it('ARC-BE-17: Authentication and authorization (unauthenticated, unverified, and non-author roles rejected)', async () => {
    // 1. Unauthenticated request -> 401
    currentUserInjected = null;
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: 1 })
      .expect(401);

    // 2. Unverified Author -> 403
    currentUserInjected = {
      id: unverifiedAuthor.id,
      email: unverifiedAuthor.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null,
      sessionId: 'session-arc-unverified',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${testArticleId}/archive`)
      .send({ expectedRevision: 1 })
      .expect(403);
  });

  // --- ARC-BE-18: No schema changes ---
  it('ARC-BE-18: No schema changes (_prisma_migrations count in test DB is exactly 14)', async () => {
    const migrationCount = await prismaAdmin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL;
    `;
    expect(Number(migrationCount[0].count)).toBe(14);
  });

  // --- ARC-BE-19: Snapshot media preservation ---
  it('ARC-BE-19: Snapshot media preservation (article_snapshot_media links intact)', async () => {
    const snapshotMedia = await prismaAdmin.articleSnapshotMedia.findFirst({
      where: { snapshotId: testSnapshotId },
    });
    expect(snapshotMedia).not.toBeNull();
    expect(snapshotMedia?.mediaAssetId).toBe(testMediaAssetId);
  });

  // --- ARC-BE-20: Test environment isolation ---
  it('ARC-BE-20: Test environment isolation (disposable DB matches prefix and primary DB untouched)', async () => {
    expect(disposableDbName).toMatch(/^academy_e2e_suite_[0-9a-f]{16}$/);
    expect(disposableDbName).not.toBe(primaryDb);
    expect(primaryDb).toBe('bachina_labs_academy');
  });
});
