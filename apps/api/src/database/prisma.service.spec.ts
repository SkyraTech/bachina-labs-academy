import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaService } from './prisma.service';

describe('PrismaService — Runtime Configuration & Security Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] =
      'postgresql://academy_dev_user:secret@localhost:5432/bachina_labs_academy?schema=public';
    process.env['DATABASE_RUNTIME_URL'] =
      'postgresql://academy_app:runtime_secret@localhost:5432/bachina_labs_academy?schema=public';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Constructor & Fail-Closed Configuration', () => {
    it('successfully instantiates when valid DATABASE_RUNTIME_URL is present', () => {
      const service = new PrismaService();
      expect(service).toBeDefined();
    });

    it('throws when DATABASE_RUNTIME_URL is missing', () => {
      delete process.env['DATABASE_RUNTIME_URL'];

      expect(() => new PrismaService()).toThrow(
        'DATABASE_RUNTIME_URL environment variable is required for application runtime but was not provided',
      );
    });

    it('throws when DATABASE_RUNTIME_URL is blank or whitespace', () => {
      process.env['DATABASE_RUNTIME_URL'] = '   ';

      expect(() => new PrismaService()).toThrow(
        'DATABASE_RUNTIME_URL environment variable is required for application runtime but was not provided',
      );
    });

    it('throws when DATABASE_RUNTIME_URL has an invalid protocol or malformed URI', () => {
      process.env['DATABASE_RUNTIME_URL'] = 'not-a-valid-url';

      expect(() => new PrismaService()).toThrow(
        'DATABASE_RUNTIME_URL is not a valid PostgreSQL connection URL',
      );

      process.env['DATABASE_RUNTIME_URL'] = 'http://localhost:5432/db';
      expect(() => new PrismaService()).toThrow(
        'DATABASE_RUNTIME_URL is not a valid PostgreSQL connection URL',
      );
    });

    it('does NOT fall back to DATABASE_URL when DATABASE_RUNTIME_URL is deleted', () => {
      delete process.env['DATABASE_RUNTIME_URL'];
      expect(process.env['DATABASE_URL']).toBeDefined();

      expect(() => new PrismaService()).toThrow(
        'Privileged fallback to DATABASE_URL is prohibited',
      );
    });
  });

  describe('verifyRuntimePrivileges() — Least-Privilege Active Enforcement', () => {
    it('accepts a valid restricted non-owner runtime role (academy_app)', async () => {
      const service = new PrismaService();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([
        {
          current_database: 'bachina_labs_academy',
          current_user: 'academy_app',
          is_superuser: false,
          can_create_role: false,
          can_create_db: false,
          owns_audit_logs: false,
          has_audit_update: false,
          has_audit_delete: false,
          has_audit_truncate: false,
          has_schema_create: false,
        },
      ]);

      await expect(service.verifyRuntimePrivileges()).resolves.toBeUndefined();
    });

    it('rejects a superuser runtime connection and disconnects', async () => {
      const service = new PrismaService();
      const disconnectSpy = vi.spyOn(service, '$disconnect').mockResolvedValue();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([
        {
          current_database: 'bachina_labs_academy',
          current_user: 'postgres',
          is_superuser: true,
          can_create_role: true,
          can_create_db: true,
          owns_audit_logs: false,
          has_audit_update: true,
          has_audit_delete: true,
          has_audit_truncate: true,
          has_schema_create: true,
        },
      ]);

      await expect(service.verifyRuntimePrivileges()).rejects.toThrow(
        'has SUPERUSER privileges. Expected restricted non-owner role',
      );
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects migration authority role (academy_dev_user) and disconnects', async () => {
      const service = new PrismaService();
      const disconnectSpy = vi.spyOn(service, '$disconnect').mockResolvedValue();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([
        {
          current_database: 'bachina_labs_academy',
          current_user: 'academy_dev_user',
          is_superuser: false,
          can_create_role: false,
          can_create_db: true,
          owns_audit_logs: true,
          has_audit_update: true,
          has_audit_delete: true,
          has_audit_truncate: true,
          has_schema_create: true,
        },
      ]);

      await expect(service.verifyRuntimePrivileges()).rejects.toThrow(
        'using the migration authority role (academy_dev_user)',
      );
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects a role that owns the audit_logs table', async () => {
      const service = new PrismaService();
      const disconnectSpy = vi.spyOn(service, '$disconnect').mockResolvedValue();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([
        {
          current_database: 'bachina_labs_academy',
          current_user: 'custom_owner',
          is_superuser: false,
          can_create_role: false,
          can_create_db: false,
          owns_audit_logs: true,
          has_audit_update: false,
          has_audit_delete: false,
          has_audit_truncate: false,
          has_schema_create: false,
        },
      ]);

      await expect(service.verifyRuntimePrivileges()).rejects.toThrow(
        'owns the audit_logs table. Must be a non-owner role',
      );
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects a role possessing prohibited UPDATE, DELETE, or TRUNCATE privileges on audit_logs', async () => {
      const service = new PrismaService();
      vi.spyOn(service, '$disconnect').mockResolvedValue();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([
        {
          current_database: 'bachina_labs_academy',
          current_user: 'rogue_app',
          is_superuser: false,
          can_create_role: false,
          can_create_db: false,
          owns_audit_logs: false,
          has_audit_update: true,
          has_audit_delete: false,
          has_audit_truncate: false,
          has_schema_create: false,
        },
      ]);

      await expect(service.verifyRuntimePrivileges()).rejects.toThrow(
        'possesses prohibited mutating privileges on audit_logs',
      );
    });

    it('rejects a role possessing CREATE privilege on public schema', async () => {
      const service = new PrismaService();
      vi.spyOn(service, '$disconnect').mockResolvedValue();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([
        {
          current_database: 'bachina_labs_academy',
          current_user: 'schema_admin_app',
          is_superuser: false,
          can_create_role: false,
          can_create_db: false,
          owns_audit_logs: false,
          has_audit_update: false,
          has_audit_delete: false,
          has_audit_truncate: false,
          has_schema_create: true,
        },
      ]);

      await expect(service.verifyRuntimePrivileges()).rejects.toThrow(
        'possesses prohibited CREATE privilege on public schema',
      );
    });

    it('throws when role metadata query returns empty', async () => {
      const service = new PrismaService();
      vi.spyOn(service, '$disconnect').mockResolvedValue();

      vi.spyOn(service, '$queryRaw').mockResolvedValue([]);

      await expect(service.verifyRuntimePrivileges()).rejects.toThrow(
        'could not resolve active PostgreSQL role metadata',
      );
    });
  });

  describe('isHealthy() Connectivity Check', () => {
    it('returns true when queryRaw SELECT 1 succeeds', async () => {
      const service = new PrismaService();
      vi.spyOn(service, '$queryRaw').mockResolvedValue([{ 1: 1 }]);

      const result = await service.isHealthy();
      expect(result).toBe(true);
    });

    it('returns false when queryRaw SELECT 1 fails', async () => {
      const service = new PrismaService();
      vi.spyOn(service, '$queryRaw').mockRejectedValue(new Error('Connection lost'));

      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });
});
