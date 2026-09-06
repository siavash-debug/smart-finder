# smart-finder

Persian-language real-estate discovery and alert platform for Tehran. Users describe the
apartment they want; the system finds exact and near matches, deduplicates listings that
describe the same physical property, tracks price changes, and notifies over Telegram.

**Project memory lives in [`docs/`](docs/).** Read
[`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md) (the authoritative brief),
[`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) (current state),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ROADMAP.md`](docs/ROADMAP.md), and
[`docs/DECISIONS.md`](docs/DECISIONS.md) before making changes.

Current status: **Phase 0 — foundation.** No listings are collected yet and search is not
available.

## Requirements

- Node.js >= 22 (development is on 24/26; containers run 24 LTS)
- Docker, for local PostgreSQL
- npm 9+ (workspaces; no other package manager needed — see ADR-0001)

## Getting started

```bash
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run db:up                 # starts PostgreSQL 16 + PostGIS
npm run build:packages        # compile workspace packages once
npm run db:migrate            # apply migrations
```

Then run either plane:

```bash
npm run dev:web               # http://localhost:3000
npm run dev:worker            # health server on http://localhost:3001
```

Workspace packages are consumed from their compiled `dist/`, so while editing
`packages/*` run the incremental compiler alongside the app:

```bash
npm run watch:packages
```

Tests resolve `@smart-finder/*` straight to TypeScript source, so they never need a build.

## Verifying

```bash
npm run verify
```

Runs, in order: format check → lint → typecheck → tests → build. This is the gate a phase must
pass before it is considered complete (MASTER_PROMPT §38).

Individually:

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run lint`      | ESLint (flat config, type-aware) across the repo   |
| `npm run typecheck` | `tsc --build` for packages, `tsc --noEmit` for web |
| `npm test`          | Vitest, all workspaces                             |
| `npm run build`     | Compile packages, then `next build`                |
| `npm run format`    | Prettier, write mode                               |

## Layout

```
apps/web            Next.js 16 · Persian RTL UI · serve plane
apps/worker         long-running Node process · ingest plane
packages/shared     env validation, structured logging, health shapes
packages/database   pg pool, migrations, health probe
infrastructure/     Dockerfiles and compose
docs/               project memory
```

Packages named in `docs/ARCHITECTURE.md` but absent from the tree (`normalizer`, `matching`,
`telegram`, `scraper`, `ai`) are created by the phase that first implements them (ADR-0008).

## Health endpoints

Both planes expose the same pair (ADR-0010):

- `GET /healthz` — liveness. No dependencies, always 200 while the process can serve.
- `GET /readyz` — readiness. Probes PostgreSQL; 200 `ready` or 503 `not_ready`.

Web serves them on `PORT` (default 3000); the worker on `WORKER_HEALTH_PORT` (default 3001).

## Environment

Every variable is documented in [`.env.example`](.env.example). `.env` is git-ignored and must
never be committed. Secrets are server-only and must never appear in a `NEXT_PUBLIC_*`
variable (MASTER_PROMPT §24).

## Containers

```bash
docker compose -f infrastructure/docker/docker-compose.yml --profile apps up --build
```

Images are plain Node images, not tied to any hosting provider — the worker and database can
be deployed anywhere (MASTER_PROMPT §33).

## Conventions

- User-facing text is Persian; code, comments, docs and commits are English.
- Money is `BIGINT` Toman carried as `bigint`; never a float (ADR-0005).
- Timestamps are UTC internally, rendered Jalali at the UI boundary.
- Unknown attributes render as `نامشخص` — never guessed, never coerced to `false`.
- Listing text is untrusted input: escaped on render, bound as SQL parameters, never treated
  as instructions.
