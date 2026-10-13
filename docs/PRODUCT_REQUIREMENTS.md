# Bachina Labs Academy — Product Requirements

**Owner:** Skyra Tech | **Client:** Bachina Labs (Bhargav) | **Version:** 1.1 working baseline | **Updated:** 2026-10-13

## 1. Product mission
A responsive public technical-knowledge and article-publishing website, with secure accounts, author self-publishing, basic administration and engagement, plus MCP-enabled AI-assistant author workflows. One product supports different subscription entitlements; it is **not** three separate applications.

## 2. Scope and status vocabulary
- **Original agreed V1:** Features described in the four original client documents.
- **Owner-directed V1 expansion:** New decisions in this project's conversation: MCP read/write integration, subscription-ready feature registry, admin plan/feature controls; intended to be delivered within the unchanged ₹1,50,000 development fee. **Record these in a revised client-approved scope/addendum before treating them as contractually accepted.**
- **Design proposal:** Technical mechanism that requires implementation review, not a promise of unapproved features.
- **Future / undecided:** No implementation until separately decided.

## 3. Actors and access
| Actor | Capabilities | Boundaries |
|---|---|---|
| Visitor | Read/search published content and authors | No private drafts, author tools or MCP |
| Registered author | Maintain account, create/edit own drafts, preview, publish without approval, comment | Ownership-based controls; no admin authority |
| Entitled subscriber | Above plus enabled subscription-controlled features, including MCP if assigned | Plan entitlement does not elevate role |
| Administrator | Manage permitted users, articles, taxonomy, comments, metrics, subscription plans and feature allocation | Audit sensitive changes; no bypass of security policy |

A visitor is not a persisted user role unless implementation requires one. No mandatory reviewer/approval queue.

## 4. Original agreed V1 features
### Public Academy
- Branded responsive home; published article list/detail; public authors; category/tag browsing; database-backed search/filtering/pagination.
- Article title, excerpt, cover/appropriate media, author, category, tags and dates; human-readable URLs.
- Basic SEO: title/description, canonical/Open Graph, robots/sitemap strategy and practical Angular rendering approach.
- Copy-link and native/platform share links (WhatsApp, LinkedIn, X); no sharing-history platform.

### Accounts
- Register, login/logout, forgot/reset password, profile management, backend role checks, secure sessions/tokens and hashed passwords.

### Authoring
- Author dashboard; create/edit articles; save draft; preview; directly publish own article; view own drafts/published items; category/tag/cover metadata.
- **No mandatory editorial review, article verification, reviewer assignment or approval state.**

### Admin
- Manage users, articles, categories, tags, comments and basic summary dashboard.

### Engagement, operations
- Authenticated comments on published articles; users manage own; admin moderation/removal.
- Basic article view count and high-level author/platform summaries (no advanced BI).
- Transactional account/security emails using provider adapter; provider costs external.

## 5. Owner-directed V1 additions: MCP
MCP is a **primary author workflow**, not read-only. The Academy exposes a NestJS MCP server over a suitable supported transport (proposed Streamable HTTP at `/mcp`); it is not an independently deployed microservice. Compatible AI assistants may discover/invoke permitted tools.

**Planned read tools:** published article list/detail/search, categories, tags, public author profile, author-published article list.

**Planned authenticated author tools:** create draft; list/retrieve **own** articles and drafts; edit own articles/metadata; preview; explicitly publish own articles. Publishing must be an intentional separate call, never a side effect of draft save.

**MCP access policy:** MCP requires an authenticated, active account and valid effective `MCP_ACCESS` entitlement. **Free users must not receive MCP access in production.** The specific paid plans granting it are undecided. External assistant compatibility and OAuth/authorization implementation need verification.

MCP tools reuse NestJS services, DTO validation, role/ownership checks; never use Prisma directly. MCP reads should not count as human article views.

## 6. Owner-directed V1 additions: subscriptions and feature control
- Build the **approved implemented** features once; decide plan assignments later through admin dashboard.
- Anticipated three plans (likely free + two paid); names, prices, exact matrix **TBD**.
- Separate **roles/permissions**, **feature registry**, **plan entitlements**, **user subscriptions**, and **MCP client grants**.
- Admin views plans, registered feature catalog and feature × plan access matrix, and can assign subscription plans to users using a controlled admin workflow.
- Admin toggling a capability must never grant unauthorized admin privileges or create functionality not coded/deployed.
- Free-account MCP access disabled as a non-negotiable final policy. During incomplete configuration default to deny (especially MCP).
- Plan activation/expiration/revocation rules and auditable admin changes required.

**Not yet approved:** online checkout, Stripe, automatic recurring billing, invoices, tax/checkout integrations, coupons, complex plan pricing. Admin-managed subscriptions are a practical candidate, but exact activation and expiry workflow must be confirmed before coding.

## 7. User stories and acceptance examples
| ID | Story | Minimum acceptance |
|---|---|---|
| PUB-01 | Visitor discovers article | Only published results; correct category/tag filtering and pagination |
| AUTH-01 | Author signs up / resets password | Verified safe token lifecycle and no account-secret disclosure |
| ART-01 | Author saves draft | Draft remains private to owner/admin as authorized |
| ART-02 | Author publishes | Appears publicly without review queue; explicit author action |
| CMT-01 | User comments | Must be authenticated; own comment management; admin moderation |
| ADM-01 | Admin manages content | Role authorization enforced on API, not only in Angular |
| MCP-01 | Entitled author connects AI assistant | Secure grant and tool listing; nonentitled/Free denied |
| MCP-02 | Entitled author creates draft | Draft belongs to authenticated identity, not caller-supplied user ID |
| MCP-03 | Entitled author publishes | Explicit action; ownership + entitlement + scope verified |
| ENT-01 | Admin changes plan feature matrix | Permissioned change persisted, audited, reflected server-side |
| ENT-02 | Subscription expires | Premium tools including existing MCP tokens denied at request time |

## 8. Exclusions / future ideas
LMS, courses, assessments/certificates; mobile applications; AI model integration/chatbot; Academy as MCP client of other servers; distributed microservices; advanced analytics/forum/marketing; dedicated Redis/Elastic/Kafka; extensive content migration. Payment processing/automated billing are **undecided, not assumed in V1**.

## 9. Change and acceptance control
Original fixed development fee **₹1,50,000** (40%/40%/20% as original quotation). Newly requested MCP and entitlement functionality is an owner-direction to absorb in the same price; review practical delivery impact and obtain corresponding written client scope confirmation. Scope precedence remains as in the signed agreement; this file is an internal implementation reference and does not by itself amend signed documents. Third-party hosting, media and email provider costs remain separate.

## 10. Open decisions
- Exact plan identities/prices; paid-tier MCP allocations; manual plan lifecycle details; whether trial subscriptions are needed.
- Hosting and frontend SSR, editor content format, media/email providers, session approach, MCP compatible client authorization flow, admin bootstrap process.
- Final visual mockups and production logo asset; specific feature flags to be exposed in admin UI.
