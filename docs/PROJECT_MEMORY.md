# Bachina Labs Academy — Project Memory / Decision Log

**Updated:** 2026-10-13 | **Owner:** Skyra Tech | **Purpose:** Durable facts, decisions and open questions.

## Confirmed product decisions
- Client is Bachina Labs, contact Bhargav; development company Skyra Tech.
- ₹1,50,000 fixed development fee originally agreed for V1; original milestone split 40/40/20. Owner subsequently requested MCP and feature-entitlement capabilities **within the same total fee**, subject to client written scope alignment.
- Public technical-article site + registered author drafting/editing/direct publish **without administrator approval**.
- Basic comments, article views/summary analytics, transactional account/security email and simple share links included.
- Public content SEO and mobile responsive experience required.
- No LMS, course/certificate system, mobile app, advanced analytics/forum, AI chatbot infrastructure or distributed microservices in current approved direction.

## Architecture decisions
- **One private Git repository**, one product, two apps: `apps/web` Angular and `apps/api` NestJS; one PostgreSQL database through Prisma; microservice-ready modular monolith.
- REST `/api/v1` with Swagger/OpenAPI. MCP server is module in NestJS, not a third deployable app. Academy MCP client connecting to external MCP servers is future consideration.
- NestJS not Next.js. Controller → application service → repository → Prisma layering.
- Developer environment reported Node 24.21.0, npm 11.19.0, pnpm 12.3.4, Git 2.53.0.windows.2. Framework targets Angular 22 / NestJS 12 **to verify** at project initialization.

## MCP and subscriptions
- MCP's **main value is authenticated authors writing articles using external assistants**, including create draft, edit, retrieve own drafts, preview and explicit publish, plus discovery/read tools.
- MCP never allows arbitrary author impersonation, cross-user draft access or implicit publish.
- MCP **must not be available to Free plan users**; allocation among anticipated two paid plans TBD.
- Approximately **three plans** anticipated, with exact names/pricing not set. Admin manages which implemented features each plan gets via feature-access matrix.
- Separate roles/permissions, subscription entitlements and OAuth/MCP scopes; admin configurability must not grant admin roles.
- Plan billing/checkout/renewal gateway not finalized; **do not assume payment integration**.

## Branding decisions
- Primary orange `#F97316`, deep orange `#C2410C`, charcoal `#20242B`, cream `#FFF7ED`, white `#FFFFFF`, slate `#64748B`.
- Teal not a brand color; blue not a required brand color.
- Premium branded minimal SaaS style based on Linear's structure, but more distinctive and professional; light, dark, system themes.
- Mockups/logo/tokens beyond core palette not fully signed off.

## Documentation ownership / Antigravity workflow
- User wants **all Markdown project documents exclusively in one `docs/` folder**.
- **ChatGPT provides and updates Markdown files on request. Antigravity may read them but must not create, overwrite or alter any `.md` files without express approval.**
- Current next step: scaffold workspace/apps and tooling only; no feature code. Avoid active repo under OneDrive if possible.

## Pending decisions
- Client-facing revised scope confirmation and timeline impact; final feature matrix and subscription lifecycle; SSR/hosting; identity/OAuth flow for actual MCP clients; editor schema; media and email providers; migration schema finalization; admin seed/authorization; logo/mockup and typographic details.

## Source precedence caution
Original Proposal, Architecture Plan, Quotation and Agreement are client documents. Earlier project/database architecture drafts predate MCP/subscription decisions. This memory records **later owner directions for proposed implementation** and does not override signed contracts. Resolve and document conflicts before modifying client contracts.
