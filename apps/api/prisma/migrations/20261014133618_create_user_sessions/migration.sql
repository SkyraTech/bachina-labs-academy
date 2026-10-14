-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(50),
    "user_agent" VARCHAR(1024),
    "ip_address" VARCHAR(45),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CheckConstraint: pin refresh_token_hash to the exact length of a SHA-256 hex digest.
--
-- SHA-256 produces 32 bytes, hex-encoded as exactly 64 lowercase characters.
-- VARCHAR(64) alone would still permit shorter strings; this constraint asserts
-- the exact length produced by the crypto digest and catches algorithm drift.
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_refresh_token_hash_len_check" CHECK (char_length("refresh_token_hash") = 64);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_created_at_idx" ON "user_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
