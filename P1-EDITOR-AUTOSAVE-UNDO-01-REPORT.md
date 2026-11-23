# BACHINA LABS ACADEMY
## CHECKPOINT P1-EDITOR-AUTOSAVE-UNDO-01 REPORT
### Content Block Undo, Soft-Deletion Safety and Accurate Autosave Feedback

**Workspace:** `c:\Users\VAMSHIKA\source\repos\skyra-tech-projects\bachina-labs-academy`  
**Prisma Schema:** `apps/api/prisma/schema.prisma`  
**Execution Date:** November 22, 2026  
**Final Verdict:** **`P1-EDITOR-AUTOSAVE-UNDO-01 PARTIAL — DURABLE SOFT DELETION OR OTHER REQUIREMENTS BLOCKED`**

---

### A. Executive Assessment

**Verdict:** **`P1-EDITOR-AUTOSAVE-UNDO-01 PARTIAL — DURABLE SOFT DELETION OR OTHER REQUIREMENTS BLOCKED`**

- **TICKET-005 (Block Deletion & Undo Recovery):** **PARTIAL / BLOCKED ON MIGRATION 18**.
  The frontend editor deletion recovery buffer, immediate removal from the active view, 10-second actionable Undo notification, LIFO multi-deletion history stack, and `Ctrl+Z` / `Cmd+Z` keyboard shortcut recovery are fully implemented and verified. However, durable backend soft deletion cannot be persisted without database schema changes (`deleted_at` on `article_blocks`), which requires Migration 18. Per Product Owner instructions, no unauthorized migrations or hard-deletion workarounds were introduced.
- **TICKET-006 (Autosave Status Feedback & Timestamps):** **FULLY IMPLEMENTED & ACCEPTED**.
  Accurate save status tracking (`SAVED`, `SAVING`, `DIRTY`, `ERROR`, `CONFLICT`), confirmed `lastSavedAt` server timestamps, accessible status pill live regions (`role="status"`, `aria-live`), and failure retry controls are fully implemented and passing all tests.
- **Quality Gates:** 795 frontend unit tests across 72 suites passed (0 failures). 1,217 backend unit tests across 97 suites passed (0 failures). TypeScript typecheck and linting passed with 0 errors.

---

### B. Workspace and Preflight

1. **Authoritative Workspace:** Verified at `c:\Users\VAMSHIKA\source\repos\skyra-tech-projects\bachina-labs-academy`.
2. **Preflight Inspections Completed:**
   - `ArticleEditorComponent` (`apps/web/src/app/features/author/articles/components/article-editor/article-editor.component.ts`)
   - `ArticleEditorStateService` (`apps/web/src/app/features/author/articles/services/article-editor-state.service.ts`)
   - `ArticleBlockListComponent` (`apps/web/src/app/features/author/articles/components/article-block-list/article-block-list.component.ts`)
   - `ToastService` & `ToastContainerComponent` (`apps/web/src/app/shared/ui/toast/`)
   - `ArticleBlocksRepository` & `ArticleBlocksService` (`apps/api/src/modules/articles/`)
   - `apps/api/prisma/schema.prisma`

---

### C. Existing Block Persistence and Deletion Semantics

Inspection of the existing backend persistence layer reveals:
1. **Prisma Model:**
   ```prisma
   model ArticleBlock {
     id            String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
     articleId     String           @map("article_id") @db.Uuid
     type          ArticleBlockType
     position      Int
     content       Json             @db.JsonB
     mediaAssetId  String?          @map("media_asset_id") @db.Uuid
     schemaVersion Int              @default(1) @map("schema_version")
     createdAt     DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
     updatedAt     DateTime         @updatedAt @map("updated_at") @db.Timestamptz(3)
     ...
   }
   ```
2. **Repository Implementation:**
   `apps/api/src/modules/articles/repositories/article-blocks.repository.ts`:
   ```typescript
   async deleteBlock(blockId: string, tx: Prisma.TransactionClient): Promise<void> {
     await tx.articleBlock.delete({
       where: { id: blockId },
     });
   }
   ```
