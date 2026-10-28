-- Migration: 20261027000000_create_article_snapshots
-- Article Module: Stage 4 — Article Snapshots Table
-- Authority: academy_dev_user

-- CreateTable
CREATE TABLE "article_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "snapshot_revision" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "published_slug" VARCHAR(280) NOT NULL,
    "summary" VARCHAR(500),
    "typography_preset" VARCHAR(50) NOT NULL,
    "cover_media_id" UUID,
    "blocks" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_snapshots_pkey" PRIMARY KEY ("id")
);

-- CheckConstraints
ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_snapshot_revision"
    CHECK ("snapshot_revision" >= 1);

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_title_length"
    CHECK (char_length(trim("title")) >= 3 AND char_length("title") <= 255);

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_published_slug_format"
    CHECK ("published_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("published_slug") >= 3 AND char_length("published_slug") <= 280);

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_typography_preset"
    CHECK ("typography_preset" IN ('MODERN_SANS', 'EDITORIAL_SERIF', 'TECHNICAL_MINIMAL'));

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_blocks_object"
    CHECK (jsonb_typeof("blocks") = 'object');

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_blocks_schema_version"
    CHECK (("blocks" ? 'schemaVersion') AND (("blocks"->>'schemaVersion') ~ '^[0-9]+$') AND (("blocks"->>'schemaVersion')::integer >= 1));

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_blocks_array"
    CHECK (("blocks" ? 'blocks') AND (jsonb_typeof("blocks"->'blocks') = 'array'));

ALTER TABLE "article_snapshots" ADD CONSTRAINT "chk_article_snapshots_blocks_size"
    CHECK (octet_length("blocks"::text) <= 1048576);

-- UniqueConstraints
ALTER TABLE "article_snapshots" ADD CONSTRAINT "article_snapshots_article_id_snapshot_revision_key"
    UNIQUE ("article_id", "snapshot_revision");

ALTER TABLE "article_snapshots" ADD CONSTRAINT "article_snapshots_id_article_id_key"
    UNIQUE ("id", "article_id");

-- CreateIndex
CREATE INDEX "article_snapshots_article_id_published_at_idx"
    ON "article_snapshots"("article_id", "published_at" DESC);

-- AddForeignKey (Article ownership: RESTRICT prevents deleting articles with historical snapshots)
ALTER TABLE "article_snapshots" ADD CONSTRAINT "article_snapshots_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddCompositeForeignKey (Composite current-snapshot pointer: guarantees current snapshot belongs to the exact article)
ALTER TABLE "articles" ADD CONSTRAINT "articles_current_snapshot_fkey"
    FOREIGN KEY ("current_snapshot_id", "id") REFERENCES "article_snapshots"("id", "article_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Runtime role permissions (Immutable: SELECT and INSERT only, NO UPDATE or DELETE)
GRANT SELECT, INSERT ON TABLE "article_snapshots" TO academy_app;
