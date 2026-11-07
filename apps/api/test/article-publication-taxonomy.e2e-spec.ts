import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  PrismaClient,
  UserRole,
  UserStatus,
  ArticleBlockType,
  Prisma,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
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
import { ArticlePublicReaderController } from '../src/modules/articles/controllers/article-public-reader.controller.js';
import { ArticlePublicReaderRepository } from '../src/modules/articles/repositories/article-public-reader.repository.js';
import { ArticlePublicReaderService } from '../src/modules/articles/services/article-public-reader.service.js';
import { ArticleMediaService } from '../src/modules/articles/services/article-media.service.js';
import { ArticleStatus } from '@prisma/client';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Article Publication & Taxonomy Snapshot Integration (e2e)', () => {
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
  let currentUserInjected: AuthenticatedUser;

  let dbName: string;

  let authorA: { id: string; email: string };
  let userA: AuthenticatedUser;

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

  function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function waitForBlockedLock(targetDb: string, timeoutMs = 4000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = runAdminPsql(
          `SELECT count(*) FROM pg_locks WHERE granted = false;`,
          targetDb,
        );
        const lines = res.trim().split('\n');
        const count = parseInt(lines[2]?.trim() || '0', 10);
        if (count > 0) {
          return true;
        }
      } catch {
        // ignore transient error
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
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

    // 6. Deploy all 13 Prisma migrations
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

    // 10. Seed Authors
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.a.pubtax@skyra-tech.com',
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
      sessionId: 'sess-pubtax-a',
    };

    // 11. Setup NestJS HTTP Test App with real ValidationPipe
    currentUserInjected = userA;
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

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (disposableDbName) {
      assertDisposableTestDatabase(disposableDbName, 'academy_auth_audit_');
      await safelyDropDisposableDatabase(disposableDbName, (sql) => runAdminPsql(sql), {
        allowedPrefix: 'academy_auth_audit_',
      });
    }
  });

  describe('A. Preflight Database & Runtime Isolation Verification', () => {
    it('verifies that prismaRuntime operates as academy_app', async () => {
      const res = await prismaRuntime.$queryRaw<{ current_user: string }[]>`SELECT current_user;`;
      expect(res[0].current_user).toBe('academy_app');
    });

    it('verifies that all 13 authentic Prisma migrations are deployed in disposable DB', async () => {
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
      expect(appliedNames.length).toBeGreaterThanOrEqual(13);
      expect(appliedNames).toContain('20261101000000_add_article_snapshot_taxonomy');
    });

    it('verifies article_snapshots table has 11 columns with taxonomy JSONB in disposable DB', async () => {
      const cols = await prismaAdmin.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'article_snapshots'
        ORDER BY ordinal_position;
      `;
      expect(cols).toHaveLength(11);
      const taxCol = cols.find((c) => c.column_name === 'taxonomy');
      expect(taxCol).toBeDefined();
      expect(taxCol!.data_type).toBe('jsonb');
      expect(taxCol!.is_nullable).toBe('YES');
    });
  });

  describe('B. Core Publication Taxonomy Capture Scenarios', () => {
    let catDevOps: { id: string; name: string; slug: string };
    let tagKubernetes: { id: string; name: string; slug: string };
    let tagTerraform: { id: string; name: string; slug: string };
    let tagAnsible: { id: string; name: string; slug: string };

    beforeAll(async () => {
      // Seed test categories and tags via admin client
      catDevOps = await prismaAdmin.category.create({
        data: {
          name: 'DevOps & SRE',
          slug: 'devops-and-sre',
          description: 'Cloud infrastructure and automation.',
        },
      });

      tagKubernetes = await prismaAdmin.tag.create({
        data: { name: 'Kubernetes', slug: 'kubernetes' },
      });
      tagTerraform = await prismaAdmin.tag.create({
        data: { name: 'Terraform', slug: 'terraform' },
      });
      tagAnsible = await prismaAdmin.tag.create({
        data: { name: 'Ansible', slug: 'ansible' },
      });
    });

    it('1. publishes article with Category and multiple Tags capturing immutable taxonomy JSONB', async () => {
      currentUserInjected = userA;

      // Create draft with category and tags
      const draft = await articlesService.createDraft(userA, {
        title: 'Infrastructure as Code Architecture',
        draftSlug: 'infrastructure-as-code-architecture',
        categoryId: catDevOps.id,
        tagIds: [tagTerraform.id, tagKubernetes.id, tagAnsible.id],
      });

      // Add required content block
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Declarative Provisioning', level: 2 },
      });

      // Publish draft
      const response = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      expect(response.body.articleId).toBe(draft.id);
      expect(response.body.status).toBe('PUBLISHED');
      expect(response.body.publishedRevision).toBe(2);

      // Inspect snapshot in PostgreSQL
      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: response.body.currentSnapshotId },
      });
      expect(snapshot).not.toBeNull();
      expect(snapshot!.taxonomy).not.toBeNull();

      const tax = snapshot!.taxonomy as any;
      // 7. Schema version check
      expect(tax.schemaVersion).toBe(1);

      // 8. Frozen category check
      expect(tax.category).toEqual({
        id: catDevOps.id,
        name: 'DevOps & SRE',
        slug: 'devops-and-sre',
      });

      // 6. Deterministic tag ordering check: ansible, kubernetes, terraform
      expect(tax.tags).toHaveLength(3);
      expect(tax.tags[0].slug).toBe('ansible');
      expect(tax.tags[0].name).toBe('Ansible');
      expect(tax.tags[1].slug).toBe('kubernetes');
      expect(tax.tags[2].slug).toBe('terraform');

      // 20. Blocks preservation check
      const blocks = snapshot!.blocks as any;
      expect(blocks.schemaVersion).toBe(1);
      expect(blocks.blocks).toHaveLength(1);
      expect(blocks.blocks[0].type).toBe('HEADING');
    });

    it('2. publishes article with no Category or Tags and captures explicitly empty structure (not SQL NULL)', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Clean Architecture Principles',
        draftSlug: 'clean-architecture-principles',
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>Separation of concerns is paramount.</p>' },
      });

      const response = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: response.body.currentSnapshotId },
      });
      expect(snapshot).not.toBeNull();
      expect(snapshot!.taxonomy).not.toBeNull();

      const tax = snapshot!.taxonomy as any;
      expect(tax).toEqual({
        schemaVersion: 1,
        category: null,
        tags: [],
      });
    });

    it('3. publishes article with Category only', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Cloud Observability Best Practices',
        draftSlug: 'cloud-observability-best-practices',
        categoryId: catDevOps.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>Metrics, logs and traces provide holistic visibility.</p>' },
      });

      const response = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: response.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.schemaVersion).toBe(1);
      expect(tax.category).toEqual({
        id: catDevOps.id,
        name: 'DevOps & SRE',
        slug: 'devops-and-sre',
      });
      expect(tax.tags).toEqual([]);
    });

    it('4. publishes article with Tags only', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Mastering Kubernetes Pod Scheduling',
        draftSlug: 'mastering-kubernetes-pod-scheduling',
        tagIds: [tagKubernetes.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Node Affinity and Taints', level: 2 },
      });

      const response = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: response.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.schemaVersion).toBe(1);
      expect(tax.category).toBeNull();
      expect(tax.tags).toHaveLength(1);
      expect(tax.tags[0]).toEqual({
        id: tagKubernetes.id,
        name: 'Kubernetes',
        slug: 'kubernetes',
      });
    });

    it('5. accepts publication with exactly 20 tags', async () => {
      currentUserInjected = userA;

      // Create 20 unique tags
      const createdTags: { id: string }[] = [];
      for (let i = 0; i < 20; i++) {
        const t = await prismaAdmin.tag.create({
          data: {
            name: `Performance Metric ${i}`,
            slug: `perf-metric-${String(i).padStart(2, '0')}`,
          },
        });
        createdTags.push(t);
      }

      const draft = await articlesService.createDraft(userA, {
        title: 'High Throughput Benchmarking Study',
        draftSlug: 'high-throughput-benchmarking-study',
        tagIds: createdTags.map((t) => t.id),
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>Latency percentiles p50, p95 and p99.</p>' },
      });

      const response = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: response.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.tags).toHaveLength(20);
    });

    it('19. preserves snapshot-media retention alongside taxonomy capture', async () => {
      currentUserInjected = userA;

      const cover = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorA.id,
          storageKey: 'media/pubtax/cover.webp',
          mediaType: 'IMAGE',
          mimeType: 'image/webp',
          fileSize: 45000,
          originalFilename: 'cover.webp',
        },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'Visual Microservices Architecture',
        draftSlug: 'visual-microservices-architecture',
        coverMediaId: cover.id,
        categoryId: catDevOps.id,
        tagIds: [tagKubernetes.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>System overview.</p>' },
      });

      const response = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Verify retention record was created in article_snapshot_media
      const retention = await prismaRuntime.articleSnapshotMedia.findMany({
        where: { snapshotId: response.body.currentSnapshotId },
      });
      expect(retention).toHaveLength(1);
      expect(retention[0].mediaAssetId).toBe(cover.id);

      // Verify taxonomy was captured too
      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: response.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.category.slug).toBe('devops-and-sre');
    });
  });

  describe('C. Republication & Historical Immutability', () => {
    let catFrontend: { id: string; name: string; slug: string };
    let catBackend: { id: string; name: string; slug: string };
    let tagAngular: { id: string; name: string; slug: string };
    let tagNest: { id: string; name: string; slug: string };

    beforeAll(async () => {
      catFrontend = await prismaAdmin.category.create({
        data: { name: 'Frontend Architecture', slug: 'frontend-architecture' },
      });
      catBackend = await prismaAdmin.category.create({
        data: { name: 'Backend Services', slug: 'backend-services' },
      });
      tagAngular = await prismaAdmin.tag.create({
        data: { name: 'Angular', slug: 'angular' },
      });
      tagNest = await prismaAdmin.tag.create({
        data: { name: 'NestJS', slug: 'nestjs' },
      });
    });

    it('10, 11, 12. republication captures updated draft taxonomy while preserving historical snapshot immutability', async () => {
      currentUserInjected = userA;

      // 1. Initial draft with Frontend category and Angular tag
      const draft = await articlesService.createDraft(userA, {
        title: 'Full Stack Integration Journey',
        draftSlug: 'full-stack-integration-journey',
        categoryId: catFrontend.id,
        tagIds: [tagAngular.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Part 1: Angular Client', level: 2 },
      });

      // 2. Initial publication (revision 2)
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snap1Id = pub1.body.currentSnapshotId;

      // 10. Author updates draft taxonomy to Backend category and NestJS tag
      await articlesService.updateDraftMetadata(userA, draft.id, {
        categoryId: catBackend.id,
        tagIds: [tagNest.id],
        expectedRevision: 2,
      });

      // Add another block to increment draft revision (revision 4)
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 3,
        content: { html: '<p>Part 2: NestJS Microservice</p>' },
      });

      // Verify original snapshot 1 before republication remains untouched
      const snap1BeforeRepub = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: snap1Id },
      });
      const tax1Before = snap1BeforeRepub!.taxonomy as any;
      expect(tax1Before.category.slug).toBe('frontend-architecture');
      expect(tax1Before.tags[0].slug).toBe('angular');

      // 11. Republish article at revision 4
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 4 })
        .expect(200);

      const snap2Id = pub2.body.currentSnapshotId;
      expect(snap2Id).not.toBe(snap1Id);
      expect(pub2.body.publishedRevision).toBe(4);

      // 12. Verify Historical Immutability
      // Snapshot 1 retains original frontend category and angular tag
      const snap1AfterRepub = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: snap1Id },
      });
      const tax1After = snap1AfterRepub!.taxonomy as any;
      expect(tax1After.category.slug).toBe('frontend-architecture');
      expect(tax1After.tags[0].slug).toBe('angular');

      // Snapshot 2 has updated backend category and nestjs tag
      const snap2AfterRepub = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: snap2Id },
      });
      const tax2After = snap2AfterRepub!.taxonomy as any;
      expect(tax2After.category.slug).toBe('backend-services');
      expect(tax2After.tags[0].slug).toBe('nestjs');
    });
  });

  describe('D. Administrator Master Data Mutations & Concurrency Scenarios', () => {
    // C1: Category rename committed BEFORE publication transaction begins
    it('Scenario C1: Category rename committed before publication captures updated category name and slug', async () => {
      currentUserInjected = userA;
      const catC1 = await prismaAdmin.category.create({
        data: { name: 'C1 Initial Category', slug: 'c1-initial-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'C1 Publication Concurrency',
        draftSlug: 'c1-publication-concurrency',
        categoryId: catC1.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>C1 Content</p>' },
      });

      // Administrator renames category and commits before author publication
      await prismaAdmin.category.update({
        where: { id: catC1.id },
        data: { name: 'C1 Renamed Category', slug: 'c1-renamed-category' },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.category).toEqual({
        id: catC1.id,
        name: 'C1 Renamed Category',
        slug: 'c1-renamed-category',
      });
    });

    // C2: Category rename committed AFTER publication snapshot capture
    it('Scenario C2: Category rename committed after publication leaves immutable snapshot unchanged', async () => {
      currentUserInjected = userA;
      const catC2 = await prismaAdmin.category.create({
        data: { name: 'C2 Initial Category', slug: 'c2-initial-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'C2 Publication Immutability',
        draftSlug: 'c2-publication-immutability',
        categoryId: catC2.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>C2 Content</p>' },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Administrator renames category after publication
      await prismaAdmin.category.update({
        where: { id: catC2.id },
        data: { name: 'C2 Mutated Category', slug: 'c2-mutated-category' },
      });

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.category.name).toBe('C2 Initial Category');
      expect(tax.category.slug).toBe('c2-initial-category');
    });

    // C-DEL-1: Normal Category deletion before publication
    it('Scenario C-DEL-1: Normal Category deletion before publication produces SQL NULL on draft and JSON null in snapshot taxonomy', async () => {
      currentUserInjected = userA;
      const catCDEL1 = await prismaAdmin.category.create({
        data: { name: 'Normal Delete Category', slug: 'normal-delete-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'C-DEL-1 Normal Delete Before Publish',
        draftSlug: 'c-del-1-normal-delete-before-publish',
        categoryId: catCDEL1.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>C-DEL-1 Content</p>' },
      });

      // Normal Category deletion via supported admin operation (standard PostgreSQL ON DELETE SET NULL)
      await prismaAdmin.category.delete({
        where: { id: catCDEL1.id },
      });

      // Query draft directly: articles.category_id was set NULL by PostgreSQL FK trigger
      const updatedDraft = await prismaRuntime.article.findUnique({
        where: { id: draft.id },
      });
      expect(updatedDraft!.categoryId).toBeNull();

      // Publish draft at revision 2
      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.schemaVersion).toBe(1);
      expect(tax.category).toBeNull();
      expect(tax.tags).toEqual([]);
    });

    // C-DEL-2: Mandatory deterministic race: In-flight Category deletion while Article is locked
    it('Scenario C-DEL-2: In-flight Category deletion while Article is locked blocks on PostgreSQL row lock and preserves frozen Category in snapshot', async () => {
      currentUserInjected = userA;
      const catCDEL2 = await prismaAdmin.category.create({
        data: { name: 'In-Flight Locked Category', slug: 'in-flight-locked-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'C-DEL-2 Concurrency Race',
        draftSlug: 'c-del-2-concurrency-race',
        categoryId: catCDEL2.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>C-DEL-2 Content</p>' },
      });

      // Synchronize using deferred promises
      const lockAcquiredDeferred = createDeferred<void>();
      const allowCaptureDeferred = createDeferred<void>();

      // Spy on captureDraftTaxonomy: Transaction A has already executed findArticleForUpdate and holds Article FOR UPDATE lock!
      const originalCapture = publicationRepo.captureDraftTaxonomy.bind(publicationRepo);
      const captureSpy = vi.spyOn(publicationRepo, 'captureDraftTaxonomy').mockImplementationOnce(async (artId, tx) => {
        // Signal that Transaction A has acquired the Article row lock FOR UPDATE
        lockAcquiredDeferred.resolve();
        // Wait until Transaction B attempts Category deletion and is confirmed waiting on the lock
        await allowCaptureDeferred.promise;
        return originalCapture(artId, tx);
      });

      try {
        // Start publication immediately in background (Transaction A)
        const pubPromise = (async () => {
          return request(app.getHttpServer())
            .post(`/articles/${draft.id}/publish`)
            .send({ expectedRevision: 2 });
        })();

        // Await Transaction A acquiring the Article row lock
        await lockAcquiredDeferred.promise;

        // Start independent Category deletion (Transaction B) via admin connection
        let deleteResolved = false;
        const deletePromise = prismaAdmin.category.delete({
          where: { id: catCDEL2.id },
        }).then((res) => {
          deleteResolved = true;
          return res;
        });

        // Poll PostgreSQL pg_locks to verify that Transaction B is actively blocked
        const isBlocked = await waitForBlockedLock(disposableDbName, 4000);
        expect(isBlocked).toBe(true);
        expect(deleteResolved).toBe(false);

        // Allow Transaction A to proceed with taxonomy capture, snapshot creation, and commit
        allowCaptureDeferred.resolve();

        // Transaction A commits first
        const pubResponse = await pubPromise;
        expect(pubResponse.status).toBe(200);

        // Once Transaction A commits and releases the Article row lock, Transaction B completes
        await deletePromise;
        expect(deleteResolved).toBe(true);

        // Verification: Snapshot retains frozen Category values
        const snapshot = await prismaRuntime.articleSnapshot.findUnique({
          where: { id: pubResponse.body.currentSnapshotId },
        });
        const tax = snapshot!.taxonomy as any;
        expect(tax.category).toEqual({
          id: catCDEL2.id,
          name: 'In-Flight Locked Category',
          slug: 'in-flight-locked-category',
        });

        // Verification: Live article row draft category_id was set NULL by PostgreSQL ON DELETE SET NULL
        const articleRow = await prismaRuntime.article.findUnique({
          where: { id: draft.id },
        });
        expect(articleRow!.categoryId).toBeNull();

        // Verification: Category row in master table is gone
        const catInDb = await prismaRuntime.category.findUnique({
          where: { id: catCDEL2.id },
        });
        expect(catInDb).toBeNull();
      } finally {
        captureSpy.mockRestore();
      }
    }, 15000);

    // C-DEL-3: Category delete after publication leaves snapshot taxonomy intact with frozen category
    it('Scenario C-DEL-3: Category delete after publication leaves snapshot taxonomy intact with frozen category', async () => {
      currentUserInjected = userA;
      const catCDEL3 = await prismaAdmin.category.create({
        data: { name: 'C-DEL-3 Frozen Category', slug: 'c-del-3-frozen-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'C-DEL-3 Delete After Publish',
        draftSlug: 'c-del-3-delete-after-publish',
        categoryId: catCDEL3.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>C-DEL-3 Content</p>' },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Delete category row from master table
      await prismaAdmin.category.delete({
        where: { id: catCDEL3.id },
      });

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.category).toEqual({
        id: catCDEL3.id,
        name: 'C-DEL-3 Frozen Category',
        slug: 'c-del-3-frozen-category',
      });
    });

    // T1: Tag rename committed BEFORE publication transaction begins
    it('Scenario T1: Tag rename committed before publication captures updated tag name and slug', async () => {
      currentUserInjected = userA;
      const tagT1 = await prismaAdmin.tag.create({
        data: { name: 'T1 Initial Tag', slug: 't1-initial-tag' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'T1 Tag Rename Before Publish',
        draftSlug: 't1-tag-rename-before-publish',
        tagIds: [tagT1.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>T1 Content</p>' },
      });

      // Administrator renames tag and commits
      await prismaAdmin.tag.update({
        where: { id: tagT1.id },
        data: { name: 'T1 Renamed Tag', slug: 't1-renamed-tag' },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.tags).toHaveLength(1);
      expect(tax.tags[0]).toEqual({
        id: tagT1.id,
        name: 'T1 Renamed Tag',
        slug: 't1-renamed-tag',
      });
    });

    // T2: Tag rename committed AFTER publication snapshot capture
    it('Scenario T2: Tag rename committed after publication leaves immutable snapshot unchanged', async () => {
      currentUserInjected = userA;
      const tagT2 = await prismaAdmin.tag.create({
        data: { name: 'T2 Initial Tag', slug: 't2-initial-tag' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'T2 Tag Rename After Publish',
        draftSlug: 't2-tag-rename-after-publish',
        tagIds: [tagT2.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>T2 Content</p>' },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Administrator renames tag after publication
      await prismaAdmin.tag.update({
        where: { id: tagT2.id },
        data: { name: 'T2 Mutated Tag', slug: 't2-mutated-tag' },
      });

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.tags[0].name).toBe('T2 Initial Tag');
      expect(tax.tags[0].slug).toBe('t2-initial-tag');
    });

    // T-DEL-1: Normal Tag deletion before capture
    it('Scenario T-DEL-1: Normal Tag deletion before publication cascades junction deletion and results in clean omission without dangling references', async () => {
      currentUserInjected = userA;
      const tagTDEL1 = await prismaAdmin.tag.create({
        data: { name: 'T-DEL-1 Ephemeral Tag', slug: 't-del-1-ephemeral-tag' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'T-DEL-1 Tag Deleted Before Publish',
        draftSlug: 't-del-1-tag-deleted-before-publish',
        tagIds: [tagTDEL1.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>T-DEL-1 Content</p>' },
      });

      // Administrator deletes tag before author publishes (cascades delete on article_tags)
      await prismaAdmin.tag.delete({
        where: { id: tagTDEL1.id },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      // Tag was cleanly omitted because join produced no tags
      expect(tax.tags).toEqual([]);
    });

    // T-DEL-2: Mandatory deterministic race: In-flight Tag deletion after capture but before publication commit
    it('Scenario T-DEL-2: In-flight Tag deletion after capture but before publication commit preserves frozen captured Tag in snapshot', async () => {
      currentUserInjected = userA;
      const tagTDEL2 = await prismaAdmin.tag.create({
        data: { name: 'In-Flight Deletion Tag', slug: 'in-flight-deletion-tag' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'T-DEL-2 Concurrency Race',
        draftSlug: 't-del-2-concurrency-race',
        tagIds: [tagTDEL2.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>T-DEL-2 Content</p>' },
      });

      const capturedDeferred = createDeferred<void>();
      const allowCommitDeferred = createDeferred<void>();

      // Spy on createSnapshot: Transaction A has already captured draft taxonomy into data.taxonomy!
      const originalCreateSnapshot = publicationRepo.createSnapshot.bind(publicationRepo);
      const snapshotSpy = vi.spyOn(publicationRepo, 'createSnapshot').mockImplementationOnce(async (data, tx) => {
        // Signal that taxonomy has been captured into data.taxonomy
        capturedDeferred.resolve();
        // Wait while Transaction B deletes the Tag
        await allowCommitDeferred.promise;
        return originalCreateSnapshot(data, tx);
      });

      try {
        // Start publication immediately in background (Transaction A)
        const pubPromise = (async () => {
          return request(app.getHttpServer())
            .post(`/articles/${draft.id}/publish`)
            .send({ expectedRevision: 2 });
        })();

        // Await Transaction A capturing taxonomy
        await capturedDeferred.promise;

        // Transaction B deletes the Tag while Transaction A is still open!
        // In PostgreSQL, deleting a Tag cascades deletion on article_tags without blocking on the articles row lock.
        await prismaAdmin.tag.delete({
          where: { id: tagTDEL2.id },
        });

        // Verify Tag T is already deleted from master table and junction table
        const tagInDb = await prismaRuntime.tag.findUnique({
          where: { id: tagTDEL2.id },
        });
        expect(tagInDb).toBeNull();

        const junctionRows = await prismaRuntime.articleTag.findMany({
          where: { tagId: tagTDEL2.id },
        });
        expect(junctionRows).toHaveLength(0);

        // Now allow Transaction A to complete snapshot creation and commit
        allowCommitDeferred.resolve();

        const pubResponse = await pubPromise;
        expect(pubResponse.status).toBe(200);

        // Verification: Snapshot retains frozen captured Tag metadata
        const snapshot = await prismaRuntime.articleSnapshot.findUnique({
          where: { id: pubResponse.body.currentSnapshotId },
        });
        const tax = snapshot!.taxonomy as any;
        expect(tax.tags).toHaveLength(1);
        expect(tax.tags[0]).toEqual({
          id: tagTDEL2.id,
          name: 'In-Flight Deletion Tag',
          slug: 'in-flight-deletion-tag',
        });
      } finally {
        snapshotSpy.mockRestore();
      }
    }, 15000);

    // T-DEL-3: Tag deleted AFTER publication
    it('Scenario T-DEL-3: Tag deleted after publication leaves snapshot taxonomy intact with frozen tag document', async () => {
      currentUserInjected = userA;
      const tagTDEL3 = await prismaAdmin.tag.create({
        data: { name: 'T-DEL-3 Frozen Tag', slug: 't-del-3-frozen-tag' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'T-DEL-3 Tag Deleted After Publish',
        draftSlug: 't-del-3-tag-deleted-after-publish',
        tagIds: [tagTDEL3.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>T-DEL-3 Content</p>' },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Administrator deletes tag after publication
      await prismaAdmin.tag.delete({
        where: { id: tagTDEL3.id },
      });

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.tags).toHaveLength(1);
      expect(tax.tags[0]).toEqual({
        id: tagTDEL3.id,
        name: 'T-DEL-3 Frozen Tag',
        slug: 't-del-3-frozen-tag',
      });
    });

    // Scenario K: Injected missing-category reference (simulated orphaned draftCategoryId)
    it('Scenario K (Injected Anomaly): Injected missing-category reference (simulated orphaned draftCategoryId) fails publication with 409 Conflict and atomic rollback', async () => {
      currentUserInjected = userA;
      const catAnom = await prismaAdmin.category.create({
        data: { name: 'Injected Anomaly Category', slug: 'injected-anomaly-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'Injected Anomaly Test',
        draftSlug: 'injected-anomaly-test',
        categoryId: catAnom.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>Anomaly Content</p>' },
      });

      // Detach foreign key constraint temporarily in this isolated test database to inject an orphaned category reference
      runAdminPsql(`
        ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_category_id_fkey";
        UPDATE "articles" SET category_id = '${catAnom.id}' WHERE id = '${draft.id}';
      `, disposableDbName);

      // Delete the category row from categories table leaving an orphaned draftCategoryId
      await prismaAdmin.category.delete({
        where: { id: catAnom.id },
      });

      // Publication must detect categoryId is null while draftCategoryId is set -> 409 Conflict
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(409);

      // Verify no partial snapshot was created
      const snapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: draft.id },
      });
      expect(snapshots).toHaveLength(0);

      // Restore foreign key constraint
      runAdminPsql(`
        UPDATE "articles" SET category_id = NULL WHERE category_id = '${catAnom.id}';
        ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      `, disposableDbName);
    });

    // Deterministic MVCC Transaction Isolation for Category
    it('demonstrates deterministic MVCC isolation: in-flight uncommitted category update is invisible to concurrent publication', async () => {
      currentUserInjected = userA;
      const catMVCC = await prismaAdmin.category.create({
        data: { name: 'Committed Category Name', slug: 'committed-cat-slug' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'MVCC Category Isolation Test',
        draftSlug: 'mvcc-category-isolation-test',
        categoryId: catMVCC.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>MVCC Category Content</p>' },
      });

      // Open interactive transaction simulating concurrent in-flight admin mutation
      await prismaAdmin.$transaction(async (adminTx) => {
        await adminTx.category.update({
          where: { id: catMVCC.id },
          data: { name: 'In-Flight Uncommitted Name', slug: 'in-flight-slug' },
        });

        // While adminTx holds the uncommitted update, author publishes via independent runtime connection
        const pub = await request(app.getHttpServer())
          .post(`/articles/${draft.id}/publish`)
          .send({ expectedRevision: 2 })
          .expect(200);

        const snapshot = await prismaRuntime.articleSnapshot.findUnique({
          where: { id: pub.body.currentSnapshotId },
        });
        const tax = snapshot!.taxonomy as any;
        // Read committed isolation guarantees author snapshot sees committed name!
        expect(tax.category.name).toBe('Committed Category Name');
        expect(tax.category.slug).toBe('committed-cat-slug');
      });

      // Now that adminTx has committed, update draft to increment revision and republish
      await articlesService.updateDraftMetadata(userA, draft.id, {
        title: 'MVCC Category Isolation Test Republished',
        expectedRevision: 2,
      });

      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      const snap2 = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub2.body.currentSnapshotId },
      });
      const tax2 = snap2!.taxonomy as any;
      // Second snapshot captures the now-committed category values
      expect(tax2.category.name).toBe('In-Flight Uncommitted Name');
      expect(tax2.category.slug).toBe('in-flight-slug');
    });

    // Deterministic MVCC Transaction Isolation for Tag
    it('demonstrates deterministic MVCC isolation: in-flight uncommitted tag update is invisible to concurrent publication', async () => {
      currentUserInjected = userA;
      const tagMVCC = await prismaAdmin.tag.create({
        data: { name: 'Committed Tag Name', slug: 'committed-tag-slug' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'MVCC Tag Isolation Test',
        draftSlug: 'mvcc-tag-isolation-test',
        tagIds: [tagMVCC.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>MVCC Tag Content</p>' },
      });

      // Open interactive transaction holding uncommitted tag update
      await prismaAdmin.$transaction(async (adminTx) => {
        await adminTx.tag.update({
          where: { id: tagMVCC.id },
          data: { name: 'In-Flight Uncommitted Tag', slug: 'in-flight-tag-slug' },
        });

        // While adminTx holds the uncommitted update, author publishes
        const pub = await request(app.getHttpServer())
          .post(`/articles/${draft.id}/publish`)
          .send({ expectedRevision: 2 })
          .expect(200);

        const snapshot = await prismaRuntime.articleSnapshot.findUnique({
          where: { id: pub.body.currentSnapshotId },
        });
        const tax = snapshot!.taxonomy as any;
        expect(tax.tags[0].name).toBe('Committed Tag Name');
        expect(tax.tags[0].slug).toBe('committed-tag-slug');
      });

      // Republish after adminTx commits
      await articlesService.updateDraftMetadata(userA, draft.id, {
        title: 'MVCC Tag Isolation Test Republished',
        expectedRevision: 2,
      });

      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      const snap2 = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub2.body.currentSnapshotId },
      });
      const tax2 = snap2!.taxonomy as any;
      expect(tax2.tags[0].name).toBe('In-Flight Uncommitted Tag');
      expect(tax2.tags[0].slug).toBe('in-flight-tag-slug');
    });
  });

  describe('E. Concurrency, Revisions & Atomic Rollback', () => {
    let catTest: { id: string; name: string; slug: string };
    let tagTest: { id: string; name: string; slug: string };

    beforeAll(async () => {
      catTest = await prismaAdmin.category.create({
        data: { name: 'Concurrency Testing', slug: 'concurrency-testing' },
      });
      tagTest = await prismaAdmin.tag.create({
        data: { name: 'Transaction Isolation', slug: 'transaction-isolation' },
      });
    });

    it('17. rejects publish request with stale expectedRevision (409 Conflict) and creates no snapshot', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Optimistic Concurrency Verification',
        draftSlug: 'optimistic-concurrency-verification',
        categoryId: catTest.id,
        tagIds: [tagTest.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.RICH_TEXT,
        expectedRevision: 1,
        content: { html: '<p>Testing revision mismatches.</p>' },
      });

      // Stale revision: expectedRevision: 1 when current revision is 2
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 1 })
        .expect(409);

      // Verify no snapshot was created
      const snapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: draft.id },
      });
      expect(snapshots).toHaveLength(0);
    });

    it('18. rolls back transaction completely on publication failure leaving no partial records', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Rollback Atomicity Validation',
        draftSlug: 'rollback-atomicity-validation',
        categoryId: catTest.id,
      });

      // Add a block
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Rollback Heading', level: 2 },
      });

      // Simulate conflict by publishing once
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Attempting to republish without any draft edits (no-op republish) must fail with 409
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(409);

      // Exactly 1 snapshot exists, no second partial snapshot
      const snapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: draft.id },
      });
      expect(snapshots).toHaveLength(1);
    });

    it('21. serializes concurrent draft taxonomy edits against article row lock', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Lock Serialization Test',
        draftSlug: 'lock-serialization-test',
        categoryId: catTest.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Locking Section', level: 2 },
      });

      // If draft taxonomy is updated concurrently, draftRevision increments to 3
      await articlesService.updateDraftMetadata(userA, draft.id, {
        tagIds: [tagTest.id],
        expectedRevision: 2,
      });

      // Publishing with expectedRevision: 2 must fail due to revision conflict
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(409);

      // Publishing with the updated expectedRevision: 3 succeeds and captures the newly assigned tag
      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.tags).toHaveLength(1);
      expect(tax.tags[0].slug).toBe('transaction-isolation');
    });

    it('22 & 24. fails publication (409 Conflict) if draft category was deleted or missing', async () => {
      currentUserInjected = userA;

      const catEphemeral = await prismaAdmin.category.create({
        data: { name: 'Ephemeral Category', slug: 'ephemeral-category' },
      });

      const draft = await articlesService.createDraft(userA, {
        title: 'Missing Category Race Test',
        draftSlug: 'missing-category-race-test',
        categoryId: catEphemeral.id,
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 2 },
      });

      // Drop FK check and directly set non-existent categoryId to simulate missing Category race
      runAdminPsql(`
        ALTER TABLE "articles" DROP CONSTRAINT "articles_category_id_fkey";
        UPDATE "articles" SET category_id = '00000000-0000-4000-8000-000000000999' WHERE id = '${draft.id}';
      `, disposableDbName);

      // Publication should detect draftCategoryId is non-null but categoryId is null -> 409 Conflict
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(409);

      // Confirm no snapshot was created
      const snapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: draft.id },
      });
      expect(snapshots).toHaveLength(0);
    });

    it('23. observes single coherent MVCC view of tags during capture', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'MVCC Coherent Tags Test',
        draftSlug: 'mvcc-coherent-tags-test',
        tagIds: [tagTest.id],
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'MVCC Content', level: 2 },
      });

      const pub = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: pub.body.currentSnapshotId },
      });
      const tax = snapshot!.taxonomy as any;
      expect(tax.tags).toHaveLength(1);
      expect(tax.tags[0].name).toBe('Transaction Isolation');
    });

    it('25. fails publication safely if direct database state has more than 20 tags', async () => {
      currentUserInjected = userA;

      const draft = await articlesService.createDraft(userA, {
        title: 'Excessive Tags Test',
        draftSlug: 'excessive-tags-test',
      });

      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Content', level: 2 },
      });

      // Insert 21 tags directly into database to simulate anomalous state
      const tagIds: string[] = [];
      for (let i = 0; i < 21; i++) {
        const t = await prismaAdmin.tag.create({
          data: {
            name: `Anomalous Tag ${i}`,
            slug: `anomalous-tag-${String(i).padStart(2, '0')}`,
          },
        });
        tagIds.push(t.id);
        await prismaAdmin.articleTag.create({
          data: {
            articleId: draft.id,
            tagId: t.id,
          },
        });
      }

      // Publish should reject with 400 Bad Request
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(400);

      // Verify no snapshot was created
      const snapshots = await prismaRuntime.articleSnapshot.findMany({
        where: { articleId: draft.id },
      });
      expect(snapshots).toHaveLength(0);
    });
  });

  describe('F. Repository createSnapshot Runtime Guard & Mandatory Taxonomy Verification', () => {
    let testArticleId: string;

    beforeAll(async () => {
      const art = await prismaAdmin.article.create({
        data: {
          authorId: authorA.id,
          title: 'Direct Repository Guard Verification',
          draftSlug: 'direct-repo-guard-verification',
          status: 'DRAFT',
          typographyPreset: 'MODERN_SANS',
          draftRevision: 1,
        },
      });
      testArticleId = art.id;
    });

    it('rejects createSnapshot call when taxonomy property is omitted (BadRequestException)', async () => {
      const countBefore = await prismaRuntime.articleSnapshot.count({
        where: { articleId: testArticleId },
      });

      await expect(
        publicationRepo.transaction(async (tx) => {
          return publicationRepo.createSnapshot(
            {
              articleId: testArticleId,
              snapshotRevision: 10,
              title: 'Omitted Taxonomy Test',
              publishedSlug: 'omitted-taxonomy-test',
              typographyPreset: 'MODERN_SANS',
              blocks: { schemaVersion: 1, blocks: [] },
            } as any,
            tx,
          );
        }),
      ).rejects.toThrow(BadRequestException);

      const countAfter = await prismaRuntime.articleSnapshot.count({
        where: { articleId: testArticleId },
      });
      expect(countAfter).toBe(countBefore);
    });

    it('rejects createSnapshot call when taxonomy is Prisma.JsonNull and preserves state (BadRequestException)', async () => {
      const snapCountBefore = await prismaRuntime.articleSnapshot.count({
        where: { articleId: testArticleId },
      });
      const mediaRetentionCountBefore = await prismaRuntime.articleSnapshotMedia.count();
      const draftBefore = await prismaRuntime.article.findUnique({
        where: { id: testArticleId },
      });

      await expect(
        publicationRepo.transaction(async (tx) => {
          return publicationRepo.createSnapshot(
            {
              articleId: testArticleId,
              snapshotRevision: 11,
              title: 'JsonNull Taxonomy Test',
              publishedSlug: 'jsonnull-taxonomy-test',
              typographyPreset: 'MODERN_SANS',
              blocks: { schemaVersion: 1, blocks: [] },
              taxonomy: Prisma.JsonNull as any,
            },
            tx,
          );
        }),
      ).rejects.toThrow(BadRequestException);

      const snapCountAfter = await prismaRuntime.articleSnapshot.count({
        where: { articleId: testArticleId },
      });
      const mediaRetentionCountAfter = await prismaRuntime.articleSnapshotMedia.count();
      const draftAfter = await prismaRuntime.article.findUnique({
        where: { id: testArticleId },
      });

      expect(snapCountAfter).toBe(snapCountBefore);
      expect(mediaRetentionCountAfter).toBe(mediaRetentionCountBefore);
      expect(draftAfter?.currentSnapshotId).toBe(draftBefore?.currentSnapshotId);
    });

    it('rejects createSnapshot call when taxonomy is Prisma.DbNull (BadRequestException)', async () => {
      await expect(
        publicationRepo.transaction(async (tx) => {
          return publicationRepo.createSnapshot(
            {
              articleId: testArticleId,
              snapshotRevision: 12,
              title: 'DbNull Taxonomy Test',
              publishedSlug: 'dbnull-taxonomy-test',
              typographyPreset: 'MODERN_SANS',
              blocks: { schemaVersion: 1, blocks: [] },
              taxonomy: Prisma.DbNull as any,
            },
            tx,
          );
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects createSnapshot call when taxonomy has invalid schemaVersion (BadRequestException)', async () => {
      await expect(
        publicationRepo.transaction(async (tx) => {
          return publicationRepo.createSnapshot(
            {
              articleId: testArticleId,
              snapshotRevision: 13,
              title: 'Invalid SchemaVersion Test',
              publishedSlug: 'invalid-schemaversion-test',
              typographyPreset: 'MODERN_SANS',
              blocks: { schemaVersion: 1, blocks: [] },
              taxonomy: { schemaVersion: 99, category: null, tags: [] } as any,
            },
            tx,
          );
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully persists snapshot when valid schemaVersion 1 taxonomy document is supplied', async () => {
      const created = await publicationRepo.transaction(async (tx) => {
        return publicationRepo.createSnapshot(
          {
            articleId: testArticleId,
            snapshotRevision: 1,
            title: 'Valid Repo Snapshot',
            publishedSlug: 'valid-repo-snapshot',
            typographyPreset: 'MODERN_SANS',
            blocks: { schemaVersion: 1, blocks: [] },
            taxonomy: {
              schemaVersion: 1,
              category: null,
              tags: [],
            },
          },
          tx,
        );
      });

      expect(created.id).toBeDefined();
      expect(created.taxonomy).toEqual({
        schemaVersion: 1,
        category: null,
        tags: [],
      });

      // Verify at the PostgreSQL level: taxonomy is NOT SQL NULL and NOT JSON literal null
      const rawRows = await prismaAdmin.$queryRaw<
        Array<{ is_sql_null: boolean; is_json_null: boolean; is_structured: boolean }>
      >`
        SELECT (taxonomy IS NULL) AS is_sql_null,
               (taxonomy = 'null'::jsonb) AS is_json_null,
               (taxonomy IS NOT NULL AND taxonomy <> 'null'::jsonb) AS is_structured
        FROM article_snapshots
        WHERE id = ${created.id}::uuid;
      `;
      expect(rawRows).toHaveLength(1);
      expect(rawRows[0].is_sql_null).toBe(false);
      expect(rawRows[0].is_json_null).toBe(false);
      expect(rawRows[0].is_structured).toBe(true);
    });

    it('preserves readability of historical pre-migration snapshots with SQL NULL taxonomy', async () => {
      // Simulate historical snapshot created before the taxonomy migration
      const historical = await prismaAdmin.articleSnapshot.create({
        data: {
          articleId: testArticleId,
          snapshotRevision: 999,
          title: 'Historical Legacy Snapshot',
          publishedSlug: 'historical-legacy-snapshot',
          typographyPreset: 'MODERN_SANS',
          blocks: { schemaVersion: 1, blocks: [] },
          taxonomy: Prisma.DbNull,
        },
      });

      const readBack = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: historical.id },
      });
      expect(readBack).not.toBeNull();
      expect(readBack!.id).toBe(historical.id);
      expect(readBack!.taxonomy).toBeNull();
    });
  });

  describe('G. Public Article Reader Immutable Taxonomy Integration (E2E)', () => {
    let catArch: { id: string; name: string; slug: string };
    let catFront: { id: string; name: string; slug: string };
    let tagRust: { id: string; name: string; slug: string };
    let tagSystems: { id: string; name: string; slug: string };
    let tagWasm: { id: string; name: string; slug: string };

    beforeAll(async () => {
      catArch = await prismaAdmin.category.create({
        data: { name: 'Architecture & Design', slug: 'pub-reader-cat-arch' },
      });
      catFront = await prismaAdmin.category.create({
        data: { name: 'Frontend Engineering', slug: 'pub-reader-cat-front' },
      });
      tagRust = await prismaAdmin.tag.create({
        data: { name: 'Rust', slug: 'pub-reader-tag-rust' },
      });
      tagSystems = await prismaAdmin.tag.create({
        data: { name: 'Systems Programming', slug: 'pub-reader-tag-systems' },
      });
      tagWasm = await prismaAdmin.tag.create({
        data: { name: 'WebAssembly', slug: 'pub-reader-tag-wasm' },
      });
    });

    it('1. Public Detail — Populated Category and Tags: returns 200, taxonomyCaptured=true, exact matching category and tags', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Pub Detail Populated',
        draftSlug: 'pub-detail-populated',
        categoryId: catArch.id,
        tagIds: [tagSystems.id, tagRust.id, tagWasm.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const snapshotId = pubRes.body.currentSnapshotId;
      const snapshot = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: snapshotId },
      });
      const snapTax = snapshot!.taxonomy as any;

      const res = await request(app.getHttpServer())
        .get('/articles/public/pub-detail-populated')
        .expect(200);

      expect(res.body.slug).toBe('pub-detail-populated');
      expect(res.body.taxonomyCaptured).toBe(true);
      expect(res.body.category).toEqual({
        id: catArch.id,
        name: catArch.name,
        slug: catArch.slug,
      });
      expect(res.body.tags).toHaveLength(3);
      expect(res.body.tags).toEqual(snapTax.tags);
    });

    it('2. Public Detail — Populated Category, Zero Tags: returns 200, taxonomyCaptured=true, category populated, tags=[]', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Pub Detail Cat Only',
        draftSlug: 'pub-detail-cat-only',
        categoryId: catArch.id,
        tagIds: [],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/articles/public/pub-detail-cat-only')
        .expect(200);

      expect(res.body.taxonomyCaptured).toBe(true);
      expect(res.body.category).toEqual({
        id: catArch.id,
        name: catArch.name,
        slug: catArch.slug,
      });
      expect(res.body.tags).toEqual([]);
    });

    it('3. Public Detail — Zero Category, Populated Tags: returns 200, taxonomyCaptured=true, category=null, tags populated', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Pub Detail Tags Only',
        draftSlug: 'pub-detail-tags-only',
        tagIds: [tagRust.id, tagSystems.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/articles/public/pub-detail-tags-only')
        .expect(200);

      expect(res.body.taxonomyCaptured).toBe(true);
      expect(res.body.category).toBeNull();
      expect(res.body.tags).toHaveLength(2);
      expect(res.body.tags.map((t: any) => t.id)).toEqual([tagRust.id, tagSystems.id]);
    });

    it('4. Public Detail — Captured Empty Taxonomy: returns 200, taxonomyCaptured=true, category=null, tags=[]', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Pub Detail Captured Empty',
        draftSlug: 'pub-detail-captured-empty',
        tagIds: [],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/articles/public/pub-detail-captured-empty')
        .expect(200);

      expect(res.body.taxonomyCaptured).toBe(true);
      expect(res.body.category).toBeNull();
      expect(res.body.tags).toEqual([]);
    });

    it('5. Public Detail — Legacy Pre-Migration SQL NULL Snapshot: returns 200, taxonomyCaptured=false, category=null, tags=[]', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Pub Detail Legacy Null',
        draftSlug: 'pub-detail-legacy-null',
        categoryId: catArch.id,
        tagIds: [tagRust.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Force taxonomy to authentic SQL NULL to simulate pre-migration snapshot
      await prismaAdmin.$executeRaw`
        UPDATE article_snapshots
        SET taxonomy = NULL
        WHERE id = ${pubRes.body.currentSnapshotId}::uuid;
      `;

      const res = await request(app.getHttpServer())
        .get('/articles/public/pub-detail-legacy-null')
        .expect(200);

      expect(res.body.taxonomyCaptured).toBe(false);
      expect(res.body.category).toBeNull();
      expect(res.body.tags).toEqual([]);
    });

    it('6. Public List — Mixed Legacy and Modern Articles: returns articles in deterministic order with respective taxonomy flags', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?limit=50')
        .expect(200);

      expect(res.body.items.length).toBeGreaterThanOrEqual(4);

      const legacyItem = res.body.items.find(
        (it: any) => it.slug === 'pub-detail-legacy-null',
      );
      expect(legacyItem).toBeDefined();
      expect(legacyItem.taxonomyCaptured).toBe(false);
      expect(legacyItem.category).toBeNull();
      expect(legacyItem.tags).toEqual([]);

      const populatedItem = res.body.items.find(
        (it: any) => it.slug === 'pub-detail-populated',
      );
      expect(populatedItem).toBeDefined();
      expect(populatedItem.taxonomyCaptured).toBe(true);
      expect(populatedItem.category).toEqual({
        id: catArch.id,
        name: catArch.name,
        slug: catArch.slug,
      });
      expect(populatedItem.tags).toHaveLength(3);

      const emptyItem = res.body.items.find(
        (it: any) => it.slug === 'pub-detail-captured-empty',
      );
      expect(emptyItem).toBeDefined();
      expect(emptyItem.taxonomyCaptured).toBe(true);
      expect(emptyItem.category).toBeNull();
      expect(emptyItem.tags).toEqual([]);
    });

    it('7. Post-Publication Draft Category Mutation Isolation: public reader continues returning frozen snapshot category', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Draft Cat Mutation Isolation',
        draftSlug: 'draft-cat-mutation-isolation',
        categoryId: catArch.id,
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Mutate draft category to Frontend
      await articlesService.updateDraftMetadata(userA, draft.id, {
        expectedRevision: 2,
        categoryId: catFront.id,
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/draft-cat-mutation-isolation')
        .expect(200);

      expect(res.body.category.id).toBe(catArch.id);
      expect(res.body.category.name).toBe(catArch.name);
    });

    it('8. Post-Publication Draft Category Disassociation Isolation: clearing draft category leaves public snapshot taxonomy unchanged', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Draft Cat Disassoc Isolation',
        draftSlug: 'draft-cat-disassoc-isolation',
        categoryId: catArch.id,
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Disassociate category from draft
      await articlesService.updateDraftMetadata(userA, draft.id, {
        expectedRevision: 2,
        categoryId: null,
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/draft-cat-disassoc-isolation')
        .expect(200);

      expect(res.body.category.id).toBe(catArch.id);
      expect(res.body.category.name).toBe(catArch.name);
    });

    it('9. Post-Publication Draft Tag Association/Disassociation Isolation: mutating draft tags leaves public snapshot tags unchanged', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Draft Tag Mutation Isolation',
        draftSlug: 'draft-tag-mutation-isolation',
        tagIds: [tagRust.id, tagSystems.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Mutate draft tags: remove Rust, add Wasm
      await articlesService.updateDraftMetadata(userA, draft.id, {
        expectedRevision: 2,
        tagIds: [tagWasm.id],
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/draft-tag-mutation-isolation')
        .expect(200);

      expect(res.body.tags).toHaveLength(2);
      expect(res.body.tags.map((t: any) => t.id)).toEqual([tagRust.id, tagSystems.id]);
    });

    it('10. Master Category Rename Isolation: renaming category in master table leaves public reader returning frozen snapshot taxonomy', async () => {
      const catRenamable = await prismaAdmin.category.create({
        data: { name: 'Original Cat Name', slug: 'orig-cat-name-iso' },
      });
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Master Cat Rename Isolation',
        draftSlug: 'master-cat-rename-isolation',
        categoryId: catRenamable.id,
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Mutate master category
      await prismaAdmin.category.update({
        where: { id: catRenamable.id },
        data: { name: 'Mutated Cat Name', slug: 'mutated-cat-name-iso' },
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/master-cat-rename-isolation')
        .expect(200);

      expect(res.body.category.id).toBe(catRenamable.id);
      expect(res.body.category.name).toBe('Original Cat Name');
      expect(res.body.category.slug).toBe('orig-cat-name-iso');
    });

    it('11. Master Tag Rename Isolation: renaming tag in master table leaves public reader returning frozen snapshot taxonomy', async () => {
      const tagRenamable = await prismaAdmin.tag.create({
        data: { name: 'Original Tag Name', slug: 'orig-tag-name-iso' },
      });
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Master Tag Rename Isolation',
        draftSlug: 'master-tag-rename-isolation',
        tagIds: [tagRenamable.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Mutate master tag
      await prismaAdmin.tag.update({
        where: { id: tagRenamable.id },
        data: { name: 'Mutated Tag Name', slug: 'mutated-tag-name-iso' },
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/master-tag-rename-isolation')
        .expect(200);

      expect(res.body.tags[0].id).toBe(tagRenamable.id);
      expect(res.body.tags[0].name).toBe('Original Tag Name');
      expect(res.body.tags[0].slug).toBe('orig-tag-name-iso');
    });

    it('12. Master Category Soft/Hard Deletion Isolation: deleting category in master table leaves public reader returning frozen snapshot category', async () => {
      const catDeletable = await prismaAdmin.category.create({
        data: { name: 'Deletable Cat', slug: 'deletable-cat-iso' },
      });
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Master Cat Deletion Isolation',
        draftSlug: 'master-cat-deletion-isolation',
        categoryId: catDeletable.id,
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Hard delete category from master table
      await prismaAdmin.category.delete({
        where: { id: catDeletable.id },
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/master-cat-deletion-isolation')
        .expect(200);

      expect(res.body.category.id).toBe(catDeletable.id);
      expect(res.body.category.name).toBe('Deletable Cat');
      expect(res.body.category.slug).toBe('deletable-cat-iso');
    });

    it('13. Master Tag Deletion Isolation: deleting tag in master table leaves public reader returning frozen snapshot taxonomy', async () => {
      const tagDeletable = await prismaAdmin.tag.create({
        data: { name: 'Deletable Tag', slug: 'deletable-tag-iso' },
      });
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Master Tag Deletion Isolation',
        draftSlug: 'master-tag-deletion-isolation',
        tagIds: [tagDeletable.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Hard delete tag from master table
      await prismaAdmin.tag.delete({
        where: { id: tagDeletable.id },
      });

      // Query public reader
      const res = await request(app.getHttpServer())
        .get('/articles/public/master-tag-deletion-isolation')
        .expect(200);

      expect(res.body.tags[0].id).toBe(tagDeletable.id);
      expect(res.body.tags[0].name).toBe('Deletable Tag');
      expect(res.body.tags[0].slug).toBe('deletable-tag-iso');
    });

    it('14. Republication Taxonomy Evolution: republishing promotes active taxonomy to R2 atomically', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Republication Evolution',
        draftSlug: 'republication-evolution',
        categoryId: catArch.id,
        tagIds: [tagRust.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Rev 1 Heading', level: 1 },
      });

      // First publication (Revision 2)
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const resR1 = await request(app.getHttpServer())
        .get('/articles/public/republication-evolution')
        .expect(200);
      expect(resR1.body.category.name).toBe(catArch.name);
      expect(resR1.body.tags[0].name).toBe(tagRust.name);

      // Update draft taxonomy for republication
      await articlesService.updateDraftMetadata(userA, draft.id, {
        expectedRevision: 2,
        categoryId: catFront.id,
        tagIds: [tagWasm.id],
      });

      // Second publication (Revision 3)
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      const resR2 = await request(app.getHttpServer())
        .get('/articles/public/republication-evolution')
        .expect(200);
      expect(resR2.body.category.name).toBe(catFront.name);
      expect(resR2.body.tags[0].name).toBe(tagWasm.name);
    });

    it('15. Draft Non-Leakage (Zero Prior Publication): draft article with taxonomy returns 404', async () => {
      currentUserInjected = userA;
      await articlesService.createDraft(userA, {
        title: 'Draft Never Published',
        draftSlug: 'draft-never-published',
        categoryId: catArch.id,
        tagIds: [tagRust.id],
      });

      await request(app.getHttpServer())
        .get('/articles/public/draft-never-published')
        .expect(404);

      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);
      const found = listRes.body.items.some(
        (it: any) => it.slug === 'draft-never-published',
      );
      expect(found).toBe(false);
    });

    it('16. Unpublished Article With Prior Snapshots: unpublishing returns 404', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Article To Unpublish',
        draftSlug: 'article-to-unpublish',
        categoryId: catArch.id,
        tagIds: [tagRust.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      await request(app.getHttpServer())
        .get('/articles/public/article-to-unpublish')
        .expect(200);

      // Unpublish article by setting status to ARCHIVED
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });

      await request(app.getHttpServer())
        .get('/articles/public/article-to-unpublish')
        .expect(404);

      const listRes = await request(app.getHttpServer())
        .get('/articles/public')
        .expect(200);
      const found = listRes.body.items.some(
        (it: any) => it.slug === 'article-to-unpublish',
      );
      expect(found).toBe(false);
    });

    it('17. Malformed Non-Null Taxonomy Snapshot Safe Failure: fails closed with 404 Not Found', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Article Malformed Snapshot',
        draftSlug: 'article-malformed-snapshot',
        categoryId: catArch.id,
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Corrupt snapshot taxonomy with invalid schemaVersion
      await prismaAdmin.articleSnapshot.update({
        where: { id: pubRes.body.currentSnapshotId },
        data: { taxonomy: { schemaVersion: 999 } },
      });

      await request(app.getHttpServer())
        .get('/articles/public/article-malformed-snapshot')
        .expect(404);

      // Verify list endpoint also fails closed when a published article has a malformed snapshot
      await request(app.getHttpServer())
        .get('/articles/public')
        .expect(404);

      // Archive malformed article so it does not poison subsequent list queries
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });
    });

    it("18. PostgreSQL JSON Literal Null Rejection: 'null'::jsonb produces isTaxonomySqlNull=false and fails closed with 404", async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Article Json Literal Null',
        draftSlug: 'article-json-literal-null',
        categoryId: catArch.id,
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Force taxonomy to JSON literal null ('null'::jsonb) in PostgreSQL
      await prismaAdmin.$executeRaw`
        UPDATE article_snapshots
        SET taxonomy = 'null'::jsonb
        WHERE id = ${pubRes.body.currentSnapshotId}::uuid;
      `;

      // Confirm raw PostgreSQL discrimination
      const rows = await prismaAdmin.$queryRaw<
        Array<{ is_sql_null: boolean; is_json_null: boolean }>
      >`
        SELECT (taxonomy IS NULL) AS is_sql_null,
               (taxonomy = 'null'::jsonb) AS is_json_null
        FROM article_snapshots
        WHERE id = ${pubRes.body.currentSnapshotId}::uuid;
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].is_sql_null).toBe(false);
      expect(rows[0].is_json_null).toBe(true);

      // Verify Reader rejects JSON literal null with fail-closed 404
      await request(app.getHttpServer())
        .get('/articles/public/article-json-literal-null')
        .expect(404);

      // Verify list endpoint also fails closed when a published article has JSON literal null
      await request(app.getHttpServer())
        .get('/articles/public')
        .expect(404);

      // Archive corrupt article so it does not poison subsequent list queries
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });
    });

    it('19. Query-Count and N+1 Verification: measures queries for 1, 5, and 10 articles; proves taxonomy introduces 0 extra queries (O(1))', async () => {
      // 1. Seed additional articles if needed to ensure at least 10 published articles exist
      currentUserInjected = userA;
      const currentCount = await prismaRuntime.article.count({
        where: { status: ArticleStatus.PUBLISHED },
      });

      for (let i = currentCount; i < 10; i++) {
        const d = await articlesService.createDraft(userA, {
          title: `N Plus One Test Article ${i + 1}`,
          draftSlug: `nplusone-test-article-${i + 1}`,
          categoryId: catArch.id,
          tagIds: [tagRust.id],
        });
        await blocksService.createBlock(userA, d.id, {
          type: ArticleBlockType.HEADING,
          expectedRevision: 1,
          content: { text: `Heading ${i + 1}`, level: 1 },
        });
        await request(app.getHttpServer())
          .post(`/articles/${d.id}/publish`)
          .send({ expectedRevision: 2 })
          .expect(200);
      }

      // 2. Instrument query count via vi.spyOn on prismaRuntime.$queryRaw
      const querySpy = vi.spyOn(prismaRuntime, '$queryRaw');

      // Test with 1 article
      querySpy.mockClear();
      const res1 = await request(app.getHttpServer())
        .get('/articles/public?limit=1')
        .expect(200);
      expect(res1.body.items).toHaveLength(1);
      const queryCount1 = querySpy.mock.calls.length;

      // Test with 5 articles
      querySpy.mockClear();
      const res5 = await request(app.getHttpServer())
        .get('/articles/public?limit=5')
        .expect(200);
      expect(res5.body.items).toHaveLength(5);
      const queryCount5 = querySpy.mock.calls.length;

      // Test with 10 articles
      querySpy.mockClear();
      const res10 = await request(app.getHttpServer())
        .get('/articles/public?limit=10')
        .expect(200);
      expect(res10.body.items).toHaveLength(10);
      const queryCount10 = querySpy.mock.calls.length;

      // Verify taxonomy queries do not scale with article count:
      // Both queries are findPublishedArticles and countPublishedArticles (or +1 for batch media if cover is present)
      expect(queryCount1).toBe(queryCount5);
      expect(queryCount5).toBe(queryCount10);
      // Explicitly assert that query count is constant (<= 3 queries)
      expect(queryCount10).toBeLessThanOrEqual(3);

      querySpy.mockRestore();
    });

    it('20. List and Detail Projection Consistency: confirms active snapshot taxonomy matches identically across both endpoints', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/articles/public?limit=50')
        .expect(200);

      const itemInList = listRes.body.items.find(
        (it: any) => it.slug === 'pub-detail-populated',
      );
      expect(itemInList).toBeDefined();

      const detailRes = await request(app.getHttpServer())
        .get('/articles/public/pub-detail-populated')
        .expect(200);

      expect(itemInList.taxonomyCaptured).toBe(detailRes.body.taxonomyCaptured);
      expect(itemInList.category).toEqual(detailRes.body.category);
      expect(itemInList.tags).toEqual(detailRes.body.tags);
    });
  });

  describe('H. Public Article Taxonomy Discovery and Filtering (Checkpoint C-2B-F)', () => {
    let discCatArch: { id: string; name: string; slug: string };
    let discCatDevOps: { id: string; name: string; slug: string };
    let _discCatEmpty: { id: string; name: string; slug: string };
    let discTagK8s: { id: string; name: string; slug: string };
    let discTagDocker: { id: string; name: string; slug: string };
    let _discTagUnused: { id: string; name: string; slug: string };

    let article1Id: string;
    let article2Id: string;
    let article3Id: string;

    beforeAll(async () => {
      // 1. Create dedicated taxonomy categories and tags
      discCatArch = await prismaAdmin.category.create({
        data: { name: 'Cloud Architecture', slug: 'disc-cat-cloud-arch' },
      });
      discCatDevOps = await prismaAdmin.category.create({
        data: { name: 'DevOps & CI/CD', slug: 'disc-cat-devops' },
      });
      _discCatEmpty = await prismaAdmin.category.create({
        data: { name: 'Empty Category (No Articles)', slug: 'disc-cat-empty' },
      });

      discTagK8s = await prismaAdmin.tag.create({
        data: { name: 'Kubernetes', slug: 'disc-tag-k8s' },
      });
      discTagDocker = await prismaAdmin.tag.create({
        data: { name: 'Docker', slug: 'disc-tag-docker' },
      });
      _discTagUnused = await prismaAdmin.tag.create({
        data: { name: 'Unused Tag', slug: 'disc-tag-unused' },
      });

      currentUserInjected = userA;

      // Article 1: Cloud Architecture + [Kubernetes, Docker]
      const d1 = await articlesService.createDraft(userA, {
        title: 'Cloud Architecture with K8s and Docker',
        draftSlug: 'disc-art-cloud-1',
        categoryId: discCatArch.id,
        tagIds: [discTagK8s.id, discTagDocker.id],
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Cloud Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      article1Id = d1.id;

      // Article 2: Cloud Architecture + [Kubernetes]
      const d2 = await articlesService.createDraft(userA, {
        title: 'Kubernetes Advanced Ingress Patterns',
        draftSlug: 'disc-art-cloud-2',
        categoryId: discCatArch.id,
        tagIds: [discTagK8s.id],
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Ingress Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      article2Id = d2.id;

      // Article 3: DevOps + [Docker]
      const d3 = await articlesService.createDraft(userA, {
        title: 'Docker Buildx and Multi-Arch Containers',
        draftSlug: 'disc-art-devops-3',
        categoryId: discCatDevOps.id,
        tagIds: [discTagDocker.id],
      });
      await blocksService.createBlock(userA, d3.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Docker Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d3.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      article3Id = d3.id;
    });

    it('21. Category Discovery: GET /articles/public/taxonomy/categories returns frozen categories with accurate articleCount in deterministic slug ASC order', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      // Verify deterministic sorting: slug ASC, then id ASC
      for (let i = 0; i < res.body.length - 1; i++) {
        const cmp = res.body[i].slug.localeCompare(res.body[i + 1].slug);
        expect(cmp).toBeLessThanOrEqual(0);
      }

      // Verify discCatArch item
      const catArchItem = res.body.find((c: any) => c.slug === 'disc-cat-cloud-arch');
      expect(catArchItem).toBeDefined();
      expect(catArchItem.id).toBe(discCatArch.id);
      expect(catArchItem.name).toBe('Cloud Architecture');
      expect(catArchItem.articleCount).toBe(2);

      // Verify discCatDevOps item
      const catDevOpsItem = res.body.find((c: any) => c.slug === 'disc-cat-devops');
      expect(catDevOpsItem).toBeDefined();
      expect(catDevOpsItem.id).toBe(discCatDevOps.id);
      expect(catDevOpsItem.name).toBe('DevOps & CI/CD');
      expect(catDevOpsItem.articleCount).toBe(1);

      // Verify empty category with 0 published articles is NOT returned
      const emptyCat = res.body.find((c: any) => c.slug === 'disc-cat-empty');
      expect(emptyCat).toBeUndefined();
    });

    it('22. Tag Discovery: GET /articles/public/taxonomy/tags returns frozen tags with accurate articleCount in deterministic slug ASC order', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      // Verify deterministic sorting: slug ASC, then id ASC
      for (let i = 0; i < res.body.length - 1; i++) {
        const cmp = res.body[i].slug.localeCompare(res.body[i + 1].slug);
        expect(cmp).toBeLessThanOrEqual(0);
      }

      // Verify discTagK8s item (articles 1 and 2)
      const k8sItem = res.body.find((t: any) => t.slug === 'disc-tag-k8s');
      expect(k8sItem).toBeDefined();
      expect(k8sItem.id).toBe(discTagK8s.id);
      expect(k8sItem.name).toBe('Kubernetes');
      expect(k8sItem.articleCount).toBe(2);

      // Verify discTagDocker item (articles 1 and 3)
      const dockerItem = res.body.find((t: any) => t.slug === 'disc-tag-docker');
      expect(dockerItem).toBeDefined();
      expect(dockerItem.id).toBe(discTagDocker.id);
      expect(dockerItem.name).toBe('Docker');
      expect(dockerItem.articleCount).toBe(2);

      // Verify unused tag with 0 published articles is NOT returned
      const unusedTag = res.body.find((t: any) => t.slug === 'disc-tag-unused');
      expect(unusedTag).toBeUndefined();
    });

    it('23. Category Filtering: GET /articles/public?category=<slug> returns only matching articles and total matches articleCount', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch')
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      const articleIds = res.body.items.map((it: any) => it.id);
      expect(articleIds).toContain(article1Id);
      expect(articleIds).toContain(article2Id);
      expect(articleIds).not.toContain(article3Id);

      for (const item of res.body.items) {
        expect(item.category.slug).toBe('disc-cat-cloud-arch');
      }
    });

    it('24. Tag Filtering: GET /articles/public?tag=<slug> returns only matching articles and total matches articleCount', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?tag=disc-tag-docker')
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      const articleIds = res.body.items.map((it: any) => it.id);
      expect(articleIds).toContain(article1Id);
      expect(articleIds).toContain(article3Id);
      expect(articleIds).not.toContain(article2Id);

      for (const item of res.body.items) {
        const tagSlugs = item.tags.map((t: any) => t.slug);
        expect(tagSlugs).toContain('disc-tag-docker');
      }
    });

    it('25. Combined Category AND Tag Filter: GET /articles/public?category=<cat>&tag=<tag> evaluates AND semantics', async () => {
      // Both match Article 1
      const resBoth = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch&tag=disc-tag-docker')
        .expect(200);

      expect(resBoth.body.total).toBe(1);
      expect(resBoth.body.items).toHaveLength(1);
      expect(resBoth.body.items[0].id).toBe(article1Id);

      // DevOps + Kubernetes matches NO articles
      const resNone = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-devops&tag=disc-tag-k8s')
        .expect(200);

      expect(resNone.body.total).toBe(0);
      expect(resNone.body.items).toHaveLength(0);
    });

    it('26. Filter Nonmatching Slugs: non-existent category or tag returns 200 with empty items array and total: 0', async () => {
      const resCat = await request(app.getHttpServer())
        .get('/articles/public?category=non-existent-category-slug')
        .expect(200);
      expect(resCat.body.items).toEqual([]);
      expect(resCat.body.total).toBe(0);

      const resTag = await request(app.getHttpServer())
        .get('/articles/public?tag=non-existent-tag-slug')
        .expect(200);
      expect(resTag.body.items).toEqual([]);
      expect(resTag.body.total).toBe(0);
    });

    it('27. Query Parameter Validation: rejects invalid, empty, or malicious category and tag parameters with 400', async () => {
      // Invalid characters / uppercase
      await request(app.getHttpServer())
        .get('/articles/public?category=UPPERCASE-SLUG')
        .expect(400);

      await request(app.getHttpServer())
        .get('/articles/public?tag=tag_with_underscore')
        .expect(400);

      // Empty string
      await request(app.getHttpServer())
        .get('/articles/public?category=')
        .expect(400);

      // Trailing hyphen
      await request(app.getHttpServer())
        .get('/articles/public?category=trailing-hyphen-')
        .expect(400);

      // SQL injection attempt
      await request(app.getHttpServer())
        .get("/articles/public?category=cloud' OR 1=1--")
        .expect(400);

      // Oversized slug
      const longSlug = 'a'.repeat(161);
      await request(app.getHttpServer())
        .get(`/articles/public?category=${longSlug}`)
        .expect(400);
    });

    it('28. Filtered Pagination Correctness: filters in SQL before pagination without page distortion', async () => {
      // Total matching is 2
      const resPage1 = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch&page=1&limit=1')
        .expect(200);
      expect(resPage1.body.total).toBe(2);
      expect(resPage1.body.page).toBe(1);
      expect(resPage1.body.limit).toBe(1);
      expect(resPage1.body.totalPages).toBe(2);
      expect(resPage1.body.items).toHaveLength(1);

      const resPage2 = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch&page=2&limit=1')
        .expect(200);
      expect(resPage2.body.total).toBe(2);
      expect(resPage2.body.page).toBe(2);
      expect(resPage2.body.items).toHaveLength(1);
      expect(resPage2.body.items[0].id).not.toBe(resPage1.body.items[0].id);

      // Beyond total pages
      const resPage3 = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch&page=3&limit=1')
        .expect(200);
      expect(resPage3.body.total).toBe(2);
      expect(resPage3.body.items).toHaveLength(0);
    });

    it('29. Legacy SQL NULL and Malformed Snapshot Exclusion: legacy and corrupted snapshots never match filters or discovery', async () => {
      // Article 1 has disc-cat-cloud-arch. Verify that our legacy article (with SQL NULL taxonomy) is not returned
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch')
        .expect(200);

      for (const item of filterRes.body.items) {
        expect(item.taxonomyCaptured).toBe(true);
        expect(item.category).not.toBeNull();
      }
    });

    it('30. Immutability Under Master Record Changes: updating or deleting draft taxonomy does not alter discovery or filters until republication', async () => {
      currentUserInjected = userA;

      // 1. Update draft category of Article 3 from discCatDevOps to discCatArch in draft
      await articlesService.updateDraftMetadata(userA, article3Id, {
        expectedRevision: 2,
        categoryId: discCatArch.id,
      });

      // 2. Verify discovery counts remain unchanged based on active snapshot
      const catRes1 = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      const catArch1 = catRes1.body.find((c: any) => c.slug === 'disc-cat-cloud-arch');
      const catDevOps1 = catRes1.body.find((c: any) => c.slug === 'disc-cat-devops');
      expect(catArch1.articleCount).toBe(2);
      expect(catDevOps1.articleCount).toBe(1);

      // 3. Republish Article 3 with new category
      await request(app.getHttpServer())
        .post(`/articles/${article3Id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      // 4. Verify discovery counts updated atomically: discCatArch is now 3, discCatDevOps is now 0 (excluded)
      const catRes2 = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      const catArch2 = catRes2.body.find((c: any) => c.slug === 'disc-cat-cloud-arch');
      const catDevOps2 = catRes2.body.find((c: any) => c.slug === 'disc-cat-devops');
      expect(catArch2.articleCount).toBe(3);
      expect(catDevOps2).toBeUndefined(); // count is 0, so excluded

      // 5. Verify filter now includes Article 3 in discCatArch
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch')
        .expect(200);
      expect(filterRes.body.total).toBe(3);
      expect(filterRes.body.items.map((it: any) => it.id)).toContain(article3Id);
    });

    it('31. Route Precedence: static discovery routes (/taxonomy/categories, /taxonomy/tags) are not captured by /:slug detail handler', async () => {
      const catRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      expect(Array.isArray(catRes.body)).toBe(true);

      const tagRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      expect(Array.isArray(tagRes.body)).toBe(true);

      // Existing detail slug still retrieves full article detail
      const detailRes = await request(app.getHttpServer())
        .get('/articles/public/disc-art-cloud-1')
        .expect(200);
      expect(detailRes.body.slug).toBe('disc-art-cloud-1');
      expect(detailRes.body.blocks).toBeDefined();
    });

    it('32. Query Performance & Constant Complexity: measures query count for discovery and filtered lists', async () => {
      const querySpy = vi.spyOn(prismaRuntime, '$queryRaw');

      // Category discovery: exactly 1 raw SQL query
      querySpy.mockClear();
      await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      expect(querySpy.mock.calls.length).toBe(1);

      // Tag discovery: exactly 1 raw SQL query
      querySpy.mockClear();
      await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      expect(querySpy.mock.calls.length).toBe(1);

      // Category filtered list: exactly 2 queries (data + count)
      querySpy.mockClear();
      await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch&limit=1')
        .expect(200);
      const callsFor1 = querySpy.mock.calls.length;

      querySpy.mockClear();
      await request(app.getHttpServer())
        .get('/articles/public?category=disc-cat-cloud-arch&limit=5')
        .expect(200);
      const callsFor5 = querySpy.mock.calls.length;

      expect(callsFor1).toBe(callsFor5);
      expect(callsFor5).toBeLessThanOrEqual(3);

      querySpy.mockRestore();
    });
  });

  describe('I. Published Taxonomy Validation Parity, Discovery Identity and Route Collision Verification (Checkpoint C-2B-F-R)', () => {
    it('33. Numeric SchemaVersion Parity: string schemaVersion "1" is excluded by SQL filter and discovery, enforcing strict numeric contract', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'String Schema Version Article',
        draftSlug: 'str-ver-art',
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      const catUuid = crypto.randomUUID();
      // Inject string schemaVersion ("1" instead of numeric 1) into snapshot taxonomy
      await prismaAdmin.articleSnapshot.update({
        where: { id: pubRes.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: '1',
            category: {
              id: catUuid,
              name: 'String Version Category',
              slug: 'strver-cat',
            },
            tags: [],
          },
        },
      });

      // 1. Must NOT appear in category discovery
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      const found = discRes.body.find((c: any) => c.slug === 'strver-cat');
      expect(found).toBeUndefined();

      // 2. Must NOT match category filter
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?category=strver-cat')
        .expect(200);
      expect(filterRes.body.items).toEqual([]);
      expect(filterRes.body.total).toBe(0);

      // Archive corrupt article so it does not affect subsequent tests
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });
    });

    it('34. Safe JSONB Evaluation: non-array and malformed tags do not cause PostgreSQL execution errors', async () => {
      currentUserInjected = userA;
      const draft = await articlesService.createDraft(userA, {
        title: 'Malformed Tags Article',
        draftSlug: 'malformed-tags-art',
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Corrupt snapshot tags to string "not-an-array"
      await prismaAdmin.articleSnapshot.update({
        where: { id: pubRes.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: 'not-an-array',
          },
        },
      });

      // Tag discovery must execute cleanly without SQL execution error
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      expect(Array.isArray(discRes.body)).toBe(true);

      // Tag filter must execute cleanly without SQL error
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?tag=non-existent-tag')
        .expect(200);
      expect(filterRes.body.items).toEqual([]);
      expect(filterRes.body.total).toBe(0);

      // Archive corrupt article
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });
    });

    it('35. Discovery Identity Scenario ID-COLLISION-1: same frozen slug across distinct category IDs produces 1 discovery entry and accurate count', async () => {
      currentUserInjected = userA;
      const catId1 = crypto.randomUUID();
      const catId2 = crypto.randomUUID();

      // Article A with Category ID 1, slug 'shared-slug-collision'
      const d1 = await articlesService.createDraft(userA, {
        title: 'Article ID Collision A',
        draftSlug: 'art-id-coll-a',
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub1.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: { id: catId1, name: 'Shared Cat Name 1', slug: 'shared-slug-collision' },
            tags: [],
          },
        },
      });

      // Article B with Category ID 2, same slug 'shared-slug-collision'
      const d2 = await articlesService.createDraft(userA, {
        title: 'Article ID Collision B',
        draftSlug: 'art-id-coll-b',
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub2.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: { id: catId2, name: 'Shared Cat Name 2', slug: 'shared-slug-collision' },
            tags: [],
          },
        },
      });

      // 1. Discovery must have exactly 1 entry for 'shared-slug-collision' with articleCount: 2
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      const matches = discRes.body.filter((c: any) => c.slug === 'shared-slug-collision');
      expect(matches).toHaveLength(1);
      expect(matches[0].articleCount).toBe(2);

      // 2. Filter list must return both articles with total: 2
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?category=shared-slug-collision')
        .expect(200);
      expect(filterRes.body.total).toBe(2);
      expect(filterRes.body.items).toHaveLength(2);
      const returnedIds = filterRes.body.items.map((it: any) => it.id);
      expect(returnedIds).toContain(d1.id);
      expect(returnedIds).toContain(d2.id);

      // Discovery articleCount exactly equals filtered total
      expect(matches[0].articleCount).toBe(filterRes.body.total);
    });

    it('36. Discovery Identity Scenario ID-COLLISION-2: same category ID across distinct slugs produces 2 discovery entries with exact counts', async () => {
      currentUserInjected = userA;
      const sharedCatId = crypto.randomUUID();

      // Article A with shared ID, slug 'slug-split-alpha'
      const d1 = await articlesService.createDraft(userA, {
        title: 'Article Slug Split A',
        draftSlug: 'art-slug-split-a',
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub1.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: { id: sharedCatId, name: 'Split Category', slug: 'slug-split-alpha' },
            tags: [],
          },
        },
      });

      // Article B with shared ID, slug 'slug-split-beta'
      const d2 = await articlesService.createDraft(userA, {
        title: 'Article Slug Split B',
        draftSlug: 'art-slug-split-b',
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub2.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: { id: sharedCatId, name: 'Split Category', slug: 'slug-split-beta' },
            tags: [],
          },
        },
      });

      // 1. Discovery must expose 2 separate entries
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      const alpha = discRes.body.find((c: any) => c.slug === 'slug-split-alpha');
      const beta = discRes.body.find((c: any) => c.slug === 'slug-split-beta');
      expect(alpha).toBeDefined();
      expect(beta).toBeDefined();
      expect(alpha.id).toBe(sharedCatId);
      expect(beta.id).toBe(sharedCatId);
      expect(alpha.articleCount).toBe(1);
      expect(beta.articleCount).toBe(1);

      // 2. Filter by alpha
      const filterAlpha = await request(app.getHttpServer())
        .get('/articles/public?category=slug-split-alpha')
        .expect(200);
      expect(filterAlpha.body.total).toBe(1);
      expect(filterAlpha.body.items[0].id).toBe(d1.id);
      expect(alpha.articleCount).toBe(filterAlpha.body.total);

      // 3. Filter by beta
      const filterBeta = await request(app.getHttpServer())
        .get('/articles/public?category=slug-split-beta')
        .expect(200);
      expect(filterBeta.body.total).toBe(1);
      expect(filterBeta.body.items[0].id).toBe(d2.id);
      expect(beta.articleCount).toBe(filterBeta.body.total);
    });

    it('37. Discovery Identity Scenario LABEL-COLLISION: same ID and slug with different names selects label from latest active published snapshot', async () => {
      currentUserInjected = userA;
      const tagId = crypto.randomUUID();

      // Tag published earlier with name "Tag Name Old"
      const d1 = await articlesService.createDraft(userA, {
        title: 'Article Label Collision A',
        draftSlug: 'art-lbl-coll-a',
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub1.body.currentSnapshotId },
        data: {
          publishedAt: new Date('2026-10-01T10:00:00Z'),
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [{ id: tagId, name: 'Tag Name Old', slug: 'tag-lbl-shared' }],
          },
        },
      });

      // Tag published later with name "Tag Name Latest"
      const d2 = await articlesService.createDraft(userA, {
        title: 'Article Label Collision B',
        draftSlug: 'art-lbl-coll-b',
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub2.body.currentSnapshotId },
        data: {
          publishedAt: new Date('2026-10-25T12:00:00Z'),
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [{ id: tagId, name: 'Tag Name Latest', slug: 'tag-lbl-shared' }],
          },
        },
      });

      // Discovery must choose the representative name from the latest snapshot
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      const tagEntry = discRes.body.find((t: any) => t.slug === 'tag-lbl-shared');
      expect(tagEntry).toBeDefined();
      expect(tagEntry.name).toBe('Tag Name Latest');
      expect(tagEntry.articleCount).toBe(2);

      // Filtering returns both articles
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?tag=tag-lbl-shared')
        .expect(200);
      expect(filterRes.body.total).toBe(2);
      expect(tagEntry.articleCount).toBe(filterRes.body.total);
    });

    it('38. Route Collision Resolution: relocated discovery endpoints restore article detail for slugs "categories" and "tags"', async () => {
      currentUserInjected = userA;

      // 1. Publish Article with draftSlug: 'categories'
      const dCat = await articlesService.createDraft(userA, {
        title: 'Article With Slug Categories',
        draftSlug: 'categories',
      });
      await blocksService.createBlock(userA, dCat.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Categories Article Heading', level: 1 },
      });
      const pubCat = await request(app.getHttpServer())
        .post(`/articles/${dCat.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      expect(pubCat.body.publishedSlug).toBe('categories');

      // 2. Publish Article with draftSlug: 'tags'
      const dTag = await articlesService.createDraft(userA, {
        title: 'Article With Slug Tags',
        draftSlug: 'tags',
      });
      await blocksService.createBlock(userA, dTag.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Tags Article Heading', level: 1 },
      });
      const pubTag = await request(app.getHttpServer())
        .post(`/articles/${dTag.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      expect(pubTag.body.publishedSlug).toBe('tags');

      // 3. Request GET /articles/public/categories -> resolves to the published article detail!
      const resCat = await request(app.getHttpServer())
        .get('/articles/public/categories')
        .expect(200);
      expect(Array.isArray(resCat.body)).toBe(false);
      expect(resCat.body.id).toBe(dCat.id);
      expect(resCat.body.slug).toBe('categories');
      expect(resCat.body.title).toBe('Article With Slug Categories');
      expect(resCat.body.blocks).toBeDefined();

      // 4. Request GET /articles/public/tags -> resolves to the published article detail!
      const resTag = await request(app.getHttpServer())
        .get('/articles/public/tags')
        .expect(200);
      expect(Array.isArray(resTag.body)).toBe(false);
      expect(resTag.body.id).toBe(dTag.id);
      expect(resTag.body.slug).toBe('tags');
      expect(resTag.body.title).toBe('Article With Slug Tags');
      expect(resTag.body.blocks).toBeDefined();

      // 5. Request normal article slug
      const resNormal = await request(app.getHttpServer())
        .get('/articles/public/disc-art-cloud-1')
        .expect(200);
      expect(resNormal.body.slug).toBe('disc-art-cloud-1');
      expect(resNormal.body.blocks).toBeDefined();

      // 6. Relocated discovery routes operate under /articles/public/taxonomy/...
      const discCatRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      expect(Array.isArray(discCatRes.body)).toBe(true);

      const discTagRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      expect(Array.isArray(discTagRes.body)).toBe(true);

      // 7. Non-existent article slug returns 404 from article detail handler
      await request(app.getHttpServer())
        .get('/articles/public/non-existent-article-slug')
        .expect(404);
    });

    it('39. Tag Discovery Identity Scenario T-ID-1: same frozen slug across distinct tag IDs produces 1 discovery entry and accurate count', async () => {
      currentUserInjected = userA;
      const tagId1 = crypto.randomUUID();
      const tagId2 = crypto.randomUUID();

      // Article A with Tag ID 1, slug 'shared-tag-coll'
      const d1 = await articlesService.createDraft(userA, {
        title: 'Tag Collision Article A',
        draftSlug: 'tag-coll-art-a',
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub1.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [{ id: tagId1, name: 'Shared Tag Name 1', slug: 'shared-tag-coll' }],
          },
        },
      });

      // Article B with Tag ID 2, same slug 'shared-tag-coll'
      const d2 = await articlesService.createDraft(userA, {
        title: 'Tag Collision Article B',
        draftSlug: 'tag-coll-art-b',
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub2.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [{ id: tagId2, name: 'Shared Tag Name 2', slug: 'shared-tag-coll' }],
          },
        },
      });

      // 1. Tag Discovery has exactly 1 entry for 'shared-tag-coll' with articleCount: 2
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      const matches = discRes.body.filter((t: any) => t.slug === 'shared-tag-coll');
      expect(matches).toHaveLength(1);
      expect(matches[0].articleCount).toBe(2);

      // 2. Tag filter list returns both articles with total: 2
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?tag=shared-tag-coll')
        .expect(200);
      expect(filterRes.body.total).toBe(2);
      expect(filterRes.body.items).toHaveLength(2);
      const returnedIds = filterRes.body.items.map((it: any) => it.id);
      expect(returnedIds).toContain(d1.id);
      expect(returnedIds).toContain(d2.id);

      // Discovery articleCount exactly equals filtered total
      expect(matches[0].articleCount).toBe(filterRes.body.total);
    });

    it('40. Tag Discovery Identity Scenario T-ID-2: same tag ID across distinct slugs produces 2 discovery entries with exact counts', async () => {
      currentUserInjected = userA;
      const sharedTagId = crypto.randomUUID();

      // Article A with shared Tag ID, slug 'tag-split-alpha'
      const d1 = await articlesService.createDraft(userA, {
        title: 'Tag Split Article A',
        draftSlug: 'tag-split-art-a',
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub1.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [{ id: sharedTagId, name: 'Split Tag Alpha', slug: 'tag-split-alpha' }],
          },
        },
      });

      // Article B with shared Tag ID, slug 'tag-split-beta'
      const d2 = await articlesService.createDraft(userA, {
        title: 'Tag Split Article B',
        draftSlug: 'tag-split-art-b',
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub2.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [{ id: sharedTagId, name: 'Split Tag Beta', slug: 'tag-split-beta' }],
          },
        },
      });

      // 1. Discovery exposes 2 separate tag entries
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/tags')
        .expect(200);
      const alpha = discRes.body.find((t: any) => t.slug === 'tag-split-alpha');
      const beta = discRes.body.find((t: any) => t.slug === 'tag-split-beta');
      expect(alpha).toBeDefined();
      expect(beta).toBeDefined();
      expect(alpha.id).toBe(sharedTagId);
      expect(beta.id).toBe(sharedTagId);
      expect(alpha.articleCount).toBe(1);
      expect(beta.articleCount).toBe(1);

      // 2. Filter by alpha
      const filterAlpha = await request(app.getHttpServer())
        .get('/articles/public?tag=tag-split-alpha')
        .expect(200);
      expect(filterAlpha.body.total).toBe(1);
      expect(filterAlpha.body.items[0].id).toBe(d1.id);
      expect(alpha.articleCount).toBe(filterAlpha.body.total);

      // 3. Filter by beta
      const filterBeta = await request(app.getHttpServer())
        .get('/articles/public?tag=tag-split-beta')
        .expect(200);
      expect(filterBeta.body.total).toBe(1);
      expect(filterBeta.body.items[0].id).toBe(d2.id);
      expect(beta.articleCount).toBe(filterBeta.body.total);
    });

    it('41. Category Discovery Identity Scenario C-LABEL: same ID and slug with differing names selects representative label from latest active published snapshot', async () => {
      currentUserInjected = userA;
      const catId = crypto.randomUUID();

      // Category published earlier (T1) with name "Category Name Old"
      const d1 = await articlesService.createDraft(userA, {
        title: 'Article Cat Label Collision A',
        draftSlug: 'art-cat-lbl-a',
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub1 = await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub1.body.currentSnapshotId },
        data: {
          publishedAt: new Date('2026-10-01T10:00:00Z'),
          taxonomy: {
            schemaVersion: 1,
            category: { id: catId, name: 'Category Name Old', slug: 'cat-lbl-shared' },
            tags: [],
          },
        },
      });

      // Category published later (T2) with name "Category Name Latest"
      const d2 = await articlesService.createDraft(userA, {
        title: 'Article Cat Label Collision B',
        draftSlug: 'art-cat-lbl-b',
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      const pub2 = await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      await prismaAdmin.articleSnapshot.update({
        where: { id: pub2.body.currentSnapshotId },
        data: {
          publishedAt: new Date('2026-10-25T12:00:00Z'),
          taxonomy: {
            schemaVersion: 1,
            category: { id: catId, name: 'Category Name Latest', slug: 'cat-lbl-shared' },
            tags: [],
          },
        },
      });

      // Discovery must choose the representative name from the latest snapshot
      const discRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      const catEntry = discRes.body.find((c: any) => c.slug === 'cat-lbl-shared');
      expect(catEntry).toBeDefined();
      expect(catEntry.name).toBe('Category Name Latest');
      expect(catEntry.articleCount).toBe(2);

      // Filtering returns both articles
      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?category=cat-lbl-shared')
        .expect(200);
      expect(filterRes.body.total).toBe(2);
      expect(catEntry.articleCount).toBe(filterRes.body.total);
    });

    it('42. Fail-Closed Malformed Taxonomy Contract: malformed non-null JSONB throws 404 and NEVER exposes mutable draft taxonomy', async () => {
      currentUserInjected = userA;
      // 1. Create category and tag in master tables
      const masterCat = await prismaAdmin.category.create({
        data: { name: 'Master Category', slug: 'master-cat-failclosed' },
      });
      const masterTag = await prismaAdmin.tag.create({
        data: { name: 'Master Tag', slug: 'master-tag-failclosed' },
      });

      // 2. Create and publish draft with master category and tag
      const draft = await articlesService.createDraft(userA, {
        title: 'Fail-Closed Malformed Article',
        draftSlug: 'fail-closed-malformed-art',
      });
      await articlesService.updateDraftMetadata(userA, draft.id, {
        expectedRevision: 1,
        categoryId: masterCat.id,
        tagIds: [masterTag.id],
      });
      await blocksService.createBlock(userA, draft.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 2,
        content: { text: 'Heading', level: 1 },
      });
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${draft.id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);

      // 3. Mutate master tables and draft to new values
      await articlesService.updateDraftMetadata(userA, draft.id, {
        expectedRevision: 3,
        categoryId: null,
        tagIds: [],
      });

      // 4. Inject corrupted malformed non-null taxonomy into active snapshot
      await prismaAdmin.articleSnapshot.update({
        where: { id: pubRes.body.currentSnapshotId },
        data: {
          taxonomy: {
            schemaVersion: 999, // unsupported schema version
            category: { id: masterCat.id, name: 'Invalid', slug: 'invalid' },
            tags: [],
          },
        },
      });

      // 5. Verify reader fails closed with 404 (does NOT fall back to master or draft tables)
      await request(app.getHttpServer())
        .get('/articles/public/fail-closed-malformed-art')
        .expect(404);

      // 6. Verify excluded from discovery and filtered lists
      const discCatRes = await request(app.getHttpServer())
        .get('/articles/public/taxonomy/categories')
        .expect(200);
      expect(discCatRes.body.find((c: any) => c.slug === 'master-cat-failclosed')).toBeUndefined();

      const filterRes = await request(app.getHttpServer())
        .get('/articles/public?category=master-cat-failclosed')
        .expect(200);
      expect(filterRes.body.total).toBe(0);

      // Clean up corrupt test article
      await prismaAdmin.article.update({
        where: { id: draft.id },
        data: { status: ArticleStatus.ARCHIVED },
      });
    });
  });

  describe('Checkpoint C-3B: Public Article Search with Taxonomy Combinations and Snapshot Integrity (e2e)', () => {
    let catBackend: { id: string; name: string; slug: string };
    let catFrontend: { id: string; name: string; slug: string };
    let tagPg: { id: string; name: string; slug: string };
    let tagNg: { id: string; name: string; slug: string };

    let art1PublishedId: string;
    let art2PublishedId: string;
    let art4SupersededId: string;
    let art5MetacharId: string;
    let art6NonWildcardId: string;
    let art7CombosId: string;

    beforeAll(async () => {
      currentUserInjected = userA;

      // 1. Create categories and tags in master tables
      catBackend = await prismaAdmin.category.create({
        data: { name: 'Backend Engineering', slug: 'backend-search-cat' },
      });
      catFrontend = await prismaAdmin.category.create({
        data: { name: 'Frontend Systems', slug: 'frontend-search-cat' },
      });
      tagPg = await prismaAdmin.tag.create({
        data: { name: 'PostgreSQL', slug: 'postgresql-search-tag' },
      });
      tagNg = await prismaAdmin.tag.create({
        data: { name: 'Angular', slug: 'angular-search-tag' },
      });

      // 2. Article 1: Title "Hyper-Throughput PostgreSQL Pipelines", Summary "A comprehensive study on WAL archiving and connection pooling."
      const d1 = await articlesService.createDraft(userA, {
        title: 'Hyper-Throughput PostgreSQL Pipelines',
        draftSlug: 'hyper-throughput-pg-pipelines',
        summary: 'A comprehensive study on WAL archiving and connection pooling.',
        categoryId: catBackend.id,
        tagIds: [tagPg.id],
      });
      await blocksService.createBlock(userA, d1.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d1.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      art1PublishedId = d1.id;

      // 3. Article 2: Summary "Zoneless change detection, signal graphs, and rendering pipelines." Title "Modern Web Applications"
      const d2 = await articlesService.createDraft(userA, {
        title: 'Modern Web Applications',
        draftSlug: 'modern-web-applications',
        summary: 'Zoneless change detection, signal graphs, and rendering pipelines.',
        categoryId: catFrontend.id,
        tagIds: [tagNg.id],
      });
      await blocksService.createBlock(userA, d2.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Heading', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d2.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      art2PublishedId = d2.id;

      // 4. Article 3: Draft ONLY (never published) with title "Secret Internal Notes"
      await articlesService.createDraft(userA, {
        title: 'Secret Internal Notes',
        draftSlug: 'secret-internal-notes',
        summary: 'Classified architecture decisions not for public eyes.',
      });

      // 5. Article 4: Inactive historical snapshot test.
      // Published with old title "Historical Inactive Search Title" then republished with new title "Active Modern Snapshot"
      const d4 = await articlesService.createDraft(userA, {
        title: 'Historical Inactive Search Title',
        draftSlug: 'superseded-article',
        summary: 'Outdated summary keyword archaic.',
      });
      await blocksService.createBlock(userA, d4.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'V1', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d4.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);

      // Now update draft title and summary to "Active Modern Snapshot" and republish
      await articlesService.updateDraftMetadata(userA, d4.id, {
        title: 'Active Modern Snapshot',
        summary: 'Current modern architecture overview.',
        expectedRevision: 2,
      });
      await request(app.getHttpServer())
        .post(`/articles/${d4.id}/publish`)
        .send({ expectedRevision: 3 })
        .expect(200);
      art4SupersededId = d4.id;

      // 6. Article 5: Literal SQL wildcards: "Test 100% Guaranteed_Result & C:\\dir"
      const d5 = await articlesService.createDraft(userA, {
        title: 'Test 100% Guaranteed_Result & C:\\dir',
        draftSlug: 'literal-wildcard-article',
        summary: 'Checking literal percent % and underscore _ and backslash \\ symbols.',
        categoryId: catBackend.id,
        tagIds: [tagPg.id],
      });
      await blocksService.createBlock(userA, d5.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Symbols', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d5.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      art5MetacharId = d5.id;

      // 7. Article 6: Non-wildcard control article (negative matching assertions)
      // Contains '100X' (no %), 'Guaranteed-Result' (hyphen instead of _), 'C:/dir' (forward slash instead of \)
      const d6 = await articlesService.createDraft(userA, {
        title: 'High 100X Scale Systems',
        draftSlug: 'non-wildcard-control-article',
        summary: 'Guaranteed-Result in production setups C:/dir/logs for verification.',
        categoryId: catFrontend.id,
        tagIds: [tagNg.id],
      });
      await blocksService.createBlock(userA, d6.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Negative Control', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d6.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      art6NonWildcardId = d6.id;

      // 8. Article 7: Metacharacter combo sequences
      // Contains adjacent literal '\%', '\_', and '\%_'
      const d7 = await articlesService.createDraft(userA, {
        title: 'Escaped Sequences \\% and \\_ and \\%_',
        draftSlug: 'metacharacter-combos-article',
        summary: 'Contains literal sequences \\% and \\_ and \\%_ in database.',
        categoryId: catBackend.id,
        tagIds: [tagPg.id],
      });
      await blocksService.createBlock(userA, d7.id, {
        type: ArticleBlockType.HEADING,
        expectedRevision: 1,
        content: { text: 'Combos', level: 1 },
      });
      await request(app.getHttpServer())
        .post(`/articles/${d7.id}/publish`)
        .send({ expectedRevision: 2 })
        .expect(200);
      art7CombosId = d7.id;
    });

    it('43. matches published article by title keyword (q=Hyper-Throughput)', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=Hyper-Throughput')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(art1PublishedId);
      expect(res.body.items[0].title).toBe('Hyper-Throughput PostgreSQL Pipelines');
    });

    it('44. matches published article by summary keyword (q=zoneless)', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=zoneless')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(art2PublishedId);
      expect(res.body.items[0].title).toBe('Modern Web Applications');
    });

    it('45. performs case-insensitive substring search (q=postgresql)', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=postgresql')
        .expect(200);

      expect(res.body.items.some((i: any) => i.id === art1PublishedId)).toBe(true);
    });

    it('46. strictly excludes draft articles from search results (q=Secret)', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=Secret')
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('47. strictly excludes historical inactive snapshots from search results (q=Historical)', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=Historical')
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);

      // But searching active snapshot title succeeds
      const activeRes = await request(app.getHttpServer())
        .get('/articles/public?q=Active Modern')
        .expect(200);
      expect(activeRes.body.total).toBe(1);
      expect(activeRes.body.items[0].id).toBe(art4SupersededId);
    });

    it('48. combines search query and category filter with AND semantics', async () => {
      // 'pipelines' appears in Article 1 (Backend) and Article 2 (Frontend)
      const bothRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines')
        .expect(200);
      expect(bothRes.body.items.some((i: any) => i.id === art1PublishedId)).toBe(true);
      expect(bothRes.body.items.some((i: any) => i.id === art2PublishedId)).toBe(true);

      // With category=backend-search-cat -> only Article 1
      const backendRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&category=backend-search-cat')
        .expect(200);
      expect(backendRes.body.total).toBe(1);
      expect(backendRes.body.items[0].id).toBe(art1PublishedId);

      // With category=frontend-search-cat -> only Article 2
      const frontendRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&category=frontend-search-cat')
        .expect(200);
      expect(frontendRes.body.total).toBe(1);
      expect(frontendRes.body.items[0].id).toBe(art2PublishedId);
    });

    it('49. combines search query and tag filter with AND semantics', async () => {
      const pgRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&tag=postgresql-search-tag')
        .expect(200);
      expect(pgRes.body.total).toBe(1);
      expect(pgRes.body.items[0].id).toBe(art1PublishedId);

      const ngRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&tag=angular-search-tag')
        .expect(200);
      expect(ngRes.body.total).toBe(1);
      expect(ngRes.body.items[0].id).toBe(art2PublishedId);
    });

    it('50. combines search query, category filter, and tag filter simultaneously (AND semantics)', async () => {
      const matchRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&category=backend-search-cat&tag=postgresql-search-tag')
        .expect(200);
      expect(matchRes.body.total).toBe(1);
      expect(matchRes.body.items[0].id).toBe(art1PublishedId);

      // Mismatched category with tag
      const mismatchRes = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&category=frontend-search-cat&tag=postgresql-search-tag')
        .expect(200);
      expect(mismatchRes.body.total).toBe(0);
      expect(mismatchRes.body.items).toHaveLength(0);
    });

    it('51. applies pagination deterministically with search query (page and limit)', async () => {
      const page1Res = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&limit=1&page=1')
        .expect(200);

      expect(page1Res.body.limit).toBe(1);
      expect(page1Res.body.page).toBe(1);
      expect(page1Res.body.total).toBeGreaterThanOrEqual(2);
      expect(page1Res.body.items).toHaveLength(1);

      const page2Res = await request(app.getHttpServer())
        .get('/articles/public?q=pipelines&limit=1&page=2')
        .expect(200);

      expect(page2Res.body.page).toBe(2);
      expect(page2Res.body.items).toHaveLength(1);
      expect(page2Res.body.items[0].id).not.toBe(page1Res.body.items[0].id);
    });

    it('52. returns empty results when search keyword matches no published articles', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=quantum_cryptography_unknown_term')
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('53. rejects repeated q query parameters with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .get('/articles/public?q=first&q=second')
        .expect(400);

      expect(res.body.message).toContain('q must be a string');
    });

    it('54. rejects search queries exceeding 120 characters with 400 Bad Request', async () => {
      const overlongTerm = 'a'.repeat(121);
      const res = await request(app.getHttpServer())
        .get(`/articles/public?q=${overlongTerm}`)
        .expect(400);

      expect(res.body.message).toContain('q must not exceed 120 characters');
    });

    it('55. treats SQL metacharacters (%, _, \\) as literal search text with strict positive and negative matching', async () => {
      // 1. Literal percent '%' search
      // Positive match: Article 5 has "100%"
      const percentRes = await request(app.getHttpServer())
        .get('/articles/public?q=100%25')
        .expect(200);
      expect(percentRes.body.total).toBe(1);
      expect(percentRes.body.items).toHaveLength(1);
      expect(percentRes.body.items[0].id).toBe(art5MetacharId);
      // Negative assertion: Article 6 ("100X") must NOT match "100%"
      expect(percentRes.body.items.some((i: any) => i.id === art6NonWildcardId)).toBe(false);

      // Single literal '%' alone
      // Positive match: Article 5 and Article 7 contain literal '%'
      const singlePercentRes = await request(app.getHttpServer())
        .get('/articles/public?q=%25')
        .expect(200);
      expect(singlePercentRes.body.total).toBe(2);
      expect(singlePercentRes.body.items).toHaveLength(2);
      const percentIds = singlePercentRes.body.items.map((i: any) => i.id);
      expect(percentIds).toContain(art5MetacharId);
      expect(percentIds).toContain(art7CombosId);
      // Negative assertion: Articles without literal '%' (Articles 1, 2, 4, 6) must NOT match
      expect(percentIds).not.toContain(art1PublishedId);
      expect(percentIds).not.toContain(art2PublishedId);
      expect(percentIds).not.toContain(art4SupersededId);
      expect(percentIds).not.toContain(art6NonWildcardId);

      // 2. Literal underscore '_' search: "Guaranteed_Result"
      // Positive match: Article 5 has "Guaranteed_Result"
      const underscoreRes = await request(app.getHttpServer())
        .get('/articles/public?q=Guaranteed_Result')
        .expect(200);
      expect(underscoreRes.body.total).toBe(1);
      expect(underscoreRes.body.items).toHaveLength(1);
      expect(underscoreRes.body.items[0].id).toBe(art5MetacharId);
      // Negative assertion: Article 6 has "Guaranteed-Result" with hyphen, which must NOT match "_"
      expect(underscoreRes.body.items.some((i: any) => i.id === art6NonWildcardId)).toBe(false);

      // Negative assertion: Arbitrary character substitution (e.g. "GuaranteedXResult") must NOT match
      const noMatchRes = await request(app.getHttpServer())
        .get('/articles/public?q=GuaranteedXResult')
        .expect(200);
      expect(noMatchRes.body.total).toBe(0);
      expect(noMatchRes.body.items).toHaveLength(0);

      // Single literal '_' alone
      // Positive match: Article 5 and Article 7 contain literal '_'
      const singleUnderscoreRes = await request(app.getHttpServer())
        .get('/articles/public?q=_')
        .expect(200);
      expect(singleUnderscoreRes.body.total).toBe(2);
      expect(singleUnderscoreRes.body.items).toHaveLength(2);
      const underscoreIds = singleUnderscoreRes.body.items.map((i: any) => i.id);
      expect(underscoreIds).toContain(art5MetacharId);
      expect(underscoreIds).toContain(art7CombosId);
      // Negative assertion: If unescaped, '%_%' would match ALL articles; verify standard articles do not match
      expect(underscoreIds).not.toContain(art1PublishedId);
      expect(underscoreIds).not.toContain(art2PublishedId);
      expect(underscoreIds).not.toContain(art4SupersededId);
      expect(underscoreIds).not.toContain(art6NonWildcardId);

      // 3. Literal backslash '\\' search: "C:\dir"
      // Positive match: Article 5 has "C:\dir"
      const backslashRes = await request(app.getHttpServer())
        .get('/articles/public?q=C:%5Cdir')
        .expect(200);
      expect(backslashRes.body.total).toBe(1);
      expect(backslashRes.body.items).toHaveLength(1);
      expect(backslashRes.body.items[0].id).toBe(art5MetacharId);
      // Negative assertion: Article 6 has "C:/dir" (forward slash), which must NOT match "\"
      expect(backslashRes.body.items.some((i: any) => i.id === art6NonWildcardId)).toBe(false);

      // Single literal '\\' alone
      const singleBackslashRes = await request(app.getHttpServer())
        .get('/articles/public?q=%5C')
        .expect(200);
      expect(singleBackslashRes.body.total).toBe(2);
      expect(singleBackslashRes.body.items).toHaveLength(2);
      const backslashIds = singleBackslashRes.body.items.map((i: any) => i.id);
      expect(backslashIds).toContain(art5MetacharId);
      expect(backslashIds).toContain(art7CombosId);
      expect(backslashIds).not.toContain(art1PublishedId);
      expect(backslashIds).not.toContain(art6NonWildcardId);

      // 4. Combined metacharacter sequences: '\%', '\_', and '\%_'
      // Search '\%'
      const comboPercentRes = await request(app.getHttpServer())
        .get('/articles/public?q=%5C%25')
        .expect(200);
      expect(comboPercentRes.body.total).toBe(1);
      expect(comboPercentRes.body.items).toHaveLength(1);
      expect(comboPercentRes.body.items[0].id).toBe(art7CombosId);
      // Negative assertion: Article 5 has '\' and '%' separately, not adjacent '\%'
      expect(comboPercentRes.body.items.some((i: any) => i.id === art5MetacharId)).toBe(false);

      // Search '\_'
      const comboUnderscoreRes = await request(app.getHttpServer())
        .get('/articles/public?q=%5C_')
        .expect(200);
      expect(comboUnderscoreRes.body.total).toBe(1);
      expect(comboUnderscoreRes.body.items).toHaveLength(1);
      expect(comboUnderscoreRes.body.items[0].id).toBe(art7CombosId);
      expect(comboUnderscoreRes.body.items.some((i: any) => i.id === art5MetacharId)).toBe(false);

      // Search '\%_'
      const tripleComboRes = await request(app.getHttpServer())
        .get('/articles/public?q=%5C%25_')
        .expect(200);
      expect(tripleComboRes.body.total).toBe(1);
      expect(tripleComboRes.body.items).toHaveLength(1);
      expect(tripleComboRes.body.items[0].id).toBe(art7CombosId);
      expect(tripleComboRes.body.items.some((i: any) => i.id === art5MetacharId)).toBe(false);

      // 5. Harmless SQL injection attempts execute completely inertly
      const sqlInjectionRes1 = await request(app.getHttpServer())
        .get("/articles/public?q=' OR '1'='1' --")
        .expect(200);
      expect(sqlInjectionRes1.body.total).toBe(0);
      expect(sqlInjectionRes1.body.items).toHaveLength(0);

      const sqlInjectionRes2 = await request(app.getHttpServer())
        .get("/articles/public?q='; DROP TABLE articles; --")
        .expect(200);
      expect(sqlInjectionRes2.body.total).toBe(0);
      expect(sqlInjectionRes2.body.items).toHaveLength(0);
    });

    it('56. verifies complete consistency between findPublishedArticles data query and countPublishedArticles total count query', async () => {
      // 1. Literal search total count matches items length when unpaginated
      const searchRes = await request(app.getHttpServer())
        .get('/articles/public?q=%25')
        .expect(200);
      expect(searchRes.body.total).toBe(searchRes.body.items.length);
      expect(searchRes.body.total).toBe(2);

      // 2. Deterministic pagination parity (total count stays constant across all pages)
      const page1Res = await request(app.getHttpServer())
        .get('/articles/public?q=%25&limit=1&page=1')
        .expect(200);
      expect(page1Res.body.total).toBe(2);
      expect(page1Res.body.totalPages).toBe(2);
      expect(page1Res.body.page).toBe(1);
      expect(page1Res.body.items).toHaveLength(1);

      const page2Res = await request(app.getHttpServer())
        .get('/articles/public?q=%25&limit=1&page=2')
        .expect(200);
      expect(page2Res.body.total).toBe(2);
      expect(page2Res.body.totalPages).toBe(2);
      expect(page2Res.body.page).toBe(2);
      expect(page2Res.body.items).toHaveLength(1);
      expect(page2Res.body.items[0].id).not.toBe(page1Res.body.items[0].id);

      // 3. Combined search + category filter count parity
      const catMatchRes = await request(app.getHttpServer())
        .get('/articles/public?q=%25&category=backend-search-cat')
        .expect(200);
      expect(catMatchRes.body.total).toBe(2);
      expect(catMatchRes.body.items).toHaveLength(2);

      const catMismatchRes = await request(app.getHttpServer())
        .get('/articles/public?q=%25&category=frontend-search-cat')
        .expect(200);
      expect(catMismatchRes.body.total).toBe(0);
      expect(catMismatchRes.body.items).toHaveLength(0);

      // 4. Combined search + tag filter count parity
      const tagMatchRes = await request(app.getHttpServer())
        .get('/articles/public?q=%25&tag=postgresql-search-tag')
        .expect(200);
      expect(tagMatchRes.body.total).toBe(2);
      expect(tagMatchRes.body.items).toHaveLength(2);

      const tagMismatchRes = await request(app.getHttpServer())
        .get('/articles/public?q=%25&tag=angular-search-tag')
        .expect(200);
      expect(tagMismatchRes.body.total).toBe(0);
      expect(tagMismatchRes.body.items).toHaveLength(0);
    });
  });
});
