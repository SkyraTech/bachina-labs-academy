/**
 * Test Database Isolation Guard
 * Enforces strict fail-closed validation and reliable teardown of disposable database targets.
 */

export const APPROVED_DISPOSABLE_PREFIXES = [
  'academy_auth_audit_',
  'academy_e2e_suite_',
  'academy_audit_',
] as const;

export const APPROVED_DISPOSABLE_PATTERNS = [
  /^academy_auth_audit_[0-9a-f]{16}$/,
  /^academy_e2e_suite_[0-9a-f]{16}$/,
  /^academy_audit_[0-9a-f]{16}$/,
] as const;

export function assertDisposableTestDatabase(
  targetDb: string | undefined | null,
  allowedPrefix?: string,
): void {
  if (!targetDb || typeof targetDb !== 'string' || targetDb.trim() === '') {
    throw new Error('Test database rejection: database name is empty or undefined.');
  }

  const normalized = targetDb.trim().toLowerCase();
  if (normalized === 'bachina_labs_academy') {
    throw new Error(
      'Test database rejection: target database cannot be production or development database "bachina_labs_academy".',
    );
  }
  if (['postgres', 'template0', 'template1'].includes(normalized)) {
    throw new Error(`Test database rejection: target database cannot be system database "${normalized}".`);
  }

  // Reject leading/trailing whitespace or uppercase characters strictly
  if (targetDb !== targetDb.trim() || targetDb !== targetDb.toLowerCase()) {
    throw new Error(
      `Test database rejection: database "${targetDb}" must be strictly lowercase without leading or trailing whitespace.`,
    );
  }

  const validPrefixes = allowedPrefix
    ? [allowedPrefix]
    : ['academy_auth_audit_', 'academy_e2e_suite_', 'academy_audit_'];

  const matchedPrefix = validPrefixes.find((p) => normalized.startsWith(p));
  if (!matchedPrefix) {
    throw new Error(
      `Test database rejection: database "${normalized}" does not start with an approved disposable prefix: ${validPrefixes.join(', ')}.`,
    );
  }

  const suffix = normalized.slice(matchedPrefix.length);
  // Strict 16 lowercase hex characters contract
  if (!/^[0-9a-f]{16}$/.test(suffix)) {
    throw new Error(
      `Test database rejection: database "${normalized}" does not have a valid collision-resistant hex suffix (must be exactly 16 lowercase hex characters).`,
    );
  }
}

export function assertDatabaseUrlSafe(
  dbUrl: string | undefined | null,
  argv: string[] = [],
): { host: string; port: string; dbName: string } {
  // 1. Rejection of attempted bypass flags
  const FORBIDDEN_FLAGS = [
    '--force-primary',
    '--allow-production',
    '--ignore-database-check',
    '--bypass',
    '--force',
  ];
  for (const flag of argv) {
    if (FORBIDDEN_FLAGS.some((f) => flag === f || flag.startsWith(`${f}=`))) {
      throw new Error(`Target rejection: Attempted bypass flag "${flag}" is strictly forbidden.`);
    }
  }

  // 2. Missing or empty URL
  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    throw new Error('Database URL rejection: DATABASE_URL is not set or empty.');
  }

  // 3. Malformed URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(dbUrl);
  } catch {
    throw new Error('Database URL rejection: DATABASE_URL format is invalid.');
  }

  if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
    throw new Error('Database URL rejection: Protocol must be postgresql.');
  }

  // 4. Host must be strictly 127.0.0.1 (no localhost aliases, no remote)
  const host = parsedUrl.hostname;
  if (host !== '127.0.0.1') {
    throw new Error(
      `Database URL rejection: Host "${host}" is not supported. Must be strictly "127.0.0.1" (no implicit localhost aliases).`,
    );
  }

  // 5. Port must be strictly 5432
  const port = parsedUrl.port;
  if (port !== '5432') {
    throw new Error(`Database URL rejection: Port "${port}" is unexpected. Must be strictly "5432".`);
  }

  // 6. Database name
  const pathname = parsedUrl.pathname.replace(/^\//, '');
  if (!pathname || pathname.trim() === '') {
    throw new Error('Database URL rejection: Database name in URL is empty.');
  }

  // Validate database name against strict disposable rules
  assertDisposableTestDatabase(pathname);

  return { host, port, dbName: pathname };
}

/**
 * Safely drops an owned disposable test database with connection draining and fail-loud guarantees.
 *
 * Sequence:
 * 1. Validates disposable database name identity.
 * 2. Checks current-run database ownership if verifiedOwnedDatabases is supplied.
 * 3. Waits for active connections to drain naturally up to maxWaitMs.
 * 4. Drops the database cleanly without unconditional WITH (FORCE) or backend termination.
 * 5. Verifies absolute post-drop absence in pg_database; fails loud if still present.
 */
export async function safelyDropDisposableDatabase(
  dbName: string,
  runPsql: (sql: string, targetDb?: string) => string | Promise<string>,
  options: {
    allowedPrefix?: string;
    maxWaitMs?: number;
    pollIntervalMs?: number;
    verifiedOwnedDatabases?: Set<string>;
  } = {},
): Promise<void> {
  assertDisposableTestDatabase(dbName, options.allowedPrefix);

  if (options.verifiedOwnedDatabases && !options.verifiedOwnedDatabases.has(dbName)) {
    throw new Error(
      `Cleanup ownership rejection: database "${dbName}" was not registered as owned by the current test run.`,
    );
  }

  const maxWaitMs = options.maxWaitMs ?? 5000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const startTime = Date.now();

  // 1. Wait for active connections to drain
  let remaining = -1;
  while (Date.now() - startTime < maxWaitMs) {
    const activeRes = await runPsql(
      `SELECT count(*) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid();`,
    );
    const countMatch = String(activeRes).match(/\b(\d+)\b/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    remaining = count;
    if (count === 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (remaining > 0) {
    // Fail loud immediately without attempting unauthorized cross-role process termination
    throw new Error(
      `Fail-loud cleanup error: connections to disposable database "${dbName}" failed to drain within ${maxWaitMs}ms (${remaining} active connections remaining).`,
    );
  }

  // 2. Drop the verified disposable database cleanly without WITH (FORCE)
  await runPsql(`DROP DATABASE IF EXISTS "${dbName}";`);

  // 3. Fail-loud verification: ensure database is confirmed absent
  const checkRes = await runPsql(
    `SELECT count(*) FROM pg_database WHERE datname = '${dbName}';`,
  );
  const checkMatch = String(checkRes).match(/\b(\d+)\b/);
  const stillExists = checkMatch ? parseInt(checkMatch[1], 10) : 0;
  if (stillExists !== 0) {
    throw new Error(
      `Fail-loud cleanup error: disposable database "${dbName}" still exists after drop attempt.`,
    );
  }
}
