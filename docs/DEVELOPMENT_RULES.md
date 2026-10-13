# Bachina Labs Academy — Development Rules

**Applies to:** all Angular, NestJS, Prisma, MCP and automation-authored code. **Updated:** 2026-10-13

## 1. Authoritative decisions
One Git monorepo; Angular frontend in `apps/web`, NestJS backend in `apps/api`; PostgreSQL/Prisma; REST plus nested MCP server; microservice-ready modular monolith. All `.md` documents live in **`docs/` only**. **AI IDE must not create, rewrite, rename or relocate Markdown files without explicit approval.** Existing documents are context, not an invitation to amend them.

## 2. Setup conventions
Use Node 24.x LTS (developer reports 24.21.0), pnpm 12.3.4 already installed. Confirm Angular/NestJS/Prisma compatible versions during setup, lock them, and pin `packageManager` consistently with actual installation. Prefer pnpm workspace; no Nx/Turborepo without accepted necessity. Store no secrets in Git. Keep `.env.example` templates outside tracked secrets; README belongs in `docs/` rather than repo root per owner's documentation preference unless tool requires otherwise.

## 3. TypeScript and architecture
- Strict typing; no habitual `any`; explicit boundaries, typed DTOs, predictable errors.
- **NestJS:** transport controller/handler → service → repository → Prisma. Domain invariants live in services; data access encapsulated by repositories.
- **Angular:** feature-oriented lazy routes; core infrastructure isolated from shared presentation; typed forms and HTTP clients; no business rules embedded in components.
- **MCP:** thin protocol adapters; reuse application services, identity, roles, ownership, entitlement and logging.
- Shared package only for genuinely reusable contracts; avoid tight coupling through a giant `common` module.
- Do not use hard-coded subscription tier comparisons; use stable feature keys and effective entitlement service.

## 4. Security
Password hashing, secure token lifecycle, validation, sanitization of authored content, rate limits, explicit CORS/origin policy, HTTPS in production, no unrestricted upload or remote URLs. Never log secrets, tokens or private article bodies. Never use frontend feature hiding as authorization. API returns explicitly shaped data, not raw ORM objects. Enforce publication state and owner/admin rules in backend.

## 5. Data access
Use one authoritative Prisma schema and migrations, managed by one owner. Do not create duplicate Prisma clients; avoid uncontrolled `prisma db push` for production. Define indexes based on list/filter/sort queries; stable pagination; avoid N+1; use transactions for business-invariant updates and plan configuration changes; test migration deployment and rollback/recovery.

## 6. Tests and review gates
- Every business rule needs at least useful service tests; critical auth/ownership/entitlements/MCP have integration tests.
- Mandatory checks at milestones: typecheck, lint, unit test and app builds; explicitly disclose failures.
- Validate mobile responsiveness, light/dark/system behavior and author draft/publication lifecycle.
- No code generation or package installation beyond agreed step boundaries without documenting what it does.

## 7. Git and secrets
One private repo; `main` stable, feature branches, review before merge, focused commits. Use ignore files for `node_modules`, build outputs, `.env`, secret JSON and IDE state. Avoid `git push`, remote creation or cloud provisioning without user approval. Record important architecture changes in `docs/PROJECT_MEMORY.md` **only when user requests documentation changes**.

## 8. Working with Google Antigravity
Each prompt should give a step boundary, files allowed to be changed, verification commands and required completion report. Agent may READ existing `docs/*.md` but must **NEVER create/edit/delete/move Markdown documentation files** unless user explicitly changes this rule. Do not overwrite uploaded client documents. On environment/tooling differences, inspect first rather than guessing. On install failures, report blocker; do not claim success.
