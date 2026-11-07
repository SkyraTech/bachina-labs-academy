import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service.js';
import { ArticleCommentsRepository } from '../repositories/article-comments.repository.js';

export const APPROVED_DISPOSABLE_PREFIXES = [
  'academy_auth_audit_',
  'academy_e2e_suite_',
  'academy_audit_',
];

@Injectable()
export class ModerationCleanupService {
  private readonly logger = new Logger(ModerationCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ArticleCommentsRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Asserts that the current database target is authorized for cleanup maintenance.
   * Explicitly rejects protected primary database 'bachina_labs_academy'.
   */
  assertTargetDatabaseSafe(): void {
    const dbUrl = this.configService.get<string>('DATABASE_URL') || process.env.DATABASE_URL || '';
    if (!dbUrl) {
      throw new Error('Database URL is not defined.');
    }

    const match = dbUrl.match(/postgresql:\/\/[^:]+:[^@]+@([^:]+):(\d+)\/([^?]+)/);
    if (!match) {
      throw new Error('Database URL format is invalid or malformed.');
    }

    const [, host, _port, dbName] = match;
    const normalizedDb = dbName.trim().toLowerCase();

    if (normalizedDb === 'bachina_labs_academy') {
      throw new Error(
        'Refusing to run cleanup against protected primary database "bachina_labs_academy". Direct cleanup of primary is forbidden in local development checkpoints.',
      );
    }

    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Refusing to run cleanup against non-local host: ${host}`);
    }

    const matchesAllowlist = APPROVED_DISPOSABLE_PREFIXES.some((prefix) =>
      normalizedDb.startsWith(prefix),
    );

    if (!matchesAllowlist) {
      throw new Error(
        `Database "${normalizedDb}" does not match approved disposable prefixes: ${APPROVED_DISPOSABLE_PREFIXES.join(', ')}`,
      );
    }
  }

  async runCleanup(options: {
    batchSize?: number;
    dryRun?: boolean;
  } = {}): Promise<{ scrubbedCount: number; dryRun: boolean }> {
    this.assertTargetDatabaseSafe();

    const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? 100));
    const dryRun = options.dryRun ?? false;

    if (dryRun) {
      const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM article_comments
        WHERE status = 'REMOVED'
          AND removed_at <= NOW() - INTERVAL '30 days'
          AND body != '';
      `;
      const count = rows[0]?.count ?? 0;
      this.logger.log(`[Dry Run] Found ${count} expired moderated comments eligible for body scrubbing.`);
      return { scrubbedCount: count, dryRun: true };
    }

    let totalScrubbed = 0;
    let batchCount = 0;

    do {
      batchCount = await this.repository.transaction(async (tx) => {
        return this.repository.scrubExpiredBatch(batchSize, tx);
      });
      totalScrubbed += batchCount;
    } while (batchCount === batchSize);

    this.logger.log(`[Cleanup Complete] Successfully scrubbed bodies for ${totalScrubbed} expired comments.`);
    return { scrubbedCount: totalScrubbed, dryRun: false };
  }
}
