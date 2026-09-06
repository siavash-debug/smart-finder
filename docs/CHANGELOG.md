# CHANGELOG

Meaningful implementation changes, newest first. Dates are UTC.

---

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
