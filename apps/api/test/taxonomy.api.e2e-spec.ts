import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { CategoriesRepository } from '../src/modules/taxonomy/repositories/categories.repository.js';
import { TagsRepository } from '../src/modules/taxonomy/repositories/tags.repository.js';
import { CategoriesService } from '../src/modules/taxonomy/services/categories.service.js';
import { TagsService } from '../src/modules/taxonomy/services/tags.service.js';
import { AdminCategoriesController } from '../src/modules/taxonomy/controllers/admin-categories.controller.js';
import { AdminTagsController } from '../src/modules/taxonomy/controllers/admin-tags.controller.js';
import { PublicCategoriesController } from '../src/modules/taxonomy/controllers/public-categories.controller.js';
import { PublicTagsController } from '../src/modules/taxonomy/controllers/public-tags.controller.js';
import { JwtAccessGuard } from '../src/modules/auth/guards/jwt-access.guard.js';
import { RolesGuard } from '../src/common/authorization/guards/roles.guard.js';
import { JwtTokenService } from '../src/modules/auth/services/jwt-token.service.js';
import { SessionsService } from '../src/modules/sessions/sessions.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/services/cookie.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';
import type { AuthenticatedUser } from '../src/modules/auth/types/jwt.types.js';

const APPROVED_DB_NAME_PATTERN = /^academy_auth_audit_[a-f0-9]{16}$/;

