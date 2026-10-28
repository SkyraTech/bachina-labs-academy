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
import { assertDisposableTestDatabase } from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Stage 6D-R Adversarial Content Security & PostgreSQL JSONB Boundary (e2e)', () => {
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
        email: 'author.sec.a@skyra-tech.com',
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
      sessionId: 'sess-sec-a-1',
    };

    const createdB = await prismaAdmin.user.create({
      data: {
        email: 'author.sec.b@skyra-tech.com',
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
      sessionId: 'sess-sec-b-1',
    };

    // 11. Seed Media Asset
    const mA = await prismaAdmin.mediaAsset.create({
      data: {
        uploaderId: authorA.id,
        storageKey: 'media/sec-asset.png',
        mediaType: 'IMAGE',
        mimeType: 'image/png',
        fileSize: 2048,
        originalFilename: 'sec-asset.png',
      },
    });
    mediaAssetAId = mA.id;

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
  }, 30000);

  describe('Section 16: Core Content Security & Boundary Integration Scenarios', () => {
    beforeAll(async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'Security Verification Draft',
        draftSlug: 'security-verification-draft',
      });
      activeDraftId = draft.id;
    });

    it('1. confirms runtime connection executes as restricted academy_app', async () => {
      const res = await prismaRuntime.$queryRaw<{ current_user: string }[]>`SELECT current_user;`;
      expect(res[0].current_user).toBe(runtimeUser);
    });

    it('2. persists approved safe RICH_TEXT and verifies stored canonical content in PostgreSQL', async () => {
      const safeHtml = '<p>Welcome to <strong>Bachina Labs</strong>. Visit <a href="https://bachinalabs.com/academy" title="Academy">Academy</a>.</p>';
      const b1 = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 1,
        type: ArticleBlockType.RICH_TEXT,
        content: { html: safeHtml },
      });

      expect(b1.type).toBe(ArticleBlockType.RICH_TEXT);
      expect(b1.draftRevision).toBe(2);

      const inDb = await prismaRuntime.articleBlock.findUnique({ where: { id: b1.id } });
      expect(inDb).not.toBeNull();
      expect((inDb!.content as any).html).toBe(safeHtml);
    });

    it('3. rejects malicious RICH_TEXT (script, event handlers, javascript:) and preserves draft revision', async () => {
      const attackPayloads = [
        '<script>alert("XSS")</script>',
        '<p onclick="steal()">Click me</p>',
        '<a href="javascript:alert(1)">Exploit</a>',
        '<iframe src="https://evil.com"></iframe>',
      ];

      for (const maliciousHtml of attackPayloads) {
        await expect(
          blocksService.createBlock(userA, activeDraftId, {
            expectedRevision: 2,
            type: ArticleBlockType.RICH_TEXT,
            content: { html: maliciousHtml },
          }),
        ).rejects.toThrow();

        // Verify draft revision remained at 2
        const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
        expect(article!.draftRevision).toBe(2);
      }
    });

    it('4. rejects spoofed YouTube and Vimeo hostnames in VIDEO blocks', async () => {
      const spoofedVideoUrls = [
        'https://youtube.com.attacker.example/watch?v=123',
        'https://vimeo.com.attacker.example/12345',
        'https://notyoutube.com/watch?v=123',
        'https://admin:pass@www.youtube.com/watch?v=123',
      ];

      for (const url of spoofedVideoUrls) {
        await expect(
          blocksService.createBlock(userA, activeDraftId, {
            expectedRevision: 2,
            type: ArticleBlockType.VIDEO,
            content: { provider: 'YOUTUBE', url },
          }),
        ).rejects.toThrow();
      }

      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(2);
    });

    it('5. persists approved YouTube and Vimeo VIDEO blocks in PostgreSQL', async () => {
      const ytBlock = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 2,
        type: ArticleBlockType.VIDEO,
        content: {
          provider: 'YOUTUBE',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          caption: 'Reliable Engineering',
        },
      });

      expect(ytBlock.draftRevision).toBe(3);

      const vimeoBlock = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 3,
        type: ArticleBlockType.VIDEO,
        content: {
          provider: 'VIMEO',
          url: 'https://vimeo.com/12345678',
        },
      });

      expect(vimeoBlock.draftRevision).toBe(4);
    });

    it('6. persists safe LINK_CARD and rejects dangerous or credentialed URLs', async () => {
      // Rejects embedded credentials
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 4,
          type: ArticleBlockType.LINK_CARD,
          content: {
            url: 'https://admin:pass@example.com',
            title: 'Unsafe',
          },
        }),
      ).rejects.toThrow(/cannot contain embedded credentials/);

      // Rejects dangerous protocol
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 4,
          type: ArticleBlockType.LINK_CARD,
          content: {
            url: 'javascript:alert(1)',
            title: 'XSS',
          },
        }),
      ).rejects.toThrow();

      // Persists safe LINK_CARD
      const linkCard = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 4,
        type: ArticleBlockType.LINK_CARD,
        content: {
          url: 'https://bachinalabs.com',
          title: 'Bachina Labs',
          description: 'Software Engineering & Cloud Architecture',
        },
      });

      expect(linkCard.draftRevision).toBe(5);
    });

    it('7. verifies all ten approved block types persist and retrieve correctly', async () => {
      let currentRev = 5;

      const remainingTypes = [
        { type: ArticleBlockType.HEADING, content: { text: 'Heading 2', level: 2 } },
        { type: ArticleBlockType.IMAGE, content: { caption: 'Diagram' }, mediaAssetId: mediaAssetAId },
        { type: ArticleBlockType.CODE, content: { code: 'const x = 1;', language: 'typescript' } },
        { type: ArticleBlockType.QUOTE, content: { quote: 'Simplicity is prerequisite for reliability.' } },
        { type: ArticleBlockType.CALLOUT, content: { variant: 'INFO', body: 'Take note of this architecture.' } },
        { type: ArticleBlockType.TABLE, content: { headers: ['A', 'B'], rows: [['1', '2']] } },
        { type: ArticleBlockType.DIVIDER, content: {} },
      ];

      for (const item of remainingTypes) {
        const blk = await blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: currentRev,
          type: item.type,
          content: item.content,
          mediaAssetId: (item as any).mediaAssetId,
        });
        currentRev = blk.draftRevision;
      }

      const allBlocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      // Previously created: RICH_TEXT (pos 0), VIDEO YT (pos 1), VIDEO Vimeo (pos 2), LINK_CARD (pos 3) + 7 = 11 blocks
      expect(allBlocks.length).toBe(11);
    });

    it('8. enforces JSONB 64 KiB boundary at application level and database level', async () => {
      const currentRev = (await prismaRuntime.article.findUnique({ where: { id: activeDraftId } }))!.draftRevision;

      // 1. Application level rejection for oversized content (> 65000 bytes)
      const oversizedText = 'a'.repeat(66000);
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: currentRev,
          type: ArticleBlockType.CODE,
          content: { code: oversizedText },
        }),
      ).rejects.toThrow(/Block content exceeds/);

      // 2. Direct database verification of PostgreSQL constraint octet_length(content::text) <= 65536
      const validBoundaryJson = JSON.stringify({ code: 'x'.repeat(60000) });
      const testOctet = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${validBoundaryJson}::jsonb::text) as octet_len;
      `;
      expect(testOctet[0].octet_len).toBeLessThanOrEqual(65536);

      // Verify that database CHECK constraint chk_article_blocks_content_size catches any direct oversized insertion
      const rawOversizedJson = JSON.stringify({ huge: 'z'.repeat(66000) });
      await expect(
        prismaAdmin.$executeRaw`
          INSERT INTO article_blocks (id, article_id, position, type, content, created_at, updated_at)
          VALUES (gen_random_uuid(), ${activeDraftId}::uuid, 999, 'CODE', ${rawOversizedJson}::jsonb, now(), now());
        `,
      ).rejects.toThrow(/chk_article_blocks_content_size/);
    });

    it('9. verifies POST and PATCH enforce identical validation and security contracts', async () => {
      const allBlocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      const richTextBlock = allBlocks.find((b) => b.type === ArticleBlockType.RICH_TEXT)!;
      const currentRev = (await prismaRuntime.article.findUnique({ where: { id: activeDraftId } }))!.draftRevision;

      // Malicious PATCH is rejected
      await expect(
        blocksService.updateBlock(userA, activeDraftId, richTextBlock.id, {
          expectedRevision: currentRev,
          content: { html: '<script>alert("PATCH XSS")</script>' },
        }),
      ).rejects.toThrow('Prohibited HTML element: <script>.');

      // Valid PATCH succeeds and advances revision once
      const updated = await blocksService.updateBlock(userA, activeDraftId, richTextBlock.id, {
        expectedRevision: currentRev,
        content: { html: '<p>Updated and verified safe content.</p>' },
      });

      expect(updated.draftRevision).toBe(currentRev + 1);
      expect((updated.content as any).html).toBe('<p>Updated and verified safe content.</p>');
    });

    it('10. verifies author ownership isolation on block update and delete', async () => {
      const allBlocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      const targetBlockId = allBlocks[0].id;
      const currentRev = (await prismaRuntime.article.findUnique({ where: { id: activeDraftId } }))!.draftRevision;

      // Author B cannot update Author A's block
      await expect(
        blocksService.updateBlock(userB, activeDraftId, targetBlockId, {
          expectedRevision: currentRev,
          content: { text: 'Tampered' },
        }),
      ).rejects.toThrow('Article not found.');

      // Author B cannot delete Author A's block
      await expect(
        blocksService.deleteBlock(userB, activeDraftId, targetBlockId, {
          expectedRevision: currentRev,
        }),
      ).rejects.toThrow('Article not found.');
    });

    it('11. verifies block deletion and reordering maintain contiguous positions', async () => {
      const allBlocks = await blocksRepo.findBlocksByArticle(activeDraftId);
      const blockToDelete = allBlocks[allBlocks.length - 1];
      const currentRev = (await prismaRuntime.article.findUnique({ where: { id: activeDraftId } }))!.draftRevision;

      await blocksService.deleteBlock(userA, activeDraftId, blockToDelete.id, {
        expectedRevision: currentRev,
      });

      const remaining = await blocksRepo.findBlocksByArticle(activeDraftId);
      for (let i = 0; i < remaining.length; i++) {
        expect(remaining[i].position).toBe(i);
      }
    });

    it('12. verifies published article snapshots and snapshot-media remain immutable during draft updates', async () => {
      // 1. Fixture: published article with snapshot
      const pub = await prismaAdmin.article.create({
        data: {
          authorId: authorA.id,
          title: 'Immutable Snapshot Test',
          draftSlug: 'immutable-snapshot-test',
          publishedSlug: 'immutable-snapshot-test-pub',
          status: ArticleStatus.PUBLISHED,
          draftRevision: 20,
          publishedRevision: 20,
          publishedAt: new Date('2026-10-25T00:00:00Z'),
        },
      });

      const snapshot = await prismaAdmin.articleSnapshot.create({
        data: {
          articleId: pub.id,
          snapshotRevision: 20,
          title: pub.title,
          publishedSlug: pub.publishedSlug!,
          typographyPreset: 'MODERN_SANS',
          blocks: { schemaVersion: 1, blocks: [] },
        },
      });

      await prismaAdmin.article.update({
        where: { id: pub.id },
        data: { currentSnapshotId: snapshot.id },
      });

      // 2. Add block to draft of published article
      const added = await blocksService.createBlock(userA, pub.id, {
        expectedRevision: 20,
        type: ArticleBlockType.RICH_TEXT,
        content: { html: '<p>New draft section after publication.</p>' },
      });

      expect(added.draftRevision).toBe(21);

      // 3. Confirm snapshot is untouched
      const snapInDb = await prismaRuntime.articleSnapshot.findUnique({ where: { id: snapshot.id } });
      expect(snapInDb!.snapshotRevision).toBe(20);
      expect(snapInDb!.title).toBe('Immutable Snapshot Test');

      // 4. Confirm zero snapshot media records exist
      const snapMediaCount = await prismaRuntime.articleSnapshotMedia.count();
      expect(snapMediaCount).toBe(0);
    });
  });

  describe('Section 17: HTTP-Level Validation Pipeline (Supertest)', () => {
    let httpArticleId: string;
    let httpBlockId: string;

    beforeAll(async () => {
      const d = await articlesService.createDraft(userA, {
        title: 'HTTP Security Pipeline Draft',
        draftSlug: 'http-security-pipeline-draft',
      });
      httpArticleId = d.id;
    });

    it('13. HTTP POST rejects malicious <script> HTML with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.RICH_TEXT,
          content: { html: '<p>Intro</p><script>alert("PWNED")</script>' },
        })
        .expect(400);

      expect(res.body.message).toContain('Prohibited HTML element: <script>.');
    });

    it('14. HTTP POST accepts valid safe HTML and returns 201 Created', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.RICH_TEXT,
          content: { html: '<p>Verified safe content with <strong>strong</strong> text.</p>' },
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.draftRevision).toBe(2);
      httpBlockId = res.body.id;
    });

    it('15. HTTP PATCH rejects malicious javascript: URL with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .patch(`/articles/${httpArticleId}/blocks/${httpBlockId}`)
        .send({
          expectedRevision: 2,
          content: { html: '<a href="javascript:stealCookie()">Click</a>' },
        })
        .expect(400);

      expect(res.body.message).toContain('Prohibited link protocol "javascript:"');
    });

    it('16. HTTP POST rejects VIDEO block with spoofed provider domain with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 2,
          type: ArticleBlockType.VIDEO,
          content: {
            provider: 'YOUTUBE',
            url: 'https://youtube.com.attacker.example/watch?v=123',
          },
        })
        .expect(400);

      expect(res.body.message).toContain('Invalid host "youtube.com.attacker.example" for YOUTUBE provider');
    });

    it('17. HTTP POST rejects LINK_CARD block with embedded credentials with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 2,
          type: ArticleBlockType.LINK_CARD,
          content: {
            url: 'https://user:pass@example.com/login',
            title: 'Phishing',
          },
        })
        .expect(400);

      expect(res.body.message).toContain('LINK_CARD block "url" cannot contain embedded credentials');
    });

    it('18. HTTP POST rejects oversized content exceeding size limit with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 2,
          type: ArticleBlockType.CODE,
          content: {
            code: 'x'.repeat(66000),
          },
        })
        .expect(400);

      expect(res.body.message).toContain('Block content exceeds');
    });

    it('19. confirms optimistic revision check succeeds with current revision after failed validation attempts', async () => {
      currentUserInjected = userA;
      // Stale revision 1 fails with 409
      await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.DIVIDER,
          content: {},
        })
        .expect(409);

      // Current revision 2 succeeds with 201
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpArticleId}/blocks`)
        .send({
          expectedRevision: 2,
          type: ArticleBlockType.DIVIDER,
          content: {},
        })
        .expect(201);

      expect(res.body.draftRevision).toBe(3);
    });
  });
});
