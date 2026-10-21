-- Migration: 20261016153000_create_audit_logs
-- Phase Q-2.3B — Durable Database Audit Logging (Checkpoint 1)
--
-- Creates the audit_logs table, PostgreSQL check constraints, performance indexes,
-- and the foreign-key relation to users with privacy-preserving SET NULL semantics.

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(64),
    "outcome" VARCHAR(20) NOT NULL,
    "trace_id" CHAR(32),
    "request_id" VARCHAR(64),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CheckConstraint: Constrain actor_type to authorized principal categories
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_actor_type" 
    CHECK ("actor_type" IN ('USER', 'SYSTEM', 'ANONYMOUS'));

-- CheckConstraint: Constrain outcome to bounded status values
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_outcome" 
    CHECK ("outcome" IN ('SUCCESS', 'FAILURE', 'DENIED'));

-- CheckConstraint: Enforce lowercase hierarchical dot-delimited action format
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_action_format" 
    CHECK ("action" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$');

-- CheckConstraint: Enforce uppercase resource_type naming
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_resource_type_format" 
    CHECK ("resource_type" ~ '^[A-Z0-9_]+$');

-- CheckConstraint: Validate 32-hex trace_id when present
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_trace_id_format" 
    CHECK ("trace_id" IS NULL OR "trace_id" ~ '^[0-9a-f]{32}$');

-- CheckConstraint: Validate correlation request_id format when present
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_request_id_format" 
    CHECK ("request_id" IS NULL OR "request_id" ~ '^[a-zA-Z0-9_-]{1,64}$');

-- CheckConstraint: Ensure metadata is a valid JSON object bounded to 1,024 bytes
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_logs_metadata_shape" 
    CHECK (jsonb_typeof("metadata") = 'object' AND octet_length("metadata"::text) <= 1024);

-- CreateIndex: Temporal index for chronological scanning and retention
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex: Actor activity index for user security timeline inspection
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex: Resource history index for tracking audit history of specific entities
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at" DESC);

-- CreateIndex: Ingress correlation index for ECS operational log cross-referencing
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- AddForeignKey: Privacy-conscious SET NULL on user deletion, NO ACTION on update
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" 
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Comments for database documentation
COMMENT ON TABLE "audit_logs" IS 'Durable append-only audit trail for identity, security, and domain events.';
COMMENT ON COLUMN "audit_logs"."actor_id" IS 'Authenticated user UUID, or NULL for anonymous attempts or deleted accounts.';
COMMENT ON COLUMN "audit_logs"."trace_id" IS 'Trace-ready W3C hex format identifier for distributed trace correlation.';
COMMENT ON COLUMN "audit_logs"."metadata" IS 'Allowlisted, non-sensitive JSONB object bounded to 1 KB.';
