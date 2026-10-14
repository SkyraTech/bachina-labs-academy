-- Migration: 20261014052015_create_users
-- Phase 2.2.1 — First business migration: users table, enums, and indexes.
--
-- Email uniqueness strategy:
--   Prisma generates users_email_key (standard B-tree, case-sensitive).
--   A separate expression index on LOWER(email) enforces case-insensitive
--   uniqueness at the database level. Both constraints coexist safely.
--   Application code MUST normalize email to lowercase at the input boundary
--   before every INSERT and SELECT to guarantee consistent behaviour.
--
-- UUID strategy:
--   gen_random_uuid() is built into PostgreSQL 13+ (pgcrypto not required).
--   Prisma's @default(uuid()) maps to this function for PostgreSQL.
--
-- Timestamps:
--   TIMESTAMPTZ(6) — UTC-anchored with microsecond precision.
--   updated_at has no DEFAULT here; it is maintained by Prisma's @updatedAt
--   which sets the value on every write through the Prisma Client.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AUTHOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'AUTHOR',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: standard case-sensitive unique constraint (Prisma @unique)
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex: supporting index on email for fast lookups
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex: case-insensitive unique expression index
-- This is the primary uniqueness guard for email registration and login.
-- It prevents 'Alice@Example.com' and 'alice@example.com' from coexisting.
-- This index cannot be expressed in Prisma schema and must be maintained here.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users"(LOWER("email"));
