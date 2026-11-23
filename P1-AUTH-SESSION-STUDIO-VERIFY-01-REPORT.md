# BACHINA LABS ACADEMY
## CHECKPOINT P1-AUTH-SESSION-STUDIO-VERIFY-01 REPORT
### Independent Authentication Security, Role Authorization and Session Restoration Verification

**Workspace:** `c:\Users\VAMSHIKA\source\repos\skyra-tech-projects\bachina-labs-academy`  
**Prisma Schema:** `apps/api/prisma/schema.prisma`  
**Mode:** STRICT READ-ONLY VERIFICATION  
**Execution Date:** November 22, 2026  

---

### A. Executive Verdict

**`P1-AUTH-SESSION-STUDIO-VERIFY-01 VERIFIED — BOTH TICKETS ACCEPTED`**

Both **TICKET-029** (ADMIN Author Studio access, navigation, and role isolation) and **TICKET-032** (Session restoration, Remember Me cookie lifecycles, and public header reactivity) are independently verified and accepted. All security boundaries remain fail-closed. No security regressions, open redirects, or privilege escalations were detected. 785 frontend unit tests across 72 suites and 1,217 backend unit tests across 97 suites pass with 0 failures, 0 lint errors, and 0 typecheck errors.

---

### B. Workspace and Preservation Compliance

1. **Workspace Integrity:** The single authoritative workspace is verified at `c:\Users\VAMSHIKA\source\repos\skyra-tech-projects\bachina-labs-academy`.
2. **Database Protection:** Zero database connections, writes, or migrations were initiated against local or remote PostgreSQL instances. All checks ran in-memory or against mock doubles.
3. **Prisma & Migration Preservation:** `apps/api/prisma/schema.prisma` is pristine. Migrations 15–17 remain unapplied to protected environments. Migration 18 does not exist and was not created.
4. **Git Discipline:** Zero git commands, commits, or pushes were executed during this verification.

---

### C. OriginGuard Change Assessment

1. **Reason for Modification:**
   `apps/api/src/modules/auth/guards/origin.guard.ts` was adjusted during cloud deployment to permit cross-origin requests originating from Vercel preview/production domains (`https://bachina-labs-academy*.vercel.app`) interacting with the Render backend.
2. **Necessity Evaluation:**
   This change was necessary to support secure frontend-to-backend authentication without bypassing Origin validation.
3. **Fail-Closed Validation & Security Invariants:**
   - **Host Header Poisoning Prevention:** `isTrustedHost(h)` strictly checks configured trusted hostnames/ports and approved reverse-proxy domains (`bachina-labs-academy.*\.vercel\.app`).
   - **Strict Same-Host Isolation:** `isSameHost(originUrl)` verifies only `host` and `x-forwarded-host`. Configured cross-origin allowed origins (e.g. `http://localhost:4200`) are **not** treated as same-host, ensuring that Fetch Metadata (`Sec-Fetch-Site: same-origin`) cannot be spoofed.
   - **Fetch Metadata Verification:** Rejects contradictory combinations:
     - `Sec-Fetch-Site === 'same-origin'` from a non-matching host -> rejected with `403 Forbidden`.
     - `Sec-Fetch-Site === 'cross-site'` targeting sensitive auth routes (`/auth/login`, `/auth/refresh`) -> rejected with `403 Forbidden`.
   - **Missing Origin/Referer:** State-changing requests lacking both `Origin` and `Referer` on sensitive auth endpoints fail-closed with `403 Forbidden`.
   - **Test Verification:** All 15 unit tests in `origin.guard.spec.ts` pass cleanly.

---

### D. TICKET-029 Authorization Review

1. **Route Configuration:**
   In both `apps/web/src/app/app.routes.ts` and `apps/web/src/app/app.routes.prod.ts`, the Author Studio routes:
   - `/author`
   - `/author/articles`
   - `/author/articles/new`
   - `/author/articles/:articleId/edit`
   - `/author/articles/:articleId/preview`
   are protected by `canActivate: [authGuard, roleGuard(['AUTHOR', 'ADMIN'])]`.
2. **Role Boundaries Verified:**
   - **ADMIN Access:** ADMIN users can navigate to `/author` and `/author/articles`.
   - **READER Isolation:** READER users attempting to access `/author` are denied and redirected to `/` (or `/login` if unauthenticated).
   - **AUTHOR Isolation:** AUTHOR users attempting to access `/admin` receive a redirect to `/author` (or `/` if unauthorized).