3. **Finding:** The existing database persistence contract performs a **HARD DELETE** (`tx.articleBlock.delete`). There is currently no `deleted_at`, `is_deleted`, or `deleted_by` column on the `article_blocks` table.

---

### D. Soft-Deletion Compatibility Assessment

- The Product Owner's directive states: *"A deleted block must not be physically destroyed merely because it disappears from the current editor or from an autosave payload. Inspect whether the existing schema and API already support durable block soft deletion. If not, do not implement a workaround that physically deletes ArticleBlock records."*
- Because durable soft deletion requires a database migration adding `deleted_at TIMESTAMPTZ(3)` and Migration 18 is explicitly prohibited in this checkpoint, durable backend soft deletion cannot be completed at this stage.
- In accordance with instructions:
  - Editor-level UX, recovery buffers, and Undo actions are fully implemented in memory.
  - The underlying backend persistence contract remains unmodified.
  - Acceptance criterion for durable soft deletion is marked **PARTIAL / DEFERRED PENDING MIGRATION 18**.

---

### E. Undo Design and Implementation (TICKET-005)

1. **Actionable Toast Notification System:**
   - Extended `ToastMessage` and `ToastService` to accept optional `action: { label: string; run: () => void }`.
   - Updated `ToastContainerComponent` to render the action button with accessible focus styling and click-to-dismiss integration.
2. **Session-Scoped Deletion Recovery Buffer:**
   - In `ArticleEditorStateService`, introduced `DeletedBlockRecord`:
     ```typescript
     export interface DeletedBlockRecord {
       readonly block: ArticleBlock;
       readonly position: number;
       readonly deletedAt: number;
     }
     ```
   - Maintained an in-memory deletion stack `readonly deletionHistory = signal<DeletedBlockRecord[]>([])` and `readonly canUndo = computed(() => this.deletionHistory().length > 0)`.
3. **Immediate Removal & Position Compaction:**
   - When an author deletes a block, it is immediately removed from `article.blocks`.
   - Remaining blocks are sorted and contiguously compacted (`position: 0, 1, 2...`).
   - A 10-second actionable toast is triggered: `"Block deleted"` with action `"Undo"`.
4. **Restoration Mechanics (`undoDeleteBlock`):**
   - Pops the most recent block record from `deletionHistory`.
   - Re-inserts the block at its original position index (clamped to the current list length).
   - Re-indexes all blocks contiguously.
   - Restores the active selection to the restored block (`selectedBlockId.set(record.block.id)`).
   - Marks the editor state dirty (`saveState.set('DIRTY')`).
   - Displays a success confirmation toast: `"Block restored."`.
5. **Keyboard Shortcuts (`Ctrl+Z` / `Cmd+Z`):**
   - Added `@HostListener('window:keydown', ['$event'])` to `ArticleEditorComponent`.
   - Checks for `Ctrl+Z` or `Cmd+Z` (ignoring `Shift+Z` redo combinations).
   - Evaluates whether focus is currently inside a native input, textarea, contenteditable element, or TipTap/ProseMirror instance. If focus is inside a text editing surface, native text undo is preserved.
   - If focus is outside text editing surfaces and `state.canUndo()` is true, default browser navigation is prevented (`event.preventDefault()`) and `state.undoDeleteBlock()` is invoked.
6. **Multi-Block Operation Determinism:**
   - Supports consecutive deletions via LIFO stack restoration.
   - Handles deletion followed by reordering gracefully without duplicate keys or broken position sequences.

---

### F. Autosave Coordination

1. **State Machine Transitions:**
   - `SAVED`: Confirmed server state. Displays green indicator + relative/absolute timestamp.
   - `SAVING`: Active HTTP request in-flight. Displays animated spinner + "Saving changes...".
   - `DIRTY`: Unsaved local modifications. Displays amber indicator + "Unsaved changes".
   - `ERROR`: Network or server failure. Displays red indicator + "Failed to save" + "Retry" link.
   - `CONFLICT`: Revision mismatch (HTTP 409). Displays pulsing red indicator + "Revision Conflict".
