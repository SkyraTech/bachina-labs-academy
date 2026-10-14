-- Migration: 20261014052130_remove_server_uuid_default
-- Prisma manages UUID generation at the client layer via @default(uuid()).
-- The gen_random_uuid() DB default added in the initial migration SQL was
-- removed by Prisma to align with its client-side UUID injection strategy.
-- This is the expected and correct behaviour for Prisma 6.x + PostgreSQL.

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;
