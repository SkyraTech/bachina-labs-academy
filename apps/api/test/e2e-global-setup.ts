import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertDisposableTestDatabase } from './test-db-isolation.js';

let disposableDbName: string | null = null;
let psqlPath: string;
let host: string;
let port: string;
let migUser: string;
let migPass: string;
let runtimeUser: string;
let runtimePass: string;
let originalDbName: string;

const tempFile = path.resolve(process.cwd(), '.test-runtime-db.json');

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

export async function setup(): Promise<void> {
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

  psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
  if (!fs.existsSync(psqlPath)) {
    psqlPath = 'psql';
  }

  // 1. Generate unique collision-resistant database name
  disposableDbName = `academy_e2e_suite_${crypto.randomBytes(8).toString('hex')}`;
  assertDisposableTestDatabase(disposableDbName, 'academy_e2e_suite_');

  // 2. Confirm database does not pre-exist
  const checkRes = runAdminPsql(`SELECT count(*) FROM pg_database WHERE datname = '${disposableDbName}';`);
  if (!checkRes.includes('0')) {
    throw new Error(`Proposed database ${disposableDbName} unexpectedly already exists!`);
  }

  // 3. Create disposable database
  runAdminPsql(`CREATE DATABASE "${disposableDbName}" OWNER "${migUser}";`);

  // 4. Initialize schema from authoritative migration files
  const migrationsPath = fs.existsSync(path.resolve('prisma/migrations'))
    ? path.resolve('prisma/migrations')
    : path.resolve('apps/api/prisma/migrations');

  const migrationDirs = [
    '20261014052015_create_users',
    '20261014052130',
    '20261014055014_refine_users_column_types',
    '20261014094904_create_email_verification_tokens',
    '20261014133618_create_user_sessions',
    '20261016153000_create_audit_logs',
  ];

  for (const dir of migrationDirs) {
    const sqlFile = path.join(migrationsPath, dir, 'migration.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    runAdminPsql(sql, disposableDbName);
  }

  // 5. Grant permissions to runtime role
  const permissionsSql = `
    GRANT ALL ON ALL TABLES IN SCHEMA public TO "${migUser}";
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${migUser}";

    GRANT SELECT, INSERT, UPDATE, DELETE ON "users", "user_sessions", "email_verification_tokens" TO "${runtimeUser}";
    GRANT SELECT, INSERT ON "audit_logs" TO "${runtimeUser}";
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM "${runtimeUser}";
  `;
  runAdminPsql(permissionsSql, disposableDbName);

  const runtimeUrl = `postgresql://${runtimeUser}:${encodeURIComponent(runtimePass)}@${host}:${port}/${disposableDbName}?schema=public`;
  const devUrl = `postgresql://${migUser}:${encodeURIComponent(migPass)}@${host}:${port}/${disposableDbName}?schema=public`;

  process.env.DATABASE_RUNTIME_URL = runtimeUrl;
  process.env.DATABASE_URL = devUrl;

  fs.writeFileSync(tempFile, JSON.stringify({ runtimeUrl, devUrl, dbName: disposableDbName }));
}

export async function teardown(): Promise<void> {
  if (fs.existsSync(tempFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
      const dbToDrop = data.dbName || disposableDbName;
      if (dbToDrop && dbToDrop.startsWith('academy_e2e_suite_')) {
        runAdminPsql(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbToDrop}' AND pid <> pg_backend_pid();`,
        );
        runAdminPsql(`DROP DATABASE IF EXISTS "${dbToDrop}";`);
      }
    } catch (err) {
      console.error('Failed to teardown disposable e2e suite database:', err);
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // ignore
      }
    }
  }
}
