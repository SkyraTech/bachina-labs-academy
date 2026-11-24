# BACHINA LABS ACADEMY
## CHECKPOINT REPORT: P1-ARTICLE-LIFECYCLE-MIGRATION-DESIGN-01
### Durable ArticleBlock Soft Deletion, Article Lifecycle, Migration Safety and Database Test Isolation

**Checkpoint Identifier:** `P1-ARTICLE-LIFECYCLE-MIGRATION-DESIGN-01`  
**Execution Mode:** STRICT READ-ONLY ARCHITECTURE AND IMPLEMENTATION DESIGN  
**Implementation Authorization:** NOT GRANTED  
**Date & Timestamp:** 2026-11-23T16:40:00+05:30  
**Target Repository:** `c:\Users\VAMSHIKA\source\repos\skyra-tech-projects\bachina-labs-academy`  
**Canonical Prisma Schema:** `apps/api/prisma/schema.prisma`  

---

## A. Executive Verdict

### **Verdict:** `P1-ARTICLE-LIFECYCLE-MIGRATION-DESIGN-01 VERIFIED — DESIGN READY FOR SEPARATE APPROVAL`

**Key Architecture Decisions & Forensic Findings:**
1. **Resolution of the Database-Isolation Test Anomaly:**
   Forensic analysis confirms that no database connection or SQL mutation occurred during previous checkpoints. The test in `apps/api/test/test-db-isolation.spec.ts` failed at the initial PostgreSQL socket authentication handshake (`FATAL: password authentication failed for user "academy_dev_user"`) before any SQL statement was processed. It was triggered because `apps/api/vitest.config.ts` configured root `./` with pattern `**/*.spec.ts`, picking up this integration file due to its `.spec.ts` naming convention. Scoping unit tests to `src/` (`pnpm --filter api test src/`) confirms that 100% of API unit tests (97 test suites, 1,220 tests) pass with absolute zero-database isolation.
2. **Durable ArticleBlock Soft-Deletion Model (TICKET-005):**
   Physical hard deletion (`tx.articleBlock.delete()`) is replaced with durable soft deletion. To resolve the conflict between soft-deleted rows and the existing deferrable PostgreSQL unique constraint `article_blocks_article_id_position_key`, the recommended architecture makes `position` nullable upon soft-deletion (`deleted_at = NOW()`, `position = NULL`). In PostgreSQL, unique constraints treat multiple `NULL` values as distinct, completely avoiding constraint collisions while preserving the deferrable constraint needed for active block reordering.
3. **Deterministic 10-Second Undo and Server Restore Contract:**
   Immediate server-side soft deletion paired with an authorized server restore endpoint (`POST /api/v1/articles/:articleId/blocks/:blockId/restore`) is selected over client-side deferred timers. This guarantees server-client synchronization, protects against unexpected browser closures, supports deterministic revision increments, and eliminates false "All changes saved" feedback.
4. **Comprehensive Article Lifecycle Architecture (TICKET-019, TICKET-020, TICKET-021, TICKET-022):**
   - **TICKET-019 (Author Unpublish & Admin Takedown):** Unpublishing transitions an article from `PUBLISHED` to `DRAFT`, unmaps the public slug, and withdraws reader visibility while preserving all immutable historical snapshots in `article_snapshots`.
   - **TICKET-020 (Draft Soft Deletion):** Draft deletion is converted from physical cascade (`onDelete: Cascade`) to durable soft deletion via `deleted_at` on `articles`. Related blocks and historical snapshots are strictly retained in the database.
   - **TICKET-021 (Admin Moderation & Republish Approval):** Moderation state is modeled using orthogonal dedicated columns (`moderation_status`, `moderation_reason`, `moderated_by_id`, `republish_requested_at`) to keep publication visibility (`ArticleStatus`) decoupled from administrative review. Direct republication is locked while under moderation.
   - **TICKET-022 (Safe Archival & Nonpublic Restoration):** Restoring an archived article transitions it to `DRAFT` (nonpublic), correcting the legacy bug in `article-publication.service.ts` where restoration prematurely jumped directly to `PUBLISHED`.
