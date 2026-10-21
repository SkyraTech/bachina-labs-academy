import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — centralised Prisma Client for the application.
 *
 * Rules:
 *  - This is the ONLY place PrismaClient is instantiated.
 *  - Never instantiate PrismaClient directly in domain modules or controllers.
 *  - Always inject PrismaService via NestJS DI.
 *  - DatabaseModule exports this service globally — no per-module imports needed.
 *
 * Lifecycle:
 *  - OnModuleInit  → $connect()   (called once on app bootstrap)
 *  - OnModuleDestroy → $disconnect() (called on graceful shutdown)
 *
 * Generated client:           @prisma/client (node_modules)
 * Schema location:            prisma/schema.prisma
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const runtimeUrl = process.env['DATABASE_RUNTIME_URL'];
    if (!runtimeUrl || runtimeUrl.trim() === '') {
      throw new Error(
        'DATABASE_RUNTIME_URL environment variable is required for application runtime but was not provided. ' +
          'Privileged fallback to DATABASE_URL is prohibited.',
      );
    }

    try {
      const parsed = new URL(runtimeUrl);
      if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      throw new Error(
        'DATABASE_RUNTIME_URL is not a valid PostgreSQL connection URL.',
      );
    }

    super({
      datasources: { db: { url: runtimeUrl } },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Connecting to database with restricted runtime role...');
    await this.$connect();
    await this.verifyRuntimePrivileges();
  }

  /**
   * Verifies that the connected database role satisfies least-privilege constraints:
   * 1. Must not be superuser.
   * 2. Must not be migration authority (academy_dev_user).
   * 3. Must not own audit_logs table.
   * 4. Must not possess UPDATE, DELETE, or TRUNCATE privileges on audit_logs.
   * 5. Must not possess CREATE on public schema.
   */
  async verifyRuntimePrivileges(): Promise<void> {
    type PrivilegeRow = {
      current_database: string;
      current_user: string;
      is_superuser: boolean;
      can_create_role: boolean;
      can_create_db: boolean;
      owns_audit_logs: boolean | null;
      has_audit_update: boolean;
      has_audit_delete: boolean;
      has_audit_truncate: boolean;
      has_schema_create: boolean;
    };

    const rows = await this.$queryRaw<PrivilegeRow[]>`
      SELECT 
        current_database() AS current_database,
        current_user AS current_user,
        r.rolsuper AS is_superuser,
        r.rolcreaterole AS can_create_role,
        r.rolcreatedb AS can_create_db,
        (t.tableowner = current_user) AS owns_audit_logs,
        CASE WHEN to_regclass('public.audit_logs') IS NOT NULL 
             THEN has_table_privilege(current_user, 'public.audit_logs', 'UPDATE') 
             ELSE false END AS has_audit_update,
        CASE WHEN to_regclass('public.audit_logs') IS NOT NULL 
             THEN has_table_privilege(current_user, 'public.audit_logs', 'DELETE') 
             ELSE false END AS has_audit_delete,
        CASE WHEN to_regclass('public.audit_logs') IS NOT NULL 
             THEN has_table_privilege(current_user, 'public.audit_logs', 'TRUNCATE') 
             ELSE false END AS has_audit_truncate,
        has_schema_privilege(current_user, 'public', 'CREATE') AS has_schema_create
      FROM pg_roles r
      LEFT JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = 'audit_logs'
      WHERE r.rolname = current_user;
    `;

    const priv = rows[0];
    if (!priv) {
      await this.$disconnect();
      throw new Error(
        'Runtime database role verification failed: could not resolve active PostgreSQL role metadata.',
      );
    }

    if (priv.is_superuser) {
      await this.$disconnect();
      throw new Error(
        `Runtime database role (${priv.current_user}) has SUPERUSER privileges. Expected restricted non-owner role.`,
      );
    }

    if (priv.current_user === 'academy_dev_user') {
      await this.$disconnect();
      throw new Error(
        'Runtime database connection is using the migration authority role (academy_dev_user). Must use dedicated runtime role.',
      );
    }

    if (priv.owns_audit_logs === true) {
      await this.$disconnect();
      throw new Error(
        `Runtime database role (${priv.current_user}) owns the audit_logs table. Must be a non-owner role.`,
      );
    }

    if (priv.has_audit_update || priv.has_audit_delete || priv.has_audit_truncate) {
      await this.$disconnect();
      throw new Error(
        `Runtime database role (${priv.current_user}) possesses prohibited mutating privileges on audit_logs (UPDATE: ${priv.has_audit_update}, DELETE: ${priv.has_audit_delete}, TRUNCATE: ${priv.has_audit_truncate}). Append-only enforcement violated.`,
      );
    }

    if (priv.has_schema_create) {
      await this.$disconnect();
      throw new Error(
        `Runtime database role (${priv.current_user}) possesses prohibited CREATE privilege on public schema.`,
      );
    }

    this.logger.log(
      `Database connection established and verified (active role: ${priv.current_user}, db: ${priv.current_database}).`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting from database...');
    await this.$disconnect();
  }

  /**
   * Performs a raw `SELECT 1` to verify database connectivity.
   * Used by the database health check — does not expose connection details.
   * Returns true if reachable, false otherwise.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
