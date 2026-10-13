# Bachina Labs Academy — Project Tasks

**Updated:** 2026-10-13 | **Status:** Step 1 setup not yet verified. Use `[ ]`, `[-]`, `[x]` accurately.

## Phase 0 — Scope and foundation
- [x] Choose Angular + NestJS + PostgreSQL + Prisma and one monorepo.
- [x] Select orange-first premium minimal direction and light/dark/system requirement.
- [x] Decide MCP must support author drafting/editing/publishing, not just reads.
- [x] Decide admin-controlled feature entitlements; plan allocations deferred.
- [ ] Confirm client-facing written scope update for MCP and entitlement features within ₹1,50,000.
- [ ] Finalize selected hosting/deployment, auth/MCP grants, editor content format and provider assumptions.

## Phase 1 — Initial project setup (NEXT; NO BUSINESS FEATURES)
- [ ] Inspect chosen working folder; avoid OneDrive-sync conflicts.
- [ ] Verify Node 24.21.0, pnpm 12.3.4 and Git; check exact Angular/NestJS compatibility.
- [ ] Create root pnpm workspace and two apps `apps/web` and `apps/api`.
- [ ] Pin package manager and versions, lockfile and scripts.
- [ ] Configure TS strict, lint/format, Git ignore, EditorConfig and safe env templates.
- [ ] Set up Angular minimal route foundation and theme token placeholder (not whole UI).
- [ ] Set up NestJS minimal API including health endpoint, validation, API prefix and Swagger foundation.
- [ ] Establish one Prisma ownership location without full business schema/migrations.
- [ ] Validate install, builds, lint/tests and dev server smoke check.
- [ ] Report actual commands/results; do not create/edit any Markdown documentation (already supplied).

## Phase 2 — Detailed data modeling / Prisma
- [ ] Approve PostgreSQL ERD, entities, relationships and indexes.
- [ ] Add feature registry, plan-feature mapping, subscriptions, MCP authorization models.
- [ ] Decide effective-subscription lifecycle and audit records.
- [ ] Apply versioned migrations and test seeds locally.

## Phase 3 — Auth, identity and basic author features
- [ ] Registration/login/logout/reset and profile, guarded REST, safe session.
- [ ] Bootstrap admin securely and implement ownership/role policies.
- [ ] Author dashboard skeleton and profile editing.

## Phase 4 — Articles, taxonomy and public website
- [ ] Draft/create/edit/preview/publish with ownership rules.
- [ ] Categories/tags/search/pagination/media adapter.
- [ ] Public home/article detail/author profiles/social sharing/basic SEO.

## Phase 5 — Engagement/admin
- [ ] Authenticated comments and moderation.
- [ ] Basic views/summaries and transactional emails.
- [ ] Protected content/user/taxonomy management dashboard.

## Phase 6 — Entitlements and subscription administration
- [ ] Stable registered implemented feature keys and dependency policy.
- [ ] EntitlementsService + guarded REST/Angular access.
- [ ] Admin plan configuration, matrix and user plan assignment.
- [ ] Expiration/revocation, auditing and fail-closed policy tests.
- [ ] Confirm final free/paid configuration (Free MCP disabled).

## Phase 7 — MCP read/write server
- [ ] Verify SDK/client compatibility and authentication design.
- [ ] Build MCP server and public content tools behind entitlement.
- [ ] Author create/list/get/update/preview/publish tools and explicit scopes.
- [ ] Security, ownership, expiry/revocation, size/abuse tests.
- [ ] Connection guide/tests for actual target AI assistants.

## Phase 8 — Quality, deployment, acceptance
- [ ] Cross-app functional tests, accessibility, responsive and theme checks.
- [ ] Deploy Angular + NestJS, database migrations, backups, secrets and monitoring.
- [ ] UAT, defects, handover and acceptance.

## Next action
Share `docs/` with the project, then execute a narrowly bounded **Step 1 initial setup** prompt. Do not mark any unchecked task completed without observed verification.