5. **Future Migration Coordination:**
   A unified Migration 18 design is formulated without creating any migration files. Migrations 15–17 remain safely pending and unapplied.

---

## B. Workspace and Protected-Resource Compliance

All investigations and designs were conducted strictly within the authorized workspace boundaries:

| Resource / Boundary | Policy Constraint | Status & Compliance Evidence |
| :--- | :--- | :--- |
| **Workspace Path** | `c:\Users\VAMSHIKA\source\repos\skyra-tech-projects\bachina-labs-academy` | Authoritative workspace verified |
| **Source & Test Code** | Zero application modifications | Zero source code altered |
| **Prisma Schema** | Zero schema modifications | `apps/api/prisma/schema.prisma` is byte-for-byte untouched |
| **Database Migrations** | No creation or execution | Migrations 15–17 remain unapplied; Migration 18 does not exist |
| **Protected Local DBs** | Zero connections or writes | `127.0.0.1:5432/bachina_labs_academy` & `..._shadow` untouched |
| **Remote Supabase DBs** | Zero connections or writes | Remote production/staging databases strictly uncontacted |
| **Git Operations** | Zero push, zero commit | Working tree unmodified during this design checkpoint |
| **Published Snapshots** | Zero mutation | Historical snapshot records and media assets preserved |

---

## C. Database-Isolation Test Anomaly Investigation

In the previous checkpoint report, `test/test-db-isolation.spec.ts` reported a failure when executing the root test command:

### 1. The Exact Command the Test Attempted to Execute
In `apps/api/test/test-db-isolation.spec.ts` (lines 490–506):
```typescript
function runPsql(sql: string, targetDb?: string): string {
  const dbToConnect = targetDb ?? dbName;
  const res = spawnSync(
    psqlPath,
    ['-h', host, '-p', port, '-U', migUser, '-d', dbToConnect, '-X', '-v', 'ON_ERROR_STOP=1'],
    {
      env: { ...process.env, PGPASSWORD: migPass },
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (res.status !== 0) {
    throw new Error(`psql failed on ${dbToConnect}: ${(res.stderr || res.stdout).trim()}`);
  }
  return (res.stdout || '').trim();
}
```
The test attempted to execute:
`SELECT count(*) FROM pg_database WHERE datname = 'academy_auth_audit_<hex>';` against database `bachina_labs_academy` on `127.0.0.1:5432` with user `academy_dev_user`.

### 2. Execution vs. Interception
The `psql.exe` binary was spawned as an operating system process via Node.js `child_process.spawnSync`. It was not intercepted by an in-process mock.

### 3. Connection Attempt Analysis
`psql.exe` attempted an outbound TCP connection to `127.0.0.1:5432` and transmitted a PostgreSQL startup packet.

### 4. Successful Connection & SQL Execution Evidence
**NO connection was established and NO SQL was executed.**  
PostgreSQL rejected the authentication packet immediately at the network handshake:
`psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL: password authentication failed for user "academy_dev_user"` (exit code 2).  
The process aborted before any PostgreSQL session was opened.

### 5. Database Mutation Evidence
**Zero mutation.** Because the connection was rejected during the handshake, zero SQL commands reached the query execution engine.

### 6. Root Cause: Why Was This Test Included?
In `apps/api/vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
...
```
All true integration tests in `apps/api/test/` are named `*.e2e-spec.ts`. However, `test-db-isolation.spec.ts` was named with the unit test suffix `.spec.ts`. When `pnpm --filter api test` ran `vitest run` from the project root without path filtering, it matched all `.spec.ts` files, including `test/test-db-isolation.spec.ts`.

### 7. Future Test Commands That Would Include It
Any command invoking `vitest run` or `pnpm --filter api test` without directory scoping (`src/`).

### 8. Proposed Test-Isolation Policy for Future Checkpoints
1. **Command-Level Policy (Immediate Enforcement):**
   Strictly execute unit tests scoped to `src/`:
   `pnpm --filter api test src/`
   Confirmed result: 97 passed (97 suites), 1,220 passed (1,220 tests), 0 failed, zero database contact.
