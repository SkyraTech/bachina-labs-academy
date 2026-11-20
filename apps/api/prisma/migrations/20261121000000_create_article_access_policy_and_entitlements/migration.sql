-- CreateEnum
CREATE TYPE "AccessPolicyTier" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "EntitlementType" AS ENUM ('PREMIUM_CONTENT', 'EARLY_ACCESS');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('SUBSCRIPTION', 'COMPLIMENTARY', 'MANUAL_OVERRIDE', 'PROMOTIONAL');

-- CreateTable
CREATE TABLE "article_access_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "tier" "AccessPolicyTier" NOT NULL DEFAULT 'FREE',
    "note" VARCHAR(255),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "article_access_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "entitlement_type" "EntitlementType" NOT NULL DEFAULT 'PREMIUM_CONTENT',
    "source" "EntitlementSource" NOT NULL DEFAULT 'COMPLIMENTARY',
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(100),
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entitlement_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "article_access_policies_article_id_key" ON "article_access_policies"("article_id");

-- CreateIndex
CREATE INDEX "article_access_policies_tier_idx" ON "article_access_policies"("tier");

-- CreateIndex
CREATE INDEX "entitlement_grants_user_validity_idx" ON "entitlement_grants"("user_id", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "entitlement_grants_user_revocation_idx" ON "entitlement_grants"("user_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "article_access_policies" ADD CONSTRAINT "article_access_policies_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_access_policies" ADD CONSTRAINT "article_access_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddCheckConstraint
ALTER TABLE "entitlement_grants"
    ADD CONSTRAINT "chk_entitlement_grants_validity_interval"
    CHECK ("valid_until" > "valid_from");

-- AddCheckConstraint
ALTER TABLE "entitlement_grants"
    ADD CONSTRAINT "chk_entitlement_grants_revocation_consistency"
    CHECK (
        ("revoked_at" IS NULL AND "revocation_reason" IS NULL) OR
        ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
    );
