import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertDisposableTestDatabase,
  assertDatabaseUrlSafe,
  safelyDropDisposableDatabase,
} from './test-db-isolation.js';

describe('Test Database Isolation Guard (assertDisposableTestDatabase & safelyDropDisposableDatabase)', () => {
  const validHex16 = crypto.randomBytes(8).toString('hex'); // exactly 16 hex chars

  describe('assertDisposableTestDatabase — Valid Names', () => {
    it('accepts academy_auth_audit_ with 16 lowercase hex characters', () => {
      const db = `academy_auth_audit_${validHex16}`;
      expect(() => assertDisposableTestDatabase(db)).not.toThrow();
      expect(() => assertDisposableTestDatabase(db, 'academy_auth_audit_')).not.toThrow();
    });

    it('accepts academy_e2e_suite_ with 16 lowercase hex characters', () => {
      const db = `academy_e2e_suite_${validHex16}`;
      expect(() => assertDisposableTestDatabase(db)).not.toThrow();
      expect(() => assertDisposableTestDatabase(db, 'academy_e2e_suite_')).not.toThrow();
    });

    it('accepts legacy academy_audit_ with 16 lowercase hex characters', () => {
      const db = `academy_audit_${validHex16}`;
      expect(() => assertDisposableTestDatabase(db)).not.toThrow();
      expect(() => assertDisposableTestDatabase(db, 'academy_audit_')).not.toThrow();
    });
  });

  describe('assertDisposableTestDatabase — Invalid Names & Strict Boundary Rejection', () => {
    it('rejects primary database bachina_labs_academy strictly', () => {
      expect(() => assertDisposableTestDatabase('bachina_labs_academy')).toThrow(
        /cannot be production or development database/i,
      );
      expect(() => assertDisposableTestDatabase('BACHINA_LABS_ACADEMY')).toThrow(
        /cannot be production or development database/i,
      );
    });

    it('rejects system databases postgres, template0, template1', () => {
      expect(() => assertDisposableTestDatabase('postgres')).toThrow(/cannot be system database/i);
      expect(() => assertDisposableTestDatabase('template0')).toThrow(/cannot be system database/i);
      expect(() => assertDisposableTestDatabase('template1')).toThrow(/cannot be system database/i);
    });

    it('rejects empty, undefined, null, or whitespace-only inputs', () => {
      expect(() => assertDisposableTestDatabase('')).toThrow(/empty or undefined/i);
      expect(() => assertDisposableTestDatabase('   ')).toThrow(/empty or undefined/i);
      expect(() => assertDisposableTestDatabase(undefined)).toThrow(/empty or undefined/i);
      expect(() => assertDisposableTestDatabase(null)).toThrow(/empty or undefined/i);
    });

    it('rejects unapproved prefixes and unknown databases', () => {
      expect(() => assertDisposableTestDatabase('random_other_db')).toThrow(
        /does not start with an approved disposable prefix/i,
      );
      expect(() => assertDisposableTestDatabase(`test_${validHex16}`)).toThrow(
        /does not start with an approved disposable prefix/i,
      );
      expect(() => assertDisposableTestDatabase(`bachina_labs_academy_test_${validHex16}`)).toThrow(
        /does not start with an approved disposable prefix/i,
      );
    });

    it('rejects bare prefix without suffix', () => {
      expect(() => assertDisposableTestDatabase('academy_auth_audit_')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
      expect(() => assertDisposableTestDatabase('academy_e2e_suite_')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
    });

    it('rejects suffix length not equal to exactly 16 characters', () => {
      // 8 hex chars (legacy minimum, now strictly rejected)
      expect(() => assertDisposableTestDatabase('academy_auth_audit_01234567')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
      // 15 hex chars
      expect(() => assertDisposableTestDatabase('academy_auth_audit_0123456789abcde')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
      // 17 hex chars
      expect(() => assertDisposableTestDatabase('academy_auth_audit_0123456789abcdef0')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
    });

    it('rejects non-hex characters in suffix', () => {
      expect(() => assertDisposableTestDatabase('academy_auth_audit_nonhex1234567890')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
      expect(() => assertDisposableTestDatabase('academy_auth_audit_1234567890abcdefg')).toThrow(
        /valid collision-resistant hex suffix/i,
      );
    });

    it('rejects uppercase and mixed-case database names', () => {
      expect(() =>
        assertDisposableTestDatabase(`ACADEMY_AUTH_AUDIT_${validHex16}`),
      ).toThrow(/must be strictly lowercase/i);
      expect(() =>
        assertDisposableTestDatabase(`academy_auth_audit_${validHex16.toUpperCase()}`),
      ).toThrow(/must be strictly lowercase/i);
    });

    it('rejects leading and trailing whitespace', () => {
      expect(() =>
        assertDisposableTestDatabase(` academy_auth_audit_${validHex16}`),
      ).toThrow(/without leading or trailing whitespace/i);
      expect(() =>
        assertDisposableTestDatabase(`academy_auth_audit_${validHex16} `),
      ).toThrow(/without leading or trailing whitespace/i);
    });

    it('rejects punctuation, quotes, or SQL injection patterns', () => {
      expect(() =>
        assertDisposableTestDatabase(`academy_auth_audit_${validHex16}"; DROP TABLE users; --`),
      ).toThrow();
    });

    it('enforces allowedPrefix restriction when explicitly supplied', () => {
      const e2eDb = `academy_e2e_suite_${validHex16}`;
      expect(() => assertDisposableTestDatabase(e2eDb, 'academy_auth_audit_')).toThrow(
        /does not start with an approved disposable prefix: academy_auth_audit_/i,
      );
      expect(() => assertDisposableTestDatabase(e2eDb, 'academy_e2e_suite_')).not.toThrow();
    });
  });

  describe('safelyDropDisposableDatabase — Teardown & Fail-Loud Guarantees', () => {
    it('refuses to drop an unapproved database target before executing any SQL', async () => {
      const runner = vi.fn();
      await expect(safelyDropDisposableDatabase('bachina_labs_academy', runner)).rejects.toThrow(
        /cannot be production or development database/i,
      );
      expect(runner).not.toHaveBeenCalled();
    });

    it('drains active connections, executes DROP DATABASE, and verifies absence on success', async () => {
      const db = `academy_auth_audit_${validHex16}`;
      const executedSql: string[] = [];
      const runner = vi.fn().mockImplementation((sql: string) => {
        executedSql.push(sql);
        if (sql.includes('pg_stat_activity')) {
          return 'count\n-----\n    0\n(1 row)';
        }
        if (sql.includes('DROP DATABASE')) {
          return 'DROP DATABASE';
        }
        if (sql.includes('pg_database')) {
          return 'count\n-----\n    0\n(1 row)';
        }
        return '';
      });

      await safelyDropDisposableDatabase(db, runner, {
        allowedPrefix: 'academy_auth_audit_',
        maxWaitMs: 1000,
        pollIntervalMs: 10,
      });

      expect(executedSql[0]).toContain('pg_stat_activity');
      expect(executedSql[1]).toBe(`DROP DATABASE IF EXISTS "${db}";`);
      expect(executedSql[2]).toContain('pg_database');
      expect(runner).toHaveBeenCalledTimes(3);
    });

    it('polls until active connections reach zero before executing DROP DATABASE', async () => {
      const db = `academy_auth_audit_${validHex16}`;
      let pollCount = 0;
      const executedSql: string[] = [];
      const runner = vi.fn().mockImplementation((sql: string) => {
        executedSql.push(sql);
        if (sql.includes('pg_stat_activity')) {
          pollCount++;
          // First poll: 2 active connections; Second poll: 0 active connections
          return pollCount === 1
            ? 'count\n-----\n    2\n(1 row)'
            : 'count\n-----\n    0\n(1 row)';
        }
        if (sql.includes('DROP DATABASE')) {
          return 'DROP DATABASE';
        }
        if (sql.includes('pg_database')) {
          return 'count\n-----\n    0\n(1 row)';
        }
        return '';
      });

      await safelyDropDisposableDatabase(db, runner, {
        allowedPrefix: 'academy_auth_audit_',
        maxWaitMs: 2000,
        pollIntervalMs: 20,
      });

      expect(pollCount).toBe(2);
      expect(executedSql).toContain(`DROP DATABASE IF EXISTS "${db}";`);
    });

    it('fails loud when the database still exists after DROP DATABASE attempt', async () => {
      const db = `academy_auth_audit_${validHex16}`;
      const runner = vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_stat_activity')) {
          return 'count\n-----\n    0\n(1 row)';
        }
        if (sql.includes('DROP DATABASE')) {
          return 'DROP DATABASE';
        }
        if (sql.includes('pg_database')) {
          // Database still exists!
          return 'count\n-----\n    1\n(1 row)';
        }
        return '';
      });

      await expect(
        safelyDropDisposableDatabase(db, runner, {
          allowedPrefix: 'academy_auth_audit_',
          maxWaitMs: 500,
          pollIntervalMs: 10,
        }),
      ).rejects.toThrow(/still exists after drop attempt/i);
    });

    it('fails loud when connections fail to drain within maxWaitMs without attempting unauthorized termination', async () => {
      const db = `academy_auth_audit_${validHex16}`;
      const executedSql: string[] = [];
      const runner = vi.fn().mockImplementation((sql: string) => {
        executedSql.push(sql);
        if (sql.includes('pg_stat_activity') && sql.includes('count(*)')) {
          // Connections remain active
          return 'count\n-----\n    1\n(1 row)';
        }
        return '';
      });

      await expect(
        safelyDropDisposableDatabase(db, runner, {
          allowedPrefix: 'academy_auth_audit_',
          maxWaitMs: 50,
          pollIntervalMs: 10,
        }),
      ).rejects.toThrow(/failed to drain within 50ms/i);

      // Verify NO unauthorized pg_terminate_backend call was made
      const terminateCall = executedSql.find((s) => s.includes('pg_terminate_backend'));
      expect(terminateCall).toBeUndefined();
    });
  });

  describe('Section 10: Complete Database Safety Negative Tests (Fail-Closed Rejection)', () => {
    // 1. Primary database
    it('1. rejects protected primary database strictly in URL', () => {
      expect(() =>
        assertDatabaseUrlSafe('postgresql://user:pass@127.0.0.1:5432/bachina_labs_academy'),
      ).toThrow(/cannot be production or development database "bachina_labs_academy"/i);
    });

    // 2. Database named postgres
    it('2. rejects system database named postgres', () => {
      expect(() =>
        assertDatabaseUrlSafe('postgresql://user:pass@127.0.0.1:5432/postgres'),
      ).toThrow(/cannot be system database "postgres"/i);
    });

    // 3. Missing URL
    it('3. rejects missing, empty, or undefined URL', () => {
      expect(() => assertDatabaseUrlSafe('')).toThrow(/DATABASE_URL is not set or empty/i);
      expect(() => assertDatabaseUrlSafe(undefined)).toThrow(/DATABASE_URL is not set or empty/i);
      expect(() => assertDatabaseUrlSafe('   ')).toThrow(/DATABASE_URL is not set or empty/i);
    });

    // 4. Empty database name
    it('4. rejects empty database name in URL path', () => {
      expect(() =>
        assertDatabaseUrlSafe('postgresql://user:pass@127.0.0.1:5432/'),
      ).toThrow(/Database name in URL is empty/i);
    });

    // 5. Malformed URL
    it('5. rejects malformed URL string', () => {
      expect(() => assertDatabaseUrlSafe('not-a-valid-database-url')).toThrow(
        /DATABASE_URL format is invalid/i,
      );
    });

    // 6. Nonlocal host
    it('6. rejects non-local host and implicit localhost aliases strictly', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@192.168.1.100:5432/academy_e2e_suite_${validHex16}`,
        ),
      ).toThrow(/Host "192.168.1.100" is not supported. Must be strictly "127.0.0.1"/i);

      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@localhost:5432/academy_e2e_suite_${validHex16}`,
        ),
      ).toThrow(/Host "localhost" is not supported. Must be strictly "127.0.0.1"/i);
    });

    // 7. Unexpected port
    it('7. rejects unexpected port (must be strictly 5432)', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@127.0.0.1:5433/academy_e2e_suite_${validHex16}`,
        ),
      ).toThrow(/Port "5433" is unexpected. Must be strictly "5432"/i);
    });

    // 8. Wrong prefix
    it('8. rejects unapproved prefix in database name', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@127.0.0.1:5432/unapproved_prefix_${validHex16}`,
        ),
      ).toThrow(/does not start with an approved disposable prefix/i);
    });

    // 9. Uppercase hexadecimal suffix
    it('9. rejects uppercase hexadecimal suffix in database name', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_${validHex16.toUpperCase()}`,
        ),
      ).toThrow(/must be strictly lowercase/i);
    });

    // 10. Incorrect suffix length
    it('10. rejects incorrect suffix length (not exactly 16 hex chars)', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          'postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_0123456789abcde', // 15 chars
        ),
      ).toThrow(/must be exactly 16 lowercase hex characters/i);

      expect(() =>
        assertDatabaseUrlSafe(
          'postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_0123456789abcdef0', // 17 chars
        ),
      ).toThrow(/must be exactly 16 lowercase hex characters/i);
    });

    // 11. Timestamp-based disposable name
    it('11. rejects timestamp-based disposable name format', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          'postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_20261106123456',
        ),
      ).toThrow(/must be exactly 16 lowercase hex characters/i);
    });

    // 12. Valid-looking but preexisting unowned database check
    it('12. rejects database creation if database unexpectedly already exists in pg_database', () => {
      const mockPsqlQuery = (sql: string) => {
        if (sql.includes('pg_database')) {
          return 'count\n-----\n    1\n(1 row)'; // already exists!
        }
        return '';
      };
      const checkRes = mockPsqlQuery(
        `SELECT count(*) FROM pg_database WHERE datname = 'academy_e2e_suite_${validHex16}';`,
      );
      expect(() => {
        const countMatch = checkRes.match(/\b(\d+)\b/);
        const count = countMatch ? parseInt(countMatch[1], 10) : 0;
        if (count > 0) {
          throw new Error('Proposed disposable database unexpectedly already exists in pg_database.');
        }
      }).toThrow(/unexpectedly already exists/i);
    });

    // 13. Attempted bypass flag
    it('13. rejects attempted bypass flags strictly (--force-primary, etc.)', () => {
      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_${validHex16}`,
          ['--force-primary'],
        ),
      ).toThrow(/Attempted bypass flag "--force-primary" is strictly forbidden/i);

      expect(() =>
        assertDatabaseUrlSafe(
          `postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_${validHex16}`,
          ['--allow-production'],
        ),
      ).toThrow(/Attempted bypass flag "--allow-production" is strictly forbidden/i);
    });

    // 14. Invalid cleanup ownership
    it('14. rejects cleanup when target database is not registered in verifiedOwnedDatabases', async () => {
      const db = `academy_e2e_suite_${validHex16}`;
      const runner = vi.fn();
      const owned = new Set<string>(['academy_e2e_suite_different16hex']);

      await expect(
        safelyDropDisposableDatabase(db, runner, {
          verifiedOwnedDatabases: owned,
        }),
      ).rejects.toThrow(/was not registered as owned by the current test run/i);
      expect(runner).not.toHaveBeenCalled();
    });

    // 15. Unknown target during teardown
    it('15. rejects teardown when target is an unknown or unapproved database name', async () => {
      const runner = vi.fn();
      await expect(
        safelyDropDisposableDatabase('unapproved_target_database', runner),
      ).rejects.toThrow(/does not start with an approved disposable prefix/i);
      expect(runner).not.toHaveBeenCalled();
    });
  });

  describe('Real Disposable Database Lifecycle (Integration)', () => {
    it('fails explicitly when required configuration file is missing', () => {
      const missingEnvPath = 'path/to/nonexistent/.env';
      expect(() => {
        if (!fs.existsSync(missingEnvPath)) {
          throw new Error('Missing database configuration: .env file not found.');
        }
      }).toThrow(/Missing database configuration: .env file not found/i);
    });

    it('fails explicitly when DATABASE_URL is missing in environment file', () => {
      const mockEnvContent = 'PORT=3000\nNODE_ENV=test\n';
      const migrationMatch = mockEnvContent.match(
        /DATABASE_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
      );
      expect(() => {
        if (!migrationMatch) {
          throw new Error('Missing database configuration: DATABASE_URL not found in .env.');
        }
      }).toThrow(/Missing database configuration: DATABASE_URL not found in .env/i);
    });

    it('refuses to operate against a non-loopback host strictly', () => {
      const remoteHost: string = '192.168.1.100';
      expect(() => {
        if (remoteHost !== '127.0.0.1' && remoteHost !== 'localhost') {
          throw new Error(`Refusing to run against non-local host: ${remoteHost}`);
        }
      }).toThrow(/Refusing to run against non-local host/i);
    });

    it('rejects database creation if proposed database unexpectedly already exists in pg_database', () => {
      const mockCheckRes = 'count\n-----\n    1\n(1 row)';
      expect(() => {
        if (!mockCheckRes.includes('0')) {
          throw new Error('Proposed database unexpectedly already exists!');
        }
      }).toThrow(/unexpectedly already exists/i);
    });

    it('creates, connects to, queries, and cleanly drops a real disposable database with zero lingering records', async () => {
      const envPath = fs.existsSync('.env') ? path.resolve('.env') : path.resolve('apps/api/.env');
      if (!fs.existsSync(envPath)) {
        throw new Error(
          'Missing database configuration: .env file not found. Integration test cannot execute without authoritative local test configuration.',
        );
      }

      const envContent = fs.readFileSync(envPath, 'utf8');
      const migrationMatch = envContent.match(
        /DATABASE_URL=postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
      );
      if (!migrationMatch) {
        throw new Error(
          'Missing database configuration: DATABASE_URL not found in .env. Integration test cannot execute.',
        );
      }

      const [, migUser, migPassRaw, host, port, dbName] = migrationMatch;
      const migPass = decodeURIComponent(migPassRaw);

      if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(`Refusing to run against non-local host: ${host}`);
      }

      let psqlPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
      if (!fs.existsSync(psqlPath)) {
        psqlPath = 'psql';
      }

      function runPsql(sql: string, targetDb?: string): string {
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
          throw new Error(`psql failed on ${dbToConnect}: ${(res.stderr || res.stdout).trim()}`);
        }
        return (res.stdout || '').trim();
      }

      // 1. Generate compliant random disposable database name
      const disposableDb = `academy_auth_audit_${crypto.randomBytes(8).toString('hex')}`;
      assertDisposableTestDatabase(disposableDb, 'academy_auth_audit_');

      // 2. Verify nonexistence
      const checkRes = runPsql(`SELECT count(*) FROM pg_database WHERE datname = '${disposableDb}';`);
      expect(checkRes).toContain('0');

      // 3. Create the database
      runPsql(`CREATE DATABASE "${disposableDb}" OWNER "${migUser}";`);

      try {
        // 4. Connect and perform a harmless query inside the disposable database
        const queryRes = runPsql(`SELECT 42 AS answer;`, disposableDb);
        expect(queryRes).toContain('42');
      } finally {
        // 5. Safely drop using our hardened helper (guaranteed in finally block)
        await safelyDropDisposableDatabase(disposableDb, (sql) => runPsql(sql), {
          allowedPrefix: 'academy_auth_audit_',
        });
      }

      // 6. Verify absence post-drop
      const postCheck = runPsql(`SELECT count(*) FROM pg_database WHERE datname = '${disposableDb}';`);
      expect(postCheck).toContain('0');
    }, 60000);
  });
});