2. **Configuration-Level Policy (Approved Future Task):**
   In `apps/api/vitest.config.ts`, restrict `include` to `['src/**/*.spec.ts']` and rename `test/test-db-isolation.spec.ts` to `test/test-db-isolation.e2e-spec.ts`.

---

## D. Current Deletion Containment Review

The containment implemented in `P1-EDITOR-HARD-DELETE-CONTAIN-01` remains 100% active and verified:
- **Frontend Template:** `article-block-list.component.html` renders the Delete Block button with `[disabled]="true"`, title tooltip `"Block deletion is temporarily disabled pending soft-deletion safety support."`, and accessible label `"Delete block (temporarily disabled)"`.
- **Frontend Component Handler:** `onDeleteBlock()` in `article-block-list.component.ts` executes an immediate no-op return.
- **Frontend State Service:** `ArticleEditorStateService.deleteBlock()` fails closed, emits an error toast, does not alter local signals, does not touch `deletionHistory`, and dispatches zero HTTP requests.
- **Backend Service:** `ArticleBlocksService.deleteBlock()` asserts ownership and draft revision, then immediately throws HTTP 409 Conflict (`'Block deletion is temporarily disabled pending durable soft-deletion support.'`) before touching any repository methods.
- **Backend Repository:** `ArticleBlocksRepository.deleteBlock()` (`tx.articleBlock.delete()`) is completely unreachable via the API.

---

## E. All Remaining Hard-Delete and Cascade Pathways

A forensic audit of the entire codebase identified one major indirect physical deletion pathway:

### The Article Draft Hard-Delete Cascade Pathway
- **Route:** `DELETE /api/v1/articles/:articleId?expectedRevision=N`
- **Controller:** `ArticlesController.deleteArticle()`
- **Service:** `ArticlesService.deleteArticle()` (lines 514–560)
- **Repository:** `ArticlesRepository.deleteArticle()` -> executes `tx.article.delete({ where: { id: articleId } })`.
- **Database Schema Relation:** In `apps/api/prisma/schema.prisma:420`:
  ```prisma
  model ArticleBlock {
    ...
    article Article @relation("ArticleDraftBlocks", fields: [articleId], references: [id], onDelete: Cascade)
  }
  ```
- **Hazard Analysis:**
  If an author deletes an unpublished draft article that has never been published, `tx.article.delete()` executes a physical SQL `DELETE FROM articles WHERE id = $1`. Because of `ON DELETE CASCADE` on `article_blocks_article_id_fkey`, PostgreSQL **physically deletes all associated ArticleBlock rows**.
- **Containment / Redesign Requirement:**
  To guarantee complete block preservation under TICKET-020, draft Article deletion must be converted from physical deletion to durable soft deletion (`deleted_at` on `articles`).

---

## F. ArticleBlock Soft-Deletion Schema Alternatives

### Evaluation of Schema Designs

| Alternative | Schema Definition | Data Integrity & Performance | Auditability | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Alt 1: Simple Nullable Timestamp** | `deletedAt DateTime? @map("deleted_at") @db.Timestamptz(3)` | Excellent; 8 bytes per row. Easy filtering: `WHERE deleted_at IS NULL`. | Relies on existing `audit_logs` table for actor tracking. | **RECOMMENDED** |
| **Alt 2: Timestamp + Direct Actor FK** | `deletedAt DateTime?`, `deletedById String? @db.Uuid` | Requires additional FK constraint to `users(id)` and migration overhead. | In-row audit actor. Redundant with existing `AuditService`. | Rejected (Over-engineering) |
| **Alt 3: Lifecycle State Enum** | `status ArticleBlockStatus @default(ACTIVE)` | Enum overhead; duplicate state transitions. | Inferior to timestamp (loses exact deletion time). | Rejected |

