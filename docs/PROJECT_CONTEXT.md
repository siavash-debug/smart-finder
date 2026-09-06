# PROJECT CONTEXT

Current state of the project. Updated at the end of every meaningful task.

**Last updated:** 2026-09-06 · **Phase:** 0 (Foundation) — complete

---

## What are we building?

A Persian-language real-estate discovery and alert platform for Tehran. A user describes the
apartment they want — as a structured form or in free Persian text. The system watches
supported listing sources, finds exact and near matches, recognises when several
advertisements describe the same physical property, tracks price changes, and notifies the
user over Telegram when something relevant appears.

The product is not a notification bot. It is a **deduplicated market view with opportunity
detection and personalised alerts** (MASTER_PROMPT §3).

## What is the current MVP?

Tehran · apartments · sale · Divar as the only source · one search profile per user ·
Telegram for auth and notifications · Persian RTL mobile-first UI.

Everything in MASTER_PROMPT §5 is explicitly out of scope until requested.

## What has been implemented?

**Phase 0 — foundation. Complete and verified.**

- npm-workspaces monorepo; TypeScript 5.9 project references; ESLint 10 flat config with
  type-aware rules; Prettier; Vitest 5.
- `packages/shared` — Zod-validated environment loading (separate schemas per plane),
  dependency-free structured JSON logger with secret redaction, health-report shapes.
- `packages/database` — `pg` pool with a `bigint` type parser for money, transaction helper,
  bounded database health probe, forward-only checksummed migration runner with an advisory
  lock, and migration `0001_extensions` (pgcrypto, pg_trgm, optional postgis).
- `apps/web` — Next.js 16 App Router, React 19, Tailwind 4, `dir="rtl"` Persian shell with
  self-hosted Vazirmatn; `/healthz` and `/readyz` route handlers.
- `apps/worker` — long-running process with a health server, abort-driven poll loop, and
  graceful SIGTERM/SIGINT drain.
- `infrastructure/docker` — Postgres 16 + PostGIS compose service, worker and web Dockerfiles.
- 46 unit tests. `npm run verify` (format → lint → typecheck → test → build) passes.

**Verified by running it, not just by compiling:**

- Migrations applied against a real PostgreSQL 16 container, and re-running is a no-op.
  All required extensions present.
- Worker container built, started, and stopped with `docker stop`: exit code 0 with the full
  drain sequence in the logs, confirming SIGTERM handling and tini signal forwarding.
- `/healthz` 200, `/readyz` 200 with database latency, 404 on unknown paths, 405 on POST.
- With PostgreSQL stopped: `/healthz` stayed 200 while `/readyz` returned 503 with a bounded
  2 s probe timeout, then recovered to 200 on its own once the database came back — the
  liveness/readiness split in ADR-0010 behaving as designed.

## What is currently broken or unverified?

- **`infrastructure/docker/Dockerfile.web` has never completed a build.** The host disk (`C:`)
  filled to 100% partway through; the Docker daemon's own storage went read-only, so the build
  could not finish and images could not even be deleted. The failure was environmental — the
  `npm ci` layer had already succeeded. The Next.js application itself builds correctly
  natively (`npm run build`). **Free disk space and re-run the build before trusting the web
  image.**
- Graceful shutdown could not be exercised on Windows directly: Node on Windows terminates on
  `kill -TERM` without running signal handlers. It is verified inside the Linux container,
  which is where it matters.
- No listings are collected and search is not available. This is expected at Phase 0.

## What is the next step?

**Phase 1 — core domain.** In order:

1. Migration `0002_core_schema` for the entities in MASTER_PROMPT §8, with the indexes the
   match fan-out and dedup candidate queries will need.
2. Repository layer per aggregate, every user-scoped query filtered by `user_id`.
3. Job queue on top of the `job` table using `SELECT ... FOR UPDATE SKIP LOCKED`, replacing
   the worker's idle tick in `apps/worker/src/index.ts`.
4. Integration tests against a real Postgres container, including an IDOR-scoping assertion.

## What decisions are locked?

Locked by `MASTER_PROMPT.md` and recorded in `DECISIONS.md`; changing any of these needs
explicit user approval (MASTER_PROMPT §43):

- PostgreSQL is the primary database **and** the job queue. No Redis, Kafka, or D1 (ADR-0003).
- Two independent execution planes; the worker never depends on request lifetime (ADR-0004).
- Money is `BIGINT` Toman carried as `bigint`. Never floating point (ADR-0005).
- `posting` (one advertisement) and `property` (one physical unit) are distinct entities;
  uncertain duplicates are never auto-merged (ADR-0006).
- Matching is deterministic and dependency-free. AI may interpret and extract, but never
  decides a match. Unknown is `نامشخص`, never `false` (ADR-0007).

Reversible engineering choices, changeable without approval: npm workspaces (ADR-0001),
TypeScript 5.9 (ADR-0002), lazy package creation (ADR-0008), Node 24 LTS in containers
(ADR-0009), the `/healthz` + `/readyz` split (ADR-0010).

## Working agreements

- Read this file, `MASTER_PROMPT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, and `DECISIONS.md`
  before starting a task. Update them when the answer changes.
- `npm run verify` must pass before a phase is called complete (MASTER_PROMPT §38).
- Never report a phase complete with a failing or skipped check. Say what was skipped and why.