3. **Resource Ownership Invariants:**
   - In `apps/api/src/modules/articles/controllers/articles.controller.ts` and `articles.service.ts`, draft creation sets `authorId: user.id`.
   - Draft updates and queries use `findArticleForUpdate(articleId, user.id, tx)`. An ADMIN **cannot** modify, overwrite, or view drafts belonging to another author through authoring endpoints.
   - Cover media assignment enforces `media.uploaderId === user.id`.
4. **Public Attribution Isolation:**
   - In `apps/api/src/modules/articles/dto/public-article-list-response.dto.ts`, public author summaries project only `id` and `displayName`.
   - Internal database role (`ADMIN`) is never leaked into public bylines or Reader responses.

---

### E. Route and Return-URL Security

1. **Return URL Sanitization:**
   `apps/web/src/app/core/auth/guards/auth.guard.ts` implements `sanitizeReturnUrl()`:
   - Strips protocol schemes (`http://`, `https://`, `//`) and whitespace.
   - Rejects unapproved root paths.
   - Prevents open redirect vulnerabilities.
2. **Login Redirect Behavior:**
   - In `guest.guard.ts` and `login.component.ts`, when an ADMIN logs in with a valid return URL (e.g. `/author/articles`), the return URL is preserved.
   - If no return URL is provided, ADMIN defaults to `/admin`.
   - AUTHOR defaults to `/author`.
   - READER defaults to `/`.

---

### F. TICKET-032 Hydration Review

1. **App Initializer Registration:**
   `apps/web/src/app/app.config.ts` registers session hydration via Angular 22's official API:
   `provideAppInitializer(() => inject(AuthStateService).ensureHydrated())`.
2. **Deduplication Safeguard (`hydration$`):**
   `AuthStateService.ensureHydrated()` checks for an existing `hydration$` observable. Concurrent callers (e.g. parallel guards or components) share the single in-flight request via `shareReplay({ bufferSize: 1, refCount: false })`.
3. **Epoch Counter Safeguard (`epoch`):**
   A monotonically increasing integer counter increments on every auth transition. If a user logs out while an asynchronous hydration or `/auth/me` request is in-flight, the late response detects `this.epoch !== currentEpoch` and discards the result, preventing stale sessions from reviving.
4. **Public Browsing:**
   Anonymous visitors browsing public routes (`/`, `/articles`) do not encounter redirect loops. `PublicLayoutComponent` reflects authenticated state reactively without redirecting users away from public articles.

---

### G. Remember Me and Cookie Contract

1. **Checkbox State:**
   In `login.component.ts`, the Remember Me checkbox is initialized to `false` (unchecked).
2. **Transmission & Lifecycle:**
   - Transmitted in the request body as `rememberMe: boolean`.
   - **`rememberMe: false`:** Backend issues `academy_refresh` without a `Max-Age` attribute (browser-session cookie, expires on browser close), bounded server-side by a 24-hour absolute session limit.
   - **`rememberMe: true`:** Backend issues `academy_refresh` with `Max-Age=2592000` (30 days), bounded server-side by database session record expiration.
   - Short-lived Access token `academy_access` expires in 15 minutes.
3. **Token Security:**
   Both tokens are set with `HttpOnly; Secure; SameSite=Lax`. No tokens or credentials are stored in `localStorage` or `sessionStorage`.

---

### H. Logout and Cross-Tab Behavior

1. **Local and Server Cleanout:**
   `AuthStateService.logout()` increments `epoch++`, immediately clears in-memory user signals, and calls backend `POST /api/v1/auth/logout` to invalidate the refresh session and expire cookies (`Max-Age=0`).
2. **Cross-Tab Synchronization:**
   `AuthRefreshService` publishes a `LOGOUT` event over `BroadcastChannel('academy_auth')`. All open browser tabs immediately receive the event, clear their in-memory session signals, and redirect protected routes to `/login`.

---

### I. Session Refresh and Concurrency Safety

1. **Refresh Interceptor:**
   `AuthRefreshInterceptor` catches HTTP `401 Unauthorized` responses and triggers `AuthRefreshService.refreshSession()`.
2. **Mutex Queuing:**
   Multiple concurrent 401 errors are queued while a single refresh request executes. Once the refresh succeeds, all queued requests replay with the renewed session.

---

### J. Relevant Test Evidence