### Canonical Prisma Model Diff (Proposed for Future Migration):
```prisma
model ArticleBlock {
  id            String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  articleId     String           @map("article_id") @db.Uuid
  type          ArticleBlockType
  position      Int?             // Made nullable for soft-deleted blocks
  content       Json             @db.JsonB
  mediaAssetId  String?          @map("media_asset_id") @db.Uuid
  schemaVersion Int              @default(1) @map("schema_version")
  createdAt     DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime         @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt     DateTime?        @map("deleted_at") @db.Timestamptz(3)

  article    Article     @relation("ArticleDraftBlocks", fields: [articleId], references: [id], onDelete: Restrict)
  mediaAsset MediaAsset? @relation("ArticleBlockImage", fields: [mediaAssetId], references: [id], onDelete: Restrict)

  @@index([articleId, position], map: "article_blocks_article_id_position_idx")
  @@index([articleId, deletedAt], map: "article_blocks_article_id_deleted_at_idx")
  @@index([mediaAssetId], map: "article_blocks_media_asset_id_idx")
  @@map("article_blocks")
}
```

---

## G. Position and Uniqueness-Constraint Strategy

### The Constraint Collision Challenge
In `apps/api/prisma/migrations/20261026000000_create_article_blocks/migration.sql`:
```sql
ALTER TABLE "article_blocks" ADD CONSTRAINT "article_blocks_article_id_position_key"
    UNIQUE ("article_id", "position") DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_position"
    CHECK ("position" >= 0);
```
If a soft-deleted row retains its original `position` (e.g. `1`), and the remaining active blocks are compacted (block 2 moves to position 1), the unique constraint will throw `P2002` (unique violation) upon transaction commit.

### Comparison of Constraint Strategies

#### Strategy 1: Partial Unique Index (`WHERE deleted_at IS NULL`)
- **DDL:**
  ```sql
  ALTER TABLE "article_blocks" DROP CONSTRAINT "article_blocks_article_id_position_key";
  CREATE UNIQUE INDEX "article_blocks_active_position_uidx" ON "article_blocks" ("article_id", "position") WHERE "deleted_at" IS NULL;
  ```
- **Fatal PostgreSQL Limitation:** Partial unique indexes in PostgreSQL **CANNOT be declared DEFERRABLE**.
- **Impact on Block Reordering:** During drag-and-drop block reordering, swapping block 0 and block 1 requires updating one block to a temporary intermediate state. Without deferrability, simple in-transaction updates fail immediately on the first statement. A complex two-phase multi-statement update (+10000 offset) would be required.

#### Strategy 2: Nullable Position on Soft Deletion (Recommended)
- **Mechanism:**
  - Soft-deleting a block sets `deleted_at = NOW()` and `position = NULL`.
  - In standard SQL and PostgreSQL, `UNIQUE ("article_id", "position")` treats `NULL` values as distinct. Multiple soft-deleted blocks for the same article can all have `position = NULL` without violating the unique constraint.
  - Active blocks retain unique, contiguous integer positions (`0, 1, 2, ...`).
  - The deferrable constraint `article_blocks_article_id_position_key` remains intact for active blocks, preserving existing zero-friction block reordering and position compaction!
  - Check constraint updated: `CHECK ("position" IS NULL OR "position" >= 0)`.
- **Verdict:** **Strategy 2 is the mathematically superior, safest, and most robust solution.**

---

## H. Ten-Second Undo and Restore Contract

### Architecture Decision: Deferred Client Timer vs. Immediate Server Soft Deletion

| Architectural Dimension | Approach A: Deferred Client Mutation (10s buffer) | Approach B: Immediate Server Soft Deletion + Restore API (Recommended) |
| :--- | :--- | :--- |
| **Persistence Latency** | Network call delayed by 10 seconds | Network call executed immediately |
| **Tab Closure / F5 Vulnerability** | **Severe:** If user closes browser tab during 10s window, deletion is lost; block reappears on reload | **Zero risk:** Deletion is already recorded on server; reload shows correct state |
| **Multi-Tab Concurrency** | High risk of revision drift across browser tabs | Deterministic optimistic revision tracking |
| **Offline / Network Drops** | Error surfaced 10s later when author has moved on | Error surfaced immediately on delete action |
| **Autosave Race Conditions** | High complexity: autosave must flush deletion buffer | Clean: autosave only serializes active draft state |

### Detailed 15-Scenario Specification (Under Approach B):

