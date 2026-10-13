/**
 * Database module (src/database/)
 *
 * This directory will contain:
 *   prisma.service.ts    — PrismaService wrapping PrismaClient (Phase 2)
 *   database.module.ts   — DatabaseModule exporting PrismaService globally (Phase 2)
 *
 * PrismaService will:
 *   - Extend PrismaClient
 *   - Implement OnModuleInit to connect on startup
 *   - Implement OnModuleDestroy to disconnect gracefully
 *   - Be exported from a global DatabaseModule
 *
 * One authoritative Prisma client in the app — never instantiate PrismaClient
 * directly in domain modules. Always inject PrismaService.
 *
 * Schema location: apps/api/prisma/schema.prisma
 * Generated client: apps/api/src/database/generated/
 */
export {};
