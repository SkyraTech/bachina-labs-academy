import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  UserRole,
  UserStatus,
  ArticleBlockType,
  ArticleStatus,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticleBlocksRepository } from '../src/modules/articles/repositories/article-blocks.repository.js';
import { ArticleBlocksService } from '../src/modules/articles/services/article-blocks.service.js';
import { ArticlePublicationRepository } from '../src/modules/articles/repositories/article-publication.repository.js';
import { ArticlePublicationService } from '../src/modules/articles/services/article-publication.service.js';
import { ArticlePublicReaderRepository } from '../src/modules/articles/repositories/article-public-reader.repository.js';
import { ArticlePublicReaderService } from '../src/modules/articles/services/article-public-reader.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticleBlocksController } from '../src/modules/articles/controllers/article-blocks.controller.js';
import { ArticlePublicationController } from '../src/modules/articles/controllers/article-publication.controller.js';
import { ArticlePublicReaderController } from '../src/modules/articles/controllers/article-public-reader.controller.js';
import { ArticleMediaService } from '../src/modules/articles/services/article-media.service.js';
import { JwtAccessGuard } from '../src/modules/auth/guards/jwt-access.guard.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import { JwtTokenService } from '../src/modules/auth/services/jwt-token.service.js';
import { SessionsService } from '../src/modules/sessions/sessions.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/services/cookie.service.js';
import { assertDisposableTestDatabase } from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Stage 6F Public Article Reader APIs & Immutable Snapshot Retrieval (e2e)', () => {
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

  let dbName: string;

  let authorA: { id: string; email: string };
  let userA: AuthenticatedUser;
  let authorCookie: string;

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

    // 6. Deploy all 11 Prisma migrations
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

    // 10. Seed Author
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.stage6f@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorA = { id: createdA.id, email: createdA.email };
    userA = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-stage6f-author',
    };

    // Simulate authentic token service for cookie authentication
    authorCookie = `${ACCESS_COOKIE_NAME}=mock-valid-token-for-author`;

    const mockJwtTokenService = {
      verifyAccessToken: vi.fn(async (token: string) => {
        if (token === 'mock-valid-token-for-author') {
          return {
            sub: userA.id,
            email: userA.email,
            role: userA.role,
            sid: userA.sessionId,
          };
        }
        throw new Error('Invalid token');
      }),
    };

    const mockSessionsService = {
      validateSession: vi.fn(async (sid: string) => {
        if (sid === userA.sessionId) {
          return { id: sid, userId: userA.id, revokedAt: null };
        }
        return null;
      }),
    };

    const mockUsersRepository = {
      findById: vi.fn(async (userId: string) => {
        if (userId === userA.id) {
          return {
            id: userA.id,
            email: userA.email,
            role: userA.role,
            status: userA.status,
            emailVerifiedAt: userA.emailVerifiedAt,
          };
        }
        return null;
      }),
    };

    // 11. Setup NestJS HTTP Test App with REAL JwtAccessGuard, RolesGuard, and ValidationPipe
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        ArticlePublicReaderController, // Registered first for precedence
        ArticlesController,
        ArticleBlocksController,
        ArticlePublicationController,
      ],
      providers: [
        { provide: ArticlesService, useValue: articlesService },
        { provide: ArticleBlocksService, useValue: blocksService },
        { provide: ArticlePublicationService, useValue: publicationService },
        { provide: ArticlePublicReaderService, useValue: publicReaderService },
        { provide: ArticleMediaService, useValue: {} },
        { provide: JwtTokenService, useValue: mockJwtTokenService },
        { provide: SessionsService, useValue: mockSessionsService },
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: APP_GUARD, useClass: JwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideGuard(VerifiedEmailGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
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

    if (disposableDbName && disposableDbName.startsWith('academy_auth_audit_')) {
      try {
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
  });

  describe('A. Preflight Database & Runtime Isolation Verification', () => {
    it('verifies that prismaRuntime operates as academy_app', async () => {
      const res = await prismaRuntime.$queryRaw<{ current_user: string }[]>`SELECT current_user;`;
      expect(res[0].current_user).toBe('academy_app');
    });

    it('verifies that 11 Prisma migrations are active in disposable DB', async () => {
      const count = await prismaAdmin.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM _prisma_migrations WHERE rolled_back_at IS NULL;
      `;
      expect(count[0].count).toBe(11);
    });
  });

  describe('B. Anonymous Access & Authentication Boundary Enforcement', () => {
    it('allows anonymous visitor to call GET /articles/public without credentials (returns 200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('limit', 20);
    });

    it('blocks anonymous visitor from calling GET /articles/mine with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/mine')
        .expect(401);

      expect(res.body.message).toBe('Authentication required.');
    });

    it('blocks anonymous visitor from calling private GET /articles/:articleId with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/00000000-0000-4000-8000-000000000001')
        .expect(401);

      expect(res.body.message).toBe('Authentication required.');
    });

    it('blocks anonymous visitor from calling private POST /articles/:articleId/publish with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/articles/00000000-0000-4000-8000-000000000001/publish')
        .send({ expectedRevision: 1 })
        .expect(401);

      expect(res.body.message).toBe('Authentication required.');
    });

    it('blocks anonymous visitor from calling private POST /articles/:articleId/blocks with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/articles/00000000-0000-4000-8000-000000000001/blocks')
        .send({
          type: ArticleBlockType.HEADING,
          expectedRevision: 1,
          content: { text: 'Title', level: 1 },
        })
        .expect(401);

      expect(res.body.message).toBe('Authentication required.');
    });

    it('permits authenticated Author to access private endpoints using their session cookie', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/mine')
        .set('Cookie', [authorCookie])
        .expect(200);

      expect(res.body).toHaveProperty('items');
    });
  });

  describe('C. Initial Publication Visibility & Snapshot Retrieval', () => {
    let articleId: string;
    const publishedSlug = 'distributed-consensus-raft';

    it('confirms unpublished DRAFT is completely invisible to public listing and detail', async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'Distributed Consensus with Raft',
        draftSlug: publishedSlug,
        summary: 'Understanding leader election and log replication.',
        typographyPreset: 'TECHNICAL_MINIMAL',
      });
      articleId = draft.id;

      await blocksService.createBlock(userA, articleId, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: '1. Leader Election Algorithm', level: 2 },
      });

      await blocksService.createBlock(userA, articleId, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 2,
        content: { html: '<p>Raft decomposes consensus into leader election and log replication.</p>' },
      });

      // 1. Not in public list
      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);
      expect(listRes.body.items.some((i: any) => i.id === articleId)).toBe(false);

      // 2. Not accessible through public detail
      await request(app.getHttpServer())
        .get(`/articles/public/${publishedSlug}`)
        .expect(404);
    });

    it('publishes the article and confirms immediate public availability from snapshot', async () => {
      // Publish draft at revision 3
      const publishRes = await publicationService.publishArticle(userA, articleId, {
        expectedRevision: 3,
      });
      expect(publishRes.status).toBe(ArticleStatus.PUBLISHED);

      // 1. Appears in public list
      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);

      const item = listRes.body.items.find((i: any) => i.id === articleId);
      expect(item).toBeDefined();
      expect(item.slug).toBe(publishedSlug);
      expect(item.title).toBe('Distributed Consensus with Raft');
      expect(item.summary).toBe('Understanding leader election and log replication.');
      expect(item.typographyPreset).toBe('TECHNICAL_MINIMAL');
      expect(item.revision).toBe(3);
      expect(item.publishedAt).toBeDefined();

      // 2. Accessible via public detail endpoint by published slug
      const detailRes = await request(app.getHttpServer())
        .get(`/articles/public/${publishedSlug}`)
        .expect(200);

      expect(detailRes.body.id).toBe(articleId);
      expect(detailRes.body.slug).toBe(publishedSlug);
      expect(detailRes.body.title).toBe('Distributed Consensus with Raft');
      expect(detailRes.body.revision).toBe(3);
      expect(detailRes.body.blocks).toHaveLength(2);

      // Verify deterministic block ordering
      expect(detailRes.body.blocks[0].position).toBe(0);
      expect(detailRes.body.blocks[0].type).toBe('HEADING');
      expect(detailRes.body.blocks[0].content.text).toBe('1. Leader Election Algorithm');
      expect(detailRes.body.blocks[1].position).toBe(1);
      expect(detailRes.body.blocks[1].type).toBe('RICH_TEXT');
    });
  });

  describe('D. Unpublished Draft Isolation (Snapshot-Only Guarantee)', () => {
    let articleId: string;
    const initialSlug = 'postgresql-indexing-internals';

    it('proves mutable draft edits never leak into public listing or detail', async () => {
      // 1. Create and publish initial revision 2
      const draft = await articlesService.createDraft(userA, {
        title: 'PostgreSQL Indexing (Initial Snapshot)',
        draftSlug: initialSlug,
        summary: 'Initial snapshot summary.',
        typographyPreset: 'MODERN_SANS',
      });
      articleId = draft.id;

      await blocksService.createBlock(userA, articleId, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'B-Tree Fundamentals', level: 2 },
      });

      await publicationService.publishArticle(userA, articleId, { expectedRevision: 2 });

      // 2. Mutate the editable draft metadata and blocks WITHOUT republishing
      await articlesService.updateDraftMetadata(userA, articleId, {
        expectedRevision: 2,
        title: 'LEAKED DRAFT TITLE - DO NOT EXPOSE',
        summary: 'LEAKED DRAFT SUMMARY - DO NOT EXPOSE',
        draftSlug: 'leaked-draft-slug',
        typographyPreset: 'EDITORIAL_SERIF',
      });

      // Add a third block to draft (revision now 4)
      await blocksService.createBlock(userA, articleId, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 3,
        content: { html: '<p>UNPUBLISHED SECRET BLOCK CONTENT</p>' },
      });

      // Verify draft state in DB has 2 blocks in draft table
      const draftState = await articlesService.getPrivateArticle(userA, articleId);
      expect(draftState.title).toBe('LEAKED DRAFT TITLE - DO NOT EXPOSE');
      expect(draftState.draftRevision).toBe(4);
      expect(draftState.blocks).toHaveLength(2);

      // 3. Inspect public listing: MUST display snapshot revision 2
      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);

      const item = listRes.body.items.find((i: any) => i.id === articleId);
      expect(item).toBeDefined();
      expect(item.title).toBe('PostgreSQL Indexing (Initial Snapshot)');
      expect(item.summary).toBe('Initial snapshot summary.');
      expect(item.typographyPreset).toBe('MODERN_SANS');
      expect(item.slug).toBe(initialSlug);
      expect(item.revision).toBe(2);

      // 4. Inspect public detail: MUST display snapshot revision 2 with 1 block
      const detailRes = await request(app.getHttpServer())
        .get(`/articles/public/${initialSlug}`)
        .expect(200);

      expect(detailRes.body.title).toBe('PostgreSQL Indexing (Initial Snapshot)');
      expect(detailRes.body.summary).toBe('Initial snapshot summary.');
      expect(detailRes.body.typographyPreset).toBe('MODERN_SANS');
      expect(detailRes.body.revision).toBe(2);
      expect(detailRes.body.blocks).toHaveLength(1);
      expect(detailRes.body.blocks[0].content.text).toBe('B-Tree Fundamentals');

      // 5. Unpublished draft slug cannot be resolved
      await request(app.getHttpServer())
        .get('/articles/public/leaked-draft-slug')
        .expect(404);
    });
  });

  describe('E. Republishing & Atomic Switch to New Snapshot', () => {
    let republishId: string;
    const oldSlug = 'cloud-native-observability-v1';
    const newSlug = 'cloud-native-observability-v2';

    it('atomically advances public visibility to new snapshot and stops resolving old slug', async () => {
      // 1. Initial publication at revision 2
      const draft = await articlesService.createDraft(userA, {
        title: 'Observability v1',
        draftSlug: oldSlug,
      });
      republishId = draft.id;

      await blocksService.createBlock(userA, republishId, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Metrics vs Logs', level: 2 },
      });

      await publicationService.publishArticle(userA, republishId, { expectedRevision: 2 });

      // 2. Edit draft title, slug, and add a block
      await articlesService.updateDraftMetadata(userA, republishId, {
        expectedRevision: 2,
        title: 'Observability v2 — Advanced Tracing',
        draftSlug: newSlug,
      });

      await blocksService.createBlock(userA, republishId, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 3,
        content: { html: '<p>Distributed tracing links requests across microservices.</p>' },
      });

      // 3. Republish at revision 4
      await publicationService.publishArticle(userA, republishId, { expectedRevision: 4 });

      // 4. New slug resolves with updated snapshot content
      const detailRes = await request(app.getHttpServer())
        .get(`/articles/public/${newSlug}`)
        .expect(200);

      expect(detailRes.body.title).toBe('Observability v2 — Advanced Tracing');
      expect(detailRes.body.revision).toBe(4);
      expect(detailRes.body.blocks).toHaveLength(2);

      // 5. Old slug stops resolving under current-slug-only policy (returns 404)
      await request(app.getHttpServer())
        .get(`/articles/public/${oldSlug}`)
        .expect(404);

      // 6. Confirm old snapshot in database remains immutable
      const oldSnapshot = await prismaRuntime.articleSnapshot.findFirst({
        where: { articleId: republishId, snapshotRevision: 2 },
      });
      expect(oldSnapshot).toBeDefined();
      expect(oldSnapshot!.title).toBe('Observability v1');
      expect(oldSnapshot!.publishedSlug).toBe(oldSlug);
    });
  });

  describe('F. Publication State Predicates & Fail-Closed Exclusions', () => {
    it('excludes ARCHIVED articles from public listing and detail (returns 404)', async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'Archived Architecture Topic',
        draftSlug: 'archived-architecture-topic',
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Legacy Design', level: 2 },
      });

      // Publish then simulate archive status
      await publicationService.publishArticle(userA, draft.id, { expectedRevision: 2 });
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });

      // 1. Not in public list
      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);
      expect(listRes.body.items.some((i: any) => i.id === draft.id)).toBe(false);

      // 2. Detail returns 404
      await request(app.getHttpServer())
        .get('/articles/public/archived-architecture-topic')
        .expect(404);
    });

    it('fails closed when snapshot pointer is inconsistent with article revision', async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'Inconsistent Revision Article',
        draftSlug: 'inconsistent-revision-article',
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Anomaly Test', level: 2 },
      });
      await publicationService.publishArticle(userA, draft.id, { expectedRevision: 2 });

      // Corrupt snapshot revision to mismatch article's publishedRevision (2 != 99)
      await prismaAdmin.articleSnapshot.updateMany({
        where: { articleId: draft.id },
        data: { snapshotRevision: 99 },
      });

      // 1. Not in public list
      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);
      expect(listRes.body.items.some((i: any) => i.id === draft.id)).toBe(false);

      // 2. Detail returns safe 404
      await request(app.getHttpServer())
        .get('/articles/public/inconsistent-revision-article')
        .expect(404);
    });
  });

  describe('G. Safe Media Retention & Projection', () => {
    let mediaCoverId: string;
    let mediaBlockId: string;
    const mediaArticleSlug = 'event-driven-messaging-patterns';

    it('safely projects cover and block media metadata without leaking storageKey or uploaderId', async () => {
      // 1. Create Media Assets
      const cover = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorA.id,
          storageKey: 'private-s3-bucket/covers/event-driven.webp',
          mediaType: 'IMAGE',
          mimeType: 'image/webp',
          fileSize: 48000,
          width: 1920,
          height: 1080,
          altText: 'Event-driven architecture overview',
          originalFilename: 'cover.webp',
        },
      });
      mediaCoverId = cover.id;

      const img = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorA.id,
          storageKey: 'private-s3-bucket/blocks/broker-topology.webp',
          mediaType: 'IMAGE',
          mimeType: 'image/webp',
          fileSize: 25000,
          width: 1280,
          height: 720,
          altText: 'Message Broker Topology',
          originalFilename: 'topology.webp',
        },
      });
      mediaBlockId = img.id;

      // 2. Create and publish draft referencing both media assets
      const draft = await articlesService.createDraft(userA, {
        title: 'Event-Driven Messaging Patterns',
        draftSlug: mediaArticleSlug,
        coverMediaId: mediaCoverId,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.IMAGE,
        expectedRevision: 1,
        content: { caption: 'Broker cluster diagram' },
        mediaAssetId: mediaBlockId,
      });

      await publicationService.publishArticle(userA, draft.id, { expectedRevision: 2 });

      // 3. Inspect public detail response
      const res = await request(app.getHttpServer())
        .get(`/articles/public/${mediaArticleSlug}`)
        .expect(200);

      // Verify Cover Media projection
      expect(res.body.cover).toEqual({
        id: mediaCoverId,
        mimeType: 'image/webp',
        width: 1920,
        height: 1080,
        altText: 'Event-driven architecture overview',
        url: `/api/v1/articles/public/media/${mediaCoverId}`,
      });
      expect(res.body.cover.storageKey).toBeUndefined();
      expect(res.body.cover.uploaderId).toBeUndefined();

      // Verify Block Media projection
      expect(res.body.blocks[0].media).toEqual({
        id: mediaBlockId,
        mimeType: 'image/webp',
        width: 1280,
        height: 720,
        altText: 'Message Broker Topology',
        url: `/api/v1/articles/public/media/${mediaBlockId}`,
      });
      expect(res.body.blocks[0].media.storageKey).toBeUndefined();
      expect(res.body.blocks[0].media.uploaderId).toBeUndefined();
    });
  });

  describe('H. Pagination & Deterministic Ordering', () => {
    it('enforces limit boundary and returns deterministic paginated results', async () => {
      // Query page 1 with limit 2
      const resPage1 = await request(app.getHttpServer())
        .get('/articles/public?page=1&limit=2')
        .expect(200);

      expect(resPage1.body.items).toHaveLength(2);
      expect(resPage1.body.page).toBe(1);
      expect(resPage1.body.limit).toBe(2);
      expect(resPage1.body.total).toBeGreaterThanOrEqual(4);
      expect(resPage1.body.totalPages).toBeGreaterThanOrEqual(2);

      // Query page 2 with limit 2
      const resPage2 = await request(app.getHttpServer())
        .get('/articles/public?page=2&limit=2')
        .expect(200);

      expect(resPage2.body.items).toHaveLength(2);
      expect(resPage2.body.page).toBe(2);

      // Verify no overlap between page 1 and page 2
      const page1Ids = resPage1.body.items.map((i: any) => i.id);
      const page2Ids = resPage2.body.items.map((i: any) => i.id);
      for (const id of page1Ids) {
        expect(page2Ids).not.toContain(id);
      }
    });

    it('rejects limit exceeding 50 with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?limit=51')
        .expect(400);

      expect(res.body.message).toContain('limit must not exceed 50');
    });

    it('rejects invalid page or limit with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .get('/articles/public?page=0')
        .expect(400);

      await request(app.getHttpServer())
        .get('/articles/public?limit=-1')
        .expect(400);

      await request(app.getHttpServer())
        .get('/articles/public?page=abc')
        .expect(400);
    });

    it('returns empty items array when page exceeds total pages', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?page=9999&limit=10')
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.page).toBe(9999);
      expect(res.body.total).toBeGreaterThan(0);
    });
  });

  describe('I. Read-Only Database Behavior Verification', () => {
    it('confirms public reader endpoints perform zero database writes', async () => {
      const [articlesBefore, snapshotsBefore, blocksBefore] = await Promise.all([
        prismaRuntime.article.count(),
        prismaRuntime.articleSnapshot.count(),
        prismaRuntime.articleBlock.count(),
      ]);

      // Execute public listing and multiple detail requests
      await request(app.getHttpServer()).get('/articles/public').expect(200);
      await request(app.getHttpServer())
        .get('/articles/public/distributed-consensus-raft')
        .expect(200);
      await request(app.getHttpServer())
        .get('/articles/public/event-driven-messaging-patterns')
        .expect(200);

      const [articlesAfter, snapshotsAfter, blocksAfter] = await Promise.all([
        prismaRuntime.article.count(),
        prismaRuntime.articleSnapshot.count(),
        prismaRuntime.articleBlock.count(),
      ]);

      expect(articlesAfter).toBe(articlesBefore);
      expect(snapshotsAfter).toBe(snapshotsBefore);
      expect(blocksAfter).toBe(blocksBefore);
    });
  });

  describe('J. HTTP Route Collision & Precedence Verification', () => {
    it('confirms GET /articles/public resolves to public list and not private :articleId', async () => {
      // Anonymous request to /articles/public must succeed with 200 (if it hit :articleId, it would return 401 or 400 UUID error)
      const res = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('confirms GET /articles/public/:slug resolves to public detail and not private :articleId', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public/distributed-consensus-raft')
        .expect(200);

      expect(res.body.slug).toBe('distributed-consensus-raft');
      expect(res.body).toHaveProperty('blocks');
    });

    it('confirms GET /articles/mine resolves to private author list when authenticated', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/mine')
        .set('Cookie', [authorCookie])
        .expect(200);

      expect(res.body).toHaveProperty('items');
    });

    it('confirms GET /articles/:articleId resolves to private draft retrieval when authenticated', async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'Private Route Collision Draft',
        draftSlug: 'private-route-collision-draft',
      });

      const res = await request(app.getHttpServer())
        .get(`/articles/${draft.id}`)
        .set('Cookie', [authorCookie])
        .expect(200);

      expect(res.body.id).toBe(draft.id);
      expect(res.body.title).toBe('Private Route Collision Draft');
    });

    it('confirms GET /articles/:articleId enforces UUID validation and rejects non-UUID with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/not-a-valid-uuid')
        .set('Cookie', [authorCookie])
        .expect(400);

      expect(res.body.message).toContain('Validation failed');
    });
  });
});