| Test Suite | Scope | Result | Key Proof |
| :--- | :--- | :--- | :--- |
| `guest.guard.spec.ts` | Frontend (12 tests) | **PASSED** | Sanitization, returnUrl preservation for ADMIN/AUTHOR, role defaults |
| `role.guard.spec.ts` | Frontend (8 tests) | **PASSED** | ADMIN/AUTHOR allowed in `/author`, READER rejected, ADMIN console isolation |
| `auth-state.service.spec.ts` | Frontend (12 tests) | **PASSED** | `hydration$` deduplication, `epoch` stale response protection, cross-tab broadcast |
| `login.component.spec.ts` | Frontend (17 tests) | **PASSED** | Remember Me checkbox default (false), sanitized redirects, login payloads |
| `dashboard-layout.component.spec.ts` | Frontend (11 tests) | **PASSED** | Admin-to-Author Studio switcher link rendering |
| `origin.guard.spec.ts` | Backend (15 tests) | **PASSED** | Reverse proxy headers, Sec-Fetch-Site rules, CSRF fail-closed rejection |
| `articles.controller.spec.ts` | Backend (28 tests) | **PASSED** | Article ownership enforcement, AUTHOR & ADMIN role decorators |
| `auth.service.spec.ts` | Backend (42 tests) | **PASSED** | Cookie lifecycles (24h vs 30d), session revocation, logout cleanup |

- **Frontend Totals:** 72 test suites, **785 tests passed**, 0 failed.
- **Backend Totals:** 97 test suites, **1,217 tests passed**, 0 failed.
- **Static Analysis:** `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter api typecheck` -> **0 errors**.

---

### K. Unverified Browser Scenarios

- **E2E Playwright Browser Execution:** Multi-browser real cookie lifetime persistence (e.g. testing browser close vs 30-day cookie retention in genuine Edge/Chromium profiles) was not executed in this unit verification step. It remains designated for disposable sandbox/E2E environments.

---

### L. Changed-File Accountability

All 14 modified files from checkpoint `P1-AUTH-SESSION-STUDIO-01` are accounted for:

1. `apps/web/src/app/app.routes.ts`: Necessary for TICKET-029 (Author Studio dual role).
2. `apps/web/src/app/app.routes.prod.ts`: Necessary for TICKET-029 (Production route parity).
3. `apps/web/src/app/core/auth/guards/guest.guard.ts`: Necessary for TICKET-029 & TICKET-032 (ReturnUrl handling).
4. `apps/web/src/app/core/auth/guards/guest.guard.spec.ts`: Necessary supporting tests.
5. `apps/web/src/app/core/auth/guards/role.guard.spec.ts`: Necessary supporting tests.
6. `apps/web/src/app/features/auth/login/login.component.ts`: Necessary for TICKET-029 & TICKET-032 (Redirect sanitization & Remember Me).
7. `apps/web/src/app/features/auth/login/login.component.spec.ts`: Necessary supporting tests.
8. `apps/web/src/app/layouts/dashboard-layout/dashboard-layout.component.ts`: Necessary for TICKET-029 (Workspace switcher link).
9. `apps/web/src/app/layouts/dashboard-layout/dashboard-layout.component.html`: Necessary for TICKET-029 (Workspace toggle UI).
10. `apps/web/src/app/layouts/dashboard-layout/dashboard-layout.component.spec.ts`: Necessary supporting tests.
11. `apps/web/src/app/app.config.ts`: Necessary for TICKET-032 (App initializer hydration).
12. `apps/web/src/app/layouts/public-layout/public-layout.component.ts`: Necessary for TICKET-032 (Session-aware public header).
13. `apps/web/src/app/layouts/public-layout/public-layout.component.html`: Necessary for TICKET-032 (Header UI buttons).
14. `apps/api/src/modules/auth/guards/origin.guard.ts`: Necessary supporting security change (CSRF and reverse-proxy header verification).

---

### M. Security Findings and Corrective Recommendations

- **Status:** **ALL INVARIANTS PASS**.
- No unauthorized privilege escalations.
- Article ownership checks remain strictly bound to `authorId === user.id`.
- CSRF Fetch Metadata validation is robust.

---

### N. Backlog Preservation

The master backlog remains intact:
1. **P1-EDITOR-AUTOSAVE-UNDO-01:** TICKET-005 (Block Undo buffer) and TICKET-006 (Autosave feedback & timestamps).
2. **TICKET-019–022:** Article lifecycle, review submissions, revision history, and moderation workflows.
3. **TICKET-026:** Author Profile editing and public bio display.
4. **TICKET-028:** Account governance and profile settings.
5. **TICKET-031:** Taxonomy archival and restoration.
6. **P10:** Reader, media streaming, and cache validation.
7. **P11:** MCP Tools Catalog.

---

### O. Recommended Next Checkpoint

**`P1-EDITOR-AUTOSAVE-UNDO-01`** (Implementation of TICKET-005: Block deletion & Undo recovery buffer, and TICKET-006: Autosave status feedback with timestamps).

---

### P. Strict Stop Confirmation

Strict read-only verification is complete. No source files were edited, no tests were modified, no database mutations were made, and no Git commands were executed.

