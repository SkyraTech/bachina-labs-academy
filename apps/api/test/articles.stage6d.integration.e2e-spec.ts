import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  ArticleStatus,
  UserRole,
  UserStatus,
  ArticleBlockType,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticleBlocksRepository } from '../src/modules/articles/repositories/article-blocks.repository.js';
import { ArticleBlocksService } from '../src/modules/articles/services/article-blocks.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticleBlocksController } from '../src/modules/articles/controllers/article-blocks.controller.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Article Stage 6D Real PostgreSQL 17 Block Operations (e2e)', () => {
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
  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser;

  let dbName: string;

  let authorA: { id: string; email: string };
  let authorB: { id: string; email: string };
  let userA: AuthenticatedUser;
  let userB: AuthenticatedUser;

  let mediaAssetAId: string;
  let mediaAssetBId: string;
  let activeDraftId: string;

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

    // 7. Grant DML permissions on tables in schema public to academy_app
    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeUser}";
      REVOKE ALL ON "audit_logs" FROM "${runtimeUser}";
      GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
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

    // 10. Seed Authors
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

    // 11. Seed Media Assets
    const mA = await prismaAdmin.mediaAsset.create({
      data: {
        uploaderId: authorA.id,
        storageKey: 'media/asset-a.png',
        mediaType: 'IMAGE',
        mimeType: 'image/png',
        fileSize: 2048,
        originalFilename: 'asset-a.png',
      },
    });
    mediaAssetAId = mA.id;

    const mB = await prismaAdmin.mediaAsset.create({
      data: {
        uploaderId: authorB.id,
        storageKey: 'media/asset-b.png',
        mediaType: 'IMAGE',
        mimeType: 'image/png',
        fileSize: 4096,
        originalFilename: 'asset-b.png',
      },
    });
    mediaAssetBId = mB.id;

    // 12. Setup NestJS HTTP Test App with real ValidationPipe
    currentUserInjected = userA;
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ArticlesController, ArticleBlocksController],
      providers: [
        { provide: ArticlesService, useValue: articlesService },
        { provide: ArticleBlocksService, useValue: blocksService },
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

  describe('Stage 6D Block Creation (POST)', () => {
    beforeAll(async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'Draft with Blocks',
        draftSlug: 'draft-with-blocks',
      });
      activeDraftId = draft.id;
    });

    it('1. confirms runtime connection executes as restricted academy_app', async () => {
      const res = await prismaRuntime.$queryRaw<{ current_user: string }[]>`SELECT current_user;`;
      expect(res[0].current_user).toBe(runtimeUser);
    });

    it('2. creates HEADING block at position 0 and advances revision from 1 to 2', async () => {
      const b1 = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 1,
        type: ArticleBlockType.HEADING,
        content: { text: 'Section 1: Foundations', level: 2 },
      });

      expect(b1.articleId).toBe(activeDraftId);
      expect(b1.type).toBe(ArticleBlockType.HEADING);
      expect(b1.position).toBe(0);
      expect(b1.draftRevision).toBe(2);

      const inDb = await prismaRuntime.articleBlock.findUnique({ where: { id: b1.id } });
      expect(inDb).not.toBeNull();
      expect(inDb!.position).toBe(0);
    });

    it('3. creates RICH_TEXT block appended at position 1 and advances revision from 2 to 3', async () => {
      const b2 = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 2,
        type: ArticleBlockType.RICH_TEXT,
        content: { html: '<p>Core architectural discussion.</p>' },
      });

      expect(b2.position).toBe(1);
      expect(b2.draftRevision).toBe(3);
    });

    it('4. creates IMAGE block referencing owned media asset at position 2 and advances revision to 4', async () => {
      const b3 = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 3,
        type: ArticleBlockType.IMAGE,
        content: { caption: 'System Topology' },
        mediaAssetId: mediaAssetAId,
      });

      expect(b3.position).toBe(2);
      expect(b3.mediaAssetId).toBe(mediaAssetAId);
      expect(b3.draftRevision).toBe(4);
    });

    it('5. rejects creating IMAGE block referencing media owned by another author with 403 Forbidden', async () => {
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 4,
          type: ArticleBlockType.IMAGE,
          content: { caption: 'Stolen Asset' },
          mediaAssetId: mediaAssetBId, // Owned by authorB
        }),
      ).rejects.toThrow('You do not have permission to use this media asset.');
    });

    it('6. rejects creating IMAGE block without mediaAssetId with 400 Bad Request', async () => {
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 4,
          type: ArticleBlockType.IMAGE,
          content: { caption: 'Missing Media' },
        }),
      ).rejects.toThrow('IMAGE blocks require a mediaAssetId.');
    });

    it('7. rejects creating non-IMAGE block with mediaAssetId with 400 Bad Request', async () => {
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 4,
          type: ArticleBlockType.DIVIDER,
          content: {},
          mediaAssetId: mediaAssetAId,
        }),
      ).rejects.toThrow('mediaAssetId must be null for non-IMAGE blocks.');
    });

    it('8. rejects block with oversized content exceeding 65536 bytes limit', async () => {
      const huge = 'a'.repeat(66000);
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 4,
          type: ArticleBlockType.CODE,
          content: { code: huge },
        }),
      ).rejects.toThrow('Block content exceeds maximum allowed size of 65536 bytes');
    });
  });

  describe('Stage 6D Block Updating (PATCH) and No-Op Semantics', () => {
    let blockToUpdateId: string;

    beforeAll(async () => {
      const blocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      blockToUpdateId = blocks[0].id; // Heading block
    });

    it('9. updates block content and advances revision from 4 to 5', async () => {
      const updated = await blocksService.updateBlock(userA, activeDraftId, blockToUpdateId, {
        expectedRevision: 4,
        content: { text: 'Section 1: Advanced Foundations', level: 2 },
      });

      expect(updated.id).toBe(blockToUpdateId);
      expect((updated.content as any).text).toBe('Section 1: Advanced Foundations');
      expect(updated.draftRevision).toBe(5);
    });

    it('10. exact no-op update preserves draft revision at 5 without database mutation', async () => {
      const noOp = await blocksService.updateBlock(userA, activeDraftId, blockToUpdateId, {
        expectedRevision: 5,
        content: { text: 'Section 1: Advanced Foundations', level: 2 }, // Identical
      });

      expect(noOp.draftRevision).toBe(5);

      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(5);
    });

    it('11. rejects update with stale expectedRevision with 409 Conflict', async () => {
      await expect(
        blocksService.updateBlock(userA, activeDraftId, blockToUpdateId, {
          expectedRevision: 1, // Current is 5
          content: { text: 'Stale' },
        }),
      ).rejects.toThrow('Draft revision conflict');
    });

    it('12. foreign author update returns 404 Not Found without leaking existence', async () => {
      await expect(
        blocksService.updateBlock(userB, activeDraftId, blockToUpdateId, {
          expectedRevision: 5,
          content: { text: 'Hijack' },
        }),
      ).rejects.toThrow('Article not found.');
    });
  });

  describe('Stage 6D Block Deletion (DELETE) and Compaction', () => {
    let blockToDeleteId: string;

    beforeAll(async () => {
      const blocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      blockToDeleteId = blocks[1].id; // Block at position 1 (RICH_TEXT)
    });

    it('13. deletes block at position 1 and compacts subsequent positions contiguously', async () => {
      await blocksService.deleteBlock(userA, activeDraftId, blockToDeleteId, {
        expectedRevision: 5,
      });

      // Confirm deleted
      const checkDeleted = await prismaRuntime.articleBlock.findUnique({
        where: { id: blockToDeleteId },
      });
      expect(checkDeleted).toBeNull();

      // Check remaining blocks are compacted: positions must be 0 and 1
      const remaining = await blocksRepo.findBlocksByArticle(activeDraftId);
      expect(remaining.length).toBe(2);
      expect(remaining[0].position).toBe(0);
      expect(remaining[1].position).toBe(1);

      // Revision advanced from 5 to 6
      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(6);
    });

    it('14. rejects delete with stale expectedRevision with 409 Conflict', async () => {
      const blocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      await expect(
        blocksService.deleteBlock(userA, activeDraftId, blocks[0].id, {
          expectedRevision: 1, // Current is 6
        }),
      ).rejects.toThrow('Draft revision conflict');
    });
  });

  describe('Stage 6D Block Reordering (PUT) and Deferrable Constraints', () => {
    let b0Id: string;
    let b1Id: string;
    let b2Id: string;

    beforeAll(async () => {
      // Add a third block so we have 3 blocks for rotation testing
      const newBlock = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 6,
        type: ArticleBlockType.QUOTE,
        content: { quote: 'Simplicity is prerequisite for reliability.' },
      });
      expect(newBlock.draftRevision).toBe(7);

      const all = await blocksRepo.findBlocksByArticle(activeDraftId);
      expect(all.length).toBe(3);
      b0Id = all[0].id;
      b1Id = all[1].id;
      b2Id = all[2].id;
    });

    it('15. reorders blocks by swapping positions 0 and 1 with deferred constraint', async () => {
      const res = await blocksService.reorderBlocks(userA, activeDraftId, {
        expectedRevision: 7,
        blockIds: [b1Id, b0Id, b2Id], // Swap b0 and b1
      });

      expect(res.draftRevision).toBe(8);
      expect(res.blocks[0].id).toBe(b1Id);
      expect(res.blocks[0].position).toBe(0);
      expect(res.blocks[1].id).toBe(b0Id);
      expect(res.blocks[1].position).toBe(1);
      expect(res.blocks[2].id).toBe(b2Id);
      expect(res.blocks[2].position).toBe(2);
    });

    it('16. reorders three blocks with 3-element rotation [b2, b1, b0]', async () => {
      const res = await blocksService.reorderBlocks(userA, activeDraftId, {
        expectedRevision: 8,
        blockIds: [b2Id, b1Id, b0Id],
      });

      expect(res.draftRevision).toBe(9);
      expect(res.blocks[0].id).toBe(b2Id);
      expect(res.blocks[1].id).toBe(b1Id);
      expect(res.blocks[2].id).toBe(b0Id);
    });

    it('17. exact no-op reorder preserves revision without mutating positions', async () => {
      const res = await blocksService.reorderBlocks(userA, activeDraftId, {
        expectedRevision: 9,
        blockIds: [b2Id, b1Id, b0Id], // Identical to current order
      });

      expect(res.draftRevision).toBe(9);

      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(9);
    });

    it('18. rejects reorder with duplicate block IDs with 400 Bad Request', async () => {
      await expect(
        blocksService.reorderBlocks(userA, activeDraftId, {
          expectedRevision: 9,
          blockIds: [b2Id, b2Id, b0Id],
        }),
      ).rejects.toThrow('Duplicate block IDs in reorder request.');
    });

    it('19. rejects reorder with incomplete block list with 400 Bad Request', async () => {
      await expect(
        blocksService.reorderBlocks(userA, activeDraftId, {
          expectedRevision: 9,
          blockIds: [b2Id, b1Id], // Missing b0
        }),
      ).rejects.toThrow('Submitted block count (2) does not match existing block count (3)');
    });

    it('20. rejects reorder with foreign block ID with 400 Bad Request', async () => {
      await expect(
        blocksService.reorderBlocks(userA, activeDraftId, {
          expectedRevision: 9,
          blockIds: [b2Id, b1Id, '00000000-0000-4000-8000-000000000099'],
        }),
      ).rejects.toThrow('does not belong to this article');
    });

    it('21. rejects reorder with stale expectedRevision with 409 Conflict', async () => {
      await expect(
        blocksService.reorderBlocks(userA, activeDraftId, {
          expectedRevision: 1, // Current is 9
          blockIds: [b0Id, b1Id, b2Id],
        }),
      ).rejects.toThrow('Draft revision conflict');
    });
  });

  describe('Stage 6D Concurrency and Publication Snapshot Isolation', () => {
    it('22. concurrent block creations produce one winner and one 409 conflict', async () => {
      const current = (await prismaRuntime.article.findUnique({ where: { id: activeDraftId } }))!.draftRevision;

      const p1 = blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: current,
        type: ArticleBlockType.DIVIDER,
        content: {},
      });

      const p2 = blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: current,
        type: ArticleBlockType.DIVIDER,
        content: {},
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('Draft revision conflict');
    });

    it('23. editing draft blocks on a PUBLISHED article isolates published snapshot and metadata', async () => {
      // 1. Create published article fixture
      const pub = await prismaAdmin.article.create({
        data: {
          authorId: authorA.id,
          title: 'Published Deep Dive',
          draftSlug: 'published-deep-dive',
          publishedSlug: 'published-deep-dive-live',
          status: ArticleStatus.PUBLISHED,
          draftRevision: 10,
          publishedRevision: 10,
          publishedAt: new Date('2026-10-20T00:00:00Z'),
        },
      });

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

      await prismaAdmin.article.update({
        where: { id: pub.id },
        data: { currentSnapshotId: snap.id },
      });

      // 2. Add draft block to published article
      const block = await blocksService.createBlock(userA, pub.id, {
        expectedRevision: 10,
        type: ArticleBlockType.CALLOUT,
        content: { variant: 'TIP', body: 'Draft tip for future update.' },
      });

      expect(block.draftRevision).toBe(11);

      // 3. Confirm published article record still has publishedRevision 10 and currentSnapshotId unchanged
      const articleInDb = await prismaRuntime.article.findUnique({ where: { id: pub.id } });
      expect(articleInDb!.draftRevision).toBe(11);
      expect(articleInDb!.publishedRevision).toBe(10);
      expect(articleInDb!.publishedSlug).toBe('published-deep-dive-live');
      expect(articleInDb!.currentSnapshotId).toBe(snap.id);

      // 4. Confirm published snapshot row is completely untouched
      const snapInDb = await prismaRuntime.articleSnapshot.findUnique({ where: { id: snap.id } });
      expect(snapInDb!.snapshotRevision).toBe(10);
      expect(snapInDb!.title).toBe('Published Deep Dive');

      // 5. Confirm zero snapshot-media rows exist
      const snapMediaCount = await prismaRuntime.articleSnapshotMedia.count();
      expect(snapMediaCount).toBe(0);
    });
  });

  describe('Stage 6D HTTP-Level Validation Pipeline (supertest)', () => {
    let httpDraftId: string;
    let httpBlockId: string;

    beforeAll(async () => {
      const d = await articlesService.createDraft(userA, {
        title: 'HTTP Pipeline Article',
        draftSlug: 'http-pipeline-article',
      });
      httpDraftId = d.id;
    });

    it('24. HTTP POST /articles/:articleId/blocks rejects missing expectedRevision with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpDraftId}/blocks`)
        .send({
          type: ArticleBlockType.HEADING,
          content: { text: 'Title', level: 1 },
        })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('expectedRevision')]),
      );
    });

    it('25. HTTP POST /articles/:articleId/blocks creates block and returns 201 Created', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpDraftId}/blocks`)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.HEADING,
          content: { text: 'HTTP Title', level: 2 },
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('HEADING');
      expect(res.body.position).toBe(0);
      expect(res.body.draftRevision).toBe(2);
      httpBlockId = res.body.id;
    });

    it('26. HTTP PATCH /articles/:articleId/blocks/:blockId updates content and returns 200 OK', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .patch(`/articles/${httpDraftId}/blocks/${httpBlockId}`)
        .send({
          expectedRevision: 2,
          content: { text: 'HTTP Title Updated', level: 2 },
        })
        .expect(200);

      expect(res.body.content.text).toBe('HTTP Title Updated');
      expect(res.body.draftRevision).toBe(3);
    });

    it('27. HTTP DELETE /articles/:articleId/blocks/:blockId requires query expectedRevision', async () => {
      currentUserInjected = userA;
      await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}/blocks/${httpBlockId}`)
        .expect(400);
    });

    it('28. HTTP DELETE /articles/:articleId/blocks/:blockId deletes block and returns 204 No Content', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .delete(`/articles/${httpDraftId}/blocks/${httpBlockId}?expectedRevision=3`)
        .expect(204);

      expect(res.body).toEqual({});
      expect(res.text).toBe('');

      // Verify removed from DB
      const inDb = await prismaRuntime.articleBlock.findUnique({
        where: { id: httpBlockId },
      });
      expect(inDb).toBeNull();
    });

    it('29. HTTP PUT /articles/:articleId/blocks/order rejects invalid non-array with 400 Bad Request', async () => {
      currentUserInjected = userA;
      await request(app.getHttpServer())
        .put(`/articles/${httpDraftId}/blocks/order`)
        .send({
          expectedRevision: 4,
          blockIds: 'not-an-array',
        })
        .expect(400);
    });
  });
});