describe('Checkpoint C-1C-R2 Taxonomy API Contract & Authorization Verification (e2e)', () => {
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

  let prismaRuntime: PrismaService;
  let prismaAdmin: PrismaClient;

  let categoriesRepo: CategoriesRepository;
  let tagsRepo: TagsRepository;
  let categoriesService: CategoriesService;
  let tagsService: TagsService;

  let app: INestApplication;

  let adminUser: AuthenticatedUser;
  let authorUser: AuthenticatedUser;
  let malformedUser: AuthenticatedUser;

  let adminCookie: string;
  let authorCookie: string;
  let malformedRoleCookie: string;
  let revokedSessionCookie: string;

  let dbName: string;
  let testCategoryId: string;
  let testTagId: string;

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
      GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
    `, disposableDbName);

    // 8. Connect PrismaClient as restricted academy_app
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;
    prismaRuntime = new PrismaClient({
      datasources: { db: { url: disposableRuntimeUrl } },
    }) as unknown as PrismaService;
    await (prismaRuntime as unknown as PrismaClient).$connect();

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
    expect(appliedNames.length).toBe(13);
    expect(appliedNames).toContain('20261101000000_add_article_snapshot_taxonomy');

    // 10. Seed Admin and Author users in disposable database
    const createdAdmin = await prismaAdmin.user.create({
      data: {
        email: 'admin.tax@skyra-tech.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    adminUser = {
      id: createdAdmin.id,
      email: createdAdmin.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'admin-sess-1',
    };

    const createdAuthor = await prismaAdmin.user.create({
      data: {
        email: 'author.tax@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorUser = {
      id: createdAuthor.id,
      email: createdAuthor.email,
      role: UserRole.AUTHOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'author-sess-1',
    };

    const createdMalformed = await prismaAdmin.user.create({
      data: {
        email: 'malformed.tax@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    malformedUser = {
      id: createdMalformed.id,
      email: createdMalformed.email,
      role: 'UNKNOWN_ROLE' as any,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      sessionId: 'malformed-sess-1',
    };

    // Configure test cookies
    adminCookie = `${ACCESS_COOKIE_NAME}=mock-token-admin`;
    authorCookie = `${ACCESS_COOKIE_NAME}=mock-token-author`;
    malformedRoleCookie = `${ACCESS_COOKIE_NAME}=mock-token-malformed`;
    revokedSessionCookie = `${ACCESS_COOKIE_NAME}=mock-token-revoked`;

    // Authentic JWT, Session, and User mock services to drive real JwtAccessGuard
    const mockJwtTokenService = {
      verifyAccessToken: vi.fn(async (token: string) => {
        if (token === 'mock-token-admin') {
          return { sub: adminUser.id, email: adminUser.email, role: adminUser.role, sid: adminUser.sessionId };
        }
        if (token === 'mock-token-author') {
          return { sub: authorUser.id, email: authorUser.email, role: authorUser.role, sid: authorUser.sessionId };
        }
        if (token === 'mock-token-malformed') {
          return { sub: malformedUser.id, email: malformedUser.email, role: malformedUser.role, sid: malformedUser.sessionId };
        }
        if (token === 'mock-token-revoked') {
          return { sub: adminUser.id, email: adminUser.email, role: adminUser.role, sid: 'revoked-session-id' };
        }
        throw new Error('Invalid token');
      }),
    };

    const mockSessionsService = {
      validateSession: vi.fn(async (sid: string) => {
        if (sid === 'revoked-session-id') {
          return null;
        }
        if (sid === adminUser.sessionId) {
          return { id: sid, userId: adminUser.id, revokedAt: null };
        }
        if (sid === authorUser.sessionId) {
          return { id: sid, userId: authorUser.id, revokedAt: null };
        }
        if (sid === malformedUser.sessionId) {
          return { id: sid, userId: malformedUser.id, revokedAt: null };
        }
        return null;
      }),
    };

    const mockUsersRepository = {
      findById: vi.fn(async (userId: string) => {
        if (userId === adminUser.id) {
          return { ...adminUser };
        }
        if (userId === authorUser.id) {
          return { ...authorUser };
        }
        if (userId === malformedUser.id) {
          return {
            id: malformedUser.id,
            email: malformedUser.email,
            role: 'UNKNOWN_ROLE' as any,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          };
        }
        return null;
      }),
    };

    // Seed test fixtures for admin routes
    const cat = await prismaAdmin.category.create({
      data: {
        name: 'Seed Admin Category',
        slug: 'seed-admin-category',
        description: 'For testing admin routes',
      },
    });
    testCategoryId = cat.id;

    const tag = await prismaAdmin.tag.create({
      data: {
        name: 'Seed Admin Tag',
        slug: 'seed-admin-tag',
      },
    });
    testTagId = tag.id;

    // 11. Wire repositories and services
    categoriesRepo = new CategoriesRepository(prismaRuntime);
    tagsRepo = new TagsRepository(prismaRuntime);
    categoriesService = new CategoriesService(categoriesRepo);
    tagsService = new TagsService(tagsRepo);

    // 12. Create NestJS Test Application with REAL JwtAccessGuard and RolesGuard
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        AdminCategoriesController,
        AdminTagsController,
        PublicCategoriesController,
        PublicTagsController,
      ],
      providers: [
        { provide: CategoriesService, useValue: categoriesService },
        { provide: TagsService, useValue: tagsService },
        { provide: CategoriesRepository, useValue: categoriesRepo },
        { provide: TagsRepository, useValue: tagsRepo },
        { provide: JwtTokenService, useValue: mockJwtTokenService },
        { provide: SessionsService, useValue: mockSessionsService },
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: APP_GUARD, useClass: JwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prismaRuntime) {
      await (prismaRuntime as unknown as PrismaClient).$disconnect();
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

  // ── SECTION 1: ENDPOINT-BY-ENDPOINT ADMINISTRATOR AUTHORIZATION MATRIX ──────
  // Exercises REAL JwtAccessGuard and RolesGuard
  // - Anonymous (no cookie) -> HTTP 401 Unauthorized
  // - Authenticated Author (role AUTHOR) -> HTTP 403 Forbidden
  // - Malformed Role -> HTTP 403 Forbidden
  // - Revoked / Expired Session -> HTTP 401 Unauthorized
  // - Authenticated Admin (role ADMIN) -> HTTP 200/201/204
  describe('Administrator Authorization Matrix with Real Guards (All 10 Routes)', () => {
    // Route 1: GET /api/v1/admin/categories
    it('Route 1: GET /api/v1/admin/categories - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/categories').expect(401);
    });
    it('Route 1: GET /api/v1/admin/categories - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', authorCookie)
        .expect(403);
    });
    it('Route 1: GET /api/v1/admin/categories - Denies Revoked Session with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', revokedSessionCookie)
        .expect(401);
    });
    it('Route 1: GET /api/v1/admin/categories - Denies Malformed Role with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', malformedRoleCookie)
        .expect(403);
    });
    it('Route 1: GET /api/v1/admin/categories - Permits Admin with 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.items).toBeInstanceOf(Array);
    });

    // Route 2: GET /api/v1/admin/categories/:id
    it('Route 2: GET /api/v1/admin/categories/:id - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer()).get(`/api/v1/admin/categories/${testCategoryId}`).expect(401);
    });
    it('Route 2: GET /api/v1/admin/categories/:id - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Cookie', authorCookie)
        .expect(403);
    });
    it('Route 2: GET /api/v1/admin/categories/:id - Permits Admin with 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.id).toBe(testCategoryId);
    });

    // Route 3: POST /api/v1/admin/categories
    it('Route 3: POST /api/v1/admin/categories - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .send({ name: 'Anon Cat', slug: 'anon-cat' })
        .expect(401);
    });
    it('Route 3: POST /api/v1/admin/categories - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', authorCookie)
        .send({ name: 'Author Cat', slug: 'author-cat' })
        .expect(403);
    });
    it('Route 3: POST /api/v1/admin/categories - Permits Admin with 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Admin Cat Auth', slug: 'admin-cat-auth' })
        .expect(201);
      expect(res.body.slug).toBe('admin-cat-auth');
    });

    // Route 4: PATCH /api/v1/admin/categories/:id
    it('Route 4: PATCH /api/v1/admin/categories/:id - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${testCategoryId}`)
        .send({ name: 'Patched Anon' })
        .expect(401);
    });
    it('Route 4: PATCH /api/v1/admin/categories/:id - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Cookie', authorCookie)
        .send({ name: 'Patched Author' })
        .expect(403);
    });
    it('Route 4: PATCH /api/v1/admin/categories/:id - Permits Admin with 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Cookie', adminCookie)
        .send({ name: 'Patched Admin Auth' })
        .expect(200);
      expect(res.body.name).toBe('Patched Admin Auth');
    });

    // Route 5: DELETE /api/v1/admin/categories/:id
    it('Route 5: DELETE /api/v1/admin/categories/:id - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${testCategoryId}`)
        .expect(401);
    });
    it('Route 5: DELETE /api/v1/admin/categories/:id - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Cookie', authorCookie)
        .expect(403);
    });
    it('Route 5: DELETE /api/v1/admin/categories/:id - Permits Admin with 204', async () => {
      const toDelete = await prismaAdmin.category.create({
        data: { name: 'Delete Cat Auth', slug: 'delete-cat-auth' },
      });
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${toDelete.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
    });

    // Route 6: GET /api/v1/admin/tags
    it('Route 6: GET /api/v1/admin/tags - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/tags').expect(401);
    });
    it('Route 6: GET /api/v1/admin/tags - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/tags')
        .set('Cookie', authorCookie)
        .expect(403);
    });
    it('Route 6: GET /api/v1/admin/tags - Permits Admin with 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tags')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.items).toBeInstanceOf(Array);
    });

    // Route 7: GET /api/v1/admin/tags/:id
    it('Route 7: GET /api/v1/admin/tags/:id - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer()).get(`/api/v1/admin/tags/${testTagId}`).expect(401);
    });
    it('Route 7: GET /api/v1/admin/tags/:id - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', authorCookie)
        .expect(403);
    });
    it('Route 7: GET /api/v1/admin/tags/:id - Permits Admin with 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.id).toBe(testTagId);
    });

    // Route 8: POST /api/v1/admin/tags
    it('Route 8: POST /api/v1/admin/tags - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .send({ name: 'Anon Tag', slug: 'anon-tag' })
        .expect(401);
    });
    it('Route 8: POST /api/v1/admin/tags - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .set('Cookie', authorCookie)
        .send({ name: 'Author Tag', slug: 'author-tag' })
        .expect(403);
    });
    it('Route 8: POST /api/v1/admin/tags - Permits Admin with 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .set('Cookie', adminCookie)
        .send({ name: 'Admin Tag Auth', slug: 'admin-tag-auth' })
        .expect(201);
      expect(res.body.slug).toBe('admin-tag-auth');
    });

    // Route 9: PATCH /api/v1/admin/tags/:id
    it('Route 9: PATCH /api/v1/admin/tags/:id - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/tags/${testTagId}`)
        .send({ name: 'Patched Anon Tag' })
        .expect(401);
    });
    it('Route 9: PATCH /api/v1/admin/tags/:id - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', authorCookie)
        .send({ name: 'Patched Author Tag' })
        .expect(403);
    });
    it('Route 9: PATCH /api/v1/admin/tags/:id - Permits Admin with 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', adminCookie)
        .send({ name: 'Patched Admin Tag Auth' })
        .expect(200);
      expect(res.body.name).toBe('Patched Admin Tag Auth');
    });

    // Route 10: DELETE /api/v1/admin/tags/:id
    it('Route 10: DELETE /api/v1/admin/tags/:id - Denies Anonymous with 401', async () => {
      await request(app.getHttpServer()).delete(`/api/v1/admin/tags/${testTagId}`).expect(401);
    });
    it('Route 10: DELETE /api/v1/admin/tags/:id - Denies Author with 403', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', authorCookie)
        .expect(403);
    });
    it('Route 10: DELETE /api/v1/admin/tags/:id - Permits Admin with 204', async () => {
      const toDelete = await prismaAdmin.tag.create({
        data: { name: 'Delete Tag Auth', slug: 'delete-tag-auth' },
      });
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/tags/${toDelete.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
    });
  });

  // ── SECTION 2: SLUG BOUNDARY AND NORMALIZATION CONTRACT ───────────────────
  describe('Slug Boundary & Strict Contract Verification', () => {
    it('1. Accepts valid lowercase kebab-case slug (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Clean Slug', slug: 'clean-slug-test' })
        .expect(201);
      expect(res.body.slug).toBe('clean-slug-test');
    });

    it('2. Rejects uppercase slug with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Upper Slug', slug: 'UPPERCASE-SLUG' })
        .expect(400);
    });

    it('3. Rejects leading whitespace padded slug with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Padded Slug', slug: ' leading-space' })
        .expect(400);
    });

    it('4. Rejects trailing whitespace padded slug with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Padded Slug', slug: 'trailing-space ' })
        .expect(400);
    });

    it('5. Rejects consecutive hyphens with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Multi Hyphen', slug: 'bad--hyphen' })
        .expect(400);
    });

    it('6. Rejects leading hyphen with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Lead Hyphen', slug: '-lead-hyphen' })
        .expect(400);
    });

    it('7. Rejects trailing hyphen with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Trail Hyphen', slug: 'trail-hyphen-' })
        .expect(400);
    });

    it('8. Rejects special symbols with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Special Symbol', slug: 'cloud@native' })
        .expect(400);
    });

    it('9. Rejects unicode accented characters with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Accent Slug', slug: 'café-style' })
        .expect(400);
    });

    it('10. Rejects single character slug (<2 chars) with HTTP 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Short Slug', slug: 'a' })
        .expect(400);
    });

    it('11. Accepts 2 character minimum slug with HTTP 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Go Language', slug: 'go' })
        .expect(201);
      expect(res.body.slug).toBe('go');
    });

    it('12. Rejects Category slug exceeding 160 characters with HTTP 400', async () => {
      const longSlug = 'a'.repeat(161);
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Too Long Slug', slug: longSlug })
        .expect(400);
    });

    it('13. Rejects Tag slug exceeding 120 characters with HTTP 400', async () => {
      const longSlug = 'b'.repeat(121);
      await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .set('Cookie', adminCookie)
        .send({ name: 'Too Long Tag Slug', slug: longSlug })
        .expect(400);
    });

    it('14. Rejects omitted slug with HTTP 400 (explicit slug required)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Software Craftsmanship & Clean Code' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('slug is required');
    });

    it('15. Rejects duplicate slug on creation with HTTP 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Dup Slug Cat', slug: 'dup-slug-test' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({ name: 'Dup Slug Cat 2', slug: 'dup-slug-test' })
        .expect(409);
      expect(res.body.message).toContain('already exists');
    });
  });

  // ── SECTION 3: TAG DTO INTEGRITY & UNSUPPORTED DESCRIPTION REJECTION ──────
  describe('Tag DTO Integrity & Strict Schema Compliance', () => {
    it('Creates a tag with supported fields (name, slug) successfully (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .set('Cookie', adminCookie)
        .send({ name: 'TypeScript Strict', slug: 'typescript-strict' })
        .expect(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('TypeScript Strict');
      expect(res.body.slug).toBe('typescript-strict');
      expect(res.body).not.toHaveProperty('description');
    });

    it('Updates a tag with supported fields successfully (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', adminCookie)
        .send({ name: 'Updated Seed Tag Name' })
        .expect(200);
      expect(res.body.name).toBe('Updated Seed Tag Name');
      expect(res.body).not.toHaveProperty('description');
    });

    it('Rejects Tag creation containing unsupported "description" property with HTTP 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .set('Cookie', adminCookie)
        .send({
          name: 'Illegal Description Tag',
          slug: 'illegal-desc-tag',
          description: 'This field does not exist in schema',
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('property description should not exist');
    });

    it('Rejects Tag update containing unsupported "description" property with HTTP 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tags/${testTagId}`)
        .set('Cookie', adminCookie)
        .send({ description: 'This field should be rejected' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('property description should not exist');
    });

    it('Public Tag responses strictly omit description and match schema', async () => {
      const listRes = await request(app.getHttpServer()).get('/api/v1/tags').expect(200);
      expect(listRes.body.items.length).toBeGreaterThan(0);
      for (const item of listRes.body.items) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('slug');
        expect(item).toHaveProperty('createdAt');
        expect(item).toHaveProperty('updatedAt');
        expect(item).not.toHaveProperty('description');
      }

      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/tags/${listRes.body.items[0].slug}`)
        .expect(200);
      expect(detailRes.body).toHaveProperty('id');
      expect(detailRes.body).not.toHaveProperty('description');
    });
  });

  // ── SECTION 4: CATEGORY DELETION SEMANTICS & ARTICLE PRESERVATION ─────────
  describe('Category Deletion Semantics (ON DELETE SET NULL Article Preservation)', () => {
    it('Deleting a Category with associated draft Articles succeeds (204) and sets article.categoryId to NULL', async () => {
      // 1. Create a Category to delete
      const catToDelete = await prismaAdmin.category.create({
        data: {
          name: 'Category To Delete Test',
          slug: 'cat-to-delete-test',
          description: 'Category for deletion semantics test',
        },
      });

      // 2. Create an Article associated with that Category
      const article = await prismaAdmin.article.create({
        data: {
          authorId: authorUser.id,
          title: 'Preserved Article on Category Delete',
          draftSlug: 'preserved-article-on-category-delete',
          status: ArticleStatus.DRAFT,
          draftRevision: 1,
          categoryId: catToDelete.id,
        },
      });

      // 3. Create another unrelated Article to verify zero collateral deletion
      const unrelatedArticle = await prismaAdmin.article.create({
        data: {
          authorId: authorUser.id,
          title: 'Unrelated Article Control Record',
          draftSlug: 'unrelated-article-control-record',
          status: ArticleStatus.DRAFT,
          draftRevision: 2,
        },
      });

      // 4. Delete the Category via the actual administrator HTTP endpoint
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${catToDelete.id}`)
        .set('Cookie', adminCookie)
        .expect(204);

      // 5. Verify the Category no longer exists
      const deletedCat = await prismaAdmin.category.findUnique({ where: { id: catToDelete.id } });
      expect(deletedCat).toBeNull();

      await request(app.getHttpServer())
        .get(`/api/v1/admin/categories/${catToDelete.id}`)
        .set('Cookie', adminCookie)
        .expect(404);

      // 6. Verify the Article still exists
      const refreshedArticle = await prismaAdmin.article.findUnique({ where: { id: article.id } });
      expect(refreshedArticle).not.toBeNull();

      // 7. Verify article.categoryId was set to NULL by PostgreSQL ON DELETE SET NULL
      expect(refreshedArticle?.categoryId).toBeNull();

      // 8. Verify Article revision and publication fields remain unchanged
      expect(refreshedArticle?.title).toBe('Preserved Article on Category Delete');
      expect(refreshedArticle?.draftSlug).toBe('preserved-article-on-category-delete');
      expect(refreshedArticle?.status).toBe(ArticleStatus.DRAFT);
      expect(refreshedArticle?.draftRevision).toBe(1);

      // 9. Verify no Article snapshot was created or modified
      const snapshots = await prismaAdmin.articleSnapshot.findMany({ where: { articleId: article.id } });
      expect(snapshots.length).toBe(0);

      // 10. Verify unrelated Article is intact
      const refreshedUnrelated = await prismaAdmin.article.findUnique({ where: { id: unrelatedArticle.id } });
      expect(refreshedUnrelated).not.toBeNull();
      expect(refreshedUnrelated?.draftRevision).toBe(2);
    });

    it('Deleting a Tag cascades from article_tags without deleting Article', async () => {
      const tagToDelete = await prismaAdmin.tag.create({
        data: { name: 'Cascade Tag Delete', slug: 'cascade-tag-delete' },
      });
      const taggedArticle = await prismaAdmin.article.create({
        data: {
          authorId: authorUser.id,
          title: 'Article With Cascading Tag',
          draftSlug: 'article-with-cascading-tag',
          status: ArticleStatus.DRAFT,
        },
      });
      await prismaAdmin.articleTag.create({
        data: { articleId: taggedArticle.id, tagId: tagToDelete.id },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/tags/${tagToDelete.id}`)
        .set('Cookie', adminCookie)
        .expect(204);

      // Junction is removed
      const junctionCount = await prismaAdmin.articleTag.count({
        where: { articleId: taggedArticle.id, tagId: tagToDelete.id },
      });
      expect(junctionCount).toBe(0);

      // Article survives intact
      const refreshedArticle = await prismaAdmin.article.findUnique({ where: { id: taggedArticle.id } });
      expect(refreshedArticle).not.toBeNull();
    });
  });

  // ── SECTION 5: PUBLIC DISCOVERY & DRAFT DATA CONFIDENTIALITY ──────────────
  describe('Public Taxonomy Discovery & Draft Data Confidentiality', () => {
    let confidentialCatId: string;
    let confidentialTagId: string;

    beforeAll(async () => {
      const cat = await prismaAdmin.category.create({
        data: {
          name: 'Public Confidentiality Category',
          slug: 'public-confidentiality-category',
          description: 'Safe public category description',
        },
      });
      confidentialCatId = cat.id;

      const tag = await prismaAdmin.tag.create({
        data: {
          name: 'Public Confidentiality Tag',
          slug: 'public-confidentiality-tag',
        },
      });
      confidentialTagId = tag.id;

      // Associate with an unpublished draft article containing sensitive titles
      const draft = await prismaAdmin.article.create({
        data: {
          authorId: authorUser.id,
          title: 'TOP SECRET INTERNAL UNPUBLISHED DRAFT',
          draftSlug: 'top-secret-internal-unpublished-draft',
          status: ArticleStatus.DRAFT,
          categoryId: cat.id,
        },
      });

      await prismaAdmin.articleTag.create({
        data: { articleId: draft.id, tagId: tag.id },
      });
    });

    it('GET /api/v1/categories - Returns safe public category fields and masks draft data', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
      const str = JSON.stringify(res.body);
      expect(str).not.toContain('TOP SECRET INTERNAL UNPUBLISHED DRAFT');
      expect(str).not.toContain('top-secret-internal-unpublished-draft');
      expect(str).not.toContain(authorUser.id);
      expect(str).not.toContain(authorUser.email);

      const found = res.body.items.find((c: any) => c.id === confidentialCatId);
      expect(found).toBeDefined();
      expect(Object.keys(found).sort()).toEqual([
        'createdAt',
        'description',
        'id',
        'name',
        'slug',
        'updatedAt',
      ]);
    });

    it('GET /api/v1/categories/:slug - Returns safe detail and masks draft data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories/public-confidentiality-category')
        .expect(200);
      const str = JSON.stringify(res.body);
      expect(str).not.toContain('TOP SECRET');
      expect(Object.keys(res.body).sort()).toEqual([
        'createdAt',
        'description',
        'id',
        'name',
        'slug',
        'updatedAt',
      ]);
    });

    it('GET /api/v1/tags - Returns safe public tag fields and masks draft data', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/tags').expect(200);
      const str = JSON.stringify(res.body);
      expect(str).not.toContain('TOP SECRET');
      expect(str).not.toContain(authorUser.id);

      const found = res.body.items.find((t: any) => t.id === confidentialTagId);
      expect(found).toBeDefined();
      expect(Object.keys(found).sort()).toEqual([
        'createdAt',
        'id',
        'name',
        'slug',
        'updatedAt',
      ]);
    });

    it('GET /api/v1/tags/:slug - Returns safe detail and masks draft data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tags/public-confidentiality-tag')
        .expect(200);
      const str = JSON.stringify(res.body);
      expect(str).not.toContain('TOP SECRET');
      expect(Object.keys(res.body).sort()).toEqual([
        'createdAt',
        'id',
        'name',
        'slug',
        'updatedAt',
      ]);
    });

    it('Public categories and tags are visible even with 0 published articles', async () => {
      const zeroCat = await prismaAdmin.category.create({
        data: { name: 'Zero Article Category', slug: 'zero-article-category' },
      });
      const res = await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
      const match = res.body.items.find((c: any) => c.id === zeroCat.id);
      expect(match).toBeDefined();
      expect(match.name).toBe('Zero Article Category');
    });
  });

  // ── SECTION 6: DETERMINISTIC PAGINATION & ORDERING TIE-BREAKER ────────────
  describe('Deterministic Pagination Ordering Tie-Breaker', () => {
    it('Orders categories deterministically by createdAt DESC, id ASC', async () => {
      const sharedDate = new Date();
      const cat1 = await prismaAdmin.category.create({
        data: { name: 'Tie Breaker Alpha', slug: 'tie-alpha', createdAt: sharedDate },
      });
      const cat2 = await prismaAdmin.category.create({
        data: { name: 'Tie Breaker Beta', slug: 'tie-beta', createdAt: sharedDate },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories?limit=100')
        .set('Cookie', adminCookie)
        .expect(200);

      const alphaIndex = res.body.items.findIndex((c: any) => c.id === cat1.id);
      const betaIndex = res.body.items.findIndex((c: any) => c.id === cat2.id);

      expect(alphaIndex).toBeGreaterThanOrEqual(0);
      expect(betaIndex).toBeGreaterThanOrEqual(0);

      // Verify that the smaller UUID appears first when createdAt is identical
      if (cat1.id < cat2.id) {
        expect(alphaIndex).toBeLessThan(betaIndex);
      } else {
        expect(betaIndex).toBeLessThan(alphaIndex);
      }
    });
  });
});
