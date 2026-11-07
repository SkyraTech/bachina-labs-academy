-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('VISIBLE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ModerationReason" AS ENUM (
    'SPAM',
    'HARASSMENT',
    'HATE_SPEECH',
    'INAPPROPRIATE',
    'OFF_TOPIC',
    'POLICY_VIOLATION'
);

-- CreateTable: user_profiles
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: article_comments
CREATE TABLE "article_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_user_id" UUID,
    "removal_reason" "ModerationReason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: user_profiles
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex: article_comments
CREATE INDEX "idx_article_comments_article_status_created" ON "article_comments"("article_id", "status", "created_at" DESC);
CREATE INDEX "idx_article_comments_user_created" ON "article_comments"("user_id", "created_at" DESC);
CREATE INDEX "idx_article_comments_status_removed_at" ON "article_comments"("status", "removed_at");

-- AddForeignKey: user_profiles -> users
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: article_comments -> articles
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: article_comments -> article_snapshots (Composite Foreign Key)
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_snapshot_id_article_id_fkey"
    FOREIGN KEY ("snapshot_id", "article_id") REFERENCES "article_snapshots"("id", "article_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey: article_comments -> users (Author)
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: article_comments -> users (Moderator)
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_removed_by_user_id_fkey"
    FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- CheckConstraint: user_profiles display_name length
ALTER TABLE "user_profiles" ADD CONSTRAINT "chk_user_profiles_display_name_len"
    CHECK (char_length("display_name") >= 2 AND char_length("display_name") <= 50);

-- CheckConstraint: article_comments body length conditional on status
ALTER TABLE "article_comments" ADD CONSTRAINT "chk_article_comments_body_len"
    CHECK (char_length("body") <= 2000 AND ("status" = 'REMOVED' OR char_length("body") >= 1));


