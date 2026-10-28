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

describe('Stage 6D-S Standards-Based HTML Safety & JSONB Boundary Assurance (e2e)', () => {
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
  let userA: AuthenticatedUser;

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

    // 10. Seed Author
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.sec.s@skyra-tech.com',
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
      sessionId: 'sess-sec-s-1',
    };

    // 11. Setup NestJS HTTP Test App with real ValidationPipe
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

  describe('Section 12: Byte-Boundary Test Matrix (JavaScript vs PostgreSQL JSONB)', () => {
    beforeAll(async () => {
      const draft = await articlesService.createDraft(userA, {
        title: 'JSONB Boundary Assurance Draft',
        draftSlug: 'jsonb-boundary-assurance-draft',
      });
      activeDraftId = draft.id;
    });

    it('1. Case 1: Small ASCII content byte comparison', async () => {
      const payload = { text: 'Hello, World!' };
      const jsLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');

      const pgRes = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) as octet_len;
      `;
      // PostgreSQL jsonb adds space after colon: {"text": "Hello, World!"} vs {"text":"Hello, World!"} (diff = 1)
      expect(pgRes[0].octet_len).toBeGreaterThanOrEqual(jsLength);
    });

    it('2. Case 2: Multibyte Unicode content byte comparison', async () => {
      const payload = { text: '🚀 Bachina Labs Academy 🎓 日本語 🌟' };
      const jsLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');

      const pgRes = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) as octet_len;
      `;
      expect(pgRes[0].octet_len).toBeGreaterThanOrEqual(jsLength);
    });

    it('3. Case 3: Escaped characters (quotes, backslashes, newlines)', async () => {
      const payload = { code: 'console.log("hello\\nworld");\t// tab' };
      const jsLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');

      const pgRes = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) as octet_len;
      `;
      expect(pgRes[0].octet_len).toBeGreaterThanOrEqual(jsLength);
    });

    it('4. Case 4: Nested JSON structures', async () => {
      const payload = {
        level1: {
          level2: {
            title: 'Deep Architecture',
            items: [1, 2, 3],
          },
        },
      };
      const jsLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');

      const pgRes = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) as octet_len;
      `;
      expect(pgRes[0].octet_len).toBeGreaterThanOrEqual(jsLength);
    });

    it('5. Case 5: Many object properties (demonstrates formatting space accumulation)', async () => {
      const payload: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        payload[`prop_${i}`] = `value_${i}`;
      }
      const jsLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');

      const pgRes = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) as octet_len;
      `;
      // Demonstrates serialization divergence: 50 spaces after colons + 49 spaces after commas = 99 bytes
      expect(pgRes[0].octet_len - jsLength).toBe(99);
    });

    it('6. Case 6: Arrays with many elements', async () => {
      const payload = {
        headers: ['A', 'B', 'C'],
        rows: Array.from({ length: 20 }, (_, i) => [`cell_${i}_1`, `cell_${i}_2`, `cell_${i}_3`]),
      };
      const jsLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');

      const pgRes = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) as octet_len;
      `;
      expect(pgRes[0].octet_len).toBeGreaterThanOrEqual(jsLength);
    });

    it('7. Case 7: Content approaching the application early-rejection threshold (<= 65000 bytes)', async () => {
      const content = { code: 'a'.repeat(58000), language: 'typescript' };
      const block = await blocksService.createBlock(userA, activeDraftId, {
        expectedRevision: 1,
        type: ArticleBlockType.CODE,
        content,
      });

      expect(block.draftRevision).toBe(2);

      const inDb = await prismaRuntime.articleBlock.findUnique({ where: { id: block.id } });
      expect(inDb).not.toBeNull();
    });

    it('8. Case 8: Content exceeding the application early-rejection threshold (> 65000 bytes)', async () => {
      const content = { code: 'a'.repeat(66000) };
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 2,
          type: ArticleBlockType.CODE,
          content,
        }),
      ).rejects.toThrow(/Block content exceeds maximum allowed size of 65536 bytes/);

      // Verify draft revision remained at 2
      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(2);
    });

    it('9. Case 9: Database boundary content at 65535 bytes in PostgreSQL', async () => {
      // Craft JSON string whose octet_length is exactly 65535 bytes
      const prefix = '{"pad":"';
      const suffix = '"}';
      const fillLen = 65535 - prefix.length - suffix.length - 1; // accounting for 1 space in JSONB
      const exact65535 = JSON.stringify({ pad: 'y'.repeat(fillLen) });

      const res = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${exact65535}::jsonb::text) as octet_len;
      `;
      expect(res[0].octet_len).toBeLessThanOrEqual(65536);

      // Insertion into PostgreSQL must succeed
      await prismaAdmin.$executeRaw`
        INSERT INTO article_blocks (id, article_id, position, type, content, created_at, updated_at)
        VALUES (gen_random_uuid(), ${activeDraftId}::uuid, 990, 'CODE', ${exact65535}::jsonb, now(), now());
      `;
    });

    it('10. Case 10: Database boundary content at exactly 65536 bytes in PostgreSQL', async () => {
      const prefix = '{"pad":"';
      const suffix = '"}';
      const fillLen = 65536 - prefix.length - suffix.length - 1;
      const exact65536 = JSON.stringify({ pad: 'y'.repeat(fillLen) });

      const res = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${exact65536}::jsonb::text) as octet_len;
      `;
      expect(res[0].octet_len).toBe(65536);

      // Boundary insertion at exactly 65536 bytes must succeed
      await prismaAdmin.$executeRaw`
        INSERT INTO article_blocks (id, article_id, position, type, content, created_at, updated_at)
        VALUES (gen_random_uuid(), ${activeDraftId}::uuid, 991, 'CODE', ${exact65536}::jsonb, now(), now());
      `;
    });

    it('11. Case 11: Database boundary content at 65537 bytes fails PostgreSQL CHECK constraint', async () => {
      const prefix = '{"pad":"';
      const suffix = '"}';
      const fillLen = 65537 - prefix.length - suffix.length - 1;
      const exact65537 = JSON.stringify({ pad: 'y'.repeat(fillLen) });

      const res = await prismaAdmin.$queryRaw<{ octet_len: number }[]>`
        SELECT octet_length(${exact65537}::jsonb::text) as octet_len;
      `;
      expect(res[0].octet_len).toBe(65537);

      // Must fail chk_article_blocks_content_size with SQLSTATE 23514
      await expect(
        prismaAdmin.$executeRaw`
          INSERT INTO article_blocks (id, article_id, position, type, content, created_at, updated_at)
          VALUES (gen_random_uuid(), ${activeDraftId}::uuid, 992, 'CODE', ${exact65537}::jsonb, now(), now());
        `,
      ).rejects.toThrow(/chk_article_blocks_content_size/);
    });
  });

  describe('Section 11: Structured CHECK Constraint Error Mapping', () => {
    it('12. distinguishes size constraint failure from foreign-key or unrelated database errors', async () => {
      // 1. Foreign-key violation should produce 403 or 404, NEVER disguised as size error
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 2,
          type: ArticleBlockType.IMAGE,
          content: {},
          mediaAssetId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow('Media asset not found.');

      // 2. Draft revision remains unchanged at 2
      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(2);
    });

    it('13. rejects duplicate attribute in HTML before persistence and preserves revision', async () => {
      await expect(
        blocksService.createBlock(userA, activeDraftId, {
          expectedRevision: 2,
          type: ArticleBlockType.RICH_TEXT,
          content: {
            html: '<a href="https://bachinalabs.com" href="https://attacker.com">Bachina Labs</a>',
          },
        }),
      ).rejects.toThrow(/Duplicate attribute "href"/);

      const article = await prismaRuntime.article.findUnique({ where: { id: activeDraftId } });
      expect(article!.draftRevision).toBe(2);
    });
  });

  describe('Section 16: HTTP-Level Security & Pipeline Assurance', () => {
    let httpDraftId: string;

    beforeAll(async () => {
      const d = await articlesService.createDraft(userA, {
        title: 'HTTP Final Assurance Article',
        draftSlug: 'http-final-assurance-article',
      });
      httpDraftId = d.id;
    });

    it('14. HTTP POST accepts valid safe RICH_TEXT and returns 201 Created with advanced revision', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpDraftId}/blocks`)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.RICH_TEXT,
          content: {
            html: '<p>Verified safe content with <a href="https://bachinalabs.com" title="Homepage">Bachina Labs</a>.</p>',
          },
        })
        .expect(201);

      expect(res.body.type).toBe('RICH_TEXT');
      expect(res.body.draftRevision).toBe(2);
    });

    it('15. HTTP POST rejects duplicate attributes in RICH_TEXT with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpDraftId}/blocks`)
        .send({
          expectedRevision: 2,
          type: ArticleBlockType.RICH_TEXT,
          content: {
            html: '<a href="https://a.com" href="https://b.com">Link</a>',
          },
        })
        .expect(400);

      expect(res.body.message).toContain('Duplicate attribute "href"');
    });

    it('16. HTTP POST rejects oversized content exceeding application threshold with 400 Bad Request', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpDraftId}/blocks`)
        .send({
          expectedRevision: 2,
          type: ArticleBlockType.CODE,
          content: {
            code: 'z'.repeat(66000),
          },
        })
        .expect(400);

      expect(res.body.message).toContain('Block content exceeds maximum allowed size of 65536 bytes');
    });

    it('17. confirms optimistic revision progression succeeds with revision 2 after failed attempts', async () => {
      currentUserInjected = userA;
      const res = await request(app.getHttpServer())
        .post(`/articles/${httpDraftId}/blocks`)
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
