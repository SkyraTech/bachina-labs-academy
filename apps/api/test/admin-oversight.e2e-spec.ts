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
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AdminModule } from '../src/modules/admin/admin.module.js';
import { TaxonomyModule } from '../src/modules/taxonomy/taxonomy.module.js';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

describe('Checkpoint P8-R Admin Oversight, Role Security, Metrics Integrity & E2E Regression', () => {
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

  let prisma: PrismaClient;
  let app: INestApplication;
  let currentUserInjected: AuthenticatedUser | null = null;

  let adminUser: { id: string; email: string };
  let authorUser1: { id: string; email: string };
  let authorUser2: { id: string; email: string };
  let suspendedUser: { id: string; email: string };
  let disabledUser: { id: string; email: string };
  let publishedArticle: { id: string; title: string };
  let _draftArticle: { id: string; title: string };
  let _archivedArticle: { id: string; title: string };
  let category1: { id: string; name: string; slug: string };
  let category2: { id: string; name: string; slug: string };
  let tag1: { id: string; name: string; slug: string };

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
      throw new Error(`runAdminPsql failed: ${res.stderr || res.stdout}`);
    }
    return res.stdout;
  }

  beforeAll(async () => {
    // 1. Resolve PostgreSQL connection info
    psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
    if (!fs.existsSync(psqlPath)) {
      psqlPath = 'psql';
    }

    const envPath = fs.existsSync('.env') ? path.resolve('.env') : path.resolve('apps/api/.env');
    const envContent = fs.readFileSync(envPath, 'utf8');

    const runtimeMatch = envContent.match(
      /DATABASE_RUNTIME_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
    );
    const migrationMatch = envContent.match(
      /DATABASE_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
    );

    if (!runtimeMatch || !migrationMatch) {
      throw new Error('Database connection strings missing in .env');
    }

    let originalDbName: string;
    [, runtimeUser, runtimePass, host, port, originalDbName] = runtimeMatch;
    [, migUser, migPass] = migrationMatch;
    dbName = originalDbName;

    // 2. Disposable database setup with verified naming
    disposableDbName = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
    assertDisposableTestDatabase(disposableDbName, 'academy_auth_audit_');

    runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`, dbName);
    runAdminPsql(`GRANT ALL PRIVILEGES ON DATABASE "${disposableDbName}" TO "${runtimeUser}";`, disposableDbName);
    runAdminPsql(`GRANT ALL ON SCHEMA public TO "${runtimeUser}";`, disposableDbName);

    disposableMigrationUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;

    // 3. Deploy migrations to disposable database
    execSync('pnpm prisma migrate deploy', {
      cwd: fs.existsSync('prisma') ? '.' : 'apps/api',
      env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
      encoding: 'utf8',
    });

    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeUser}";
    `, disposableDbName);

    prisma = new PrismaClient({ datasources: { db: { url: disposableRuntimeUrl } } });
    await prisma.$connect();

    // 4. Seed test accounts
    adminUser = await prisma.user.create({
      data: {
        email: `admin_${Date.now()}@bachinalabs.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashforadmin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    authorUser1 = await prisma.user.create({
      data: {
        email: `author1_${Date.now()}@bachinalabs.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashforauthor1',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    authorUser2 = await prisma.user.create({
      data: {
        email: `author2_${Date.now()}@bachinalabs.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashforauthor2',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null, // unverified
      },
    });

    suspendedUser = await prisma.user.create({
      data: {
        email: `suspended_${Date.now()}@bachinalabs.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashforsuspended',
        role: UserRole.AUTHOR,
        status: UserStatus.SUSPENDED,
        emailVerifiedAt: new Date(),
      },
    });

    disabledUser = await prisma.user.create({
      data: {
        email: `disabled_${Date.now()}@bachinalabs.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashfordisabled',
        role: UserRole.AUTHOR,
        status: UserStatus.DISABLED,
        emailVerifiedAt: new Date(),
      },
    });

    // Seed taxonomy
    category1 = await prisma.category.create({
      data: {
        name: 'Backend Architecture',
        slug: `backend-arch-${Date.now()}`,
        description: 'Server side patterns and systems.',
      },
    });

    category2 = await prisma.category.create({
      data: {
        name: 'Database Engineering',
        slug: `database-eng-${Date.now()}`,
        description: 'Relational data and indexing.',
      },
    });

    tag1 = await prisma.tag.create({
      data: {
        name: 'PostgreSQL',
        slug: `postgresql-${Date.now()}`,
      },
    });

    // Seed articles
    publishedArticle = await prisma.article.create({
      data: {
        authorId: authorUser1.id,
        title: 'PostgreSQL 17 Deep Dive (Draft Title)',
        draftSlug: 'postgresql-17-deep-dive',
        publishedSlug: 'postgresql-17-production-guide',
        summary: 'In-depth PostgreSQL performance and replication architecture.',
        status: ArticleStatus.PUBLISHED,
        draftRevision: 3,
        publishedRevision: 1,
        categoryId: category2.id,
        publishedAt: new Date(),
      },
    });

    // Create immutable snapshots: revision 1 and revision 2 (multi-snapshot provenance)
    await prisma.articleSnapshot.create({
      data: {
        articleId: publishedArticle.id,
        snapshotRevision: 1,
        title: 'PostgreSQL 17 Production Guide (Published Snapshot Title Rev 1)',
        publishedSlug: 'postgresql-17-production-guide',
        summary: 'Frozen snapshot summary of PostgreSQL guide rev 1.',
        typographyPreset: 'TECHNICAL_MINIMAL',
        blocks: {
          schemaVersion: 1,
          blocks: [
            { type: 'HEADING', content: { level: 1, text: 'Introduction' } },
          ],
        },
        taxonomy: {
          category: { id: category2.id, name: category2.name, slug: category2.slug },
          tags: [{ id: tag1.id, name: tag1.name, slug: tag1.slug }],
        },
      },
    });

    await prisma.articleSnapshot.create({
      data: {
        articleId: publishedArticle.id,
        snapshotRevision: 2,
        title: 'PostgreSQL 17 Production Guide (Published Snapshot Title Rev 2)',
        publishedSlug: 'postgresql-17-production-guide',
        summary: 'Frozen snapshot summary of PostgreSQL guide rev 2.',
        typographyPreset: 'TECHNICAL_MINIMAL',
        blocks: {
          schemaVersion: 1,
          blocks: [
            { type: 'HEADING', content: { level: 1, text: 'Introduction v2' } },
          ],
        },
        taxonomy: {
          category: { id: category2.id, name: category2.name, slug: category2.slug },
          tags: [{ id: tag1.id, name: tag1.name, slug: tag1.slug }],
        },
      },
    });

    _draftArticle = await prisma.article.create({
      data: {
        authorId: authorUser1.id,
        title: 'Upcoming Distributed Systems Patterns',
        draftSlug: 'upcoming-distributed-systems',
        summary: 'Draft article currently in progress.',
        status: ArticleStatus.DRAFT,
        draftRevision: 1,
        publishedRevision: 0,
        categoryId: category1.id,
      },
    });

    _archivedArticle = await prisma.article.create({
      data: {
        authorId: authorUser2.id,
        title: 'Legacy Monolith Architecture (Archived)',
        draftSlug: 'legacy-monolith-archived',
        summary: 'Historical post archived from active discovery.',
        status: ArticleStatus.ARCHIVED,
        draftRevision: 2,
        publishedRevision: 0,
        categoryId: category1.id,
      },
    });

    // 5. Mount NestJS testing module with mock auth guard
    @Injectable()
    class TestJwtAccessGuard implements CanActivate {
      constructor(private readonly reflector: Reflector) { }

      canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
          IS_PUBLIC_KEY,
          [context.getHandler(), context.getClass()],
        );
        if (isPublic) return true;

        if (!currentUserInjected) {
          throw new UnauthorizedException('Authentication required');
        }

        // Active status check (mirrors JwtAccessGuard behavior for suspended/disabled accounts)
        if (currentUserInjected.status && currentUserInjected.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Account is not active');
        }

        const req = context.switchToHttp().getRequest();
        req.user = currentUserInjected;
        return true;
      }
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AdminModule, TaxonomyModule],
      providers: [
        { provide: APP_GUARD, useClass: TestJwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
    if (disposableDbName) {
      await safelyDropDisposableDatabase(disposableDbName, (sql) => runAdminPsql(sql, dbName), {
        allowedPrefix: 'academy_auth_audit_',
      });
    }
  });

  // ── P8-R-E1: ADMIN accesses all five Admin read routes ────────────────────────
  it('P8-R-E1: ADMIN accesses all five Admin read routes successfully (200 OK)', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(200);
    await request(app.getHttpServer()).get(`/api/v1/admin/users/${adminUser.id}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/articles').expect(200);
    await request(app.getHttpServer()).get(`/api/v1/admin/articles/${publishedArticle.id}`).expect(200);
  });

  // ── P8-R-E2: AUTHOR denied on all five Admin routes ───────────────────────────
  it('P8-R-E2: AUTHOR role is rejected with 403 Forbidden on all five Admin routes', async () => {
    currentUserInjected = {
      id: authorUser1.id,
      email: authorUser1.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-author',
    };

    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/users/${adminUser.id}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/articles').expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/articles/${publishedArticle.id}`).expect(403);
  });

  // ── P8-R-E3: Non-Admin role (e.g. simulated READER) denied on all five routes ─
  it('P8-R-E3: Non-Admin user cannot access any Admin routes (403 Forbidden)', async () => {
    currentUserInjected = {
      id: 'reader-user-id',
      email: 'reader@example.com',
      role: 'READER' as any,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-reader',
    };

    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/users/${adminUser.id}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/articles').expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/articles/${publishedArticle.id}`).expect(403);
  });

  // ── P8-R-E4: Anonymous visitor denied on all five Admin routes ────────────────
  it('P8-R-E4: Unauthenticated visitor receives 401 Unauthorized across all five Admin routes', async () => {
    currentUserInjected = null;

    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/admin/users/${adminUser.id}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/articles').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/admin/articles/${publishedArticle.id}`).expect(401);
  });

  // ── P8-R-E5: Suspended/disabled user denied where status model supports it ───
  it('P8-R-E5: Suspended and Disabled accounts are denied (401 Unauthorized)', async () => {
    // Suspended account
    currentUserInjected = {
      id: suspendedUser.id,
      email: suspendedUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.SUSPENDED,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-suspended',
    };
    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(401);

    // Disabled account
    currentUserInjected = {
      id: disabledUser.id,
      email: disabledUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.DISABLED,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-disabled',
    };
    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(401);
  });

  // ── P8-R-E6: Invalid/unknown User identifiers handled safely ─────────────────
  it('P8-R-E6: User details returns 404 for unknown UUID and 400 for malformed identifier', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    // Unknown UUID
    await request(app.getHttpServer())
      .get('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
      .expect(404);

    // Malformed UUID
    await request(app.getHttpServer())
      .get('/api/v1/admin/users/not-a-valid-uuid')
      .expect(400);
  });

  // ── P8-R-E7: Invalid/unknown Article identifiers handled safely ──────────────
  it('P8-R-E7: Article details returns 404 for unknown UUID and 400 for malformed identifier', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    // Unknown UUID
    await request(app.getHttpServer())
      .get('/api/v1/admin/articles/00000000-0000-0000-0000-000000000000')
      .expect(404);

    // Malformed UUID
    await request(app.getHttpServer())
      .get('/api/v1/admin/articles/not-a-valid-uuid')
      .expect(400);
  });

  // ── P8-R-E8: User list excludes password hash, two-factor secret and tokens ──
  it('P8-R-E8: User directory strictly excludes passwordHash and secret credentials from raw payload', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .expect(200);

    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.total).toBe(5);

    for (const item of res.body.items) {
      expect(item.id).toBeDefined();
      expect(item.email).toBeDefined();
      expect(item.role).toBeDefined();
      expect(item.status).toBeDefined();
      expect(typeof item.isEmailVerified).toBe('boolean');

      // Privacy checks: raw payload must never contain credential tokens or hashes
      expect(item.passwordHash).toBeUndefined();
      expect(item.password).toBeUndefined();
      expect(item.twoFactorSecret).toBeUndefined();
      expect(item.tokens).toBeUndefined();
      expect(item.sessions).toBeUndefined();
    }
  });

  // ── P8-R-E9: User detail excludes authentication secrets ─────────────────────
  it('P8-R-E9: User detail endpoint strictly excludes passwordHash and tokens', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${adminUser.id}`)
      .expect(200);

    expect(res.body.id).toBe(adminUser.id);
    expect(res.body.email).toBe(adminUser.email);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.password).toBeUndefined();
    expect(res.body.twoFactorSecret).toBeUndefined();
    expect(res.body.sessions).toBeUndefined();
  });

  // ── P8-R-E10: Role filters align with actual Prisma enum ─────────────────────
  it('P8-R-E10: User role filters strictly align with Prisma UserRole enum values', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const adminRes = await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=ADMIN')
      .expect(200);
    expect(adminRes.body.total).toBe(1);
    expect(adminRes.body.items[0].email).toBe(adminUser.email);

    const authorRes = await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=AUTHOR')
      .expect(200);
    expect(authorRes.body.total).toBe(4);

    // Invalid role rejected with 400
    await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=NONEXISTENT_ROLE')
      .expect(400);
  });

  // ── P8-R-E11: Status filters align with actual Prisma enum ───────────────────
  it('P8-R-E11: User status filters align with Prisma UserStatus enum (ACTIVE, SUSPENDED, DISABLED)', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const activeRes = await request(app.getHttpServer())
      .get('/api/v1/admin/users?status=ACTIVE')
      .expect(200);
    expect(activeRes.body.total).toBe(3);

    const suspendedRes = await request(app.getHttpServer())
      .get('/api/v1/admin/users?status=SUSPENDED')
      .expect(200);
    expect(suspendedRes.body.total).toBe(1);
    expect(suspendedRes.body.items[0].id).toBe(suspendedUser.id);

    const disabledRes = await request(app.getHttpServer())
      .get('/api/v1/admin/users?status=DISABLED')
      .expect(200);
    expect(disabledRes.body.total).toBe(1);
    expect(disabledRes.body.items[0].id).toBe(disabledUser.id);

    // Invalid status rejected with 400
    await request(app.getHttpServer())
      .get('/api/v1/admin/users?status=NONEXISTENT_STATUS')
      .expect(400);
  });

  // ── P8-R-E12: Combined filters and pagination return correct totals ──────────
  it('P8-R-E12: Combined filters and pagination return deterministic and accurate totals', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=AUTHOR&status=ACTIVE&page=1&limit=2')
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.items.length).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
    expect(res.body.totalPages).toBe(1);
  });

  // ── P8-R-E13: Multiple snapshots do not inflate published Article count ──────
  it('P8-R-E13: Multiple historical snapshots do NOT inflate published Article count', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .expect(200);

    // Authoritative check: 1 published article vs 2 historical published snapshots
    expect(res.body.articles.total).toBe(3);
    expect(res.body.articles.published).toBe(1);
    expect(res.body.articles.draft).toBe(1);
    expect(res.body.articles.archived).toBe(1);
    expect(res.body.articles.totalPublishedSnapshots).toBe(2);
  });

  // ── P8-R-E14: Category and Tag master counts remain accurate ─────────────────
  it('P8-R-E14: Category and Tag master counts accurately reflect database state', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .expect(200);

    expect(res.body.taxonomy.totalCategories).toBe(2);
    expect(res.body.taxonomy.totalTags).toBe(1);
  });

  // ── P8-R-E15: Admin Article links use frozen published slug ──────────────────
  it('P8-R-E15: Admin Article detail preserves frozen publishedSlug and draftSlug distinction', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${publishedArticle.id}`)
      .expect(200);

    expect(res.body.id).toBe(publishedArticle.id);
    expect(res.body.title).toBe('PostgreSQL 17 Deep Dive (Draft Title)');
    expect(res.body.draftSlug).toBe('postgresql-17-deep-dive');
    expect(res.body.publishedSlug).toBe('postgresql-17-production-guide');
    expect(res.body.draftRevision).toBe(3);
    expect(res.body.publishedRevision).toBe(1);
    expect(res.body.author.email).toBe(authorUser1.email);
  });

  // ── P8-R-E16: Admin GET requests do not mutate Users, Articles or snapshots ──
  it('P8-R-E16: Admin GET requests do not mutate Users, Articles, or snapshots', async () => {
    currentUserInjected = {
      id: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'sess-admin',
    };

    const usersBefore = await prisma.user.count();
    const articlesBefore = await prisma.article.count();
    const snapshotsBefore = await prisma.articleSnapshot.count();

    await request(app.getHttpServer()).get('/api/v1/admin/overview').expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(200);
    await request(app.getHttpServer()).get(`/api/v1/admin/users/${adminUser.id}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/articles').expect(200);
    await request(app.getHttpServer()).get(`/api/v1/admin/articles/${publishedArticle.id}`).expect(200);

    const usersAfter = await prisma.user.count();
    const articlesAfter = await prisma.article.count();
    const snapshotsAfter = await prisma.articleSnapshot.count();

    expect(usersAfter).toBe(usersBefore);
    expect(articlesAfter).toBe(articlesBefore);
    expect(snapshotsAfter).toBe(snapshotsBefore);
  });
});