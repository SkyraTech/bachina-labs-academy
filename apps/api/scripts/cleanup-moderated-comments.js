import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

export const APPROVED_PATTERNS = [
  /^academy_auth_audit_[0-9a-f]{16}$/,
  /^academy_e2e_suite_[0-9a-f]{16}$/,
  /^academy_audit_[0-9a-f]{16}$/,
];

export function assertDatabaseSafe(
  dbUrl = process.env.DATABASE_URL,
  argv = process.argv.slice(2),
) {
  // 1. Strictly forbid any attempted bypass flags
  const FORBIDDEN_FLAGS = [
    '--force-primary',
    '--allow-production',
    '--ignore-database-check',
    '--bypass',
    '--force',
  ];
  for (const arg of argv) {
    if (FORBIDDEN_FLAGS.some((f) => arg === f || arg.startsWith(`${f}=`))) {
      throw new Error(`Target rejection: Attempted bypass flag "${arg}" is strictly forbidden.`);
    }
  }

  // 2. Reject missing or empty DATABASE_URL
  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    throw new Error('Database URL rejection: DATABASE_URL is not set or empty.');
  }

  // 3. Reject malformed URLs
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error('Database URL rejection: DATABASE_URL format is invalid.');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Database URL rejection: Protocol must be postgresql.');
  }

  // 4. Host must be strictly 127.0.0.1 (reject localhost aliases, remote hosts)
  const host = parsed.hostname;
  if (host !== '127.0.0.1') {
    throw new Error(
      `Database URL rejection: Host "${host}" is not supported. Must be strictly "127.0.0.1" (no implicit localhost aliases).`,
    );
  }

  // 5. Port must be strictly 5432
  const port = parsed.port;
  if (port !== '5432') {
    throw new Error(`Database URL rejection: Port "${port}" is unexpected. Must be strictly "5432".`);
  }

  // 6. Database name validation
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName || dbName.trim() === '') {
    throw new Error('Database URL rejection: Database name in URL is empty.');
  }

  const normalizedDb = dbName.trim().toLowerCase();

  if (normalizedDb === 'bachina_labs_academy') {
    throw new Error(
      'Target rejection: Refusing to run cleanup against protected primary database "bachina_labs_academy". Direct cleanup of primary is forbidden in local development.',
    );
  }

  if (['postgres', 'template0', 'template1'].includes(normalizedDb)) {
    throw new Error(`Target rejection: Target database cannot be system database "${normalizedDb}".`);
  }

  if (dbName !== dbName.trim() || dbName !== dbName.toLowerCase()) {
    throw new Error(
      `Database name "${dbName}" must be strictly lowercase without leading or trailing whitespace.`,
    );
  }

  const isApproved = APPROVED_PATTERNS.some((pat) => pat.test(normalizedDb));
  if (!isApproved) {
    throw new Error(
      `Target rejection: Database "${normalizedDb}" does not match approved disposable patterns: ^academy_auth_audit_[0-9a-f]{16}$, ^academy_e2e_suite_[0-9a-f]{16}$, ^academy_audit_[0-9a-f]{16}$`,
    );
  }

  return { host, port, dbName: normalizedDb };
}

async function main() {
  assertDatabaseSafe();

  const isDryRun = process.argv.includes('--dry-run');
  const batchArg = process.argv.find((a) => a.startsWith('--batch-size='));
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 100;

  const prisma = new PrismaClient();

  try {
    if (isDryRun) {
      const rows = await prisma.$queryRaw`
        SELECT count(*)::int AS count
        FROM article_comments
        WHERE status = 'REMOVED'
          AND removed_at <= NOW() - INTERVAL '30 days'
          AND body != '';
      `;
      const count = rows[0]?.count ?? 0;
      console.log(`[Dry Run] Found ${count} expired comments eligible for body scrubbing.`);
      return;
    }

    let totalScrubbed = 0;
    let batchCount = 0;

    do {
      const expiredRows = await prisma.$queryRaw`
        SELECT id FROM article_comments
        WHERE status = 'REMOVED'
          AND removed_at <= NOW() - INTERVAL '30 days'
          AND body != ''
        ORDER BY removed_at ASC, id ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED;
      `;

      if (expiredRows.length === 0) {
        break;
      }

      const ids = expiredRows.map((r) => r.id);
      await prisma.articleComment.updateMany({
        where: { id: { in: ids } },
        data: {
          body: '',
          updatedAt: new Date(),
        },
      });

      batchCount = ids.length;
      totalScrubbed += batchCount;
    } while (batchCount === batchSize);

    console.log(`[Cleanup Complete] Successfully scrubbed ${totalScrubbed} expired comment bodies.`);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch((err) => {
    console.error('[Cleanup Error]:', err.message);
    process.exit(1);
  });
}