2. **Timestamp Tracking (`lastSavedAt`):**
   - Signal `lastSavedAt: Signal<Date | null>` is updated exclusively upon confirmed backend 200/201 responses (in `updateMetadata`, `createBlock`, `updateBlock`, `reorderBlocks`, `publishArticle`, `duplicateArticle`, and `saveAllPendingChanges`).
   - Discarding changes or local debounce timers do not falsely advance `lastSavedAt`.
3. **Conflict & Overlap Protection:**
   - Overlapping save requests are rejected while `isSaving()` is true.
   - Optimistic concurrency conflicts (409) freeze automatic saving and require explicit author review via the conflict banner.

---

### G. Autosave Status Implementation (TICKET-006)

In `apps/web/src/app/features/author/articles/components/article-editor/article-editor.component.html`:
- Topbar Save Status Pill updated with accessible live regions:
  - `role="status"` and `aria-live="polite"` for non-disruptive state transitions (`SAVED`, `SAVING`, `DIRTY`).
  - `aria-live="assertive"` for critical failures (`ERROR`, `CONFLICT`).
- Displays formatted local time: e.g. `"All changes saved · 15:45:00"`.
- Provides an inline `"Retry"` button on save failure that triggers `state.saveAllPendingChanges()`.

---

### H. Exact Modified Files

1. `apps/web/src/app/shared/ui/toast/models/toast.model.ts`:
   Added `ToastAction` interface and optional `action?: ToastAction` property to `ToastMessage`.
2. `apps/web/src/app/shared/ui/toast/services/toast.service.ts`:
   Updated `show()` to pass `action` into new `ToastMessage` instances.
3. `apps/web/src/app/shared/ui/toast/components/toast-container/toast-container.component.html`:
   Added conditional action button markup for actionable toasts.
4. `apps/web/src/app/features/author/articles/services/article-editor-state.service.ts`:
   Added `DeletedBlockRecord`, `deletionHistory`, `canUndo`, `lastSavedAt`, updated `deleteBlock()`, added `undoDeleteBlock()`, and wired `lastSavedAt` updates to confirmed saves.
5. `apps/web/src/app/features/author/articles/services/article-editor-state.service.spec.ts`:
   Updated `toastMock` with `show()`; added test suites for TICKET-005 (buffer, undo, LIFO stack, empty buffer) and TICKET-006 (timestamps).
6. `apps/web/src/app/features/author/articles/components/article-editor/article-editor.component.ts`:
   Added `@HostListener` for `Ctrl+Z` / `Cmd+Z`, computed `lastSavedFormatted`, and element type checks.
7. `apps/web/src/app/features/author/articles/components/article-editor/article-editor.component.html`:
   Updated the Save Status Pill to display timestamped status, live regions, and retry controls.
8. `apps/web/src/app/features/author/articles/components/article-editor/article-editor.component.spec.ts`:
   Updated `toastMock` with `show()`; added tests for `Ctrl+Z` / `Cmd+Z` handling and timestamp rendering.

---

### I. Regression Test Inventory

- **Block Deletion & Recovery Buffer Tests:**
  - `T5-01`: Buffers deleted block in `deletionHistory` and displays 10s Undo toast.
  - `T5-02`: Restores deleted block at original position when `undoDeleteBlock()` is called, compacting positions and restoring selection.
  - `T5-03`: Supports multiple consecutive deletions in reverse chronological (LIFO) order.
  - `T5-04`: Returns `false` safely when attempting to undo with an empty buffer.
- **Keyboard Shortcut Tests:**
  - `should trigger state.undoDeleteBlock on Ctrl+Z when canUndo is true and focus not in input`.
  - `should trigger state.undoDeleteBlock on Cmd+Z (Meta+Z)`.
  - `should NOT trigger undo when Shift is held (Ctrl+Shift+Z)`.
