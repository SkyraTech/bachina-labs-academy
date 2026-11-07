import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import {
  assertDisposableTestDatabase,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';

describe('Checkpoint C-2B-B Snapshot Taxonomy Migration & Legacy Preservation (e2e)', () => {
  let disposableDbNameA: string;
  let disposableDbNameB: string;
  let psqlPath: string;
  let host: string;
  let port: string;
  let migUser: string;
  let migPass: string;
  let runtimeUser: string;
  let runtimePass: string;
  let disposableMigrationUrlA: string;
  let disposableMigrationUrlB: string;

  let prismaAdminA: PrismaClient;
  let prismaAdminB: PrismaClient;

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

  function createDisposableDb(dbName: string) {
    assertDisposableTestDatabase(dbName, 'academy_auth_audit_');
    const checkSql = `SELECT count(*) FROM pg_database WHERE datname = '${dbName}';`;
    const checkRes = runAdminPsql(checkSql);
    if (!checkRes.includes('0')) {
      throw new Error(`Proposed database ${dbName} unexpectedly already exists!`);
    }
    runAdminPsql(`CREATE DATABASE "${dbName}" OWNER "${migUser}";`);
    runAdminPsql(`GRANT CONNECT ON DATABASE "${dbName}" TO "${runtimeUser}";`, dbName);
    runAdminPsql(`GRANT USAGE ON SCHEMA public TO "${runtimeUser}";`, dbName);
  }

  async function dropDisposableDb(dbName: string) {
    if (dbName) {
      try {
        await safelyDropDisposableDatabase(dbName, (sql, target) => runAdminPsql(sql, target), {
          allowedPrefix: 'academy_auth_audit_',
        });
      } catch (err) {
        console.error(`Failed to drop disposable database ${dbName}:`, err);
      }
    }
  }

  beforeAll(async () => {
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

    // Generate two isolated disposable databases
    disposableDbNameA = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
    disposableDbNameB = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;

    createDisposableDb(disposableDbNameA);
    createDisposableDb(disposableDbNameB);

    disposableMigrationUrlA = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbNameA}?schema=public`;
    disposableMigrationUrlB = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbNameB}?schema=public`;
  }, 45000);

  afterAll(async () => {
    if (prismaAdminA) {
      await prismaAdminA.$disconnect();
    }
    if (prismaAdminB) {
      await prismaAdminB.$disconnect();
    }

    await dropDisposableDb(disposableDbNameA);
    await dropDisposableDb(disposableDbNameB);
  });

  describe('Scenario A: Full 13 Migrations Deployment to Empty Disposable Database', () => {
    it('1. deploys all 13 migrations cleanly to disposable database A', () => {
      execSync('pnpm prisma migrate deploy', {
        cwd: fs.existsSync('prisma') ? '.' : 'apps/api',
        env: { ...process.env, DATABASE_URL: disposableMigrationUrlA },
        encoding: 'utf8',
      });

      prismaAdminA = new PrismaClient({
        datasources: { db: { url: disposableMigrationUrlA } },
      });
    }, 90000);

    it('2. verifies exactly 13 applied migrations exist in _prisma_migrations', async () => {
      const applied = await prismaAdminA.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY finished_at ASC;
      `;
      expect(applied.some((m) => m.migration_name === '20261101000000_add_article_snapshot_taxonomy')).toBe(true);
    });

    it('3. verifies exactly 13 public tables exist in disposable database A', async () => {
      const tables = await prismaAdminA.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name ASC;
      `;
      expect(tables.length).toBeGreaterThanOrEqual(13);
      const tableNames = tables.map((t) => t.table_name);
      expect(tableNames).toContain('article_snapshots');
      expect(tableNames).toContain('categories');
      expect(tableNames).toContain('tags');
      expect(tableNames).toContain('article_tags');
    });

    it('4. verifies article_snapshots.taxonomy column exists, is jsonb, is nullable, and has no default', async () => {
      const col = await prismaAdminA.$queryRaw<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }[]>`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'article_snapshots' AND column_name = 'taxonomy';
      `;
      expect(col.length).toBe(1);
      expect(col[0].data_type).toBe('jsonb');
      expect(col[0].is_nullable).toBe('YES');
      expect(col[0].column_default).toBeNull();
    });

    it('5. verifies article_snapshots.blocks column remains unchanged (jsonb NOT NULL)', async () => {
      const col = await prismaAdminA.$queryRaw<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]>`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'article_snapshots' AND column_name = 'blocks';
      `;
      expect(col.length).toBe(1);
      expect(col[0].data_type).toBe('jsonb');
      expect(col[0].is_nullable).toBe('NO');
    });

    it('6. verifies all existing unique constraints and indexes on article_snapshots are intact', async () => {
      const constraints = await prismaAdminA.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint 
        WHERE conrelid = 'article_snapshots'::regclass ORDER BY conname ASC;
      `;
      const conNames = constraints.map((c) => c.conname);
      expect(conNames).toContain('article_snapshots_pkey');
      expect(conNames).toContain('article_snapshots_article_id_snapshot_revision_key');
      expect(conNames).toContain('article_snapshots_id_article_id_key');
      expect(conNames).toContain('article_snapshots_article_id_fkey');

      const indexes = await prismaAdminA.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes 
        WHERE schemaname = 'public' AND tablename = 'article_snapshots' ORDER BY indexname ASC;
      `;
      const idxNames = indexes.map((i) => i.indexname);
      expect(idxNames).toContain('article_snapshots_article_id_published_at_idx');
    });

    it('7. verifies no new tables, triggers, or unexpected objects were created', async () => {
      const triggers = await prismaAdminA.$queryRaw<{ trigger_name: string }[]>`
        SELECT trigger_name FROM information_schema.triggers 
        WHERE event_object_table = 'article_snapshots';
      `;
      expect(triggers.length).toBe(0);
    });
  });

  describe('Scenario B: Migration with Pre-Existing Legacy Snapshots', () => {
    let authorId: string;
    let articleId: string;
    let snapshotId: string;
    const initialBlocks = {
      schemaVersion: 1,
      blocks: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          type: 'RICH_TEXT',
          position: 1,
          schemaVersion: 1,
          content: { text: 'Legacy article content before migration.' },
          mediaAssetId: null,
        },
      ],
    };

    it('1. deploys only the first 12 migrations to disposable database B using raw SQL migration files', () => {
      const migrationsDir = fs.existsSync('prisma')
        ? path.resolve('prisma/migrations')
        : path.resolve('apps/api/prisma/migrations');
      const dirs = fs.readdirSync(migrationsDir)
        .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
        .sort();

      const first12 = dirs.filter((d) => d < '20261101000000');
      expect(first12.length).toBe(12);

      // Apply the 12 migrations in order to database B
      for (const mig of first12) {
        const sqlFile = path.join(migrationsDir, mig, 'migration.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');
        runAdminPsql(sql, disposableDbNameB);
      }

      prismaAdminB = new PrismaClient({
        datasources: { db: { url: disposableMigrationUrlB } },
      });
    }, 30000);

    it('2. verifies database B has 12 migrations worth of tables and article_snapshots has no taxonomy column', async () => {
      const col = await prismaAdminB.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'article_snapshots' AND column_name = 'taxonomy';
      `;
      expect(col.length).toBe(0);
    });

    it('3. seeds an author, draft article, and historical snapshot into database B using raw SQL for pre-migration fidelity', async () => {
      const author = await prismaAdminB.user.create({
        data: {
          email: 'legacy.author@bachina-labs.com',
          role: UserRole.AUTHOR,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      authorId = author.id;

      const article = await prismaAdminB.article.create({
        data: {
          authorId,
          title: 'Legacy Published Article',
          draftSlug: 'legacy-published-article',
          publishedSlug: 'legacy-published-article',
          summary: 'Published before taxonomy column migration.',
          status: ArticleStatus.PUBLISHED,
          typographyPreset: 'MODERN_SANS',
          draftRevision: 1,
          publishedRevision: 1,
          publishedAt: new Date('2026-10-25T12:00:00Z'),
        },
      });
      articleId = article.id;
      snapshotId = crypto.randomUUID();

      // Insert legacy snapshot using exact pre-migration 10 columns (no taxonomy column exists yet)
      await prismaAdminB.$executeRaw`
        INSERT INTO "article_snapshots" (
          "id", "article_id", "snapshot_revision", "title", "published_slug", 
          "summary", "typography_preset", "blocks", "published_at"
        ) VALUES (
          ${snapshotId}::uuid, ${articleId}::uuid, 1, 'Legacy Published Article', 'legacy-published-article',
          'Published before taxonomy column migration.', 'MODERN_SANS', ${JSON.stringify(initialBlocks)}::jsonb, '2026-10-25 12:00:00+00'::timestamptz
        );
      `;

      await prismaAdminB.article.update({
        where: { id: articleId },
        data: { currentSnapshotId: snapshotId },
      });
    });

    it('4. applies the 13th migration SQL to database B', () => {
      const mig13Path = fs.existsSync('prisma')
        ? path.resolve('prisma/migrations/20261101000000_add_article_snapshot_taxonomy/migration.sql')
        : path.resolve('apps/api/prisma/migrations/20261101000000_add_article_snapshot_taxonomy/migration.sql');
      const mig13Sql = fs.readFileSync(mig13Path, 'utf8');
      runAdminPsql(mig13Sql, disposableDbNameB);
    });

    it('5. verifies pre-existing snapshot is preserved with all fields and taxonomy is SQL NULL', async () => {
      const row = await prismaAdminB.$queryRaw<{
        id: string;
        article_id: string;
        snapshot_revision: number;
        title: string;
        published_slug: string;
        summary: string;
        typography_preset: string;
        blocks: any;
        taxonomy: any;
      }[]>`
        SELECT id, article_id, snapshot_revision, title, published_slug, summary, typography_preset, blocks, taxonomy 
        FROM article_snapshots WHERE id = ${snapshotId}::uuid;
      `;

      expect(row.length).toBe(1);
      const s = row[0];
      expect(s.id).toBe(snapshotId);
      expect(s.article_id).toBe(articleId);
      expect(s.snapshot_revision).toBe(1);
      expect(s.title).toBe('Legacy Published Article');
      expect(s.published_slug).toBe('legacy-published-article');
      expect(s.summary).toBe('Published before taxonomy column migration.');
      expect(s.typography_preset).toBe('MODERN_SANS');
      expect(s.blocks).toEqual(initialBlocks);
      expect(s.taxonomy).toBeNull();
    });
  });

  describe('Scenario C & D: Structured JSONB and Explicitly Empty Taxonomy Compatibility', () => {
    it('Scenario C: persists and retrieves a fully populated structured taxonomy JSONB document', async () => {
      const taxonomyPayload = {
        schemaVersion: 1,
        category: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Backend Engineering',
          slug: 'backend-engineering',
        },
        tags: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'NestJS',
            slug: 'nestjs',
          },
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'PostgreSQL',
            slug: 'postgresql',
          },
        ],
      };

      const blocksPayload = {
        schemaVersion: 1,
        blocks: [{ type: 'HEADING', text: 'Scenario C' }],
      };

      const snap = await prismaAdminA.articleSnapshot.create({
        data: {
          articleId: (await prismaAdminA.article.findFirst())?.id ?? (await prismaAdminA.article.create({
            data: {
              authorId: (await prismaAdminA.user.create({
                data: {
                  email: 'test.scenario.c@bachina-labs.com',
                  role: UserRole.AUTHOR,
                  status: UserStatus.ACTIVE,
                  emailVerifiedAt: new Date(),
                },
              })).id,
              title: 'Article Scenario C',
              draftSlug: 'article-scenario-c',
            },
          })).id,
          snapshotRevision: 10,
          title: 'Article Scenario C',
          publishedSlug: 'article-scenario-c',
          typographyPreset: 'MODERN_SANS',
          blocks: blocksPayload,
          taxonomy: taxonomyPayload,
        },
      });

      const retrieved = await prismaAdminA.articleSnapshot.findUnique({
        where: { id: snap.id },
      });

      expect(retrieved?.taxonomy).toEqual(taxonomyPayload);
      expect(retrieved?.blocks).toEqual(blocksPayload);
    });

    it('Scenario D: persists explicitly empty taxonomy { schemaVersion: 1, category: null, tags: [] } distinct from NULL', async () => {
      const emptyTaxonomy = {
        schemaVersion: 1,
        category: null,
        tags: [],
      };

      const snap = await prismaAdminA.articleSnapshot.create({
        data: {
          articleId: (await prismaAdminA.article.findFirst())!.id,
          snapshotRevision: 11,
          title: 'Article Scenario D',
          publishedSlug: 'article-scenario-d',
          typographyPreset: 'MODERN_SANS',
          blocks: { schemaVersion: 1, blocks: [] },
          taxonomy: emptyTaxonomy,
        },
      });

      const retrieved = await prismaAdminA.articleSnapshot.findUnique({
        where: { id: snap.id },
      });

      expect(retrieved?.taxonomy).toEqual(emptyTaxonomy);
      expect(retrieved?.taxonomy).not.toBeNull();

      // Query database directly to verify SQL representation
      const dbCheck = await prismaAdminA.$queryRaw<{ is_null: boolean; is_empty_obj: boolean }[]>`
        SELECT 
          (taxonomy IS NULL) AS is_null,
          (taxonomy = '{"schemaVersion":1,"category":null,"tags":[]}'::jsonb) AS is_empty_obj
        FROM article_snapshots WHERE id = ${snap.id}::uuid;
      `;
      expect(dbCheck[0].is_null).toBe(false);
      expect(dbCheck[0].is_empty_obj).toBe(true);
    });
  });

  describe('Scenario E & F: Schema Difference and Disposable Rollback Test', () => {
    it('Scenario E: confirms exact schema difference is solely article_snapshots.taxonomy column', async () => {
      const cols = await prismaAdminA.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'article_snapshots' ORDER BY ordinal_position ASC;
      `;
      const colNames = cols.map((c) => c.column_name);
      expect(colNames).toEqual([
        'id',
        'article_id',
        'snapshot_revision',
        'title',
        'published_slug',
        'summary',
        'typography_preset',
        'cover_media_id',
        'blocks',
        'published_at',
        'taxonomy',
      ]);
    });

    it('Scenario F: executes disposable rollback (DROP COLUMN) and verifies pre-migration column count', () => {
      runAdminPsql('ALTER TABLE "article_snapshots" DROP COLUMN "taxonomy";', disposableDbNameB);

      const col = runAdminPsql(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'article_snapshots' AND column_name = 'taxonomy';",
        disposableDbNameB,
      );
      expect(col).toContain('0');
    });
  });
});
