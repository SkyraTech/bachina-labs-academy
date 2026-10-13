# Bachina Labs Academy — MCP Server Architecture

**Status:** Owner-requested V1 functionality; implementation details subject to security/compatibility review. **Updated:** 2026-10-13

## 1. Intent
AI assistants (including compatible ChatGPT/Claude configurations) can connect to the **Academy MCP server** to read articles and, most importantly, let **authenticated entitled authors create, edit, preview and publish their own articles**. MCP is an interface to NestJS services, not an AI inference/chatbot provider. The Academy acting as an **MCP client** of external servers is future scope.

## 2. Integration
`AI Assistant → Streamable HTTP /mcp (proposed) → MCP authorization → MCP tool handler → NestJS application service → repository → Prisma → PostgreSQL`.

Do not place direct Prisma calls or external REST calls in MCP handlers. Use an SDK/package/version that is current and verified against target clients at implementation time; avoid assuming that any custom MCP endpoint is discoverable in every assistant plan.

## 3. Tool catalog (proposed contract identifiers)
| Name | Operation | Security |
|---|---|---|
| `academy_list_articles` | Filter/paginate published article list | Authenticated + MCP entitlement |
| `academy_get_article` | Return published content + attribution URL | Authenticated + MCP entitlement |
| `academy_search_articles` | Search published content | Authenticated + MCP entitlement |
| `academy_list_categories` | List public categories | Authenticated + MCP entitlement |
| `academy_list_tags` | List tags | Authenticated + MCP entitlement |
| `academy_get_author` | Public author profile | Authenticated + MCP entitlement |
| `academy_list_author_articles` | Published author articles | Authenticated + MCP entitlement |
| `academy_create_article_draft` | Create new draft for current account | Auth + MCP entitlement + scope + author permission |
| `academy_get_my_articles` | List own articles and drafts | Same, ownership-bound |
| `academy_get_my_article` | Fetch own draft/article | Same, ownership-bound |
| `academy_update_article` | Update own article/metadata | Same, ownership-bound |
| `academy_preview_article` | Preview own draft content | Same, ownership-bound |
| `academy_publish_article` | Explicitly publish own article | Same + publish-specific scope/permission |

This is the **candidate** tool inventory, not a frozen public API. Save draft is covered by `create`/`update`; separate save tool only if proven necessary.

## 4. MCP authorization
- No anonymous MCP access. Free users denied by entitlement regardless of tool type; exact premium tier assignment deferred.
- Establish a secure account-connection/consent flow using standards-compatible authorization suitable for remote MCP clients; evaluate OAuth 2.1/OAuth protected-resource metadata and client registration needs against actual client support.
- Keep MCP access (`MCP_ACCESS`) distinct from granular scopes (`articles:read`, `articles:write`, `articles:publish` proposed).
- Resolve actor ID **from verified identity**, not from tool arguments. Verify account active, entitlement live, scope sufficient, article ownership and article-state rules **on every call**.
- Revoked, expired or downgraded accounts lose MCP access; fail closed during unknown entitlement states.
- Keep grant lifecycle/revocation metadata, hash stored opaque secrets when relevant, rotate credentials. Do not log credentials or sensitive article drafts.
- Cross-origin and host validations, HTTPS, rate/concurrency/response-size limits, and request timeouts. Follow current transport spec at coding time.

## 5. Business safety
- Author workflows **do not** require editorial approval.
- Creation defaults to private draft. Publishing separate tool action, not a side effect of editor save.
- Published read only for public article tools; never disclose other people's drafts, emails, auth status, tokens or admin data.
- Constrain pagination, query lengths, returned article content and media references. Return canonical source URLs, title, published date and public author info where appropriate.
- MCP reads **do not increment human article-view counts**.
- Treat all stored article content as untrusted from an AI-prompt perspective; sanitize rendering and avoid unsafe interpretation of article text as instructions.

## 6. Proposed module boundaries
```text
apps/api/src/modules/mcp/
  mcp.module.ts
  server/
  transport/
  tools/
  schemas/
  presenters/
  security/
  tests/
```

Avoid generating empty placeholder files during initial scaffold; implement these when MCP phase starts.

## 7. Acceptance tests
1. Free author with valid login cannot list/call MCP tools.
2. Entitled author can create a private draft and see it under own account.
3. Entitled author cannot retrieve/edit another user's draft.
4. Updating a draft does not publish it.
5. Explicit publish changes visibility using existing article service rules.
6. Revoking/downgrading a subscription invalidates effective MCP access immediately or within an approved bounded interval.
7. Invalid OAuth scope is rejected; tool names/arguments validated.
8. MCP article reads do not count as page views.
9. Compatible ChatGPT/Claude clients are exercised against actual deployed test endpoint before stating compatibility.

## 8. Not included
Academy MCP **client** connections to third-party MCP servers, AI model usage, full chat agent, automated approval/review workflow, payment integrations.
