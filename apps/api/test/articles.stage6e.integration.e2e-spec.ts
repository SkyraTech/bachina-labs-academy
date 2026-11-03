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
import request from 'supertest';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticleBlocksRepository } from '../src/modules/articles/repositories/article-blocks.repository.js';
import { ArticleBlocksService } from '../src/modules/articles/services/article-blocks.service.js';
import { ArticlePublicationRepository } from '../src/modules/articles/repositories/article-publication.repository.js';
import { ArticlePublicationService } from '../src/modules/articles/services/article-publication.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticleBlocksController } from '../src/modules/articles/controllers/article-blocks.controller.js';
import { ArticlePublicationController } from '../src/modules/articles/controllers/article-publication.controller.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import { assertDisposableTestDatabase } from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Stage 6E Article Publication, Republishing & Immutable Snapshots (e2e)', () => {
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
  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser;

  let dbName: string;

  let authorA: { id: string; email: string };
  let userA: AuthenticatedUser;

  let authorB: { id: string; email: string };
  let userB: AuthenticatedUser;

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

    // 10. Seed Authors
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.a.stage6e@skyra-tech.com',
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
      sessionId: 'sess-stage6e-a',
    };

    const createdB = await prismaAdmin.user.create({
      data: {
        email: 'author.b.stage6e@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorB = { id: createdB.id, email: createdB.email };
    userB = {
      id: authorB.id,
      email: authorB.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-stage6e-b',
    };

    // 11. Setup NestJS HTTP Test App with real ValidationPipe
    currentUserInjected = userA;
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        ArticlesController,
        ArticleBlocksController,
        ArticlePublicationController,
      ],
      providers: [
        { provide: ArticlesService, useValue: articlesService },
        { provide: ArticleBlocksService, useValue: blocksService },
        { provide: ArticlePublicationService, useValue: publicationService },
      ],
    })
      .overrideGuard(VerifiedEmailGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
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

    it('verifies that all authentic Prisma migrations are deployed in disposable DB', async () => {
      const migrationsPath = fs.existsSync(path.resolve('prisma/migrations'))
        ? path.resolve('prisma/migrations')
        : path.resolve('apps/api/prisma/migrations');
      const expectedMigrationNames = fs
        .readdirSync(migrationsPath)
        .filter((d) => fs.existsSync(path.join(migrationsPath, d, 'migration.sql')))
        .sort();

      const applied = await prismaAdmin.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY finished_at ASC;
      `;
      const appliedNames = applied.map((m) => m.migration_name).sort();
      expect(appliedNames).toEqual(expectedMigrationNames);
      expect(appliedNames.length).toBe(13);
      expect(appliedNames).toContain('20261101000000_add_article_snapshot_taxonomy');
    });
  });

  describe('B. Initial Publication Lifecycle & Snapshot Generation', () => {
    let articleId: string;

    it('creates a valid draft with ordered blocks', async () => {
      const article = await articlesService.createDraft(userA, {
        title: 'Mastering PostgreSQL Transactions',
        draftSlug: 'mastering-postgresql-transactions',
        summary: 'Deep dive into isolation levels and concurrency control.',
        typographyPreset: 'TECHNICAL_MINIMAL',
      });
      articleId = article.id;

      await blocksService.createBlock(userA, articleId, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Section 1: Transaction Isolation', level: 2 },
      });

      await blocksService.createBlock(userA, articleId, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 2,
        content: { html: '<p>PostgreSQL uses MVCC to manage concurrent transactions safely.</p>' },
      });

      const privateDraft = await articlesService.getPrivateArticle(userA, articleId);
      expect(privateDraft.draftRevision).toBe(3);
      expect(privateDraft.status).toBe(ArticleStatus.DRAFT);
      expect(privateDraft.publishedRevision).toBe(0);
      expect(privateDraft.currentSnapshotId).toBeNull();
    });

    it('successfully publishes article at expected draft revision 3', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${articleId}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      expect(res.body.articleId).toBe(articleId);
      expect(res.body.status).toBe(ArticleStatus.PUBLISHED);
      expect(res.body.draftRevision).toBe(3);
      expect(res.body.publishedRevision).toBe(3);
      expect(res.body.publishedSlug).toBe('mastering-postgresql-transactions');
      expect(res.body.currentSnapshotId).toBeDefined();
      expect(res.body.publishedAt).toBeDefined();

      const snapshotId = res.body.currentSnapshotId;

      // Verify Snapshot record directly in PostgreSQL
      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: snapshotId },
      });
      expect(snapshot).toBeDefined();
      expect(snapshot!.articleId).toBe(articleId);
      expect(snapshot!.snapshotRevision).toBe(3);
      expect(snapshot!.title).toBe('Mastering PostgreSQL Transactions');
      expect(snapshot!.publishedSlug).toBe('mastering-postgresql-transactions');
      expect(snapshot!.typographyPreset).toBe('TECHNICAL_MINIMAL');

      // Verify blocks JSONB structure in snapshot
      const blocksJson = snapshot!.blocks as { schemaVersion: number; blocks: any[] };
      expect(blocksJson.schemaVersion).toBe(1);
      expect(blocksJson.blocks).toHaveLength(2);
      expect(blocksJson.blocks[0].type).toBe('HEADING');
      expect(blocksJson.blocks[0].position).toBe(0);
      expect(blocksJson.blocks[0].content.text).toBe('Section 1: Transaction Isolation');
      expect(blocksJson.blocks[1].type).toBe('RICH_TEXT');
      expect(blocksJson.blocks[1].position).toBe(1);

      // Verify Article state in database
      const articleRow = await prismaRuntime.article.findUnique({
        where: { id: articleId },
      });
      expect(articleRow!.status).toBe(ArticleStatus.PUBLISHED);
      expect(articleRow!.draftRevision).toBe(3); // Draft revision MUST NOT increment on publication
      expect(articleRow!.publishedRevision).toBe(3);
      expect(articleRow!.currentSnapshotId).toBe(snapshotId);
      expect(articleRow!.publishedSlug).toBe('mastering-postgresql-transactions');
      expect(articleRow!.publishedAt).not.toBeNull();
    });

    it('verifies that draft blocks rows are not mutated during publication', async () => {
      const blocks = await prismaRuntime.articleBlock.findMany({
        where: { articleId },
        orderBy: { position: 'asc' },
      });
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe(ArticleBlockType.HEADING);
      expect(blocks[1].type).toBe(ArticleBlockType.RICH_TEXT);
    });
  });

  describe('C. Snapshot Media Retention & Foreign Key Integrity', () => {
    let mediaCoverId: string;
    let mediaBlock1Id: string;
    let articleWithMediaId: string;
    let snapshotId: string;

    it('publishes article with cover media and image blocks, verifying deduplicated retention rows', async () => {
      // 1. Create MediaAssets owned by Author A
      const cover = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorA.id,
          storageKey: 'media/stage6e/cover-1.webp',
          mediaType: 'IMAGE',
          mimeType: 'image/webp',
          fileSize: 45000,
          originalFilename: 'cover.webp',
        },
      });
      mediaCoverId = cover.id;

      const img1 = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorA.id,
          storageKey: 'media/stage6e/block-1.webp',
          mediaType: 'IMAGE',
          mimeType: 'image/webp',
          fileSize: 32000,
          originalFilename: 'diagram.webp',
        },
      });
      mediaBlock1Id = img1.id;

      // 2. Create Article Draft referencing Cover Media
      const article = await articlesService.createDraft(userA, {
        title: 'Distributed System Architectures',
        draftSlug: 'distributed-system-architectures',
        coverMediaId: mediaCoverId,
      });
      articleWithMediaId = article.id;

      // 3. Add IMAGE block referencing mediaBlock1Id
      await blocksService.createBlock(userA, articleWithMediaId, {
        type: ArticleBlockType.IMAGE,
        expectedRevision: 1,
        content: { caption: 'System Topology Diagram' },
        mediaAssetId: mediaBlock1Id,
      });

      // 4. Add second IMAGE block referencing mediaCoverId (testing deduplication across cover and blocks)
      await blocksService.createBlock(userA, articleWithMediaId, {
        type: ArticleBlockType.IMAGE,
        expectedRevision: 2,
        content: { caption: 'Cover Reused in Body' },
        mediaAssetId: mediaCoverId,
      });

      // Revision is now 3. Publish!
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${articleWithMediaId}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      snapshotId = res.body.currentSnapshotId;

      // Inspect article_snapshot_media retention records
      const retentionRecords = await prismaRuntime.articleSnapshotMedia.findMany({
        where: { snapshotId },
        orderBy: { mediaAssetId: 'asc' },
      });

      // Exactly 2 retention rows must exist (mediaCoverId and mediaBlock1Id), despite 3 total references
      expect(retentionRecords).toHaveLength(2);
      const retainedMediaIds = retentionRecords.map((r) => r.mediaAssetId);
      expect(retainedMediaIds).toContain(mediaCoverId);
      expect(retainedMediaIds).toContain(mediaBlock1Id);
    });

    it('verifies that referenced media assets CANNOT be deleted due to ON DELETE RESTRICT on retention table', async () => {
      // Attempting to delete mediaCoverId must fail because it is retained by article_snapshot_media
      await expect(
        prismaAdmin.mediaAsset.delete({
          where: { id: mediaCoverId },
        }),
      ).rejects.toThrow();

      // Attempting to delete mediaBlock1Id must also fail
      await expect(
        prismaAdmin.mediaAsset.delete({
          where: { id: mediaBlock1Id },
        }),
      ).rejects.toThrow();
    });
  });

  describe('D. Republishing, Version Progression & Historical Immutability', () => {
    let republishArticleId: string;
    let initialSnapshotId: string;
    let initialPublishedAt: string;

    it('publishes initial draft at revision 2', async () => {
      const article = await articlesService.createDraft(userA, {
        title: 'Evolution of Data Pipelines',
        draftSlug: 'evolution-of-data-pipelines',
      });
      republishArticleId = article.id;

      await blocksService.createBlock(userA, republishArticleId, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Batch vs Streaming', level: 2 },
      });

      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${republishArticleId}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      initialSnapshotId = res.body.currentSnapshotId;
      initialPublishedAt = res.body.publishedAt;
      expect(res.body.draftRevision).toBe(2);
      expect(res.body.publishedRevision).toBe(2);
    });

    it('edits the draft to revision 3 and republishes, creating second immutable snapshot', async () => {
      // Add a block to the published article's draft
      await blocksService.createBlock(userA, republishArticleId, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 2,
        content: { html: '<p>Streaming architecture introduces event-time semantics.</p>' },
      });

      const draftState = await articlesService.getPrivateArticle(userA, republishArticleId);
      expect(draftState.draftRevision).toBe(3);
      expect(draftState.publishedRevision).toBe(2);

      // Republish at expectedRevision: 3
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${republishArticleId}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      const secondSnapshotId = res.body.currentSnapshotId;
      expect(secondSnapshotId).not.toBe(initialSnapshotId);
      expect(res.body.publishedRevision).toBe(3);
      expect(res.body.draftRevision).toBe(3);

      // Verify that initial publishedAt timestamp was preserved
      expect(res.body.publishedAt).toBe(initialPublishedAt);

      // Verify two distinct snapshots in database
      const allSnapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: republishArticleId },
        orderBy: { snapshotRevision: 'asc' },
      });
      expect(allSnapshots).toHaveLength(2);
      expect(allSnapshots[0].id).toBe(initialSnapshotId);
      expect(allSnapshots[0].snapshotRevision).toBe(2);
      expect(allSnapshots[1].id).toBe(secondSnapshotId);
      expect(allSnapshots[1].snapshotRevision).toBe(3);

      // Verify first snapshot was not mutated
      const snap1Blocks = allSnapshots[0].blocks as any;
      expect(snap1Blocks.blocks).toHaveLength(1);

      // Verify second snapshot has both blocks
      const snap2Blocks = allSnapshots[1].blocks as any;
      expect(snap2Blocks.blocks).toHaveLength(2);
    });

    it('rejects publication when no draft changes have occurred (no-op republish)', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${republishArticleId}/publish`)
        .send({ expectedRevision: 3 })
        .expect(409);

      expect(res.body.message).toBe('No unpublished draft changes to publish.');

      // Verify no third snapshot was created
      const count = await prismaRuntime.articleSnapshot.count({
        where: { articleId: republishArticleId },
      });
      expect(count).toBe(2);
    });
  });

  describe('E. Concurrency & Duplicate Revision Prevention', () => {
    it('handles simultaneous publication requests with identical revision safely (exactly one succeeds)', async () => {
      const article = await articlesService.createDraft(userA, {
        title: 'Concurrent Execution Patterns',
        draftSlug: 'concurrent-execution-patterns',
      });

      await blocksService.createBlock(userA, article.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Race Conditions and Mutexes', level: 2 },
      });

      currentUserInjected = userA;

      // Fire 2 concurrent HTTP publish requests with expectedRevision: 2
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/articles/${article.id}/publish`)
          .send({ expectedRevision: 2 }),
        request(app.getHttpServer())
          .post(`/articles/${article.id}/publish`)
          .send({ expectedRevision: 2 }),
      ]);

      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      // Exactly one snapshot must exist
      const snapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: article.id },
      });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].snapshotRevision).toBe(2);
    });
  });

  describe('F. Published Slug Conflict & Atomic Rollback', () => {
    it('rejects publication with 409 Conflict when published slug collides with existing published article', async () => {
      // Author A publishes article with draftSlug 'conflict-slug-demo'
      const articleA = await articlesService.createDraft(userA, {
        title: 'Original Author Article',
        draftSlug: 'conflict-slug-demo',
      });
      await blocksService.createBlock(userA, articleA.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Original Content', level: 1 },
      });
      currentUserInjected = userA;
      await request(app.getHttpServer())
        .post(`/articles/${articleA.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Author B creates article with SAME draftSlug 'conflict-slug-demo'
      const articleB = await articlesService.createDraft(userB, {
        title: 'Second Author Article',
        draftSlug: 'conflict-slug-demo',
      });
      await blocksService.createBlock(userB, articleB.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Conflicting Content', level: 1 },
      });

      // Author B attempts to publish -> published_slug collision!
      currentUserInjected = userB;
      const res = await request(app.getHttpServer())
        .post(`/articles/${articleB.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(409);

      expect(res.body.message).toBe('A published article with this slug already exists.');

      // Verify Author B's article is STILL in DRAFT state
      const articleBRow = await prismaRuntime.article.findUnique({
        where: { id: articleB.id },
      });
      expect(articleBRow!.status).toBe(ArticleStatus.DRAFT);
      expect(articleBRow!.publishedRevision).toBe(0);
      expect(articleBRow!.currentSnapshotId).toBeNull();

      // Verify no snapshot was created for Author B
      const snapshotsB = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: articleB.id },
      });
      expect(snapshotsB).toHaveLength(0);
    });
  });

  describe('G. HTTP Request DTO & Edge Cases', () => {
    let testDraftId: string;

    beforeAll(async () => {
      const art = await articlesService.createDraft(userA, {
        title: 'HTTP Validation Suite',
        draftSlug: 'http-validation-suite',
      });
      testDraftId = art.id;

      await blocksService.createBlock(userA, testDraftId, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 2 },
      });
    });

    it('rejects missing expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({})
        .expect(400);

      expect(res.body.message).toContain('expectedRevision is required');
    });

    it('rejects null expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: null })
        .expect(400);

      expect(res.body.message).toContain('expectedRevision is required');
    });

    it('rejects non-integer expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: 1.5 })
        .expect(400);

      expect(res.body.message).toContain('expectedRevision must be an integer');
    });

    it('rejects zero or negative expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: 0 })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: -2 })
        .expect(400);
    });

    it('rejects unknown fields with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: 2, unknownProperty: true })
        .expect(400);

      expect(res.body.message).toContain('property unknownProperty should not exist');
    });

    it('returns 404 Not Found for foreign owned article (private masking)', async () => {
      // User B attempts to publish User A's article
      currentUserInjected = userB;
      const res = await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: 2 })
        .expect(404);

      expect(res.body.message).toBe('Article not found.');
    });

    it('returns 404 Not Found for nonexistent article UUID', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post('/articles/00000000-0000-4000-8000-000000000000/publish')
        .send({ expectedRevision: 1 })
        .expect(404);

      expect(res.body.message).toBe('Article not found.');
    });

    it('rejects publication when expectedRevision does not match with 409 Conflict', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${testDraftId}/publish`)
        .send({ expectedRevision: 99 })
        .expect(409);

      expect(res.body.message).toContain('Revision conflict');
    });

    it('rejects publication of an empty draft with 400 Bad Request', async () => {
      const emptyDraft = await articlesService.createDraft(userA, {
        title: 'Empty Draft Article',
        draftSlug: 'empty-draft-article',
      });

      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${emptyDraft.id}/publish`)
        .send({ expectedRevision: 1 })
        .expect(400);

      expect(res.body.message).toBe('Article must contain at least one content block to be published.');
    });
  });

  describe('H. Immutability & Permission Isolation for Runtime Role', () => {
    it('confirms academy_app cannot UPDATE article_snapshots', async () => {
      // Direct raw update query using runtime client
      await expect(
        prismaRuntime.$executeRaw`
          UPDATE article_snapshots SET title = 'Tampered Title';
        `,
      ).rejects.toThrow();
    });

    it('confirms academy_app cannot DELETE from article_snapshots', async () => {
      await expect(
        prismaRuntime.$executeRaw`
          DELETE FROM article_snapshots;
        `,
      ).rejects.toThrow();
    });

    it('confirms academy_app cannot DELETE from article_snapshot_media', async () => {
      await expect(
        prismaRuntime.$executeRaw`
          DELETE FROM article_snapshot_media;
        `,
      ).rejects.toThrow();
    });
  });
});
