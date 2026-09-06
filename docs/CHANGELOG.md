# CHANGELOG

Meaningful implementation changes, newest first. Dates are UTC.

---

## 2026-09-07 — Phase 1: core domain (code complete; DB verification pending)

### Schema

- `packages/database/migrations/0002_core_schema.sql` — all eighteen tables from
  MASTER_PROMPT §8 (`app_user` in place of the reserved word `user`), plus
  `duplicate_candidate` implementing §28's uncertain-duplicate requirement. Match fan-out and
  dedup-candidate indexes, `updated_at` triggers, three-state nullable booleans (never
  defaulted to `false`), and check constraints throughout (money non-negative, min ≤ max on
  ranges, one active `search_profile` per user via a partial unique index).

### `packages/database`

- `pool.ts` — added `Queryable` (`Pick<pg.Pool, "query">`), the type every repository and
  queue function now takes, so callers can pass a plain pool or a client already inside a
  transaction. `replaceActiveSearchProfile` is the sole exception, since it opens its own
  transaction and needs a real `Pool`.
- `job-queue.ts` — `enqueueJob`, `claimJobs` (one atomic `UPDATE ... FROM (SELECT ... FOR
UPDATE SKIP LOCKED)`, so two workers polling at once never claim the same row),
  `completeJob`, `failJob`. `computeBackoffMs` is full-jitter exponential backoff (base 1s,
  capped at 5 minutes), a pure function so it is tested without a database.
- `user-repository.ts` — `createUser`, `findUserById`, `findUserByTelegramId`,
  `findOrCreateUserByTelegramId` (a single `INSERT ... ON CONFLICT`, not read-then-write, so
  two logins racing for a new Telegram id cannot both attempt an insert).
- `search-profile-repository.ts` — `getActiveSearchProfile`, `getSearchProfileById`,
  `replaceActiveSearchProfile` (transactional: snapshots the previous active profile to
  `search_profile_history`, deactivates it, inserts the new one), `deactivateSearchProfile`,
  `listSearchProfileHistory`. Every function takes `userId` and filters by it in SQL — the
  IDOR defence MASTER_PROMPT §24 requires.
- Only these two repositories and the job queue were built this phase; the remaining fifteen
  tables get theirs when their consuming phase arrives (ADR-0011, same reasoning as ADR-0008).

### `apps/worker`

- `job-dispatcher.ts` — `processClaimedJobs` (pure: dispatches a batch to a handler registry,
  reports outcomes through injectable effects, never throws — one bad job cannot take down the
  rest of its batch) and `createJobPollTick` (binds it to the real queue). `index.ts` now runs
  this in place of the Phase 0 idle tick. The handler registry is empty — no job producer
  exists until the Phase 5 collector; an unhandled `job_type` fails loudly rather than being
  silently dropped.

### Tests

- 25 integration tests across `job-queue.integration.test.ts`,
  `user-repository.integration.test.ts`, and `search-profile-repository.integration.test.ts`:
  concurrent claim exclusivity, priority ordering, retry-then-reclaim, the
  one-active-profile-per-user replace/history flow, and the IDOR-scoping tests this phase's
  exit criteria specifically call for. Every one self-skips (`it.runIf`, gated on a top-level
  `await isTestDatabaseAvailable()`) rather than failing when no database is reachable.
- 20 new unit tests: `computeBackoffMs` (pure), and `processClaimedJobs`'s dispatch/error
  handling with a fake effects object — no database involved.
- `npm run verify` passes: format, lint, typecheck, 57 unit tests, 25 integration tests
  correctly self-skipped, build.

### Known gap

- **The 25 integration tests have not been executed against a live database.** Docker Desktop
  is down on this machine — a downstream consequence of the Phase 0 disk-full event: the
  daemon's own image/container storage was left corrupted, and by this phase Docker Desktop
  itself had stopped running. This blocks running `npm run db:migrate` and the integration
  suite for real. Not a defect in the schema or repository code — tracked in detail in
  `PROJECT_CONTEXT.md`, with the exact commands to run once Docker is back.

## 2026-09-06 — Phase 0: foundation

Repository initialised from empty. Everything below is new.

### Project memory

- `docs/MASTER_PROMPT.md` — the complete brief, verbatim, as the authoritative source of truth.
- `docs/PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md` (ADR-0001 to
  ADR-0010), `CHANGELOG.md`, and a `README.md` covering setup, verification, and conventions.

