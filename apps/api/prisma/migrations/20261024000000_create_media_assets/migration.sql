-- Migration: 20261024000000_create_media_assets
-- Article Module: Stage 1 — Media Assets
-- Authority: academy_dev_user

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploader_id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "media_type" VARCHAR(50) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt_text" VARCHAR(255),
    "original_filename" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CheckConstraints
ALTER TABLE "media_assets" ADD CONSTRAINT "chk_media_assets_type"
    CHECK ("media_type" IN ('IMAGE'));

ALTER TABLE "media_assets" ADD CONSTRAINT "chk_media_assets_mime"
    CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE "media_assets" ADD CONSTRAINT "chk_media_assets_size"
    CHECK ("file_size" > 0 AND "file_size" <= 5242880);

ALTER TABLE "media_assets" ADD CONSTRAINT "chk_media_assets_dimensions"
    CHECK (
        ("width" IS NULL AND "height" IS NULL) OR
        ("width" IS NOT NULL AND "height" IS NOT NULL AND "width" > 0 AND "width" <= 16384 AND "height" > 0 AND "height" <= 16384)
    );

ALTER TABLE "media_assets" ADD CONSTRAINT "chk_media_assets_storage_key"
    CHECK (
        char_length("storage_key") >= 10 AND
        char_length("storage_key") <= 512 AND
        "storage_key" !~ '\.\.'
    );

ALTER TABLE "media_assets" ADD CONSTRAINT "chk_media_assets_original_filename"
    CHECK (char_length(trim("original_filename")) > 0);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_uploader_id_created_at_idx" ON "media_assets"("uploader_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_id_fkey"
    FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Runtime role permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "media_assets" TO academy_app;
