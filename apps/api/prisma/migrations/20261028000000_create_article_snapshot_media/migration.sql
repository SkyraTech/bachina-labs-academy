-- Migration: 20261028000000_create_article_snapshot_media
-- Article Module: Stage 5 — Snapshot Media Retention Junction Table
-- Authority: academy_dev_user

-- CreateTable
CREATE TABLE "article_snapshot_media" (
    "snapshot_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,

    CONSTRAINT "article_snapshot_media_pkey" PRIMARY KEY ("snapshot_id", "media_asset_id")
);

-- CreateIndex
CREATE INDEX "article_snapshot_media_media_asset_id_idx" ON "article_snapshot_media"("media_asset_id");

-- AddForeignKey
ALTER TABLE "article_snapshot_media" ADD CONSTRAINT "article_snapshot_media_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "article_snapshots"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_snapshot_media" ADD CONSTRAINT "article_snapshot_media_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Runtime role permissions (Immutable: SELECT and INSERT only, NO UPDATE or DELETE)
GRANT SELECT, INSERT ON TABLE "article_snapshot_media" TO academy_app;
