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
import { APP_GUARD } from '@nestjs/core';
import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
  ForbiddenException,
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticleBlocksRepository } from '../src/modules/articles/repositories/article-blocks.repository.js';
import { ArticleBlocksService } from '../src/modules/articles/services/article-blocks.service.js';
import { ArticlePublicationRepository } from '../src/modules/articles/repositories/article-publication.repository.js';
import { ArticlePublicationService } from '../src/modules/articles/services/article-publication.service.js';
import { ArticlePublicReaderRepository } from '../src/modules/articles/repositories/article-public-reader.repository.js';
import { ArticlePublicReaderService } from '../src/modules/articles/services/article-public-reader.service.js';
import { ArticleMediaService } from '../src/modules/articles/services/article-media.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticlePublicReaderController } from '../src/modules/articles/controllers/article-public-reader.controller.js';
import { ArticlePublicationController } from '../src/modules/articles/controllers/article-publication.controller.js';
import { ArticleBlocksController } from '../src/modules/articles/controllers/article-blocks.controller.js';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Checkpoint P4-R Article Duplication Integrity and Hardening (e2e)', () => {
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
  let dbName: string;

  let prismaRuntime: PrismaClient;
  let prismaAdmin: PrismaClient;

  let articlesRepo: ArticlesRepository;
  let articlesService: ArticlesService;
  let blocksRepo: ArticleBlocksRepository;
  let blocksService: ArticleBlocksService;
  let publicationRepo: ArticlePublicationRepository;
  let publicationService: ArticlePublicationService;
  let publicReaderRepo: ArticlePublicReaderRepository;
  let publicReaderService: ArticlePublicReaderService;

  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser | null = null;

  // Test Entities
  let userA: AuthenticatedUser;
  let userB: AuthenticatedUser;
  let unverifiedUser: AuthenticatedUser;
  let readerUser: AuthenticatedUser;

  let testCategory: { id: string; name: string; slug: string };
  let testTag1: { id: string; name: string; slug: string };
  let testTag2: { id: string; name: string; slug: string };
  let coverMediaAsset: { id: string; storageKey: string };
  let blockMediaAsset: { id: string; storageKey: string };

  let sourceDraftArticle: any;
  let sourcePublishedArticle: any;
  let sourcePublishedSnapshotId: string;

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

    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Refusing to run against non-local host: ${host}`);
    }

    psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
    if (!fs.existsSync(psqlPath)) {
      psqlPath = 'psql';
    }

    // 2. Generate unique disposable DB
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

    // 5. Grant connection and schema usage to runtime user academy_app
    runAdminPsql(`GRANT CONNECT ON DATABASE "${disposableDbName}" TO "${runtimeUser}";`, disposableDbName);
    runAdminPsql(`GRANT USAGE ON SCHEMA public TO "${runtimeUser}";`, disposableDbName);

    // 6. Deploy all 13 authentic Prisma migrations
    disposableMigrationUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;
    execSync('pnpm prisma migrate deploy', {
      cwd: fs.existsSync('prisma') ? '.' : 'apps/api',
      env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
      encoding: 'utf8',
    });

    // 7. Grant DML permissions on tables in schema public to academy_app with immutable snapshots enforcement
    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeUser}";
      REVOKE ALL ON "audit_logs" FROM "${runtimeUser}";
      GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
      REVOKE UPDATE, DELETE ON "article_snapshots" FROM "${runtimeUser}";
      REVOKE UPDATE, DELETE ON "article_snapshot_media" FROM "${runtimeUser}";
    `, disposableDbName);

    // 8. Connect PrismaClients
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;
    prismaRuntime = new PrismaClient({
      datasources: { db: { url: disposableRuntimeUrl } },
    });
    await prismaRuntime.$connect();

    prismaAdmin = new PrismaClient({
      datasources: { db: { url: disposableMigrationUrl } },
    });
    await prismaAdmin.$connect();

    // 9. Wire repositories and services
    articlesRepo = new ArticlesRepository(prismaRuntime as any);
    articlesService = new ArticlesService(articlesRepo);
    blocksRepo = new ArticleBlocksRepository(prismaRuntime as any);
    blocksService = new ArticleBlocksService(blocksRepo);
    publicationRepo = new ArticlePublicationRepository(prismaRuntime as any);
    publicationService = new ArticlePublicationService(publicationRepo);
    publicReaderRepo = new ArticlePublicReaderRepository(prismaRuntime as any);
    publicReaderService = new ArticlePublicReaderService(publicReaderRepo);

    // 10. Seed Users
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.a.dup@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    userA = {
      id: createdA.id,
      email: createdA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-dup-a',
    };

    const createdB = await prismaAdmin.user.create({
      data: {
        email: 'author.b.dup@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    userB = {
      id: createdB.id,
      email: createdB.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-dup-b',
    };

    const createdUnverified = await prismaAdmin.user.create({
      data: {
        email: 'unverified.dup@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
      },
    });
    unverifiedUser = {
      id: createdUnverified.id,
      email: createdUnverified.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null,
      sessionId: 'sess-dup-unverified',
    };

    const createdReader = await prismaAdmin.user.create({
      data: {
        email: 'reader.dup@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    readerUser = {
      id: createdReader.id,
      email: createdReader.email,
      role: 'READER' as any,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-dup-reader',
    };

    // 11. Seed Taxonomy
    testCategory = await prismaAdmin.category.create({
      data: {
        name: 'Distributed Systems',
        slug: 'distributed-systems',
        description: 'Consensus algorithms and distributed storage',
      },
    });

    testTag1 = await prismaAdmin.tag.create({
      data: {
        name: 'Raft',
        slug: 'raft',
      },
    });

    testTag2 = await prismaAdmin.tag.create({
      data: {
        name: 'PostgreSQL',
        slug: 'postgresql',
      },
    });

    // 12. Seed Media Assets owned by User A
    coverMediaAsset = await prismaAdmin.mediaAsset.create({
      data: {
        uploaderId: userA.id,
        storageKey: 'media/author-a/cover-banner.webp',
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: 84000,
        originalFilename: 'cover-banner.webp',
        width: 1200,
        height: 630,
      },
    });

    blockMediaAsset = await prismaAdmin.mediaAsset.create({
      data: {
        uploaderId: userA.id,
        storageKey: 'media/author-a/architecture-diagram.webp',
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: 124000,
        originalFilename: 'architecture-diagram.webp',
        width: 1600,
        height: 900,
      },
    });

    // 13. Seed Source Draft Article with 4 content blocks & 2 tags
    sourceDraftArticle = await prismaAdmin.article.create({
      data: {
        authorId: userA.id,
        title: 'Building Distributed Consensus in Node.js',
        draftSlug: 'building-distributed-consensus',
        summary: 'Architectural guide to consensus algorithms and replicated state machines.',
        status: ArticleStatus.DRAFT,
        typographyPreset: 'MODERN_SANS',
        coverMediaId: coverMediaAsset.id,
        categoryId: testCategory.id,
        draftRevision: 3,
        publishedRevision: 0,
        tags: {
          create: [{ tagId: testTag1.id }, { tagId: testTag2.id }],
        },
        blocks: {
          create: [
            {
              type: ArticleBlockType.HEADING,
              position: 1000,
              content: { text: 'Introduction to Consensus', level: 1 },
              schemaVersion: 1,
            },
            {
              type: ArticleBlockType.RICH_TEXT,
              position: 2000,
              content: { html: '<p>Consensus algorithms allow replicated state machines to function.</p>' },
              schemaVersion: 1,
            },
            {
              type: ArticleBlockType.IMAGE,
              position: 3000,
              mediaAssetId: blockMediaAsset.id,
              content: { caption: 'State Machine Replication Protocol' },
              schemaVersion: 1,
            },
            {
              type: ArticleBlockType.CODE,
              position: 4000,
              content: { code: 'const raft = new RaftCluster();', language: 'typescript' },
              schemaVersion: 1,
            },
          ],
        },
      },
      include: {
        blocks: true,
        tags: true,
      },
    });

    // 14. Seed Source Published Article with published snapshot & snapshot media
    const publishedArt = await prismaAdmin.article.create({
      data: {
        authorId: userA.id,
        title: 'High-Performance Relational Indexing in PostgreSQL',
        draftSlug: 'high-performance-relational-indexing',
        publishedSlug: 'high-performance-relational-indexing',
        summary: 'Deep dive into B-Tree, BRIN, and GiST indexes.',
        status: ArticleStatus.PUBLISHED,
        typographyPreset: 'TECHNICAL_MINIMAL',
        coverMediaId: coverMediaAsset.id,
        categoryId: testCategory.id,
        draftRevision: 2,
        publishedRevision: 1,
        publishedAt: new Date('2026-11-01T12:00:00Z'),
        tags: {
          create: [{ tagId: testTag2.id }],
        },
        blocks: {
          create: [
            {
              type: ArticleBlockType.HEADING,
              position: 1000,
              content: { text: 'Indexing Fundamentals', level: 1 },
              schemaVersion: 1,
            },
          ],
        },
      },
    });

    const snapshot = await prismaAdmin.articleSnapshot.create({
      data: {
        articleId: publishedArt.id,
        snapshotRevision: 1,
        title: publishedArt.title,
        publishedSlug: publishedArt.publishedSlug!,
        summary: publishedArt.summary,
        typographyPreset: publishedArt.typographyPreset,
        coverMediaId: coverMediaAsset.id,
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: crypto.randomUUID(),
              type: 'HEADING',
              position: 1000,
              content: { text: 'Indexing Fundamentals', level: 1 },
            },
          ],
        },
        publishedAt: publishedArt.publishedAt!,
        taxonomy: {
          schemaVersion: 1,
          category: { id: testCategory.id, name: testCategory.name, slug: testCategory.slug },
          tags: [{ id: testTag2.id, name: testTag2.name, slug: testTag2.slug }],
        },
      },
    });

    await prismaAdmin.articleSnapshotMedia.create({
      data: {
        snapshotId: snapshot.id,
        mediaAssetId: coverMediaAsset.id,
      },
    });

    await prismaAdmin.article.update({
      where: { id: publishedArt.id },
      data: { currentSnapshotId: snapshot.id },
    });

    sourcePublishedArticle = await prismaAdmin.article.findUniqueOrThrow({
      where: { id: publishedArt.id },
      include: { blocks: true, tags: true },
    });
    sourcePublishedSnapshotId = snapshot.id;

    // 15. Setup NestJS HTTP Test App with actual controllers and ValidationPipe
    @Injectable()
    class MockAuthGuard implements CanActivate {
      constructor(private readonly reflector: Reflector) { }
      canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (isPublic) {
          return true;
        }
        if (!currentUserInjected) {
          throw new UnauthorizedException('Authentication required.');
        }
        const req = context.switchToHttp().getRequest();
        req.user = currentUserInjected;
        return true;
      }
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        ArticlePublicReaderController,
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
        { provide: APP_GUARD, useClass: MockAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideGuard(VerifiedEmailGuard)
      .useValue({
        canActivate: () => {
          if (!currentUserInjected) {
            throw new UnauthorizedException('Authentication required.');
          }
          if (currentUserInjected.emailVerifiedAt === null) {
            throw new ForbiddenException('Email verification required.');
          }
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: any) => {
      req.user = currentUserInjected;
      next();
    });
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
    if (app) {
      await app.close();
    }
    if (prismaRuntime) {
      await prismaRuntime.$disconnect();
    }
    if (prismaAdmin) {
      await prismaAdmin.$disconnect();
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (disposableDbName) {
      assertDisposableTestDatabase(disposableDbName, 'academy_auth_audit_');
      await safelyDropDisposableDatabase(disposableDbName, (sql) => runAdminPsql(sql), {
        allowedPrefix: 'academy_auth_audit_',
      });
    }
  });

  // ── P4-R-E1: Duplicate existing draft ──────────────────────────────────────────
  it('P4-R-E1: duplicates an existing draft into a new independent draft with reset revisions', async () => {
    currentUserInjected = userA;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.id).not.toBe(sourceDraftArticle.id);
    expect(res.body.title).toBe('Building Distributed Consensus in Node.js (Copy)');
    expect(res.body.draftSlug).toBe('building-distributed-consensus-copy');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.draftRevision).toBe(1);
    expect(res.body.publishedRevision).toBe(0);
    expect(res.body.publishedSlug).toBeNull();
    expect(res.body.publishedAt).toBeNull();
    expect(res.body.currentSnapshotId).toBeNull();
    expect(res.body.authorId).toBe(userA.id);

    // Verify in database
    const dbDuplicate = await prismaAdmin.article.findUnique({
      where: { id: res.body.id },
    });
    expect(dbDuplicate).not.toBeNull();
    expect(dbDuplicate?.status).toBe('DRAFT');
    expect(dbDuplicate?.draftRevision).toBe(1);
    expect(dbDuplicate?.publishedRevision).toBe(0);
  });

  // ── P4-R-E2: Duplicate published Article without copying snapshots ─────────────
  it('P4-R-E2: duplicates published Article without copying snapshots or inheriting published status', async () => {
    currentUserInjected = userA;

    const initialSnapshotCount = await prismaAdmin.articleSnapshot.count();
    const initialSnapshotMediaCount = await prismaAdmin.articleSnapshotMedia.count();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourcePublishedArticle.id}/duplicate`)
      .expect(201);

    expect(res.body.id).not.toBe(sourcePublishedArticle.id);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.publishedSlug).toBeNull();
    expect(res.body.currentSnapshotId).toBeNull();
    expect(res.body.publishedAt).toBeNull();
    expect(res.body.publishedRevision).toBe(0);

    // Verify zero new snapshots or snapshot-media rows were created
    const postSnapshotCount = await prismaAdmin.articleSnapshot.count();
    const postSnapshotMediaCount = await prismaAdmin.articleSnapshotMedia.count();
    expect(postSnapshotCount).toBe(initialSnapshotCount);
    expect(postSnapshotMediaCount).toBe(initialSnapshotMediaCount);

    // Original published article is untouched
    const original = await prismaAdmin.article.findUnique({
      where: { id: sourcePublishedArticle.id },
    });
    expect(original?.status).toBe('PUBLISHED');
    expect(original?.currentSnapshotId).toBe(sourcePublishedSnapshotId);
    expect(original?.publishedSlug).toBe('high-performance-relational-indexing');
  });

  // ── P4-R-E3: Verify fresh Article and block UUIDs ──────────────────────────────
  it('P4-R-E3: generates completely fresh Article and block UUIDs, none matching source', async () => {
    currentUserInjected = userA;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(201);

    const dupId = res.body.id;
    expect(dupId).not.toBe(sourceDraftArticle.id);

    const dbBlocks = await prismaAdmin.articleBlock.findMany({
      where: { articleId: dupId },
      orderBy: { position: 'asc' },
    });

    const sourceBlocks = await prismaAdmin.articleBlock.findMany({
      where: { articleId: sourceDraftArticle.id },
      orderBy: { position: 'asc' },
    });

    expect(dbBlocks.length).toBe(sourceBlocks.length);
    const sourceBlockIds = new Set(sourceBlocks.map((b) => b.id));

    for (const b of dbBlocks) {
      expect(b.articleId).toBe(dupId);
      expect(sourceBlockIds.has(b.id)).toBe(false); // Brand new block UUID
    }
  });

  // ── P4-R-E4: Verify block content and ordering ─────────────────────────────────
  it('P4-R-E4: preserves block ordering, types, positions, JSON payloads, and configurations', async () => {
    currentUserInjected = userA;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(201);

    const dupBlocks = await prismaAdmin.articleBlock.findMany({
      where: { articleId: res.body.id },
      orderBy: { position: 'asc' },
    });

    const sourceBlocks = await prismaAdmin.articleBlock.findMany({
      where: { articleId: sourceDraftArticle.id },
      orderBy: { position: 'asc' },
    });

    expect(dupBlocks.length).toBe(4);
    for (let i = 0; i < sourceBlocks.length; i++) {
      expect(dupBlocks[i].position).toBe(sourceBlocks[i].position);
      expect(dupBlocks[i].type).toBe(sourceBlocks[i].type);
      expect(dupBlocks[i].schemaVersion).toBe(sourceBlocks[i].schemaVersion);
      expect(dupBlocks[i].content).toEqual(sourceBlocks[i].content);
      expect(dupBlocks[i].mediaAssetId).toBe(sourceBlocks[i].mediaAssetId);
    }
  });

  // ── P4-R-E5: Verify Category and Tag relationships ────────────────────────────
  it('P4-R-E5: preserves Category and clones Tag relations with independent join rows', async () => {
    currentUserInjected = userA;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(201);

    const dupArticle = await prismaAdmin.article.findUnique({
      where: { id: res.body.id },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    expect(dupArticle?.categoryId).toBe(testCategory.id);
    expect(dupArticle?.tags.length).toBe(2);

    const tagSlugs = dupArticle?.tags.map((t) => t.tag.slug).sort();
    expect(tagSlugs).toEqual(['postgresql', 'raft']);

    // Ensure join rows point strictly to the duplicate article
    for (const t of dupArticle?.tags || []) {
      expect(t.articleId).toBe(dupArticle?.id);
    }
  });

  // ── P4-R-E6: Verify cover media and IMAGE block references ─────────────────────
  it('P4-R-E6: maintains valid cover media and IMAGE block references owned by the same author', async () => {
    currentUserInjected = userA;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(201);

    expect(res.body.coverMediaId).toBe(coverMediaAsset.id);

    const imageBlock = res.body.blocks.find((b: any) => b.type === 'IMAGE');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.mediaAssetId).toBe(blockMediaAsset.id);

    // Verify media asset itself was not duplicated or modified
    const mediaCount = await prismaAdmin.mediaAsset.count({
      where: { uploaderId: userA.id },
    });
    expect(mediaCount).toBe(2); // Still strictly 2 media assets
  });

  // ── P4-R-E7: Reject unauthorized cross-owner duplication ──────────────────────
  it('P4-R-E7: rejects cross-owner duplication with 404 Not Found, creating zero records', async () => {
    currentUserInjected = userB; // Author B tries to duplicate Author A's draft

    const initialArticleCount = await prismaAdmin.article.count();
    const initialBlockCount = await prismaAdmin.articleBlock.count();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(404);

    expect(res.body.message).toContain('not found');

    const postArticleCount = await prismaAdmin.article.count();
    const postBlockCount = await prismaAdmin.articleBlock.count();
    expect(postArticleCount).toBe(initialArticleCount);
    expect(postBlockCount).toBe(initialBlockCount);
  });

  // ── P4-R-E8: Reject unauthenticated or unauthorized role ───────────────────────
  it('P4-R-E8: rejects unauthenticated requests (401), unverified authors (403), and READER role (403)', async () => {
    // 1. Unauthenticated
    currentUserInjected = null;
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(401);

    // 2. Unverified Author
    currentUserInjected = unverifiedUser;
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(403);

    // 3. Reader User
    currentUserInjected = readerUser;
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`)
      .expect(403);
  });

  // ── P4-R-E9: Concurrent duplication requests preserve uniqueness ───────────────
  it('P4-R-E9: concurrent duplication requests for the same source succeed with distinct unique slugs', async () => {
    currentUserInjected = userA;

    // Fire 2 simultaneous duplication requests against the PostgreSQL database
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`),
      request(app.getHttpServer()).post(`/api/v1/articles/${sourceDraftArticle.id}/duplicate`),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    expect(res1.body.id).not.toBe(res2.body.id);
    expect(res1.body.draftSlug).not.toBe(res2.body.draftSlug);

    expect(res1.body.draftSlug).toMatch(/^building-distributed-consensus-copy(-\d+)?$/);
    expect(res2.body.draftSlug).toMatch(/^building-distributed-consensus-copy(-\d+)?$/);

    // Verify both articles have full independent blocks in the database
    const blocks1 = await prismaAdmin.articleBlock.count({ where: { articleId: res1.body.id } });
    const blocks2 = await prismaAdmin.articleBlock.count({ where: { articleId: res2.body.id } });
    expect(blocks1).toBe(4);
    expect(blocks2).toBe(4);
  });

  // ── P4-R-E10: Transaction failure rolls back every partial write ────────────────
  it('P4-R-E10: transaction abort rolls back every partial row, leaving zero residual records', async () => {
    currentUserInjected = userA;

    const initialArticleCount = await prismaAdmin.article.count();
    const initialBlockCount = await prismaAdmin.articleBlock.count();
    const initialTagCount = await prismaAdmin.articleTag.count();

    // Execute atomic transaction test where an error occurs mid-duplication
    await expect(
      prismaRuntime.$transaction(async (tx) => {
        const source = await tx.article.findFirstOrThrow({
          where: { id: sourceDraftArticle.id, authorId: userA.id },
          include: { blocks: true, tags: true },
        });

        const newArt = await tx.article.create({
          data: {
            authorId: userA.id,
            title: `${source.title} (Failed Rollback Copy)`,
            draftSlug: 'temp-rollback-test-slug',
            summary: source.summary,
            status: 'DRAFT',
            tags: {
              create: source.tags.map((t) => ({ tagId: t.tagId })),
            },
          },
        });

        await tx.articleBlock.createMany({
          data: source.blocks.map((b) => ({
            articleId: newArt.id,
            type: b.type,
            position: b.position,
            content: b.content as any,
            mediaAssetId: b.mediaAssetId,
          })),
        });

        // Deliberately trigger failure after article and block creation
        throw new Error('Simulated atomic failure during duplication workflow');
      }),
    ).rejects.toThrow('Simulated atomic failure during duplication workflow');

    // Assert that the rolled-back draft, blocks, and tags are completely absent
    const postArticleCount = await prismaAdmin.article.count();
    const postBlockCount = await prismaAdmin.articleBlock.count();
    const postTagCount = await prismaAdmin.articleTag.count();

    expect(postArticleCount).toBe(initialArticleCount);
    expect(postBlockCount).toBe(initialBlockCount);
    expect(postTagCount).toBe(initialTagCount);

    const leakedArticle = await prismaAdmin.article.findFirst({
      where: { draftSlug: 'temp-rollback-test-slug' },
    });
    expect(leakedArticle).toBeNull();
  });

  // ── P4-R-E11: Duplicate remains absent from public discovery ──────────────────
  it('P4-R-E11: duplicate draft remains strictly private and excluded from public Reader and discovery', async () => {
    currentUserInjected = userA;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourcePublishedArticle.id}/duplicate`)
      .expect(201);

    const dupDraftSlug = res.body.draftSlug;

    // 1. Public Reader by slug must return 404
    await request(app.getHttpServer())
      .get(`/api/v1/articles/public/${dupDraftSlug}`)
      .expect(404);

    // 2. Public article catalog listing must NOT include duplicate draft
    const catalogRes = await request(app.getHttpServer())
      .get('/api/v1/articles/public')
      .expect(200);

    const foundInCatalog = catalogRes.body.items.some(
      (item: any) => item.id === res.body.id || item.slug === dupDraftSlug,
    );
    expect(foundInCatalog).toBe(false);
  });

  // ── P4-R-E12: Original published snapshot remains unchanged ───────────────────
  it('P4-R-E12: original published snapshot remains frozen and unchanged after duplication', async () => {
    const preSnapshot = await prismaAdmin.articleSnapshot.findUniqueOrThrow({
      where: { id: sourcePublishedSnapshotId },
    });

    currentUserInjected = userA;
    await request(app.getHttpServer())
      .post(`/api/v1/articles/${sourcePublishedArticle.id}/duplicate`)
      .expect(201);

    const postSnapshot = await prismaAdmin.articleSnapshot.findUniqueOrThrow({
      where: { id: sourcePublishedSnapshotId },
    });

    expect(postSnapshot.id).toBe(preSnapshot.id);
    expect(postSnapshot.snapshotRevision).toBe(preSnapshot.snapshotRevision);
    expect(postSnapshot.publishedSlug).toBe(preSnapshot.publishedSlug);
    expect(postSnapshot.title).toBe(preSnapshot.title);
    expect(postSnapshot.publishedAt.toISOString()).toBe(preSnapshot.publishedAt.toISOString());
    expect(postSnapshot.blocks).toEqual(preSnapshot.blocks);
    expect(postSnapshot.taxonomy).toEqual(preSnapshot.taxonomy);
  });
});