1. **Author clicks Delete:** Block is immediately removed from view. API dispatches `DELETE /api/v1/articles/:id/blocks/:blockId?expectedRevision=N`. UI displays 10s Undo toast.
2. **Block disappears from active editor:** Local signal `article.blocks` updates immediately. Focus shifts safely to adjacent block.
3. **Undo toast appears for 10 seconds:** Toast provides single-click "Undo" action.
4. **Author clicks Undo before expiry:** Toast dismisses. API dispatches `POST /api/v1/articles/:id/blocks/:blockId/restore?expectedRevision=N+1`. Server restores block, recalculates position, and increments revision.
5. **Ten seconds expire without Undo:** Toast dismisses automatically. Block remains safely soft-deleted on server.
6. **Ctrl+Z / Cmd+Z used outside input:** Intercepted by keyboard handler. Invokes restore API if recent deletion exists in memory history.
7. **Another block edited/reordered during Undo window:** The prior deletion already incremented revision to `N+1`. The subsequent edit cleanly uses `expectedRevision: N+1`.
8. **Autosave fires during Undo window:** Saves metadata or dirty block using current revision. No conflict because soft deletion already settled on the server.
9. **Author navigates away:** In-flight delete or restore holds navigation via `canDeactivate` guard until network Promise settles.
10. **Browser refreshed or closed unexpectedly:** Server state is already updated (`deleted_at = NOW()`). On reload, `loadArticle()` loads only active blocks. Zero data corruption.
11. **Delete request response lost (Network drop):** Client handles timeout; prompts retry. Server transaction is idempotent.
12. **Restore request response lost:** Client retries with current revision.
13. **Server returns 409 Conflict:** Displays conflict dialog; prompts author to refresh and reconciles server state.
14. **Multiple blocks deleted & restored out of order:** Each delete/restore atomically reindexes remaining active blocks contiguously.
15. **Article opened in two tabs:** Optimistic concurrency control (`draftRevision`) rejects stale mutations from either tab with HTTP 409 Conflict.

---

## I. Autosave and Revision Consistency

### Frontend State Machine Specification (`ArticleEditorStateService`):
```
[User Action: Delete Block]
         │
         ▼
State: SAVING (Disable mutations)
         │
         ├──> [HTTP DELETE Success] ──> State: SAVED, lastSavedAt = NOW(), draftRevision = N+1
         │                              Show 10s Undo Toast
         │
         └──> [HTTP DELETE Failure] ──> State: ERROR, restore block in view, toast.error()

[User Action: Undo Toast / Ctrl+Z]
         │
         ▼
State: SAVING (Disable mutations)
         │
         ├──> [HTTP RESTORE Success] ──> State: SAVED, lastSavedAt = NOW(), draftRevision = N+2
         │                               Block restored in view, toast.success('Block restored')
         │
         └──> [HTTP RESTORE Failure] ──> State: ERROR, block remains hidden, toast.error('Failed to restore block')
```

- **Durability Guarantee:** `lastSavedAt` is ONLY updated upon confirmed HTTP 200/204 response from the backend.
- **Elimination of False "Saved" Indicator:** If a delete or restore request fails, `saveState` transitions to `'ERROR'`, and the UI pill displays `"Save Failed — Retry"`.

---

## J. Article Publication/Archival Lifecycle Design (TICKET-019 & TICKET-022)

### 1. Author Unpublish (TICKET-019)
- **Endpoint:** `POST /api/v1/articles/:articleId/unpublish`
- **Eligibility:** Author must own article; status must be `PUBLISHED`.
- **Atomic Operations in Transaction:**
  1. Lock article row with `findArticleForUpdate`.
  2. Verify `draftRevision === dto.expectedRevision`.
  3. Update `status = 'DRAFT'`.
  4. Nullify `publishedSlug = NULL` to release the slug or mark unmapped.
  5. Advance `draftRevision = draftRevision + 1`.
  6. **Snapshot Preservation:** Active snapshot (`currentSnapshotId`) and historical snapshots in `article_snapshots` are **RETAINED** as immutable provenance.
  7. Public reader endpoint (`/api/v1/public/articles/:slug`) returns 404.

### 2. Safe Archival & Nonpublic Restoration (TICKET-022)
- **Existing Archival Flow (`POST /articles/:id/archive`):**
  - Allowed from `DRAFT` or `PUBLISHED`. Transitions `status = 'ARCHIVED'`.
  - Immutable historical snapshots retained.
