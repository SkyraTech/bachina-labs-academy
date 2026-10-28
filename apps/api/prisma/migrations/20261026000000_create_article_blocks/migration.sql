-- Migration: 20261026000000_create_article_blocks
-- Article Module: Stage 3 — Article Blocks Table
-- Authority: academy_dev_user

-- CreateEnum
CREATE TYPE "ArticleBlockType" AS ENUM (
    'HEADING',
    'RICH_TEXT',
    'IMAGE',
    'VIDEO',
    'CODE',
    'QUOTE',
    'CALLOUT',
    'TABLE',
    'DIVIDER',
    'LINK_CARD'
);

-- CreateTable
CREATE TABLE "article_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "type" "ArticleBlockType" NOT NULL,
    "position" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "media_asset_id" UUID,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_blocks_pkey" PRIMARY KEY ("id")
);

-- CheckConstraints
ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_position"
    CHECK ("position" >= 0);

ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_content_object"
    CHECK (jsonb_typeof("content") = 'object');

ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_content_size"
    CHECK (octet_length("content"::text) <= 65536);

ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_image_media"
    CHECK (("type" = 'IMAGE' AND "media_asset_id" IS NOT NULL) OR ("type" <> 'IMAGE' AND "media_asset_id" IS NULL));

ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_schema_version"
    CHECK ("schema_version" >= 1);

-- UniqueConstraint (Deferrable for transactional block reordering)
ALTER TABLE "article_blocks" ADD CONSTRAINT "article_blocks_article_id_position_key"
    UNIQUE ("article_id", "position") DEFERRABLE INITIALLY IMMEDIATE;

-- CreateIndex
CREATE INDEX "article_blocks_article_id_idx" ON "article_blocks"("article_id");

-- CreateIndex
CREATE INDEX "article_blocks_media_asset_id_idx" ON "article_blocks"("media_asset_id");

-- AddForeignKey
ALTER TABLE "article_blocks" ADD CONSTRAINT "article_blocks_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "article_blocks" ADD CONSTRAINT "article_blocks_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Runtime role permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "article_blocks" TO academy_app;
