-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CheckConstraint: pin token_hash to the exact length of a SHA-256 hex digest.
--
-- SHA-256 produces 32 bytes, hex-encoded as exactly 64 lowercase characters.
-- VARCHAR(64) alone would still permit a 1-character hash, so this constraint
-- asserts the length the VerificationTokenService actually produces and turns
-- a silent algorithm/encoding drift into a loud constraint violation.
--
-- Prisma cannot express CHECK constraints, so this is maintained in the
-- migration SQL — the same precedent as users_email_lower_key and the partial
-- unique index below. If the digest algorithm ever changes, this length must
-- change with it.
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_token_hash_len_check" CHECK (char_length("token_hash") = 64);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_created_at_idx" ON "email_verification_tokens"("user_id", "created_at");

-- CreateIndex: partial unique index — at most ONE unconsumed token per user.
-- RETAINED AS DEFENCE IN DEPTH. The 60-second cooldown is now enforced inside
-- the issuing transaction, which serializes on the owning users row via
-- SELECT ... FOR UPDATE (see EmailVerificationTokenRepository.issueToken).
--
-- Why the index alone was not sufficient: it constrains only unconsumed rows,
-- so once a token is consumed the user is unconstrained again and could reissue
-- immediately. The row lock closes that gap because the cooldown check reads the
-- latest token of ANY status, including consumed ones.
--
-- Why it is still kept: it bounds the table to a single active token per user
-- even if application logic is bypassed, and any INSERT that races past the
-- lock fails with a unique violation (P2002). The application maps that to the
-- generic cooldown outcome rather than surfacing it, so a conflict can never
-- leak account state.
--
-- The WHERE clause excludes consumed tokens (consumed_at IS NULL), so a
-- consumed token does not block issuing a new one, and historical consumed rows
-- coexist freely — those rows are the cooldown history.
--
-- This index cannot be expressed in the Prisma schema and is maintained here,
-- exactly like users_email_lower_key in 20261014052015_create_users.
CREATE UNIQUE INDEX "email_verification_tokens_user_active_key" ON "email_verification_tokens"("user_id") WHERE "consumed_at" IS NULL;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