- **Architectural Correction for Restore (`POST /articles/:id/restore`):**
  - **Existing Flawed Behavior:** Legacy code in `article-publication.service.ts:565` sets `status = 'PUBLISHED'` immediately upon restoration!
  - **Required Redesign:** Restoring an archived article must transition `status = 'DRAFT'` (Nonpublic).
  - The author must review and explicitly execute a separate publish action (`POST /articles/:id/publish`) to make the article publicly readable again.

---

## K. Draft Article Soft-Deletion Design (TICKET-020)

### Specification:
1. **Schema Addition:** `deletedAt DateTime? @map("deleted_at")` on model `Article`.
2. **Draft-Only Boundary:**
   - Articles with `status === 'PUBLISHED'` or historical snapshots (`snapshotCount > 0`) **cannot** be soft-deleted. They must be unpublished or archived.
   - Only `status === 'DRAFT'` with zero published snapshots can be soft-deleted.
3. **Cascade Elimination:**
   - In `schema.prisma`, relation `ArticleDraftBlocks` is changed from `onDelete: Cascade` to `onDelete: Restrict`.
   - When an article is soft-deleted, its `article_blocks` records are **retained** in PostgreSQL.
4. **Query Isolation:**
   - Author API `findMyArticles()`:
     ```prisma
     where: { authorId: user.id, deletedAt: null }
     ```
   - Authors have zero visibility into soft-deleted articles. No deleted filter or trash folder is exposed to authors.
5. **Admin Read-Only Inspector:**
   - New admin route `GET /api/v1/admin/articles/deleted` (restricted to `UserRole.ADMIN`).
   - Admin view provides read-only inspection with audit log provenance, author attribution, and deletion timestamp. Admins cannot edit or undelete another author's draft.

---

## L. Admin Moderation and Republish Workflow (TICKET-021)

### Model Specification: Dedicated Moderation Columns
Rather than polluting `ArticleStatus` (which defines public visibility: `DRAFT`, `PUBLISHED`, `ARCHIVED`), moderation is modeled orthogonally:

```prisma
enum ModerationState {
  NONE
  FLAGGED
  TAKEN_DOWN
  REPUBLISH_REQUESTED
  APPROVED
}

// Added to model Article:
moderationState       ModerationState @default(NONE) @map("moderation_status")
moderatedAt           DateTime?       @map("moderated_at") @db.Timestamptz(3)
moderatedById         String?         @map("moderated_by_id") @db.Uuid
moderationReason      String?         @map("moderation_reason") @db.VarChar(1000)
republishRequestedAt  DateTime?       @map("republish_requested_at") @db.Timestamptz(3)
republishNote         String?         @map("republish_note") @db.VarChar(1000)
```

### End-to-End Moderation Flow:
```
[Admin Takedown]
   │  Admin provides mandatory reason (min 10 chars)
   ▼
Article: status = DRAFT, moderationState = TAKEN_DOWN, publishedSlug = NULL
Audit Log: action = 'article.moderation.takedown', actor = admin.id, metadata = { reason }
Author View: Banner displaying "Article taken down by moderation: <reason>"
Publish Button: Disabled ("Publication locked pending moderation review")
   │
   ▼ [Author Remediates Content]
Author clicks "Request Republish Approval" with remediation explanation
   │
   ▼
Article: moderationState = REPUBLISH_REQUESTED, republishNote = "Fixed cited code copyright"
Audit Log: action = 'article.moderation.republish_requested'
Admin View: Appears in "Pending Moderation Review" queue
   │
   ├──> [Admin Rejects] ──> moderationState = TAKEN_DOWN, feedback provided to author
   │
   └──> [Admin Approves] ──> moderationState = APPROVED
                            Author notified; "Publish Article" unlocked for author!
```

---

## M. Proposed Migration Sequencing and Dependencies

> **STRICT COMPLIANCE NOTICE:** No migration files have been created. No schema files have been modified. This is purely technical sequence planning for separate future Product Owner authorization.

