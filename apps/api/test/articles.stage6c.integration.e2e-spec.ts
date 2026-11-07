import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, ArticleStatus, UserRole, UserStatus, ArticleBlockType } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Article Stage 6C Real PostgreSQL 17 Integration (e2e)', () => {
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
  let repository: ArticlesRepository;
  let service: ArticlesService;
  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser;

  let dbName: string;

  let authorA: { id: string; email: string };
  let authorB: { id: string; email: string };
  let userA: AuthenticatedUser;
  let userB: AuthenticatedUser;

  let activeDraftId: string;
  let publishedArticleId: string;
  let publishedSnapshotId: string;
  let mediaAssetAId: string;
  let mediaAssetBId: string;

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

    // 2. Generate collision-resistant unique database name
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

    // 7. Grant permissions on users and sessions tables to academy_app
    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification_tokens" TO "${runtimeUser}";
      GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
    `, disposableDbName);

    // 8. Connect PrismaClient as restricted academy_app
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;
    prismaRuntime = new PrismaClient({
      datasources: { db: { url: disposableRuntimeUrl } },
    });
    await prismaRuntime.$connect();

    prismaAdmin = new PrismaClient({
      datasources: { db: { url: disposableMigrationUrl } },
    });
    await prismaAdmin.$connect();

    // 9. Verify exact authentic migrations in disposable database
    const migrationsPath = fs.existsSync(path.resolve('prisma/migrations'))
      ? path.resolve('prisma/migrations')
      : path.resolve('apps/api/prisma/migrations');
    const expectedMigrationNames = fs
      .readdirSync(migrationsPath)
      .filter((d) => fs.existsSync(path.join(migrationsPath, d, 'migration.sql')))
      .sort();

    const appliedMigrations = await prismaAdmin.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY finished_at ASC;
    `;
    const appliedNames = appliedMigrations.map((m) => m.migration_name).sort();
    expect(appliedNames).toEqual(expectedMigrationNames);
    expect(appliedNames.length).toBeGreaterThanOrEqual(13);
    expect(appliedNames).toContain('20261101000000_add_article_snapshot_taxonomy');

    // 10. Wire repository and service
    repository = new ArticlesRepository(prismaRuntime as any);
    service = new ArticlesService(repository);

    // 11. Seed Authors
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.a@skyra-tech.com',
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
      sessionId: 'sess-a-1',
    };

    const createdB = await prismaAdmin.user.create({
      data: {
        email: 'author.b@skyra-tech.com',
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
      sessionId: 'sess-b-1',
    };

    // 12. Setup NestJS HTTP Test App with real ValidationPipe
    currentUserInjected = userA;
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ArticlesController],
      providers: [
        {
          provide: ArticlesService,
          useValue: service,
        },
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
  }, 45000);

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

    if (disposableDbName) {
      try {
        await safelyDropDisposableDatabase(disposableDbName, (sql, target) => runAdminPsql(sql, target), {
          allowedPrefix: 'academy_auth_audit_',
        });
      } catch (err) {
        console.error(`Failed to drop disposable database ${disposableDbName}:`, err);
      }
    }
  }, 30000);

  // ── Stage 6B Regressions ──────────────────────────────────────────────────

  describe('Stage 6B Endpoints Regression in Real PostgreSQL', () => {
    it('1. creates draft article through service stack and verifies persistence', async () => {
      const draft = await service.createDraft(userA, {
        title: 'PostgreSQL Real-World Architecture',
        draftSlug: 'postgresql-real-world-architecture',
        summary: 'A deep architectural guide.',
        typographyPreset: 'MODERN_SANS',
      });

      expect(draft.id).toBeDefined();
      expect(draft.authorId).toBe(authorA.id);
      expect(draft.draftRevision).toBe(1);
      expect(draft.publishedRevision).toBe(0);
      expect(draft.status).toBe(ArticleStatus.DRAFT);
      expect(draft.currentSnapshotId).toBeNull();

      activeDraftId = draft.id;

      // Verify directly in DB
      const dbRecord = await prismaRuntime.article.findUnique({
        where: { id: draft.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.authorId).toBe(authorA.id);
      expect(dbRecord!.draftRevision).toBe(1);
    });

    it('2. verifies zero snapshot rows exist for newly created draft', async () => {
      const snapCount = await prismaRuntime.articleSnapshot.count({
        where: { articleId: activeDraftId },
      });
      const snapMediaCount = await prismaRuntime.articleSnapshotMedia.count();
      expect(snapCount).toBe(0);
      expect(snapMediaCount).toBe(0);
    });

    it('3. lists articles with strict author isolation', async () => {
      const listA = await service.listMyArticles(userA, { page: 1, limit: 10 });
      expect(listA.items.length).toBe(1);
      expect(listA.items[0].id).toBe(activeDraftId);

      const listB = await service.listMyArticles(userB, { page: 1, limit: 10 });
      expect(listB.items.length).toBe(0);
    });

    it('4. retrieves owned draft with draft blocks array', async () => {
      const retrieved = await service.getPrivateArticle(userA, activeDraftId);
      expect(retrieved.id).toBe(activeDraftId);
      expect(retrieved.authorId).toBe(authorA.id);
      expect(Array.isArray(retrieved.blocks)).toBe(true);
    });

    it('5. rejects foreign author retrieval with 404 private resource masking', async () => {
      await expect(
        service.getPrivateArticle(userB, activeDraftId),
      ).rejects.toThrow('Article not found.');
    });

    it('6. confirms restricted runtime database role (academy_app)', async () => {
      const currentUserRows = await prismaRuntime.$queryRaw<{ current_user: string }[]>`
        SELECT current_user;
      `;
      expect(currentUserRows[0].current_user).toBe(runtimeUser);
    });
  });

  // ── Stage 6C Metadata Editing ─────────────────────────────────────────────

  describe('Stage 6C Metadata Editing and Optimistic Concurrency', () => {
    it('7. updates valid metadata and advances revision by exactly 1', async () => {
      const updated = await service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 1,
        title: 'PostgreSQL Real-World Architecture (Updated)',
        draftSlug: 'postgresql-real-world-architecture-updated',
        summary: 'Updated summary.',
        typographyPreset: 'EDITORIAL_SERIF',
      });

      expect(updated.draftRevision).toBe(2);
      expect(updated.title).toBe('PostgreSQL Real-World Architecture (Updated)');
      expect(updated.draftSlug).toBe('postgresql-real-world-architecture-updated');
      expect(updated.typographyPreset).toBe('EDITORIAL_SERIF');

      const persisted = await prismaRuntime.article.findUnique({
        where: { id: activeDraftId },
      });
      expect(persisted!.draftRevision).toBe(2);
      expect(persisted!.title).toBe('PostgreSQL Real-World Architecture (Updated)');
    });

    it('8. detects exact no-op update: does not bump revision or change updatedAt', async () => {
      const before = await prismaRuntime.article.findUnique({
        where: { id: activeDraftId },
      });

      const noOpRes = await service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 2,
        title: 'PostgreSQL Real-World Architecture (Updated)',
        draftSlug: 'postgresql-real-world-architecture-updated',
        summary: 'Updated summary.',
        typographyPreset: 'EDITORIAL_SERIF',
      });

      expect(noOpRes.draftRevision).toBe(2);

      const after = await prismaRuntime.article.findUnique({
        where: { id: activeDraftId },
      });
      expect(after!.draftRevision).toBe(2);
      expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
    });

    it('9. rejects stale expectedRevision with 409 Conflict', async () => {
      await expect(
        service.updateDraftMetadata(userA, activeDraftId, {
          expectedRevision: 1, // Stale! DB is at 2
          title: 'Stale Attempt',
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('10. verifies concurrent updates conflict: exactly one winner advances revision', async () => {
      // Both attempts start from expectedRevision: 2
      const p1 = service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 2,
        title: 'Concurrent Winner Candidate Alpha',
      });
      const p2 = service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 2,
        title: 'Concurrent Winner Candidate Beta',
      });

      const outcomes = await Promise.allSettled([p1, p2]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const error = (rejected[0] as PromiseRejectedResult).reason;
      expect(error.status).toBe(409);
      expect(error.message).toContain('Draft revision conflict');

      const postConcurrent = await prismaRuntime.article.findUnique({
        where: { id: activeDraftId },
      });
      expect(postConcurrent!.draftRevision).toBe(3);
    });

    it('11. verifies nullable field clear-versus-omitted handling', async () => {
      // Clear summary with explicit null
      const cleared = await service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 3,
        summary: null,
      });
      expect(cleared.summary).toBeNull();
      expect(cleared.draftRevision).toBe(4);

      // Omit summary in next update -> summary remains null
      const omitted = await service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 4,
        title: 'Title Changed But Summary Omitted',
      });
      expect(omitted.summary).toBeNull();
      expect(omitted.draftRevision).toBe(5);
    });

    it('12. validates cover media ownership and clears on explicit null', async () => {
      // Seed Media Assets
      const mA = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorA.id,
          originalFilename: 'cover-a.jpg',
          mimeType: 'image/jpeg',
          mediaType: 'IMAGE',
          storageKey: 'media/cover-a.jpg',
          fileSize: 2048,
        },
      });
      mediaAssetAId = mA.id;

      const mB = await prismaAdmin.mediaAsset.create({
        data: {
          uploaderId: authorB.id,
          originalFilename: 'cover-b.jpg',
          mimeType: 'image/jpeg',
          mediaType: 'IMAGE',
          storageKey: 'media/cover-b.jpg',
          fileSize: 4096,
        },
      });
      mediaAssetBId = mB.id;

      // Author A connects own media asset -> succeeds
      const connected = await service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 5,
        coverMediaId: mediaAssetAId,
      });
      expect(connected.coverMediaId).toBe(mediaAssetAId);
      expect(connected.draftRevision).toBe(6);

      // Author A attempts to use media asset owned by Author B -> 403 Forbidden
      await expect(
        service.updateDraftMetadata(userA, activeDraftId, {
          expectedRevision: 6,
          coverMediaId: mediaAssetBId,
        }),
      ).rejects.toThrow('You do not have permission to use this media asset.');

      // Clear cover media with explicit null
      const disconnected = await service.updateDraftMetadata(userA, activeDraftId, {
        expectedRevision: 6,
        coverMediaId: null,
      });
      expect(disconnected.coverMediaId).toBeNull();
      expect(disconnected.draftRevision).toBe(7);
    });

    it('13. edits draft metadata on a PUBLISHED article while isolating published metadata', async () => {
      // Create published article fixture with immutable snapshot
      const pub = await prismaAdmin.article.create({
        data: {
          authorId: authorA.id,
          title: 'Published Deep Dive',
          draftSlug: 'published-deep-dive',
          publishedSlug: 'published-deep-dive-v1',
          status: ArticleStatus.PUBLISHED,
          draftRevision: 10,
          publishedRevision: 10,
          publishedAt: new Date('2026-10-20T00:00:00Z'),
        },
      });
      publishedArticleId = pub.id;

      const snap = await prismaAdmin.articleSnapshot.create({
        data: {
          articleId: pub.id,
          snapshotRevision: 10,
          title: pub.title,
          publishedSlug: pub.publishedSlug!,
          typographyPreset: 'MODERN_SANS',
          blocks: { schemaVersion: 1, blocks: [] },
        },
      });
      publishedSnapshotId = snap.id;

      await prismaAdmin.article.update({
        where: { id: pub.id },
        data: { currentSnapshotId: snap.id },
      });

      // Update draft metadata
      const draftEdit = await service.updateDraftMetadata(userA, publishedArticleId, {
        expectedRevision: 10,
        title: 'Published Deep Dive (Draft Work)',
      });

      expect(draftEdit.status).toBe(ArticleStatus.PUBLISHED);
      expect(draftEdit.draftRevision).toBe(11);
      expect(draftEdit.publishedRevision).toBe(10);
      expect(draftEdit.publishedSlug).toBe('published-deep-dive-v1');
      expect(draftEdit.currentSnapshotId).toBe(publishedSnapshotId);
      expect(draftEdit.publishedAt).toBe('2026-10-20T00:00:00.000Z');

      // Verify snapshot row in database is completely untouched
      const snapInDb = await prismaRuntime.articleSnapshot.findUnique({
        where: { id: publishedSnapshotId },
      });
      expect(snapInDb!.title).toBe('Published Deep Dive');
      expect(snapInDb!.snapshotRevision).toBe(10);
    });
  });

  // ── Stage 6C Deletion ─────────────────────────────────────────────────────

  describe('Stage 6C Safe Deletion and Constraint Reconciliation', () => {
    it('14. deletes an eligible draft and cascades draft blocks', async () => {
      const deletable = await service.createDraft(userA, {
        title: 'Draft Destined for Deletion',
        draftSlug: 'draft-destined-for-deletion',
      });

      // Add a dependent draft block
      await prismaAdmin.articleBlock.create({
        data: {
          articleId: deletable.id,
          type: ArticleBlockType.RICH_TEXT,
          position: 0,
          content: { text: 'Ephemeral content' },
        },
      });

      // Stale delete revision is rejected
      await expect(
        service.deleteEligibleDraft(userA, deletable.id, { expectedRevision: 99 }),
      ).rejects.toThrow('Draft revision conflict');

      // Foreign delete is masked with 404
      await expect(
        service.deleteEligibleDraft(userB, deletable.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Article not found.');

      // Valid delete succeeds
      await service.deleteEligibleDraft(userA, deletable.id, { expectedRevision: 1 });

      const checkArticle = await prismaRuntime.article.findUnique({
        where: { id: deletable.id },
      });
      expect(checkArticle).toBeNull();

      const checkBlocks = await prismaRuntime.articleBlock.count({
        where: { articleId: deletable.id },
      });
      expect(checkBlocks).toBe(0);
    });

    it('15. rejects deleting a PUBLISHED article with 409 Conflict', async () => {
      await expect(
        service.deleteEligibleDraft(userA, publishedArticleId, { expectedRevision: 11 }),
      ).rejects.toThrow('Only unpublished drafts with no publication history may be deleted.');
    });

    it('16. rejects deleting an ARCHIVED article with 409 Conflict', async () => {
      const archived = await prismaAdmin.article.create({
        data: {
          authorId: authorA.id,
          title: 'Archived Article Record',
          draftSlug: 'archived-article-record',
          status: ArticleStatus.ARCHIVED,
        },
      });

      await expect(
        service.deleteEligibleDraft(userA, archived.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Only unpublished drafts with no publication history may be deleted.');
    });

    it('17. rejects deleting an article with historical snapshots (RESTRICT safety)', async () => {
      const draftWithSnap = await prismaAdmin.article.create({
        data: {
          authorId: authorA.id,
          title: 'Draft with Historical Snapshots',
          draftSlug: 'draft-with-historical-snapshots',
          status: ArticleStatus.DRAFT,
        },
      });

      await prismaAdmin.articleSnapshot.create({
        data: {
          articleId: draftWithSnap.id,
          snapshotRevision: 1,
          title: 'Old Snap Title',
          publishedSlug: 'old-snap-slug',
          typographyPreset: 'MODERN_SANS',
          blocks: { schemaVersion: 1, blocks: [] },
        },
      });

      await expect(
        service.deleteEligibleDraft(userA, draftWithSnap.id, { expectedRevision: 1 }),
      ).rejects.toThrow('Cannot delete an article that has published history');
    });

    it('18. confirms referenced media assets and snapshot records remain intact', async () => {
      const mediaAssets = await prismaRuntime.mediaAsset.findMany();
      expect(mediaAssets.length).toBeGreaterThanOrEqual(2);

      const snapshots = await prismaRuntime.articleSnapshot.findMany();
      expect(snapshots.length).toBeGreaterThanOrEqual(2);
    });

    it('19. rejects missing or invalid expectedRevision at service level with 400 BadRequestException', async () => {
      const draft = await service.createDraft(userA, {
        title: 'Draft For Service Validation',
        draftSlug: 'draft-for-service-validation',
      });

      // Missing
      await expect(
        service.deleteEligibleDraft(userA, draft.id, {} as any),
      ).rejects.toThrow('expectedRevision query parameter is required and must be an integer >= 1.');

      // Zero
      await expect(
        service.deleteEligibleDraft(userA, draft.id, { expectedRevision: 0 } as any),
      ).rejects.toThrow('expectedRevision query parameter is required and must be an integer >= 1.');

      // Negative
      await expect(
        service.deleteEligibleDraft(userA, draft.id, { expectedRevision: -1 } as any),
      ).rejects.toThrow('expectedRevision query parameter is required and must be an integer >= 1.');

      // Fractional
      await expect(
        service.deleteEligibleDraft(userA, draft.id, { expectedRevision: 1.5 } as any),
      ).rejects.toThrow('expectedRevision query parameter is required and must be an integer >= 1.');

      // Clean up draft with matching expectedRevision
      await service.deleteEligibleDraft(userA, draft.id, { expectedRevision: 1 });
    });
  });

  // ── Stage 6C-R HTTP-Level DELETE Validation Pipeline (supertest) ──────────

  describe('Stage 6C-R HTTP-Level DELETE Validation Pipeline (supertest)', () => {
    let httpDraftId: string;

    beforeAll(async () => {
      const d = await service.createDraft(userA, {
        title: 'HTTP Test Draft',
        draftSlug: 'http-test-draft',
      });
      httpDraftId = d.id;
    });

    it('20. HTTP DELETE: rejects request with missing expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}`)
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('expectedRevision'),
        ]),
      );
    });

    it('21. HTTP DELETE: rejects request with non-numeric or malformed expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      // Non-numeric
      await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=abc`)
        .expect(400);

      // Zero
      await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=0`)
        .expect(400);

      // Negative
      await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=-2`)
        .expect(400);

      // Fractional
      await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=1.5`)
        .expect(400);
    });

    it('22. HTTP DELETE: rejects stale expectedRevision with 409 Conflict', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=999`)
        .expect(409);

      expect(res.body.message).toContain('Draft revision conflict');
    });

    it('23. HTTP DELETE: masks foreign draft deletion with 404 Not Found without leaking revision', async () => {
      currentUserInjected = userB;
      const res = await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=1`)
        .expect(404);

      expect(res.body.message).toContain('Article not found.');
    });

    it('24. HTTP DELETE: successfully deletes eligible draft with matching expectedRevision and returns 204 No Content with empty body', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}?expectedRevision=1`)
        .expect(204);

      expect(res.body).toEqual({});
      expect(res.text).toBe('');

      // Verify draft is removed from database
      const check = await prismaRuntime.article.findUnique({
        where: { id: httpDraftId },
      });
      expect(check).toBeNull();
    });
  });
});
