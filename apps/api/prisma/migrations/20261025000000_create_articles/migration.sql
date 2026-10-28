-- Migration: 20261025000000_create_articles
-- Article Module: Stage 2 — Articles Table
-- Authority: academy_dev_user

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "author_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "draft_slug" VARCHAR(280) NOT NULL,
    "published_slug" VARCHAR(280),
    "summary" VARCHAR(500),
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "typography_preset" VARCHAR(50) NOT NULL DEFAULT 'MODERN_SANS',
    "cover_media_id" UUID,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "published_revision" INTEGER NOT NULL DEFAULT 0,
    "current_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CheckConstraints
ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_title_length"
    CHECK (char_length(trim("title")) >= 3 AND char_length("title") <= 255);

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_draft_slug_format"
    CHECK ("draft_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("draft_slug") >= 3 AND char_length("draft_slug") <= 280);

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_published_slug_format"
    CHECK ("published_slug" IS NULL OR ("published_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("published_slug") >= 3 AND char_length("published_slug") <= 280));

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_typography_preset"
    CHECK ("typography_preset" IN ('MODERN_SANS', 'EDITORIAL_SERIF', 'TECHNICAL_MINIMAL'));

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_draft_revision"
    CHECK ("draft_revision" >= 1);

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_published_revision"
    CHECK ("published_revision" >= 0);

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_revision_order"
    CHECK ("published_revision" <= "draft_revision");

ALTER TABLE "articles" ADD CONSTRAINT "chk_articles_publication_state"
    CHECK ("status" != 'PUBLISHED' OR ("published_slug" IS NOT NULL AND "published_at" IS NOT NULL AND "published_revision" >= 1));

-- CreateIndex
CREATE UNIQUE INDEX "articles_published_slug_key" ON "articles"("published_slug");

-- CreateIndex
CREATE INDEX "articles_author_id_created_at_idx" ON "articles"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "articles_draft_slug_idx" ON "articles"("draft_slug");

-- CreateIndex
CREATE INDEX "articles_status_published_at_idx" ON "articles"("status", "published_at" DESC);

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "articles" ADD CONSTRAINT "articles_cover_media_id_fkey"
    FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Runtime role permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "articles" TO academy_app;