### Pending Migration Backlog Status:
- **Migration 15:** `20261120000000_add_reader_to_user_role` (Unapplied).
- **Migration 16:** `20261120000001_set_default_user_role_reader` (Unapplied).
- **Migration 17:** `20261121000000_create_article_access_policy_and_entitlements` (Unapplied).

### Proposed Future Migration Structure:
Rather than generating fragmented partial migrations, all lifecycle and soft-deletion changes should be consolidated into **Migration 18** (or executed sequentially following Migrations 15–17):

#### Proposed Migration 18 DDL Outline:
```sql
-- 1. Create ModerationState Enum
CREATE TYPE "ModerationState" AS ENUM ('NONE', 'FLAGGED', 'TAKEN_DOWN', 'REPUBLISH_REQUESTED', 'APPROVED');

-- 2. Alter Table articles: Add soft deletion and moderation metadata
ALTER TABLE "articles"
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3) NULL,
  ADD COLUMN "moderation_status" "ModerationState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "moderated_at" TIMESTAMPTZ(3) NULL,
  ADD COLUMN "moderated_by_id" UUID NULL,
  ADD COLUMN "moderation_reason" VARCHAR(1000) NULL,
  ADD COLUMN "republish_requested_at" TIMESTAMPTZ(3) NULL,
  ADD COLUMN "republish_note" VARCHAR(1000) NULL;

-- 3. Alter Table article_blocks: Add deleted_at and make position nullable
ALTER TABLE "article_blocks"
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3) NULL,
  ALTER COLUMN "position" DROP NOT NULL;

-- 4. Update Check Constraints on article_blocks
ALTER TABLE "article_blocks" DROP CONSTRAINT "chk_article_blocks_position";
ALTER TABLE "article_blocks" ADD CONSTRAINT "chk_article_blocks_position"
  CHECK ("position" IS NULL OR "position" >= 0);

-- 5. Foreign Key Restraint on Cascades
ALTER TABLE "article_blocks" DROP CONSTRAINT "article_blocks_article_id_fkey";
ALTER TABLE "article_blocks" ADD CONSTRAINT "article_blocks_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Partial Indexes for High Performance Active Queries
CREATE INDEX "articles_active_author_idx" ON "articles" ("author_id", "created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "article_blocks_active_idx" ON "article_blocks" ("article_id", "position") WHERE "deleted_at" IS NULL;
```

---

## N. Security and Audit Considerations

1. **Information Disclosure Prevention (404 Masking):**
   In all endpoints (`GET /articles/:id`, `PATCH /articles/:id`, `POST /articles/:id/restore`), querying non-existent or foreign-owned articles returns `404 Not Found`. Callers cannot probe for the existence of other users' draft or deleted articles.
2. **Actor Immutability in Audit Logs:**
   All takedown, unpublish, archive, restore, and delete operations record transactional events to `audit_logs` using `AuditService.recordTransactional()` with caller IP, user ID, user role, and exact reason metadata.
3. **Public API Shielding:**
   Public reader routes continue to filter strictly on `status = 'PUBLISHED'` and `deleted_at IS NULL`. Soft-deleted blocks, unmapped slugs, and taken-down articles are physically filtered by PostgreSQL queries.

---

## O. Implementation Checkpoints (Recommended Sequencing)

To maintain strict risk control, implementation should proceed in small, independently verifiable checkpoints:

```
[Phase 1: DB Migration Checkpoint (Authorized separately)]
  CP-01: Apply pending Migrations 15-17 + Migration 18 on staging / local test databases.
           │
[Phase 2: Backend Core Services]
  CP-02: Implement ArticleBlocksRepository & Service soft-delete & restore endpoints.
  CP-03: Implement Article draft soft-delete and unpublish logic in ArticlesService.
           │
[Phase 3: Frontend Undo & Autosave Integration]
  CP-04: Connect ArticleEditorStateService to backend restore API; enable UI Delete button.
  CP-05: Integrate autosave pill with restore mutation state; verify 10-second toast.
           │
[Phase 4: Admin Moderation & Lifecycle UX]
  CP-06: Admin takedown dialog, moderation queue, and author republish request workflow.
  CP-07: Admin read-only soft-deleted draft inspector.
```

