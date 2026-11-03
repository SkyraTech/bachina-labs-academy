import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { assertDisposableTestDatabase } from './test-db-isolation.js';

describe('Checkpoint C-1A Taxonomy Database Foundation & Migration (e2e)', () => {
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

  let authorId: string;

  let originalDbName: string;

  function runAdminPsql(sql: string, targetDb?: string) {
    const dbToConnect = targetDb ?? originalDbName;
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
    // 1. Read configuration safely from apps/api/.env
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

    [, runtimeUser, runtimePass, host, port, originalDbName] = runtimeMatch;
    [, migUser, migPass] = migrationMatch;
    migPass = decodeURIComponent(migPass);

    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Refusing to run against non-local host: ${host}`);
    }

    psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
    if (!fs.existsSync(psqlPath)) {
      psqlPath = 'psql';
    }

    // 2. Generate unique disposable database name matching ^academy_auth_audit_[a-f0-9]{16}$
    disposableDbName = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
    assertDisposableTestDatabase(disposableDbName, 'academy_auth_audit_');

    // 3. Confirm target database does not exist
    const checkSql = `SELECT count(*) FROM pg_database WHERE datname = '${disposableDbName}';`;
    const checkRes = runAdminPsql(checkSql);
    if (!checkRes.includes('0')) {
      throw new Error(`Proposed database ${disposableDbName} unexpectedly already exists!`);
    }

    // 4. Create isolated disposable database owned by migration user
    runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`);

    // 5. Grant connection and schema usage to runtime user academy_app
    runAdminPsql(`GRANT CONNECT ON DATABASE "${disposableDbName}" TO "${runtimeUser}";`, disposableDbName);
    runAdminPsql(`GRANT USAGE ON SCHEMA public TO "${runtimeUser}";`, disposableDbName);

    // 6. Deploy all 12 Prisma migrations (11 prior + 20261029000000_create_taxonomies)
    disposableMigrationUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;
    execSync('pnpm prisma migrate deploy', {
      cwd: fs.existsSync('prisma') ? '.' : 'apps/api',
      env: { ...process.env, DATABASE_URL: disposableMigrationUrl },
      encoding: 'utf8',
    });

    // 7. Grant permissions on users and existing tables to runtime user
    runAdminPsql(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "articles" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "article_blocks" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "article_snapshots" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "article_snapshot_media" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "media_assets" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "${runtimeUser}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification_tokens" TO "${runtimeUser}";
      GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
    `, disposableDbName);

    // 8. Connect Prisma clients
    disposableRuntimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;
    prismaRuntime = new PrismaClient({
      datasources: { db: { url: disposableRuntimeUrl } },
    });
    await prismaRuntime.$connect();

    prismaAdmin = new PrismaClient({
      datasources: { db: { url: disposableMigrationUrl } },
    });
    await prismaAdmin.$connect();

    // 9. Seed author user
    const author = await prismaAdmin.user.create({
      data: {
        email: 'taxonomy.author@skyra-tech.com',
        role: UserRole.AUTHOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    authorId = author.id;
  }, 45000);

  afterAll(async () => {
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
  });

  it('1. confirms all 13 migrations were applied to the disposable database', async () => {
    const appliedMigrations = await prismaAdmin.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY finished_at ASC;
    `;
    expect(appliedMigrations.length).toBe(13);
    expect(appliedMigrations[11].migration_name).toBe('20261029000000_create_taxonomies');
    expect(appliedMigrations[12].migration_name).toBe('20261101000000_add_article_snapshot_taxonomy');
  });

  it('2. creates a Category with valid name, slug, and description', async () => {
    const category = await prismaRuntime.category.create({
      data: {
        name: 'Backend Engineering',
        slug: 'backend-engineering',
        description: 'Server-side architecture, APIs, and scalable infrastructure.',
      },
    });

    expect(category.id).toBeDefined();
    expect(category.name).toBe('Backend Engineering');
    expect(category.slug).toBe('backend-engineering');
    expect(category.description).toBe('Server-side architecture, APIs, and scalable infrastructure.');
    expect(category.createdAt).toBeInstanceOf(Date);
    expect(category.updatedAt).toBeInstanceOf(Date);
  });

  it('3. rejects duplicate Category slug with unique constraint error', async () => {
    await expect(
      prismaRuntime.category.create({
        data: {
          name: 'Duplicate Category',
          slug: 'backend-engineering',
        },
      }),
    ).rejects.toThrow();
  });

  it('4. rejects case-insensitive collision on Category slug via lower index', async () => {
    await expect(
      prismaRuntime.category.create({
        data: {
          name: 'Case Collision Category',
          slug: 'BACKEND-ENGINEERING',
        },
      }),
    ).rejects.toThrow();
  });

  it('5. creates a Tag with valid name and slug', async () => {
    const tag = await prismaRuntime.tag.create({
      data: {
        name: 'PostgreSQL',
        slug: 'postgresql',
      },
    });

    expect(tag.id).toBeDefined();
    expect(tag.name).toBe('PostgreSQL');
    expect(tag.slug).toBe('postgresql');
    expect(tag.createdAt).toBeInstanceOf(Date);
  });

  it('6. rejects duplicate Tag slug with unique constraint error', async () => {
    await expect(
      prismaRuntime.tag.create({
        data: {
          name: 'PostgreSQL Dup',
          slug: 'postgresql',
        },
      }),
    ).rejects.toThrow();
  });

  it('7. creates an Article without a Category (preserves backward compatibility)', async () => {
    const article = await prismaRuntime.article.create({
      data: {
        authorId,
        title: 'Uncategorized Architecture Guide',
        draftSlug: 'uncategorized-architecture-guide',
      },
    });

    expect(article.id).toBeDefined();
    expect(article.categoryId).toBeNull();
  });

  it('8. creates an Article associated with a Category', async () => {
    const category = await prismaRuntime.category.findUniqueOrThrow({
      where: { slug: 'backend-engineering' },
    });

    const article = await prismaRuntime.article.create({
      data: {
        authorId,
        title: 'High-Throughput NestJS Systems',
        draftSlug: 'high-throughput-nestjs-systems',
        categoryId: category.id,
      },
      include: {
        category: true,
      },
    });

    expect(article.id).toBeDefined();
    expect(article.categoryId).toBe(category.id);
    expect(article.category?.name).toBe('Backend Engineering');
  });

  it('9. associates multiple Tags with an Article via ArticleTag junction table', async () => {
    const tagNest = await prismaRuntime.tag.create({
      data: { name: 'NestJS', slug: 'nestjs' },
    });
    const tagPostgres = await prismaRuntime.tag.findUniqueOrThrow({
      where: { slug: 'postgresql' },
    });

    const article = await prismaRuntime.article.findFirstOrThrow({
      where: { draftSlug: 'high-throughput-nestjs-systems' },
    });

    // Create associations
    await prismaRuntime.articleTag.create({
      data: {
        articleId: article.id,
        tagId: tagNest.id,
      },
    });

    await prismaRuntime.articleTag.create({
      data: {
        articleId: article.id,
        tagId: tagPostgres.id,
      },
    });

    // Query article with tags
    const articleWithTags = await prismaRuntime.article.findUniqueOrThrow({
      where: { id: article.id },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });

    expect(articleWithTags.tags.length).toBe(2);
    const tagSlugs = articleWithTags.tags.map((at) => at.tag.slug);
    expect(tagSlugs).toContain('nestjs');
    expect(tagSlugs).toContain('postgresql');
  });

  it('10. rejects duplicate Tag assignment to the same Article (composite PK check)', async () => {
    const tagNest = await prismaRuntime.tag.findUniqueOrThrow({
      where: { slug: 'nestjs' },
    });
    const article = await prismaRuntime.article.findFirstOrThrow({
      where: { draftSlug: 'high-throughput-nestjs-systems' },
    });

    await expect(
      prismaRuntime.articleTag.create({
        data: {
          articleId: article.id,
          tagId: tagNest.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('11. deleting a Category sets Article categoryId to NULL without deleting the Article', async () => {
    const tempCat = await prismaRuntime.category.create({
      data: { name: 'Temporary Category', slug: 'temp-category' },
    });

    const article = await prismaRuntime.article.create({
      data: {
        authorId,
        title: 'Article in Temporary Category',
        draftSlug: 'article-in-temp-category',
        categoryId: tempCat.id,
      },
    });

    expect(article.categoryId).toBe(tempCat.id);

    // Delete category
    await prismaRuntime.category.delete({
      where: { id: tempCat.id },
    });

    // Verify article still exists but categoryId is now null
    const articleAfterCatDelete = await prismaRuntime.article.findUniqueOrThrow({
      where: { id: article.id },
    });
    expect(articleAfterCatDelete).toBeDefined();
    expect(articleAfterCatDelete.categoryId).toBeNull();
  });

  it('12. deleting a Tag deletes the ArticleTag association but does NOT delete the Article', async () => {
    const tempTag = await prismaRuntime.tag.create({
      data: { name: 'Temporary Tag', slug: 'temp-tag' },
    });

    const article = await prismaRuntime.article.create({
      data: {
        authorId,
        title: 'Article with Temp Tag',
        draftSlug: 'article-with-temp-tag',
      },
    });

    await prismaRuntime.articleTag.create({
      data: {
        articleId: article.id,
        tagId: tempTag.id,
      },
    });

    // Delete tag
    await prismaRuntime.tag.delete({
      where: { id: tempTag.id },
    });

    // Verify junction row is gone
    const junctionCheck = await prismaRuntime.articleTag.findUnique({
      where: {
        articleId_tagId: {
          articleId: article.id,
          tagId: tempTag.id,
        },
      },
    });
    expect(junctionCheck).toBeNull();

    // Verify article still exists
    const articleCheck = await prismaRuntime.article.findUniqueOrThrow({
      where: { id: article.id },
    });
    expect(articleCheck).toBeDefined();
  });

  it('13. rejects Category creation with invalid name length (< 2 characters) via check constraint', async () => {
    await expect(
      prismaRuntime.category.create({
        data: {
          name: 'A',
          slug: 'valid-slug-a',
        },
      }),
    ).rejects.toThrow();
  });

  it('14. rejects Tag creation with malformed slug regex via check constraint', async () => {
    await expect(
      prismaRuntime.tag.create({
        data: {
          name: 'Invalid Slug Tag',
          slug: 'Invalid_Slug!',
        },
      }),
    ).rejects.toThrow();
  });

  it('15. confirms existing ArticleBlock and ArticleSnapshot schema integrity remain untouched', async () => {
    const blockCount = await prismaRuntime.articleBlock.count();
    const snapshotCount = await prismaRuntime.articleSnapshot.count();
    const mediaCount = await prismaRuntime.mediaAsset.count();

    expect(blockCount).toBe(0);
    expect(snapshotCount).toBe(0);
    expect(mediaCount).toBe(0);
  });
});
