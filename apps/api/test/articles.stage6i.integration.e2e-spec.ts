import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ArticlesRepository } from '../src/modules/articles/repositories/articles.repository.js';
import { ArticlesService } from '../src/modules/articles/services/articles.service.js';
import { ArticleBlocksRepository } from '../src/modules/articles/repositories/article-blocks.repository.js';
import { ArticleBlocksService } from '../src/modules/articles/services/article-blocks.service.js';
import { ArticlePublicationRepository } from '../src/modules/articles/repositories/article-publication.repository.js';
import { ArticlePublicationService } from '../src/modules/articles/services/article-publication.service.js';
import { ArticlePublicReaderRepository } from '../src/modules/articles/repositories/article-public-reader.repository.js';
import { ArticlePublicReaderService } from '../src/modules/articles/services/article-public-reader.service.js';
import { ArticleMediaRepository } from '../src/modules/articles/repositories/article-media.repository.js';
import { ArticleMediaStorageService } from '../src/modules/articles/services/article-media-storage.service.js';
import { ArticleMediaService } from '../src/modules/articles/services/article-media.service.js';
import { ArticlesController } from '../src/modules/articles/controllers/articles.controller.js';
import { ArticleBlocksController } from '../src/modules/articles/controllers/article-blocks.controller.js';
import { ArticlePublicationController } from '../src/modules/articles/controllers/article-publication.controller.js';
import { ArticlePublicReaderController } from '../src/modules/articles/controllers/article-public-reader.controller.js';
import { ArticleMediaController } from '../src/modules/articles/controllers/article-media.controller.js';
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