---

## P. Pending Product Owner Decisions

The following policy decisions are cataloged for explicit Product Owner review before implementation:

1. **Unpublish Slug Retention:** When an author unpublishes an article, should `published_slug` be retained exclusively for that article (preventing other authors from claiming the URL during draft updates), or freed immediately?  
   *Engineering Recommendation:* Retain slug mapping on the article record to prevent URL hijacking of established article backlinks.
2. **Soft-Deleted Draft Retention Window:** Should soft-deleted drafts be retained indefinitely, or subject to a 30-day automated purge policy?  
   *Engineering Recommendation:* Retain indefinitely in PostgreSQL until explicit enterprise retention policies are defined.
3. **Admin Takedown Reason Visibility:** Should the admin's moderation reason be displayed verbatim to the author in the studio alert banner, or sanitized through predefined reason codes?  
   *Engineering Recommendation:* Display predefined categories (e.g. "Copyright Concern", "Code Quality / Formatting", "Terms of Service Violation") accompanied by optional admin notes.

---

## Q. Original Tester Ticket and P10/P11 Backlog Preservation

| Ticket / Project Item | Current Status | Impact of Lifecycle Design |
| :--- | :--- | :--- |
| **TICKET-005 (Block Deletion & Undo)** | **OPEN / CONTAINED** | Fully solved by Section F, G, H design; ready for CP-02/CP-04 implementation |
| **TICKET-006 (Autosave Status)** | **ACCEPTED / VERIFIED** | Preserved; contract formalized in Section I |
| **TICKET-010 (Playwright Selectors)** | **PENDING** | Selector conventions preserved; unaffected |
| **TICKET-012 (Copy Section Link)** | **PENDING** | Preserved; unaffected |
| **TICKET-013–017 (Placeholder Cleanup)** | **PENDING** | Preserved; unaffected |
| **TICKET-019 (Author Unpublish)** | **DESIGN READY** | Fully modeled in Section J |
| **TICKET-020 (Draft Soft Deletion)** | **DESIGN READY** | Fully modeled in Section K |
| **TICKET-021 (Admin Moderation)** | **DESIGN READY** | Fully modeled in Section L |
| **TICKET-022 (Archive / Nonpublic Restore)** | **DESIGN READY** | Flaw resolved; fully modeled in Section J |
| **TICKET-023 (Navigation Placement)** | **PENDING** | Preserved; unaffected |
| **TICKET-026 (Author Profiles)** | **PENDING** | Preserved; unaffected |
| **TICKET-028 (Account Governance)** | **PENDING** | Preserved; unaffected |
| **TICKET-031 (Taxonomy Archive/Restore)** | **PENDING** | Preserved; coordinated schema impact analyzed in Section M |
| **P10 (Reader Entitlements)** | **PENDING** | Preserved; unapplied Migration 17 intact |
| **POD-27 (Premium Content)** | **NOT APPROVED** | Strictly preserved as unapproved |
| **P11 (MCP Tool Suite)** | **PENDING** | Preserved for separate planning |

---

## R. Strict No-Modification Confirmation

- **Application Source Code Modified:** Zero lines.
- **Application Test Code Modified:** Zero lines.
- **Prisma Schema Modified:** Zero lines.
- **Migrations Created or Applied:** Zero.
- **Database Connections / Queries Executed:** Zero.
- **Git Push Executed:** Zero.

---

## S. Final Recommendation and Stop

### Final Recommendation
The architectural design for durable `ArticleBlock` soft deletion, 10-second Undo recovery, Article lifecycle transitions (unpublish, archive, restore), draft soft deletion, and admin moderation is mathematically coherent, source-grounded, and completely preserves database integrity. The resolution to the unique constraint collision (making `position` nullable for soft-deleted blocks) protects PostgreSQL deferrable constraint mechanics without introducing fragile multi-statement reorder workarounds.

### Strict Stop
All design and investigative objectives for `P1-ARTICLE-LIFECYCLE-MIGRATION-DESIGN-01` are complete.  
No implementation has begun.  
Antigravity has strictly stopped and awaits explicit Product Owner instructions.

