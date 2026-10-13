# Bachina Labs Academy — Repository Setup Instructions

**For developer + Google Antigravity.** These Markdown documents are prepared externally; agent must not generate/modify `.md` files.

## 1. Environment reported on developer's Windows machine
- Node `v24.21.0`
- npm `11.19.0`
- pnpm `12.3.4`
- Git `2.53.0.windows.2`

No immediate upgrade indicated from these reported versions; framework compatibility and registry access must be checked during actual setup. On Windows PowerShell: `node -v`, `pnpm -v`, `git --version`.

## 2. Working directory
Suggested `C:\Projects\BachinaLabsAcademy` to reduce OneDrive sync/file watcher problems. User's existing directory was beneath OneDrive; **do not move files without explicit user approval**. Keep `docs/` exactly as copied from this bundle.

## 3. Workspace expectation
- One pnpm monorepo (two apps); package manager version pinned to installed `pnpm@12.3.4` if compatible with build tools.
- One Angular app under `apps/web` and one NestJS app under `apps/api`.
- Root tooling/configuration/scripts and pnpm lockfile, but **NO Markdown files created by Antigravity**, including root README.
- Both apps independently buildable and runnable.
- Prisma location chosen once (for example `apps/api/prisma/`) and documented in setup completion report; do not duplicate schemas.
- Minimal health API `/api/v1/health` if sensible. No business endpoints/DB entities yet.

## 4. Important agent restrictions
1. Read all supplied `docs/*.md`, especially `DEVELOPMENT_RULES.md` and `PROJECT_TASKS.md`.
2. Never create/edit/move/delete `.md` files; if an Angular/NestJS CLI generates README.md, remove only that newly generated file before completion without touching user's docs, and report what happened.
3. Do not publish repository, commit secrets, initialize cloud resources or push to GitHub automatically.
4. Do not install a huge architecture framework or build app features in this step.
5. Verify installs/builds/typecheck/tests where possible; if missing local Postgres, do not fabricate database test results.

## 5. Suggested setup report fields
Workspace tree; exact framework/package versions; root scripts; status of pnpm install, web build, api build, lint/tests, dev smoke tests; list of blockers; next recommended step (Prisma/schema design).
