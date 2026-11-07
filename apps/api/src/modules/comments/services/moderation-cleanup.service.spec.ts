import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModerationCleanupService } from './moderation-cleanup.service.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { ArticleCommentsRepository } from '../repositories/article-comments.repository.js';
import type { ConfigService } from '@nestjs/config';

describe('ModerationCleanupService', () => {
  let service: ModerationCleanupService;
  let mockPrisma: any;
  let mockRepo: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn(),
    };
    mockRepo = {
      transaction: vi.fn(async (cb) => cb({})),
      scrubExpiredBatch: vi.fn(),
    };
    mockConfig = {
      get: vi.fn(),
    };
    service = new ModerationCleanupService(
      mockPrisma as unknown as PrismaService,
      mockRepo as unknown as ArticleCommentsRepository,
      mockConfig as unknown as ConfigService,
    );
  });

  describe('assertTargetDatabaseSafe', () => {
    it('throws error if target is protected primary database "bachina_labs_academy"', () => {
      mockConfig.get.mockReturnValue('postgresql://user:pass@127.0.0.1:5432/bachina_labs_academy');

      expect(() => service.assertTargetDatabaseSafe()).toThrowError(
        /Refusing to run cleanup against protected primary database "bachina_labs_academy"/,
      );
    });

    it('throws error if target does not match approved disposable prefix', () => {
      mockConfig.get.mockReturnValue('postgresql://user:pass@127.0.0.1:5432/some_random_db');

      expect(() => service.assertTargetDatabaseSafe()).toThrowError(
        /does not match approved disposable prefixes/,
      );
    });

    it('accepts approved disposable target prefix', () => {
      mockConfig.get.mockReturnValue('postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_1234567890abcdef');

      expect(() => service.assertTargetDatabaseSafe()).not.toThrow();
    });
  });

  describe('runCleanup', () => {
    it('runs dry run without modifying database rows', async () => {
      mockConfig.get.mockReturnValue('postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_1234567890abcdef');
      mockPrisma.$queryRaw.mockResolvedValue([{ count: 7 }]);

      const result = await service.runCleanup({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.scrubbedCount).toBe(7);
      expect(mockRepo.scrubExpiredBatch).not.toHaveBeenCalled();
    });

    it('executes bounded batch scrubbing until exhausted', async () => {
      mockConfig.get.mockReturnValue('postgresql://user:pass@127.0.0.1:5432/academy_e2e_suite_1234567890abcdef');
      // First batch returns 100 (full batch), second batch returns 25 (terminal batch)
      mockRepo.scrubExpiredBatch
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(25);

      const result = await service.runCleanup({ batchSize: 100, dryRun: false });

      expect(result.dryRun).toBe(false);
      expect(result.scrubbedCount).toBe(125);
      expect(mockRepo.scrubExpiredBatch).toHaveBeenCalledTimes(2);
    });
  });
});

