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
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticlePublicReaderRepository } from '../src/modules/articles/repositories/article-public-reader.repository.js';
import { ArticlePublicReaderService } from '../src/modules/articles/services/article-public-reader.service.js';
import { ArticleMediaService } from '../src/modules/articles/services/article-media.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticlePublicReaderController } from '../src/modules/articles/controllers/article-public-reader.controller.js';
import { JwtAccessGuard } from '../src/modules/auth/guards/jwt-access.guard.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import { VerifiedEmailGuard } from '../src/common/authorization/guards/verified-email.guard.js';
import { JwtTokenService } from '../src/modules/auth/services/jwt-token.service.js';
import { SessionsService } from '../src/modules/sessions/sessions.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/services/cookie.service.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

const APPROVED_DB_NAME_PATTERN = /^academy_auth_audit_[a-f0-9]{16}$/;

describe('Checkpoint C-2 Author Article Taxonomy Assignment and Validation (e2e)', () => {
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
  let readerRepo: ArticlePublicReaderRepository;
  let readerService: ArticlePublicReaderService;

  let app: INestApplication;

  let authorUserA: AuthenticatedUser;
  let authorUserB: AuthenticatedUser;

  let authorACookie: string;
  let authorBCookie: string;
  let revokedSessionCookie: string;

  let dbName: string;

  let testCat1: { id: string; name: string; slug: string };
  let testCat2: { id: string; name: string; slug: string };
  let testTagA: { id: string; name: string; slug: string };
  let testTagB: { id: string; name: string; slug: string };
  let testTagC: { id: string; name: string; slug: string };
  let twentyTags: { id: string; name: string; slug: string }[];

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

    // 2. Generate collision-resistant unique disposable database name strictly matching pattern
    disposableDbName = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
    if (!APPROVED_DB_NAME_PATTERN.test(disposableDbName)) {
      throw new Error(`Generated database name ${disposableDbName} does not match approved pattern.`);
    }
    assertDisposableTestDatabase(disposableDbName, 'academy_auth_audit_');

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

    // 6. Deploy all 12 authentic Prisma migrations
    disposableMigrationUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;
    execSync('pnpm prisma migrate deploy', {
      cwd: fs.existsSync('prisma') ? '.' : 'apps/api',
      env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
      encoding: 'utf8',
    });

    // 7. Grant permissions on tables to academy_app
    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "articles" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "tags" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "article_tags" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "article_blocks" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "article_snapshots" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "media_assets" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "${runtimeUser}";
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

    // 10. Seed Authors
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.a.taxonomy@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorUserA = {
      id: createdA.id,
      email: createdA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-a-c2',
    };

    const createdB = await prismaAdmin.user.create({
      data: {
        email: 'author.b.taxonomy@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorUserB = {
      id: createdB.id,
      email: createdB.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-b-c2',
    };

    // Configure test cookies
    authorACookie = `${ACCESS_COOKIE_NAME}=token-author-a`;
    authorBCookie = `${ACCESS_COOKIE_NAME}=token-author-b`;
    revokedSessionCookie = `${ACCESS_COOKIE_NAME}=token-revoked`;

    // Authentic JWT, Session, and User mock services to drive real JwtAccessGuard
    const mockJwtTokenService = {
      verifyAccessToken: vi.fn(async (token: string) => {
        if (token === 'token-author-a') {
          return { sub: authorUserA.id, email: authorUserA.email, role: authorUserA.role, sid: authorUserA.sessionId };
        }
        if (token === 'token-author-b') {
          return { sub: authorUserB.id, email: authorUserB.email, role: authorUserB.role, sid: authorUserB.sessionId };
        }
        if (token === 'token-revoked') {
          return { sub: authorUserA.id, email: authorUserA.email, role: authorUserA.role, sid: 'revoked-session' };
        }
        throw new Error('Invalid token');
      }),
    };

    const mockSessionsService = {
      validateSession: vi.fn(async (sid: string) => {
        if (sid === 'revoked-session') {
          return null;
        }
        if (sid === authorUserA.sessionId) {
          return { id: sid, userId: authorUserA.id, revokedAt: null };
        }
        if (sid === authorUserB.sessionId) {
          return { id: sid, userId: authorUserB.id, revokedAt: null };
        }
        return null;
      }),
    };

    const mockUsersRepository = {
      findById: vi.fn(async (userId: string) => {
        if (userId === authorUserA.id) {
          return { ...authorUserA };
        }
        if (userId === authorUserB.id) {
          return { ...authorUserB };
        }
        return null;
      }),
    };

    // Seed taxonomy fixtures
    testCat1 = await prismaAdmin.category.create({
      data: {
        name: 'Backend Engineering',
        slug: 'backend-engineering',
        description: 'Backend topics',
      },
    });

    testCat2 = await prismaAdmin.category.create({
      data: {
        name: 'DevOps & Infrastructure',
        slug: 'devops-infra',
        description: 'Infrastructure topics',
      },
    });

    // Seed tags with distinct names and slugs to verify alphabetical ordering:
    // slug: 'docker', slug: 'nestjs', slug: 'postgresql'
    testTagA = await prismaAdmin.tag.create({
      data: {
        name: 'PostgreSQL',
        slug: 'postgresql',
      },
    });

    testTagB = await prismaAdmin.tag.create({
      data: {
        name: 'NestJS',
        slug: 'nestjs',
      },
    });

    testTagC = await prismaAdmin.tag.create({
      data: {
        name: 'Docker',
        slug: 'docker',
      },
    });

    await prismaAdmin.tag.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        name: `Tag Batch ${String(i + 1).padStart(2, '0')}`,
        slug: `tag-batch-${String(i + 1).padStart(2, '0')}`,
      })),
    });

    twentyTags = await prismaAdmin.tag.findMany({
      where: { slug: { startsWith: 'tag-batch-' } },
      orderBy: { slug: 'asc' },
    });

    // Wire repositories and services
    articlesRepo = new ArticlesRepository(prismaRuntime as any);
    articlesService = new ArticlesService(articlesRepo);
    readerRepo = new ArticlePublicReaderRepository(prismaRuntime as any);
    readerService = new ArticlePublicReaderService(readerRepo);

    const mockMediaService = {
      getPublicMediaContent: vi.fn(),
    };

    // 11. Create NestJS Test Application
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ArticlesController, ArticlePublicReaderController],
      providers: [
        { provide: ArticlesService, useValue: articlesService },
        { provide: ArticlesRepository, useValue: articlesRepo },
        { provide: ArticlePublicReaderService, useValue: readerService },
        { provide: ArticlePublicReaderRepository, useValue: readerRepo },
        { provide: ArticleMediaService, useValue: mockMediaService },
        { provide: JwtTokenService, useValue: mockJwtTokenService },
        { provide: SessionsService, useValue: mockSessionsService },
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: APP_GUARD, useClass: JwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        VerifiedEmailGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  }, 90000);

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
      assertDisposableTestDatabase(disposableDbName, 'academy_auth_audit_');
      await safelyDropDisposableDatabase(disposableDbName, (sql) => runAdminPsql(sql), {
        allowedPrefix: 'academy_auth_audit_',
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 1: Article Creation with Taxonomy
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 1: Draft Article Creation with Taxonomy', () => {
    it('1. creates draft with valid Category and multiple Tags returning sorted tagIds and nested taxonomy (201)', async () => {
      // Tags passed in unsorted order: [PostgreSQL (slug 'postgresql'), Docker (slug 'docker'), NestJS (slug 'nestjs')]
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Full Stack NestJS Architecture',
          draftSlug: 'full-stack-nestjs-architecture',
          categoryId: testCat1.id,
          tagIds: [testTagA.id, testTagC.id, testTagB.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.categoryId).toBe(testCat1.id);
      expect(res.body.category).toEqual({
        id: testCat1.id,
        name: testCat1.name,
        slug: testCat1.slug,
      });
      // Tags sorted alphabetically by slug: docker, nestjs, postgresql
      expect(res.body.tagIds).toEqual([testTagC.id, testTagB.id, testTagA.id]);
      expect(res.body.tags).toEqual([
        { id: testTagC.id, name: testTagC.name, slug: testTagC.slug },
        { id: testTagB.id, name: testTagB.name, slug: testTagB.slug },
        { id: testTagA.id, name: testTagA.name, slug: testTagA.slug },
      ]);
      expect(res.body.draftRevision).toBe(1);
    });

    it('2. creates draft with Category only (tagIds omitted) (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Backend Only Article',
          draftSlug: 'backend-only-article',
          categoryId: testCat1.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.categoryId).toBe(testCat1.id);
      expect(res.body.category).toEqual({
        id: testCat1.id,
        name: testCat1.name,
        slug: testCat1.slug,
      });
      expect(res.body.tagIds).toEqual([]);
      expect(res.body.tags).toEqual([]);
    });

    it('3. creates draft with Tags only (categoryId omitted) (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Tags Only Article',
          draftSlug: 'tags-only-article',
          tagIds: [testTagB.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.categoryId).toBeNull();
      expect(res.body.category).toBeNull();
      expect(res.body.tagIds).toEqual([testTagB.id]);
      expect(res.body.tags).toEqual([
        { id: testTagB.id, name: testTagB.name, slug: testTagB.slug },
      ]);
    });

    it('4. creates draft with neither Category nor Tags (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Bare Draft Article',
          draftSlug: 'bare-draft-article',
        });

      expect(res.status).toBe(201);
      expect(res.body.categoryId).toBeNull();
      expect(res.body.category).toBeNull();
      expect(res.body.tagIds).toEqual([]);
      expect(res.body.tags).toEqual([]);
    });

    it('5. rejects creation with non-existent categoryId (400)', async () => {
      const nonExistentCat = crypto.randomUUID();
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Invalid Category Article',
          draftSlug: 'invalid-category-article',
          categoryId: nonExistentCat,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Category not found/i);
    });

    it('6. rejects creation with malformed categoryId (non-UUID) (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Malformed Category Article',
          draftSlug: 'malformed-category-article',
          categoryId: 'not-a-valid-uuid',
        });

      expect(res.status).toBe(400);
    });

    it('7. rejects creation with non-existent tagId (400)', async () => {
      const nonExistentTag = crypto.randomUUID();
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Invalid Tag Article',
          draftSlug: 'invalid-tag-article',
          tagIds: [testTagA.id, nonExistentTag],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/One or more tags not found/i);
    });

    it('8. rejects creation with duplicate tagIds (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Duplicate Tags Article',
          draftSlug: 'duplicate-tags-article',
          tagIds: [testTagA.id, testTagA.id],
        });

      expect(res.status).toBe(400);
    });

    it('9. rejects creation with more than 20 tagIds (400)', async () => {
      const over20Tags = Array.from({ length: 21 }, (_, i) =>
        `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      );
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Too Many Tags Article',
          draftSlug: 'too-many-tags-article',
          tagIds: over20Tags,
        });

      expect(res.status).toBe(400);
    });

    it('10. creates draft with 6 valid Tags successfully and persists 6 associations in article_tags (201)', async () => {
      const tagSlice = twentyTags.slice(0, 6);
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Six Tags Article',
          draftSlug: 'six-tags-article',
          tagIds: tagSlice.map((t) => t.id),
        });

      expect(res.status).toBe(201);
      expect(res.body.tagIds.length).toBe(6);
      expect(res.body.tags.length).toBe(6);

      const dbTagCount = await prismaAdmin.articleTag.count({
        where: { articleId: res.body.id },
      });
      expect(dbTagCount).toBe(6);
    });

    it('11. creates draft with exactly 20 valid Tags successfully and persists 20 associations in article_tags (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Twenty Tags Article',
          draftSlug: 'twenty-tags-article',
          tagIds: twentyTags.map((t) => t.id),
        });

      expect(res.status).toBe(201);
      expect(res.body.tagIds.length).toBe(20);
      expect(res.body.tags.length).toBe(20);

      const dbTagCount = await prismaAdmin.articleTag.count({
        where: { articleId: res.body.id },
      });
      expect(dbTagCount).toBe(20);
    });

    it('12. rejects creation with 21 tags atomically leaving 0 partial records (400)', async () => {
      const initialArticles = await prismaAdmin.article.count();
      const initialArticleTags = await prismaAdmin.articleTag.count();

      const extraTagId = crypto.randomUUID();
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Twenty One Tags Article',
          draftSlug: 'twenty-one-tags-article',
          tagIds: [...twentyTags.map((t) => t.id), extraTagId],
        });

      expect(res.status).toBe(400);

      const postArticles = await prismaAdmin.article.count();
      const postArticleTags = await prismaAdmin.articleTag.count();
      expect(postArticles).toBe(initialArticles);
      expect(postArticleTags).toBe(initialArticleTags);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 2: Draft Taxonomy Modification, Replacement, Clearing, and Concurrency
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 2: Draft Taxonomy Modification, Clearing, and Concurrency', () => {
    let articleId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Taxonomy Lifecycle Article',
          draftSlug: 'taxonomy-lifecycle-article',
          categoryId: testCat1.id,
          tagIds: [testTagA.id],
        });
      articleId = created.body.id;
    });

    it('10. replaces Category on draft update and increments revision (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          categoryId: testCat2.id,
        });

      expect(res.status).toBe(200);
      expect(res.body.categoryId).toBe(testCat2.id);
      expect(res.body.tagIds).toEqual([testTagA.id]); // preserved
      expect(res.body.draftRevision).toBe(2);
    });

    it('11. explicitly clears Category when categoryId is null and increments revision (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 2,
          categoryId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.categoryId).toBeNull();
      expect(res.body.tagIds).toEqual([testTagA.id]);
      expect(res.body.draftRevision).toBe(3);
    });

    it('12. replaces Tag set on draft update and increments revision (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 3,
          tagIds: [testTagB.id, testTagC.id],
        });

      expect(res.status).toBe(200);
      expect(res.body.categoryId).toBeNull();
      // Sorted: docker, nestjs
      expect(res.body.tagIds).toEqual([testTagC.id, testTagB.id]);
      expect(res.body.draftRevision).toBe(4);
    });

    it('13. explicitly clears all Tags when tagIds is empty array [] and increments revision (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 4,
          tagIds: [],
        });

      expect(res.status).toBe(200);
      expect(res.body.categoryId).toBeNull();
      expect(res.body.tagIds).toEqual([]);
      expect(res.body.draftRevision).toBe(5);
    });

    it('14. preserves Category and Tags when taxonomy fields are omitted in draft update (200)', async () => {
      // First, set category and a tag
      await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 5,
          categoryId: testCat1.id,
          tagIds: [testTagA.id],
        });

      // Update only title
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 6,
          title: 'Preserved Taxonomy Article',
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Preserved Taxonomy Article');
      expect(res.body.categoryId).toBe(testCat1.id);
      expect(res.body.tagIds).toEqual([testTagA.id]);
      expect(res.body.draftRevision).toBe(7);
    });

    it('15. detects identical taxonomy update as no-op and returns article without incrementing revision (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 7,
          categoryId: testCat1.id,
          tagIds: [testTagA.id],
        });

      expect(res.status).toBe(200);
      expect(res.body.draftRevision).toBe(7); // NOT incremented
      expect(res.body.categoryId).toBe(testCat1.id);
      expect(res.body.tagIds).toEqual([testTagA.id]);
    });

    it('16. rejects draft update with non-existent categoryId (400) without database mutation', async () => {
      const nonExistent = crypto.randomUUID();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 7,
          categoryId: nonExistent,
        });

      expect(res.status).toBe(400);

      // Verify DB unchanged
      const raw = await prismaAdmin.article.findUnique({ where: { id: articleId } });
      expect(raw?.categoryId).toBe(testCat1.id);
      expect(raw?.draftRevision).toBe(7);
    });

    it('17. rejects draft update with non-existent tagId (400) without database mutation', async () => {
      const nonExistent = crypto.randomUUID();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 7,
          tagIds: [testTagA.id, nonExistent],
        });

      expect(res.status).toBe(400);

      // Verify DB unchanged
      const raw = await prismaAdmin.article.findUnique({ where: { id: articleId } });
      expect(raw?.draftRevision).toBe(7);
    });

    it('18. rejects draft update with duplicate tagIds (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 7,
          tagIds: [testTagA.id, testTagA.id],
        });

      expect(res.status).toBe(400);
    });

    it('18b. updates draft with exactly 20 valid Tags successfully and persists 20 associations in article_tags (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 7,
          tagIds: twentyTags.map((t) => t.id),
        });

      expect(res.status).toBe(200);
      expect(res.body.tagIds.length).toBe(20);
      expect(res.body.tags.length).toBe(20);
      expect(res.body.draftRevision).toBe(8);

      const dbCount = await prismaAdmin.articleTag.count({
        where: { articleId },
      });
      expect(dbCount).toBe(20);
    });

    it('19. rejects draft update with >20 tagIds (400)', async () => {
      const over20 = Array.from({ length: 21 }, (_, i) =>
        `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      );
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 8,
          tagIds: over20,
        });

      expect(res.status).toBe(400);

      const raw = await prismaAdmin.article.findUnique({ where: { id: articleId } });
      expect(raw?.draftRevision).toBe(8);
    });

    it('20. rejects draft update with stale expectedRevision (409)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1, // Stale! Current is 7
          categoryId: testCat2.id,
        });

      expect(res.status).toBe(409);
    });

    it('21. transactional rollback: failure during tag validation preserves Category and aborts update', async () => {
      const nonExistentTag = crypto.randomUUID();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 8,
          categoryId: testCat2.id, // Valid new category
          tagIds: [nonExistentTag], // Invalid tag
        });

      expect(res.status).toBe(400);

      // Verify DB row still has testCat1, NOT testCat2, and draftRevision remains 8
      const raw = await prismaAdmin.article.findUnique({ where: { id: articleId } });
      expect(raw?.categoryId).toBe(testCat1.id);
      expect(raw?.draftRevision).toBe(8);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 3: Author Retrieval, Pagination, Cross-Author Isolation & Security
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 3: Read Endpoints, Access Control and Author Isolation', () => {
    let articleAId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Author A Scoped Article',
          draftSlug: 'author-a-scoped-article',
          categoryId: testCat1.id,
          tagIds: [testTagB.id, testTagA.id],
        });
      articleAId = created.body.id;
    });

    it('22. author retrieval returns correct categoryId and sorted tagIds (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/articles/${articleAId}`)
        .set('Cookie', authorACookie);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(articleAId);
      expect(res.body.categoryId).toBe(testCat1.id);
      // Alphabetical tags by slug: nestjs, postgresql
      expect(res.body.tagIds).toEqual([testTagB.id, testTagA.id]);
    });

    it('23. author list returns correct categoryId and sorted tagIds in summary items (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/articles/mine')
        .set('Cookie', authorACookie);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      const item = res.body.items.find((i: any) => i.id === articleAId);
      expect(item).toBeDefined();
      expect(item.categoryId).toBe(testCat1.id);
      expect(item.tagIds).toEqual([testTagB.id, testTagA.id]);
    });

    it('24. cross-author isolation: author B cannot view or update author A article (404)', async () => {
      // Author B GET Author A article -> 404
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/articles/${articleAId}`)
        .set('Cookie', authorBCookie);
      expect(getRes.status).toBe(404);

      // Author B PATCH Author A article -> 404
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleAId}`)
        .set('Cookie', authorBCookie)
        .send({
          expectedRevision: 1,
          categoryId: testCat2.id,
        });
      expect(patchRes.status).toBe(404);

      // Verify Author A's article was untouched
      const raw = await prismaAdmin.article.findUnique({ where: { id: articleAId } });
      expect(raw?.categoryId).toBe(testCat1.id);
    });

    it('25. rejects anonymous requests to author endpoints (401)', async () => {
      const resPost = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .send({ title: 'Anon Title', draftSlug: 'anon-title' });
      expect(resPost.status).toBe(401);

      const resGet = await request(app.getHttpServer())
        .get(`/api/v1/articles/${articleAId}`);
      expect(resGet.status).toBe(401);

      const resList = await request(app.getHttpServer())
        .get('/api/v1/articles/mine');
      expect(resList.status).toBe(401);

      const resPatch = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${articleAId}`)
        .send({ expectedRevision: 1 });
      expect(resPatch.status).toBe(401);
    });

    it('26. rejects revoked session requests to author endpoints (401)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/articles/${articleAId}`)
        .set('Cookie', revokedSessionCookie);

      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 4: Public Reader Isolation, Referential Integrity, and Snapshot Safety
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 4: Public Reader Isolation, Cascade/Set-Null, and Snapshot Safety', () => {
    let publishedArticleId: string;
    let publishedSlug: string;

    beforeAll(async () => {
      publishedSlug = 'immutable-published-article';
      // Create and publish an article directly in DB with an immutable snapshot
      const article = await prismaAdmin.article.create({
        data: {
          authorId: authorUserA.id,
          title: 'Immutable Published Article',
          draftSlug: publishedSlug,
          publishedSlug: publishedSlug,
          status: ArticleStatus.PUBLISHED,
          publishedAt: new Date(),
          draftRevision: 3,
          publishedRevision: 1,
          categoryId: testCat1.id,
          tags: {
            create: [
              { tagId: testTagA.id },
              { tagId: testTagB.id },
            ],
          },
        },
      });
      publishedArticleId = article.id;

      const snapshot = await prismaAdmin.articleSnapshot.create({
        data: {
          articleId: publishedArticleId,
          snapshotRevision: 1,
          title: 'Immutable Published Article',
          publishedSlug: publishedSlug,
          typographyPreset: 'MODERN_SANS',
          publishedAt: new Date(),
          blocks: {
            schemaVersion: 1,
            blocks: [
              {
                id: crypto.randomUUID(),
                type: 'RICH_TEXT',
                position: 0,
                content: { html: '<p>Published immutable content.</p>' },
              },
            ],
          },
        },
      });

      await prismaAdmin.article.update({
        where: { id: publishedArticleId },
        data: { currentSnapshotId: snapshot.id },
      });
    });

    it('27. public reader endpoints do not leak draft taxonomy changes on published article (200)', async () => {
      // Modify draft metadata: clear category and replace tags with testTagC
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${publishedArticleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 3,
          categoryId: null,
          tagIds: [testTagC.id],
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.categoryId).toBeNull();
      expect(patchRes.body.tagIds).toEqual([testTagC.id]);
      expect(patchRes.body.draftRevision).toBe(4);

      // Read via public reader endpoint
      const pubRes = await request(app.getHttpServer())
        .get(`/api/v1/articles/public/${publishedSlug}`);

      expect(pubRes.status).toBe(200);
      expect(pubRes.body.title).toBe('Immutable Published Article');
      expect(pubRes.body.blocks).toBeDefined();
      expect(pubRes.body.blocks.length).toBe(1);
      // Public reader response does not contain draft taxonomy fields
    });

    it('28. category deletion sets article categoryId to NULL (ON DELETE SET NULL) without changing revision', async () => {
      // Create a temporary category and assign to draft
      const tempCat = await prismaAdmin.category.create({
        data: { name: 'Temporary Category', slug: 'temp-category' },
      });

      const draft = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Temp Category Article',
          draftSlug: 'temp-cat-article',
          categoryId: tempCat.id,
        });

      const tempArtId = draft.body.id;
      expect(draft.body.categoryId).toBe(tempCat.id);
      expect(draft.body.draftRevision).toBe(1);

      // Delete the category directly via admin
      await prismaAdmin.category.delete({ where: { id: tempCat.id } });

      // Verify database article record has categoryId = null, draftRevision still 1
      const updatedArticle = await prismaAdmin.article.findUnique({ where: { id: tempArtId } });
      expect(updatedArticle?.categoryId).toBeNull();
      expect(updatedArticle?.draftRevision).toBe(1);

      // Verify GET returns categoryId: null
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/articles/${tempArtId}`)
        .set('Cookie', authorACookie);
      expect(getRes.body.categoryId).toBeNull();
    });

    it('29. tag deletion cascades and removes tag association without affecting article or revision', async () => {
      // Create a temporary tag and assign to draft
      const tempTag = await prismaAdmin.tag.create({
        data: { name: 'Temporary Tag', slug: 'temp-tag' },
      });

      const draft = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Temp Tag Article',
          draftSlug: 'temp-tag-article',
          tagIds: [tempTag.id, testTagA.id],
        });

      const tempArtId = draft.body.id;
      expect(draft.body.tagIds).toEqual(expect.arrayContaining([tempTag.id, testTagA.id]));
      expect(draft.body.draftRevision).toBe(1);

      // Delete the temporary tag directly via admin
      await prismaAdmin.tag.delete({ where: { id: tempTag.id } });

      // Verify article_tags row for tempTag is gone, but testTagA persists
      const remainingTags = await prismaAdmin.articleTag.findMany({
        where: { articleId: tempArtId },
      });
      expect(remainingTags.length).toBe(1);
      expect(remainingTags[0].tagId).toBe(testTagA.id);

      // Verify article draftRevision remains 1
      const updatedArticle = await prismaAdmin.article.findUnique({ where: { id: tempArtId } });
      expect(updatedArticle?.draftRevision).toBe(1);

      // Verify GET returns only testTagA
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/articles/${tempArtId}`)
        .set('Cookie', authorACookie);
      expect(getRes.body.tagIds).toEqual([testTagA.id]);
    });

    it('30. published snapshot immutability: snapshot content, revision, and metadata remain untouched', async () => {
      const snapshot = await prismaAdmin.articleSnapshot.findFirst({
        where: { articleId: publishedArticleId },
      });

      expect(snapshot).toBeDefined();
      expect(snapshot?.snapshotRevision).toBe(1);
      expect(snapshot?.title).toBe('Immutable Published Article');
      expect(snapshot?.publishedSlug).toBe(publishedSlug);

      // Verify article currentSnapshotId is intact
      const pubArt = await prismaAdmin.article.findUnique({ where: { id: publishedArticleId } });
      expect(pubArt?.currentSnapshotId).toBe(snapshot?.id);
      expect(pubArt?.publishedRevision).toBe(1);
      // But draft revision has progressed independently
      expect(pubArt?.draftRevision).toBe(4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 5: Checkpoint C-2-R Creation-Time Races, Atomicity & Type Safety
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 5: Checkpoint C-2-R Creation-Time Races, Atomicity & Type Safety', () => {
    it('31. creation race (Scenario B): category deleted after pre-validation rolls back and returns 400 with zero partial rows', async () => {
      const raceCat = await prismaAdmin.category.create({
        data: { name: 'Race Cat 1', slug: 'race-cat-1' },
      });

      let preValidationPassed = false;
      const origFindCategory = articlesRepo.findCategoryById.bind(articlesRepo);
      const findCatSpy = vi.spyOn(articlesRepo, 'findCategoryById').mockImplementation(async (catId, tx) => {
        const res = await origFindCategory(catId, tx);
        if (catId === raceCat.id && res) {
          preValidationPassed = true;
        }
        return res;
      });

      const origCreate = articlesRepo.create.bind(articlesRepo);
      const createSpy = vi.spyOn(articlesRepo, 'create').mockImplementation(async (data) => {
        // Assert pre-validation completed successfully before deletion occurs
        expect(preValidationPassed).toBe(true);
        // Concurrently delete category from database via second connection
        await prismaAdmin.category.delete({ where: { id: raceCat.id } });
        const check = await prismaAdmin.category.findUnique({ where: { id: raceCat.id } });
        expect(check).toBeNull();
        // Continue to persistence (triggers PostgreSQL FK violation articles_category_id_fkey)
        return origCreate(data);
      });

      const initialArticles = await prismaAdmin.article.count();
      const initialArticleTags = await prismaAdmin.articleTag.count();
      const initialBlocks = await prismaAdmin.articleBlock.count();
      const initialSnapshots = await prismaAdmin.articleSnapshot.count();

      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Race Category Article',
          draftSlug: 'race-category-article',
          categoryId: raceCat.id,
          tagIds: [testTagA.id],
        });

      findCatSpy.mockRestore();
      createSpy.mockRestore();

      expect(preValidationPassed).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Category not found.');
      expect(JSON.stringify(res.body)).not.toContain('P2003');
      expect(JSON.stringify(res.body)).not.toContain('articles_category_id_fkey');

      expect(await prismaAdmin.article.count()).toBe(initialArticles);
      expect(await prismaAdmin.articleTag.count()).toBe(initialArticleTags);
      expect(await prismaAdmin.articleBlock.count()).toBe(initialBlocks);
      expect(await prismaAdmin.articleSnapshot.count()).toBe(initialSnapshots);
    });

    it('32. creation race (Scenario B): tag deleted after pre-validation rolls back and returns 400 with zero partial rows', async () => {
      const raceTag = await prismaAdmin.tag.create({
        data: { name: 'Race Tag 1', slug: 'race-tag-1' },
      });

      let preValidationPassed = false;
      const origFindTags = articlesRepo.findTagsByIds.bind(articlesRepo);
      const findTagsSpy = vi.spyOn(articlesRepo, 'findTagsByIds').mockImplementation(async (tagIds, tx) => {
        const res = await origFindTags(tagIds, tx);
        if (tagIds.includes(raceTag.id) && res.some((t) => t.id === raceTag.id)) {
          preValidationPassed = true;
        }
        return res;
      });

      const origCreate = articlesRepo.create.bind(articlesRepo);
      const createSpy = vi.spyOn(articlesRepo, 'create').mockImplementation(async (data) => {
        expect(preValidationPassed).toBe(true);
        // Concurrently delete validated tag from database via second connection
        await prismaAdmin.tag.delete({ where: { id: raceTag.id } });
        const check = await prismaAdmin.tag.findUnique({ where: { id: raceTag.id } });
        expect(check).toBeNull();
        // Continue to persistence (triggers PostgreSQL FK violation article_tags_tag_id_fkey)
        return origCreate(data);
      });

      const initialArticles = await prismaAdmin.article.count();
      const initialArticleTags = await prismaAdmin.articleTag.count();
      const initialBlocks = await prismaAdmin.articleBlock.count();
      const initialSnapshots = await prismaAdmin.articleSnapshot.count();

      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Race Tag Article',
          draftSlug: 'race-tag-article',
          categoryId: testCat1.id,
          tagIds: [testTagA.id, raceTag.id],
        });

      findTagsSpy.mockRestore();
      createSpy.mockRestore();

      expect(preValidationPassed).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('One or more tags not found.');
      expect(JSON.stringify(res.body)).not.toContain('P2003');
      expect(JSON.stringify(res.body)).not.toContain('article_tags_tag_id_fkey');

      expect(await prismaAdmin.article.count()).toBe(initialArticles);
      expect(await prismaAdmin.articleTag.count()).toBe(initialArticleTags);
      expect(await prismaAdmin.articleBlock.count()).toBe(initialBlocks);
      expect(await prismaAdmin.articleSnapshot.count()).toBe(initialSnapshots);
    });

    it('33. accepts categoryId: null explicitly on creation (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Explicit Null Category Article',
          draftSlug: 'explicit-null-cat-article',
          categoryId: null,
        });

      expect(res.status).toBe(201);
      expect(res.body.categoryId).toBeNull();
      expect(res.body.category).toBeNull();
    });

    it('34. rejects unsupported categoryId types with 400 Bad Request', async () => {
      const emptyRes = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Empty Cat Article',
          draftSlug: 'empty-cat-article',
          categoryId: '',
        });
      expect(emptyRes.status).toBe(400);

      const numRes = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Num Cat Article',
          draftSlug: 'num-cat-article',
          categoryId: 12345,
        });
      expect(numRes.status).toBe(400);

      const objRes = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Obj Cat Article',
          draftSlug: 'obj-cat-article',
          categoryId: { id: testCat1.id },
        });
      expect(objRes.status).toBe(400);

      const arrRes = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Arr Cat Article',
          draftSlug: 'arr-cat-article',
          categoryId: [testCat1.id],
        });
      expect(arrRes.status).toBe(400);
    });

    it('35. update race (Scenario B): category deleted after pre-validation rolls back and preserves draft revision (400)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Update Race Article',
          draftSlug: 'update-race-article',
          categoryId: testCat1.id,
        });
      const artId = created.body.id;

      const targetCat = await prismaAdmin.category.create({
        data: { name: 'Target Cat 1', slug: 'target-cat-1' },
      });

      let preValidationPassed = false;
      const origFindCategory = articlesRepo.findCategoryById.bind(articlesRepo);
      const findCategorySpy = vi.spyOn(articlesRepo, 'findCategoryById')
        .mockImplementation(async (catId, tx) => {
          const res = await origFindCategory(catId, tx);
          if (catId === targetCat.id && res) {
            preValidationPassed = true;
          }
          return res;
        });

      const origUpdate = articlesRepo.updateArticle.bind(articlesRepo);
      const updateSpy = vi.spyOn(articlesRepo, 'updateArticle')
        .mockImplementation(async (id, data, tx) => {
          expect(preValidationPassed).toBe(true);
          await prismaAdmin.category.delete({ where: { id: targetCat.id } });
          const check = await prismaAdmin.category.findUnique({ where: { id: targetCat.id } });
          expect(check).toBeNull();
          return origUpdate(id, data, tx);
        });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${artId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          categoryId: targetCat.id,
        });

      findCategorySpy.mockRestore();
      updateSpy.mockRestore();

      expect(preValidationPassed).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Category not found.');

      const raw = await prismaAdmin.article.findUnique({ where: { id: artId } });
      expect(raw?.categoryId).toBe(testCat1.id);
      expect(raw?.draftRevision).toBe(1);
    });

    it('36. update race (Scenario B): tag deleted after pre-validation rolls back and preserves draft revision (400)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Update Tag Race Article',
          draftSlug: 'update-tag-race-article',
          tagIds: [testTagA.id],
        });
      const artId = created.body.id;

      const targetTag = await prismaAdmin.tag.create({
        data: { name: 'Target Tag 1', slug: 'target-tag-1' },
      });

      let preValidationPassed = false;
      const origFindTags = articlesRepo.findTagsByIds.bind(articlesRepo);
      const findTagsSpy = vi.spyOn(articlesRepo, 'findTagsByIds')
        .mockImplementation(async (tagIds, tx) => {
          const res = await origFindTags(tagIds, tx);
          if (tagIds.includes(targetTag.id) && res.some((t) => t.id === targetTag.id)) {
            preValidationPassed = true;
          }
          return res;
        });

      const origReplace = articlesRepo.replaceArticleTags.bind(articlesRepo);
      const replaceSpy = vi.spyOn(articlesRepo, 'replaceArticleTags')
        .mockImplementation(async (id, tagIds, tx) => {
          expect(preValidationPassed).toBe(true);
          await prismaAdmin.tag.delete({ where: { id: targetTag.id } });
          const check = await prismaAdmin.tag.findUnique({ where: { id: targetTag.id } });
          expect(check).toBeNull();
          return origReplace(id, tagIds, tx);
        });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/articles/${artId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          tagIds: [targetTag.id],
        });

      findTagsSpy.mockRestore();
      replaceSpy.mockRestore();

      expect(preValidationPassed).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('One or more tags not found.');

      const raw = await prismaAdmin.article.findUnique({ where: { id: artId } });
      expect(raw?.draftRevision).toBe(1);

      const rawTags = await prismaAdmin.articleTag.findMany({ where: { articleId: artId } });
      expect(rawTags.length).toBe(1);
      expect(rawTags[0].tagId).toBe(testTagA.id);
    });
  });
});