- **Autosave Status & Timestamp Tests:**
  - `T6-01`: Records `lastSavedAt` timestamp upon successful metadata update.
  - `T6-02`: Records `lastSavedAt` timestamp upon successful block creation and update.
  - `should display formatted timestamp in Save Status Pill when saved`.
  - Navigation guards verify dirty-state detection and prevent silent loss of unsaved changes.

---

### J. Frontend Quality Gate Results

| Command | Exit Code | Outcome |
| :--- | :--- | :--- |
| `pnpm --filter web typecheck` | 0 | **PASSED** (0 errors) |
| `pnpm --filter web lint` | 0 | **PASSED** (0 errors, 0 warnings) |
| `pnpm --filter web test` | 0 | **PASSED** (72 test files passed, **795 tests passed**, 0 failed) |
| `pnpm --filter web build` | 0 | **PASSED** (Production bundle generated in 14.1s) |

---

### K. Backend Verification

| Command | Exit Code | Outcome |
| :--- | :--- | :--- |
| `pnpm --filter api test src/` | 0 | **PASSED** (97 test files passed, **1,217 tests passed**, 0 failed) |

---

### L. Snapshot and Revision Safety

- Published `ArticleSnapshot` records and snapshot blocks remain completely untouched and immutable.
- Optimistic draft revision increments (`draftRevision`) are preserved.
- Unsaved changes prevent publication until changes are confirmed.

---

### M. Protected Database and Migration Compliance

- Zero connections opened against protected production databases.
- Prisma schema file `apps/api/prisma/schema.prisma` is untouched.
- Migrations 15–17 remain unapplied.
- Migration 18 was not created.

---

### N. Browser/E2E Test Limitations

- Real browser automation tests across Playwright are deferred to separately authorized disposable test environments.

---

### O. Deferred Migration or Backend Requirements

To achieve full compliance with durable database-level block soft deletion (TICKET-005):
1. **Migration 18 Dependency:**
   - Add `deleted_at TIMESTAMPTZ(3)` to `article_blocks` table.
   - Add partial index: `CREATE INDEX article_blocks_active_idx ON article_blocks(article_id, position) WHERE deleted_at IS NULL;`.
2. **API & Repository Enhancements:**
   - Update `ArticleBlocksRepository.deleteBlock()` to execute `UPDATE article_blocks SET deleted_at = NOW() WHERE id = :id`.
   - Add `restoreBlock(blockId)` endpoint: `POST /api/v1/articles/:articleId/blocks/:blockId/restore`.
   - Filter active draft queries to `WHERE deleted_at IS NULL`.

---

### P. Updated Ticket Statuses

- **TICKET-005 (Block Deletion & Undo Recovery):** **PARTIAL** (Editor recovery buffer, 10s toast, and Ctrl+Z keyboard shortcuts implemented; durable DB soft-deletion pending Migration 18).
- **TICKET-006 (Autosave Status Feedback & Timestamps):** **COMPLETED / ACCEPTED**.

---

### Q. Recommended Next Checkpoint

**`P1-LIFECYCLE-SUBMIT-REVIEW-01`** (Implementation of TICKET-019–022: Article lifecycle, draft review submission, revision history, and author publishing controls).

---

### R. Strict Stop Confirmation

Controlled implementation and regression verification are completed. No Git pushes were executed. No unapproved database operations were performed.

---

### Local Git Commit Message (For Your Reference)

```text
feat(author,web): implement block deletion Undo buffer and autosave feedback (TICKET-005, TICKET-006)

- TICKET-005: Add in-memory block deletion recovery buffer and LIFO undo history
- TICKET-005: Add actionable 10-second Undo toast notification with immediate restore
- TICKET-005: Add Ctrl+Z and Cmd+Z keyboard shortcut listener in ArticleEditorComponent
- TICKET-006: Add lastSavedAt timestamp tracking to ArticleEditorStateService on confirmed saves
- TICKET-006: Update Save Status Pill with timestamped status, live regions, and retry action
- ui: Add optional action button support to ToastMessage and ToastService
- tests: Expand editor component and state service test suites (795 frontend tests passing)
```