describe('Stage 6I Secure Article Media Upload & Public Delivery (integration)', () => {
  let disposableDbName: string;
  let tempStorageDir: string;
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

  let mediaRepo: ArticleMediaRepository;
  let mediaStorage: ArticleMediaStorageService;
  let mediaService: ArticleMediaService;
  let articlesRepo: ArticlesRepository;
  let articlesService: ArticlesService;
  let blocksRepo: ArticleBlocksRepository;
  let blocksService: ArticleBlocksService;
  let publicationRepo: ArticlePublicationRepository;
  let publicationService: ArticlePublicationService;
  let publicReaderRepo: ArticlePublicReaderRepository;
  let publicReaderService: ArticlePublicReaderService;

  let app: INestApplication;
  let dbName: string;

  let authorA: { id: string; email: string };
  let authorB: { id: string; email: string };
  let userA: AuthenticatedUser;
  let userB: AuthenticatedUser;
  let authorACookie: string;
  let authorBCookie: string;

  // Valid test image binary buffers
  const validWebpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

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

    // 2. Generate unique disposable DB & isolated temp storage
    disposableDbName = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
    assertDisposableTestDatabase(disposableDbName);

    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-stage6i-storage-'));

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

    // 9. Wire repositories, storage, and services
    const configMock = {
      get: (k: string) => (k === 'ARTICLE_MEDIA_STORAGE_DIR' ? tempStorageDir : undefined),
    };
    mediaStorage = new ArticleMediaStorageService(configMock as any);
    mediaRepo = new ArticleMediaRepository(prismaRuntime as any);
    mediaService = new ArticleMediaService(mediaRepo, mediaStorage);

    articlesRepo = new ArticlesRepository(prismaRuntime as any);
    articlesService = new ArticlesService(articlesRepo);
    blocksRepo = new ArticleBlocksRepository(prismaRuntime as any);
    blocksService = new ArticleBlocksService(blocksRepo);
    publicationRepo = new ArticlePublicationRepository(prismaRuntime as any);
    publicationService = new ArticlePublicationService(publicationRepo);
    publicReaderRepo = new ArticlePublicReaderRepository(prismaRuntime as any);
    publicReaderService = new ArticlePublicReaderService(publicReaderRepo);

    // 10. Seed Authors A and B
    const createdA = await prismaAdmin.user.create({
      data: {
        email: 'author.stage6i.a@skyra-tech.com',
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
      sessionId: 'sess-stage6i-author-a',
    };

    const createdB = await prismaAdmin.user.create({
      data: {
        email: 'author.stage6i.b@skyra-tech.com',
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
      sessionId: 'sess-stage6i-author-b',
    };

    authorACookie = `${ACCESS_COOKIE_NAME}=token-author-a`;
    authorBCookie = `${ACCESS_COOKIE_NAME}=token-author-b`;

    const mockJwtTokenService = {
      verifyAccessToken: vi.fn(async (token: string) => {
        if (token === 'token-author-a') {
          return { sub: userA.id, email: userA.email, role: userA.role, sid: userA.sessionId };
        }
        if (token === 'token-author-b') {
          return { sub: userB.id, email: userB.email, role: userB.role, sid: userB.sessionId };
        }
        throw new Error('Invalid token');
      }),
    };

    const mockSessionsService = {
      validateSession: vi.fn(async (sid: string) => {
        if (sid === userA.sessionId) return { id: sid, userId: userA.id, revokedAt: null };
        if (sid === userB.sessionId) return { id: sid, userId: userB.id, revokedAt: null };
        return null;
      }),
    };

    const mockUsersRepository = {
      findById: vi.fn(async (id: string) => {
        if (id === userA.id) return { ...userA, emailVerifiedAt: new Date(), passwordHash: null, createdAt: new Date(), updatedAt: new Date() };
        if (id === userB.id) return { ...userB, emailVerifiedAt: new Date(), passwordHash: null, createdAt: new Date(), updatedAt: new Date() };
        return null;
      }),
      findUserById: vi.fn(async (id: string) => {
        if (id === userA.id) return { ...userA, emailVerifiedAt: new Date(), passwordHash: null, createdAt: new Date(), updatedAt: new Date() };
        if (id === userB.id) return { ...userB, emailVerifiedAt: new Date(), passwordHash: null, createdAt: new Date(), updatedAt: new Date() };
        return null;
      }),
    };

    // 11. Build testing NestJS application
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        ArticlePublicReaderController, // Registered first for route precedence
        ArticleMediaController,
        ArticlesController,
        ArticleBlocksController,
        ArticlePublicationController,
      ],
      providers: [
        { provide: ArticleMediaService, useValue: mediaService },
        { provide: ArticlesService, useValue: articlesService },
        { provide: ArticleBlocksService, useValue: blocksService },
        { provide: ArticlePublicationService, useValue: publicationService },
        { provide: ArticlePublicReaderService, useValue: publicReaderService },
        { provide: JwtTokenService, useValue: mockJwtTokenService },
        { provide: SessionsService, useValue: mockSessionsService },
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: APP_GUARD, useClass: JwtAccessGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideGuard(VerifiedEmailGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
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

    // Clean up temporary storage directory
    try {
      if (tempStorageDir && fs.existsSync(tempStorageDir)) {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('Failed to clean up temporary storage dir:', err);
    }

    // Clean up disposable PostgreSQL database
    if (disposableDbName) {
      try {
        await safelyDropDisposableDatabase(disposableDbName, (sql, target) => runAdminPsql(sql, target), {
          allowedPrefix: 'academy_auth_audit_',
        });
      } catch (err) {
        console.error(`Failed to drop disposable database ${disposableDbName}:`, err);
      }
    }
  });

  describe('Scenario A: Upload ownership & Library isolation', () => {
    let uploadedMediaIdA: string;

    it('allows authenticated author to upload a valid WebP image', async () => {
      const res = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validWebpBuffer, 'cover-illustration.webp');

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.mimeType).toBe('image/webp');
      expect(res.body.originalFilename).toBe('cover-illustration.webp');
      expect(res.body.mediaType).toBe('IMAGE');
      // Storage key must NEVER be leaked in API response
      expect(res.body.storageKey).toBeUndefined();

      uploadedMediaIdA = res.body.id;

      // Verify DB record
      const dbRecord = await prismaRuntime.mediaAsset.findUnique({
        where: { id: uploadedMediaIdA },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.uploaderId).toBe(authorA.id);
    });

    it('scopes author media library to the authenticated uploader', async () => {
      const resA = await request(app.getHttpServer())
        .get('/articles/media/mine')
        .set('Cookie', authorACookie);

      expect(resA.status).toBe(200);
      expect(resA.body.items).toHaveLength(1);
      expect(resA.body.items[0].id).toBe(uploadedMediaIdA);
      expect(resA.body.items[0].storageKey).toBeUndefined();

      // Author B media library must be completely empty!
      const resB = await request(app.getHttpServer())
        .get('/articles/media/mine')
        .set('Cookie', authorBCookie);

      expect(resB.status).toBe(200);
      expect(resB.body.items).toHaveLength(0);
      expect(resB.body.total).toBe(0);
    });

    it('allows author A to preview their owned image via private preview', async () => {
      const res = await request(app.getHttpServer())
        .get(`/articles/media/${uploadedMediaIdA}/content`)
        .set('Cookie', authorACookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/webp');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toContain('private');
      expect(res.body).toEqual(validWebpBuffer);
    });

    it('denies Author B private preview of Author A asset with a safe 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/articles/media/${uploadedMediaIdA}/content`)
        .set('Cookie', authorBCookie);

      // Must fail closed with 404 (prevent asset existence enumeration)
      expect(res.status).toBe(404);
    });
  });

  describe('Scenario B & C: Draft media isolation & Publication visibility', () => {
    let articleId: string;
    let coverMediaId: string;
    let imageBlockMediaId: string;
    const slug = 'deep-dive-into-storage';

    beforeAll(async () => {
      // Author A uploads cover and block images
      const coverRes = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validWebpBuffer, 'cover.webp');
      coverMediaId = coverRes.body.id;

      const blockRes = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validPngBuffer, 'diagram.png');
      imageBlockMediaId = blockRes.body.id;

      // Author A creates draft article with coverMediaId
      const artRes = await request(app.getHttpServer())
        .post('/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Deep Dive into Storage',
          draftSlug: slug,
          coverMediaId,
        });
      articleId = artRes.body.id;

      // Author A adds an IMAGE block
      await request(app.getHttpServer())
        .post(`/articles/${articleId}/blocks`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.IMAGE,
          content: { caption: 'Storage Engine Architecture', altText: 'Storage Diagram' },
          mediaAssetId: imageBlockMediaId,
        });
    });

    it('denies anonymous public delivery while article is in DRAFT (fails closed with 404)', async () => {
      const resCover = await request(app.getHttpServer()).get(
        `/articles/public/media/${coverMediaId}`,
      );
      expect(resCover.status).toBe(404);

      const resBlock = await request(app.getHttpServer()).get(
        `/articles/public/media/${imageBlockMediaId}`,
      );
      expect(resBlock.status).toBe(404);
    });

    it('publishes article and exposes controlled public media URLs', async () => {
      // Author A publishes article
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${articleId}/publish`)
        .set('Cookie', authorACookie)
        .send({ expectedRevision: 2 });

      expect(pubRes.status).toBe(200);
      expect(pubRes.body.status).toBe('PUBLISHED');

      // Public article detail reader returns public media URLs
      const readerRes = await request(app.getHttpServer()).get(`/articles/public/${slug}`);
      expect(readerRes.status).toBe(200);
      expect(readerRes.body.cover.url).toBe(`/api/v1/articles/public/media/${coverMediaId}`);
      expect(readerRes.body.blocks[0].media.url).toBe(
        `/api/v1/articles/public/media/${imageBlockMediaId}`,
      );

      // Storage keys are never present in public reader payload
      expect(readerRes.body.cover.storageKey).toBeUndefined();
      expect(readerRes.body.blocks[0].media.storageKey).toBeUndefined();
    });

    it('anonymous reader can successfully stream public image bytes with security headers', async () => {
      const coverDelivery = await request(app.getHttpServer()).get(
        `/articles/public/media/${coverMediaId}`,
      );
      expect(coverDelivery.status).toBe(200);
      expect(coverDelivery.headers['content-type']).toContain('image/webp');
      expect(coverDelivery.headers['x-content-type-options']).toBe('nosniff');
      expect(coverDelivery.headers['cache-control']).toContain('public');
      expect(coverDelivery.body).toEqual(validWebpBuffer);

      const blockDelivery = await request(app.getHttpServer()).get(
        `/articles/public/media/${imageBlockMediaId}`,
      );
      expect(blockDelivery.status).toBe(200);
      expect(blockDelivery.headers['content-type']).toContain('image/png');
      expect(blockDelivery.headers['x-content-type-options']).toBe('nosniff');
      expect(blockDelivery.body).toEqual(validPngBuffer);
    });
  });

  describe('Scenario D & E: Draft editing, Snapshot immutability & Historical retention revocation', () => {
    let articleId: string;
    let v1CoverId: string;
    let v2CoverId: string;
    const slug = 'immutable-retention-test';

    beforeAll(async () => {
      // Upload V1 Cover
      const resV1 = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validWebpBuffer, 'cover-v1.webp');
      v1CoverId = resV1.body.id;

      // Upload V2 Cover
      const resV2 = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validPngBuffer, 'cover-v2.png');
      v2CoverId = resV2.body.id;

      // Create and publish article with V1 Cover
      const art = await request(app.getHttpServer())
        .post('/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Immutable Retention Test',
          draftSlug: slug,
          coverMediaId: v1CoverId,
        });
      articleId = art.body.id;

      // Add a block to satisfy publishability requirement (min 1 non-divider block)
      await request(app.getHttpServer())
        .post(`/articles/${articleId}/blocks`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.HEADING,
          content: { text: 'Introduction to Retention', level: 2 },
        });

      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${articleId}/publish`)
        .set('Cookie', authorACookie)
        .send({ expectedRevision: 2 });
      expect(pubRes.status).toBe(200);
    });

    it('editing draft cover to V2 does NOT change public V1 image before republication', async () => {
      // Author updates draft metadata to V2 Cover
      const updateRes = await request(app.getHttpServer())
        .patch(`/articles/${articleId}`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 2,
          coverMediaId: v2CoverId,
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.draftRevision).toBe(3);

      // Public reader STILL serves V1 Cover URL from active snapshot!
      const publicRes = await request(app.getHttpServer()).get(`/articles/public/${slug}`);
      expect(publicRes.status).toBe(200);
      expect(publicRes.body.cover.url).toBe(`/api/v1/articles/public/media/${v1CoverId}`);

      // V2 Cover remains NON-PUBLIC
      const v2PublicRes = await request(app.getHttpServer()).get(
        `/articles/public/media/${v2CoverId}`,
      );
      expect(v2PublicRes.status).toBe(404);
    });

    it('republishing activates V2 Cover and revokes public access to V1 Cover while preserving retention', async () => {
      // Republish article -> Revision 3 snapshot active!
      const pubRes = await request(app.getHttpServer())
        .post(`/articles/${articleId}/publish`)
        .set('Cookie', authorACookie)
        .send({ expectedRevision: 3 });
      expect(pubRes.status).toBe(200);
      expect(pubRes.body.publishedRevision).toBe(3);

      // Public reader now serves V2 Cover URL
      const publicRes = await request(app.getHttpServer()).get(`/articles/public/${slug}`);
      expect(publicRes.body.cover.url).toBe(`/api/v1/articles/public/media/${v2CoverId}`);

      // Anonymous delivery of V2 Cover succeeds
      const v2Res = await request(app.getHttpServer()).get(
        `/articles/public/media/${v2CoverId}`,
      );
      expect(v2Res.status).toBe(200);

      // V1 Cover is now ONLY in historical snapshot -> must fail closed with 404!
      const v1Res = await request(app.getHttpServer()).get(
        `/articles/public/media/${v1CoverId}`,
      );
      expect(v1Res.status).toBe(404);

      // Verify that historical retention record for V1 Cover still exists in DB
      const retentionRecords = await prismaRuntime.articleSnapshotMedia.findMany({
        where: { mediaAssetId: v1CoverId },
      });
      expect(retentionRecords.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Scenario F & G: Failure handling & Route collisions', () => {
    it('rejects invalid uploads with 400 and creates no DB records', async () => {
      const beforeCount = await prismaRuntime.mediaAsset.count();

      const res = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', Buffer.from('plain-text-not-image'), 'text.jpg');

      expect(res.status).toBe(400);

      const afterCount = await prismaRuntime.mediaAsset.count();
      expect(afterCount).toBe(beforeCount);
    });

    it('verifies route collision prevention across media, slug, and private article routes', async () => {
      // 1. /articles/media/mine resolves to author media library, NOT :articleId
      const resMine = await request(app.getHttpServer())
        .get('/articles/media/mine')
        .set('Cookie', authorACookie);
      expect(resMine.status).toBe(200);
      expect(resMine.body.items).toBeDefined();

      // 2. /articles/public resolves to public listing, NOT :articleId
      const resPublicList = await request(app.getHttpServer()).get('/articles/public');
      expect(resPublicList.status).toBe(200);
      expect(resPublicList.body.items).toBeDefined();

      // 3. /articles/public/media/:id resolves to public media delivery, NOT public :slug
      const resNonExistent = await request(app.getHttpServer()).get(
        '/articles/public/media/00000000-0000-4000-8000-000000000000',
      );
      expect(resNonExistent.status).toBe(404);
      expect(resNonExistent.body.message).toContain('Media asset not found');
    });
  });

  describe('Scenario H: Database-backed publication consistency & Storage escape (Stage 6I-R)', () => {
    let articleId1: string;
    let articleId2: string;
    let articleId3: string;
    let mediaId1: string;
    let sharedMediaId: string;
    const slug1 = 'pub-consistency-article-1';
    const slug2 = 'pub-consistency-article-2';
    const slug3 = 'pub-consistency-article-3';

    beforeAll(async () => {
      // 1. Upload mediaId1 for Article 1
      const upload1 = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validWebpBuffer, 'media-1.webp');
      expect(upload1.status).toBe(201);
      mediaId1 = upload1.body.id;

      // 2. Upload sharedMediaId for Article 2 & 3
      const uploadShared = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validPngBuffer, 'shared.png');
      expect(uploadShared.status).toBe(201);
      sharedMediaId = uploadShared.body.id;

      // 3. Create & publish Article 1 with mediaId1
      const art1Res = await request(app.getHttpServer())
        .post('/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Publication Consistency 1',
          draftSlug: slug1,
          coverMediaId: mediaId1,
        });
      expect(art1Res.status).toBe(201);
      articleId1 = art1Res.body.id;

      const block1Res = await request(app.getHttpServer())
        .post(`/articles/${articleId1}/blocks`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.HEADING,
          content: { text: 'Heading block in article 1', level: 2 },
        });
      expect(block1Res.status).toBe(201);

      const pub1Res = await request(app.getHttpServer())
        .post(`/articles/${articleId1}/publish`)
        .set('Cookie', authorACookie)
        .send({ expectedRevision: 2 });
      expect(pub1Res.status).toBe(200);

      // 4. Create & publish Article 2 with sharedMediaId
      const art2Res = await request(app.getHttpServer())
        .post('/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Publication Consistency 2',
          draftSlug: slug2,
          coverMediaId: sharedMediaId,
        });
      expect(art2Res.status).toBe(201);
      articleId2 = art2Res.body.id;

      const block2Res = await request(app.getHttpServer())
        .post(`/articles/${articleId2}/blocks`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.HEADING,
          content: { text: 'Heading block in article 2', level: 2 },
        });
      expect(block2Res.status).toBe(201);

      const pub2Res = await request(app.getHttpServer())
        .post(`/articles/${articleId2}/publish`)
        .set('Cookie', authorACookie)
        .send({ expectedRevision: 2 });
      expect(pub2Res.status).toBe(200);

      // 5. Create & publish Article 3 with sharedMediaId
      const art3Res = await request(app.getHttpServer())
        .post('/articles')
        .set('Cookie', authorACookie)
        .send({
          title: 'Publication Consistency 3',
          draftSlug: slug3,
          coverMediaId: sharedMediaId,
        });
      expect(art3Res.status).toBe(201);
      articleId3 = art3Res.body.id;

      const block3Res = await request(app.getHttpServer())
        .post(`/articles/${articleId3}/blocks`)
        .set('Cookie', authorACookie)
        .send({
          expectedRevision: 1,
          type: ArticleBlockType.HEADING,
          content: { text: 'Heading block in article 3', level: 2 },
        });
      expect(block3Res.status).toBe(201);

      const pub3Res = await request(app.getHttpServer())
        .post(`/articles/${articleId3}/publish`)
        .set('Cookie', authorACookie)
        .send({ expectedRevision: 2 });
      expect(pub3Res.status).toBe(200);
    });

    it('A. serves public media when active snapshot satisfies all publication consistency conditions', async () => {
      const res = await request(app.getHttpServer()).get(
        `/articles/public/media/${mediaId1}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual(validWebpBuffer);
    });

    it('B. denies public delivery (404) when published_revision mismatches snapshot_revision', async () => {
      const originalArticle = await prismaRuntime.article.findUniqueOrThrow({
        where: { id: articleId1 },
      });

      // Advance draftRevision to 3 and set publishedRevision to 1 (mismatches active snapshot revision 2)
      await prismaRuntime.article.update({
        where: { id: articleId1 },
        data: {
          draftRevision: 3,
          publishedRevision: 1,
        },
      });

      const res = await request(app.getHttpServer()).get(
        `/articles/public/media/${mediaId1}`,
      );
      expect(res.status).toBe(404);

      // Restore
      await prismaRuntime.article.update({
        where: { id: articleId1 },
        data: {
          draftRevision: originalArticle.draftRevision,
          publishedRevision: originalArticle.publishedRevision,
        },
      });
    });

    it('C. denies public delivery (404) when published_slug mismatches snapshot slug', async () => {
      const originalArticle = await prismaRuntime.article.findUniqueOrThrow({
        where: { id: articleId1 },
      });

      await prismaRuntime.article.update({
        where: { id: articleId1 },
        data: { publishedSlug: 'desynchronized-slug' },
      });

      const res = await request(app.getHttpServer()).get(
        `/articles/public/media/${mediaId1}`,
      );
      expect(res.status).toBe(404);

      // Restore
      await prismaRuntime.article.update({
        where: { id: articleId1 },
        data: { publishedSlug: originalArticle.publishedSlug },
      });
    });

    it('E. denies public delivery (404) when article is ARCHIVED', async () => {
      await prismaRuntime.article.update({
        where: { id: articleId1 },
        data: { status: 'ARCHIVED' },
      });

      const res = await request(app.getHttpServer()).get(
        `/articles/public/media/${mediaId1}`,
      );
      expect(res.status).toBe(404);

      // Restore
      await prismaRuntime.article.update({
        where: { id: articleId1 },
        data: { status: 'PUBLISHED' },
      });
    });

    it('G. denies public delivery (404) for an unlinked media asset not retained by any active snapshot', async () => {
      const unlinkedRes = await request(app.getHttpServer())
        .post('/articles/media')
        .set('Cookie', authorACookie)
        .attach('file', validPngBuffer, 'unlinked.png');
      expect(unlinkedRes.status).toBe(201);
      const unlinkedMediaId = unlinkedRes.body.id;

      const res = await request(app.getHttpServer()).get(
        `/articles/public/media/${unlinkedMediaId}`,
      );
      expect(res.status).toBe(404);
    });

    it('H. delivers shared media if at least one eligible current published snapshot retains it', async () => {
      // Archive Article 2; Article 3 remains PUBLISHED and retains sharedMediaId
      await prismaRuntime.article.update({
        where: { id: articleId2 },
        data: { status: 'ARCHIVED' },
      });

      const res = await request(app.getHttpServer()).get(
        `/articles/public/media/${sharedMediaId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual(validPngBuffer);
    });

    it('I. storage escape protection rejects path traversal and invalid media IDs safely', async () => {
      // Non-UUID / traversal attempts return 400 via ParseUUIDPipe without executing query
      const traversalRes = await request(app.getHttpServer()).get(
        '/articles/public/media/..%2F..%2Fetc%2Fpasswd',
      );
      expect([400, 404]).toContain(traversalRes.status);
      expect(JSON.stringify(traversalRes.body)).not.toContain('storage');

      const nonUuidRes = await request(app.getHttpServer()).get(
        '/articles/public/media/not-a-valid-uuid',
      );
      expect([400, 404]).toContain(nonUuidRes.status);

      // Valid UUID format that does not exist returns 404
      const nonExistentRes = await request(app.getHttpServer()).get(
        '/articles/public/media/00000000-0000-4000-8000-000000000000',
      );
      expect(nonExistentRes.status).toBe(404);
      expect(JSON.stringify(nonExistentRes.body)).not.toContain('storage');
    });
  });
});
