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
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
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
import { PublicAuthorsRepository } from '../src/modules/authors/repositories/public-authors.repository.js';
import { PublicAuthorsService } from '../src/modules/authors/services/public-authors.service.js';
import { PublicAuthorsController } from '../src/modules/authors/controllers/public-authors.controller.js';
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

describe('Checkpoint P5 Public Author Profiles and Published Article Discovery (e2e)', () => {
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
  let authorsRepo: PublicAuthorsRepository;
  let authorsService: PublicAuthorsService;

  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser | null = null;

  // Test Authors
  let authorA: { id: string; email: string };
  let authorB: { id: string; email: string };
  let draftOnlyAuthor: { id: string; email: string };
  let suspendedAuthor: { id: string; email: string };

  let authorAPublishedArt1: any;
  let authorAPublishedArt2: any;
  let authorADraftArt: any;
  let authorBPublishedArt: any;

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

    // 7. Grant DML permissions to academy_app with immutable snapshots enforcement
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
    authorsRepo = new PublicAuthorsRepository(prismaRuntime as any);
    authorsService = new PublicAuthorsService(authorsRepo, publicReaderService);

    // 10. Seed Users
    const uA = await prismaAdmin.user.create({
      data: {
        email: 'author.a.p5@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date('2026-10-01T10:00:00Z'),
      },
    });
    authorA = { id: uA.id, email: uA.email };

    const uB = await prismaAdmin.user.create({
      data: {
        email: 'author.b.p5@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date('2026-10-05T10:00:00Z'),
      },
    });
    authorB = { id: uB.id, email: uB.email };

    const uDraft = await prismaAdmin.user.create({
      data: {
        email: 'draft.only.p5@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date('2026-10-10T10:00:00Z'),
      },
    });
    draftOnlyAuthor = { id: uDraft.id, email: uDraft.email };

    const uSuspended = await prismaAdmin.user.create({
      data: {
        email: 'suspended.author.p5@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.SUSPENDED,
        emailVerifiedAt: new Date('2026-10-12T10:00:00Z'),
      },
    });
    suspendedAuthor = { id: uSuspended.id, email: uSuspended.email };

    // 11. Helper to create published article with snapshot
    async function createPublishedArticle(
      authorId: string,
      title: string,
      slug: string,
      summary: string,
    ) {
      const art = await prismaAdmin.article.create({
        data: {
          authorId,
          title,
          draftSlug: slug,
          publishedSlug: slug,
          summary,
          status: ArticleStatus.PUBLISHED,
          typographyPreset: 'MODERN_SANS',
          draftRevision: 2,
          publishedRevision: 1,
          publishedAt: new Date('2026-10-20T12:00:00Z'),
          blocks: {
            create: [
              {
                type: ArticleBlockType.HEADING,
                position: 1000,
                content: { text: 'Section 1', level: 2 },
                schemaVersion: 1,
              },
            ],
          },
        },
      });

      const snap = await prismaAdmin.articleSnapshot.create({
        data: {
          articleId: art.id,
          snapshotRevision: 1,
          title: art.title,
          publishedSlug: slug,
          summary: art.summary,
          typographyPreset: art.typographyPreset,
          blocks: {
            schemaVersion: 1,
            blocks: [
              {
                id: crypto.randomUUID(),
                type: 'HEADING',
                position: 1000,
                content: { text: 'Section 1', level: 2 },
              },
            ],
          },
          taxonomy: {
            schemaVersion: 1,
            category: null,
            tags: [],
          },
          publishedAt: art.publishedAt!,
        },
      });

      await prismaAdmin.article.update({
        where: { id: art.id },
        data: { currentSnapshotId: snap.id },
      });

      return art;
    }

    authorAPublishedArt1 = await createPublishedArticle(
      authorA.id,
      'Distributed Transaction Patterns',
      'distributed-transaction-patterns',
      'Sagas and Two-Phase Commit',
    );

    authorAPublishedArt2 = await createPublishedArticle(
      authorA.id,
      'Event-Driven Architecture',
      'event-driven-architecture',
      'Kafka and RabbitMQ Patterns',
    );

    authorBPublishedArt = await createPublishedArticle(
      authorB.id,
      'High-Throughput Caching',
      'high-throughput-caching',
      'Redis cluster and cache-aside',
    );

    // Seed authorA unpublished draft
    authorADraftArt = await prismaAdmin.article.create({
      data: {
        authorId: authorA.id,
        title: 'Secret Internal Article Draft',
        draftSlug: 'secret-internal-article-draft',
        publishedSlug: null,
        summary: 'Classified draft',
        status: ArticleStatus.DRAFT,
        draftRevision: 1,
        publishedRevision: 0,
      },
    });

    // Seed draftOnlyAuthor draft
    await prismaAdmin.article.create({
      data: {
        authorId: draftOnlyAuthor.id,
        title: 'Draft Only Work In Progress',
        draftSlug: 'draft-only-work-in-progress',
        status: ArticleStatus.DRAFT,
        draftRevision: 1,
        publishedRevision: 0,
      },
    });

    // 12. Setup NestJS HTTP Test App
    @Injectable()
    class MockAuthGuard implements CanActivate {
      constructor(private readonly reflector: Reflector) {}
      canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (isPublic) return true;
        if (!currentUserInjected) {
          throw new UnauthorizedException('Authentication required.');
        }
        context.switchToHttp().getRequest().user = currentUserInjected;
        return true;
      }
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        PublicAuthorsController,
        ArticlePublicReaderController,
        ArticlesController,
        ArticleBlocksController,
        ArticlePublicationController,
      ],
      providers: [
        { provide: PublicAuthorsService, useValue: authorsService },
        { provide: PublicAuthorsRepository, useValue: authorsRepo },
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
      .useValue({ canActivate: () => true })
      .compile();

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
  }, 30000);

  // ── P5-E1: Anonymous public profile lookup ───────────────────────────────────
  it('P5-E1: public author profile is accessible anonymously and returns published count', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}`)
      .expect(200);

    expect(res.body.id).toBe(authorA.id);
    expect(res.body.displayName).toBe('Academy Author');
    expect(res.body.publishedArticlesCount).toBe(2);
    expect(res.body.joinedAt).toBeDefined();
  });

  // ── P5-E2: Unknown or inactive author returns 404 ─────────────────────────────
  it('P5-E2: unknown author or suspended author returns 404 Not Found', async () => {
    currentUserInjected = null;

    const randomUUID = crypto.randomUUID();
    const resUnknown = await request(app.getHttpServer())
      .get(`/api/v1/authors/${randomUUID}`)
      .expect(404);
    expect(resUnknown.body.message).toContain('not found');

    const resSuspended = await request(app.getHttpServer())
      .get(`/api/v1/authors/${suspendedAuthor.id}`)
      .expect(404);
    expect(resSuspended.body.message).toContain('not found');
  });

  // ── P5-E3: Public author profile excludes private fields ─────────────────────
  it('P5-E3: public author profile strictly excludes private account fields', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}`)
      .expect(200);

    expect(res.body.email).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.password_hash).toBeUndefined();
    expect(res.body.emailVerifiedAt).toBeUndefined();
    expect(res.body.sessions).toBeUndefined();
    expect(res.body.auditLogs).toBeUndefined();
    expect(res.body.draftCount).toBeUndefined();
    expect(res.body.draftArticles).toBeUndefined();
  });

  // ── P5-E4: Only published articles listed for author ──────────────────────────
  it('P5-E4: lists only published articles for the specified author', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}/articles`)
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);

    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).toContain(authorAPublishedArt1.id);
    expect(ids).toContain(authorAPublishedArt2.id);
    expect(ids).not.toContain(authorBPublishedArt.id);

    // Confirm author attribution is attached
    for (const item of res.body.items) {
      expect(item.author.id).toBe(authorA.id);
      expect(item.author.displayName).toBe('Academy Author');
    }
  });

  // ── P5-E5: Duplicate drafts and unpublished drafts excluded ───────────────────
  it('P5-E5: draft articles and duplicated drafts are excluded from author article list', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}/articles`)
      .expect(200);

    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).not.toContain(authorADraftArt.id);

    const slugs = res.body.items.map((i: any) => i.slug);
    expect(slugs).not.toContain('secret-internal-article-draft');
  });

  // ── P5-E6: Published snapshot title and slug used ──────────────────────────────
  it('P5-E6: public article cards use frozen snapshot title and published slug', async () => {
    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}/articles`)
      .expect(200);

    const art1 = res.body.items.find((i: any) => i.id === authorAPublishedArt1.id);
    expect(art1).toBeDefined();
    expect(art1.title).toBe('Distributed Transaction Patterns');
    expect(art1.slug).toBe('distributed-transaction-patterns');
    expect(art1.revision).toBe(1);
  });

  // ── P5-E7: Authors with only drafts show empty published articles list ────────
  it('P5-E7: author with only drafts returns empty items array (zero draft leakage)', async () => {
    currentUserInjected = null;

    const profileRes = await request(app.getHttpServer())
      .get(`/api/v1/authors/${draftOnlyAuthor.id}`)
      .expect(200);
    expect(profileRes.body.publishedArticlesCount).toBe(0);

    const articlesRes = await request(app.getHttpServer())
      .get(`/api/v1/authors/${draftOnlyAuthor.id}/articles`)
      .expect(200);
    expect(articlesRes.body.total).toBe(0);
    expect(articlesRes.body.items).toHaveLength(0);
  });

  // ── P5-E8: Pagination and ordering consistent ─────────────────────────────────
  it('P5-E8: pagination limits and page navigation are consistent', async () => {
    currentUserInjected = null;

    const page1Res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}/articles?page=1&limit=1`)
      .expect(200);

    expect(page1Res.body.page).toBe(1);
    expect(page1Res.body.limit).toBe(1);
    expect(page1Res.body.total).toBe(2);
    expect(page1Res.body.totalPages).toBe(2);
    expect(page1Res.body.items).toHaveLength(1);

    const page2Res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}/articles?page=2&limit=1`)
      .expect(200);

    expect(page2Res.body.page).toBe(2);
    expect(page2Res.body.items).toHaveLength(1);
    expect(page2Res.body.items[0].id).not.toBe(page1Res.body.items[0].id);
  });

  // ── P5-E9: Draft metadata changes do not alter public author article cards ────
  it('P5-E9: mutating draft title does not change displayed published snapshot title', async () => {
    // Author A mutates draft title on authorAPublishedArt1
    await prismaAdmin.article.update({
      where: { id: authorAPublishedArt1.id },
      data: {
        title: 'UNPUBLISHED DRAFT TITLE MUTATION',
        draftSlug: 'unpublished-draft-slug-mutation',
        draftRevision: 3,
      },
    });

    currentUserInjected = null;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/authors/${authorA.id}/articles`)
      .expect(200);

    const art = res.body.items.find((i: any) => i.id === authorAPublishedArt1.id);
    expect(art).toBeDefined();
    // Must strictly match immutable published snapshot
    expect(art.title).toBe('Distributed Transaction Patterns');
    expect(art.slug).toBe('distributed-transaction-patterns');
    expect(art.revision).toBe(1);
  });

  // ── P5-E10: Public profile requests are nonmutating ───────────────────────────
  it('P5-E10: repeated GET requests to public author endpoints perform zero database writes', async () => {
    const preUserCount = await prismaAdmin.user.count();
    const preArticleCount = await prismaAdmin.article.count();
    const preSnapshotCount = await prismaAdmin.articleSnapshot.count();

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get(`/api/v1/authors/${authorA.id}`).expect(200);
      await request(app.getHttpServer()).get(`/api/v1/authors/${authorA.id}/articles`).expect(200);
    }

    const postUserCount = await prismaAdmin.user.count();
    const postArticleCount = await prismaAdmin.article.count();
    const postSnapshotCount = await prismaAdmin.articleSnapshot.count();

    expect(postUserCount).toBe(preUserCount);
    expect(postArticleCount).toBe(preArticleCount);
    expect(postSnapshotCount).toBe(preSnapshotCount);
  });

  // ── Carry-Forward Check B: Concurrent article creation vs duplication ─────────
  it('P5-CF-B: concurrent draft creation and duplication serialize without collision or data loss', async () => {
    const authUserA: AuthenticatedUser = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-p5-cf-b',
    };

    currentUserInjected = authUserA;

    // Concurrently trigger normal draft creation and duplication for the same author
    const [createRes, dupRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/articles')
        .send({
          title: 'Concurrent Created Article',
          draftSlug: 'concurrent-draft-target',
          typographyPreset: 'MODERN_SANS',
        }),
      request(app.getHttpServer()).post(
        `/api/v1/articles/${authorAPublishedArt2.id}/duplicate`,
      ),
    ]);

    expect(createRes.status).toBe(201);
    expect(dupRes.status).toBe(201);

    expect(createRes.body.id).not.toBe(dupRes.body.id);
    expect(createRes.body.draftSlug).not.toBe(dupRes.body.draftSlug);

    // Both articles exist in DB with authorA
    const countA = await prismaAdmin.article.count({
      where: {
        id: { in: [createRes.body.id, dupRes.body.id] },
        authorId: authorA.id,
      },
    });
    expect(countA).toBe(2);
  });

  // ── Carry-Forward Check C: Maximum-length duplicate slug suffix handling ──────
  it('P5-CF-C: duplicating near maximum length slug generates valid <= 280 char unique slug', async () => {
    // 1. Create source article with 270 char draft slug
    const maxBase = 'a'.repeat(270);
    const longArt = await prismaAdmin.article.create({
      data: {
        authorId: authorA.id,
        title: 'Long Slug Article',
        draftSlug: maxBase,
        status: ArticleStatus.DRAFT,
      },
    });

    const authUserA: AuthenticatedUser = {
      id: authorA.id,
      email: authorA.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-p5-cf-c',
    };
    currentUserInjected = authUserA;

    // 2. Duplicate it twice to force counter collision (-copy, -copy-2)
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/articles/${longArt.id}/duplicate`)
      .expect(201);

    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/articles/${longArt.id}/duplicate`)
      .expect(201);

    expect(res1.body.draftSlug.length).toBeLessThanOrEqual(280);
    expect(res2.body.draftSlug.length).toBeLessThanOrEqual(280);
    expect(res1.body.draftSlug).not.toBe(res2.body.draftSlug);
    expect(res1.body.draftSlug).toContain('-copy');
    expect(res2.body.draftSlug).toContain('-copy-2');
  });
});