### Monorepo and toolchain

- npm workspaces over `packages/*` and `apps/*` (ADR-0001).
- TypeScript 5.9.3 with project references. Each package has a `tsconfig.build.json` that
  emits and excludes tests, and a `tsconfig.json` that includes tests for the editor and for
  type-aware linting.
- Strict compiler settings: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`, NodeNext resolution.
- ESLint 10 flat config with `recommendedTypeChecked` and `stylisticTypeChecked`, plus
  `no-floating-promises`, `no-misused-promises`, and `no-explicit-any` as errors.
- Prettier 3, Vitest 5 (workspace packages aliased to source so tests never read a stale
  `dist/`), `.editorconfig`, `.gitignore`, `.dockerignore`.

### `packages/shared`

- `env.ts` — Zod schemas composed per plane, so the worker cannot receive web-only
  configuration. Fails fast at startup; validation errors name the offending key but never
  echo its value.
- `logger.ts` — dependency-free structured JSON logger: level filtering, child loggers with
  bound context, `Error` serialization including the `cause` chain, depth-limited redaction of
  secret-shaped keys, and a fallback line when context is not serializable.
- `health.ts` — liveness and readiness report shapes with `degraded` deliberately not blocking
  readiness.

### `packages/database`

- `pool.ts` — pooled `pg` client. `int8` is parsed to `bigint` so Toman amounts stay exact
  (ADR-0005); `numeric` is left as a string. Pool `error` listener prevents an idle-client
  error from crashing the process. `withTransaction` always releases its client.
- `health.ts` — readiness probe with its own timeout, independent of the pool's connection
  timeout, reporting only the error class rather than connection details.
- `migrate.ts` — forward-only runner. Migrations run in filename order, each in its own
  transaction, under a session advisory lock. Applied migrations are checksummed with
  CRLF normalisation, and editing an applied file is a hard error.
- `migrations/0001_extensions.sql` — `pgcrypto` and `pg_trgm` required; `postgis` optional so
  the schema stays portable to managed Postgres without it.
- The migration runner is exported from `@smart-finder/database/migrate`, not the package
  root, so it stays out of the serve plane's bundle graph.

### `apps/web`

- Next.js 16 App Router, React 19, Tailwind CSS 4.
- `dir="rtl"`, `lang="fa"`, Persian-first mobile layout using logical properties; Vazirmatn
  self-hosted from `@fontsource-variable/vazirmatn` (no third-party font CDN).
- Reduced-motion and visible focus-outline defaults.
- `/healthz` (liveness) and `/readyz` (readiness, probes PostgreSQL) route handlers, both
  Node runtime and force-dynamic.
- Pool cached on `globalThis` so hot reload does not leak connections.

### `apps/worker`

- Long-running process: env → pool → health server → poll loop, with a graceful drain on
  SIGTERM/SIGINT and a forced exit if the grace period expires or a second signal arrives.
- `poll-loop.ts` — sequential, abort-driven loop that polls immediately while work is being
  found and sleeps otherwise; a throwing tick is logged and the loop continues rather than
  crashing the worker.
- The tick is deliberately idle: the `job` table does not exist until Phase 1.

### Infrastructure

- `docker-compose.yml` with PostgreSQL 16 + PostGIS, a healthcheck, and `web`/`worker` behind
  an `apps` profile.
- `Dockerfile.worker` and `Dockerfile.web` — multi-stage, `node:24-alpine`, non-root, tini for
  signal forwarding, container healthchecks.
- `.env.example` documenting every variable with server-only and public sections separated.

### Verification

- `npm run verify` passes: format check, lint, typecheck, 46 tests, build.
- Migrations applied against a real PostgreSQL 16 container; re-running is a no-op.
- Worker container built and stopped via `docker stop`: exit 0 with the full drain sequence
  logged, confirming SIGTERM handling through tini.
- Liveness/readiness split confirmed against a real outage: with PostgreSQL stopped,
  `/healthz` stayed 200 and `/readyz` returned 503 within its 2 s probe bound, then recovered
  to 200 unaided.

### Known gap

- `Dockerfile.web` has not completed a build: the host disk reached 100% mid-build and the
  Docker daemon's storage went read-only. Environmental, not a Dockerfile defect — the
  `npm ci` layer had already succeeded and the app builds natively. Re-run once disk is free.
