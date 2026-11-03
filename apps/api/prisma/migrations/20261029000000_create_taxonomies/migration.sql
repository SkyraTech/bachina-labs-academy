-- Migration: 20261029000000_create_taxonomies
-- Taxonomy Module: Categories, Tags, and ArticleTaxonomy Associations
-- Authority: academy_dev_user

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CheckConstraints for categories
ALTER TABLE "categories" ADD CONSTRAINT "chk_categories_name_length"
    CHECK (char_length(trim("name")) >= 2 AND char_length("name") <= 120);

ALTER TABLE "categories" ADD CONSTRAINT "chk_categories_slug_format"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") >= 2 AND char_length("slug") <= 160);

ALTER TABLE "categories" ADD CONSTRAINT "chk_categories_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 500);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX "categories_slug_lower_key" ON "categories"(LOWER("slug"));
CREATE INDEX "categories_created_at_idx" ON "categories"("created_at" DESC);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CheckConstraints for tags
ALTER TABLE "tags" ADD CONSTRAINT "chk_tags_name_length"
    CHECK (char_length(trim("name")) >= 2 AND char_length("name") <= 80);

ALTER TABLE "tags" ADD CONSTRAINT "chk_tags_slug_format"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") >= 2 AND char_length("slug") <= 120);

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");
CREATE UNIQUE INDEX "tags_slug_lower_key" ON "tags"(LOWER("slug"));
CREATE INDEX "tags_created_at_idx" ON "tags"("created_at" DESC);

-- AlterTable articles: add nullable category_id
ALTER TABLE "articles" ADD COLUMN "category_id" UUID;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex on articles
CREATE INDEX "articles_category_id_idx" ON "articles"("category_id");
CREATE INDEX "articles_status_category_id_published_at_idx" ON "articles"("status", "category_id", "published_at" DESC);

-- CreateTable article_tags
CREATE TABLE "article_tags" (
    "article_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_id", "tag_id")
);

-- CreateIndex on article_tags
CREATE INDEX "article_tags_tag_id_article_id_idx" ON "article_tags"("tag_id", "article_id");

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Runtime role permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "categories" TO academy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tags" TO academy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "article_tags" TO academy_app;

