# CHANGELOG

Meaningful implementation changes, newest first. Dates are UTC.

---

## 2026-09-07 — Phase 2: Persian engine

New package: `packages/normalizer`, deterministic and dependency-free — no AI, no database
(ADR-0012). Eleven modules plus the `extractPreferences` orchestrator, 230 module-level tests
plus 15 integration-style tests for `extractPreferences` itself (245 new tests; 312 total
across the repository, up from 82 after Phase 1).

### Modules

- `text.ts` — Persian/Arabic character normalization (`ي/ى→ی`, `ك→ک`, Heh variants,
  hamza-Alef variants). Alef with madda (`آ`) is deliberately excluded from the fold — a real
  bug caught by its own test suite: an early version collapsed "آپارتمان" to "اپارتمان",
  destroying a meaningful letter, not a typo variant. Also strips zero-width characters
  (ZWSP/ZWNJ/ZWJ/BOM) and collapses Unicode-width whitespace. Idempotent by construction and
  tested as such. Invisible/whitespace regex literals are built via `new RegExp` from
  explicit `\uXXXX` escape strings rather than pasting the actual invisible characters into
  the source file, so they stay visible in review and diffs.
- `digits.ts` — Persian/Arabic-Indic/Latin digit normalization; `parseDecimalLiteral` is
  strict about grouping (`"12,5"` is rejected, not silently accepted) and returns an exact
  `{integer, fraction, fractionDigits}` structure; `scaleDecimalToBigInt` multiplies by a
  scale (e.g. one billion) using only `bigint` arithmetic — no floating point anywhere in the
  money path, including the case that would expose float drift (`0.1 * 1_000_000_000`).
- `number-words.ts` — Persian number words (units/tens/hundreds/هزار/میلیون/میلیارد) via one
  accumulate-and-flush algorithm that serves both a plain count ("صد و بیست و پنج" → 125) and
  a cross-scale money compound ("پنج میلیارد و دویست میلیون" → 5,200,000,000).
- `money.ts` — total vs. per-square-meter (`متری`), exact vs. range, an `approximate` flag
  for `حدود`/`تقریبا`/`نزدیک`, Rial→Toman conversion (exact division by 10, rejected rather
  than rounded if not whole), and a hard ambiguity rule: a bare number with neither an
  explicit currency word nor a scale word anywhere in the expression is `unknown` — "500"
  alone is not a price.
- `area.ts` — requires a unit suffix (`متر`/`متری`/`m`/`m2`/`sqm`); a bare number is `unknown`
  rather than guessed. `at_least`/`at_most` comparators (`بیشتر از`/`کمتر از`) and an
  `approximate` flag, both preserved explicitly rather than collapsed into a plain value.
- `rooms.ts` — digit and word counts with `خواب`/`خوابه`/`اتاق`/`اتاق خواب`. Structurally
  cannot false-positive on an unrelated number: MASTER_PROMPT's own adversarial example,
  `"۱۲۵ متر، ۲ پارکینگ"`, is a direct test case and correctly returns `unknown`.
- `floor.ts` — numeric floor, ordinal words (`سوم`→3), "N از M", and `همکف`/`زیرزمین`/
  `پنت‌هاوس` as their own `kind: "category"` result — not mapped to an arbitrary integer,
  since `posting.floor` (migration `0002_core_schema`) has no category column to map onto.
- `building-age.ts` — explicit Jalali construction year (`ساخت ۱۴۰۲`), `نوساز`/`کلیدنخورده`,
  and relative age (`۵ ساله`) kept as _relative_ rather than resolved to an absolute year —
  doing that needs a reference "now", which would make the parser's output depend on when it
  happens to run.
- `attributes.ts` — tri-state (`true`/`false`/`null`) parking/elevator/storage/balcony/pool/
  guard/lobby/jacuzzi. Absence of a mention is always `null` (unknown), never `false`; a bare
  checklist-style mention (just "پارکینگ" with no further qualifier) defaults to `true`,
  matching how real listings enumerate amenities; contradictory mentions resolve to unknown.
  A real bug caught here too: punctuation left glued to a token by `normalizeText` (which
  canonicalizes character forms but doesn't add spacing) broke noun matching until tokens
  were stripped of edge punctuation before comparison.
- `geography.ts` — a small, explicitly seeded Tehran neighborhood/district alias list (not a
  speculative database, per MASTER_PROMPT §9), with digit normalization applied so `"منطقه
۲"` and `"منطقه 2"` resolve identically.
- `jalali.ts` (ADR-0013) — Jalali↔Gregorian conversion implemented in-house from the standard
  Borkowski/Fliegel-Van-Flandern algorithms rather than a dependency, to keep the package
  fully dependency-free. A real bug here too: the initial `div` helper was `Math.trunc`
  passed directly as a two-argument function — `Math.trunc` only reads its first argument, so
  `div(a, b)` silently ignored `b` and produced billion-scale garbage dates. Caught
  immediately by the test suite (55 tests: round-trip across 21 years, a 3-year consecutive-
  day walk with no gaps/duplicates, Nowruz-is-always-March-20-or-21 across 40 years, two
  independently-recalled documented reference dates — Nowruz 1400 = 2021-03-21, Nowruz 1403 =
  2024-03-20 — and invalid-date rejection), never reached the committed state.
- `preferences.ts` — `extractPreferences(text)`, the non-AI extraction pipeline. Splits input
  on commas into clauses (not "و", which is part of money's own compound grammar), then
  searches every contiguous token window within a clause for each field — necessary because
  MASTER_PROMPT §14's own worked example packs area, room count, and district into one clause
  alongside ordinary sentence text, not its own clause per field. Both of the brief's worked
  examples (§12 and §14) are direct test cases and pass. Explicit `required`/`forbidden`/
  `no_preference`/`unknown` states for attributes — `"پارکینگ مهم نیست"` becomes
  `no_preference`, never `forbidden` and never silently `unknown`.

### Documentation

- ADR-0012 (`packages/normalizer` is fully deterministic — no AI, no database dependency) and
  ADR-0013 (in-house Jalali conversion) added to `DECISIONS.md`.
- `ARCHITECTURE.md` updated: `packages/normalizer` moved from "(Phase 2, planned)" to its
  actual module list; noted as dependency-free and not yet wired into `apps/web`/`apps/worker`.
- `ROADMAP.md` Phase 2 marked complete, with one explicit exception: a standalone 50–100-
  sentence evaluation corpus with a measured accuracy baseline (an aspiration recorded in
  `ROADMAP.md` back in Phase 0) was not built as its own artifact. This session's actual
  Phase 2 instructions asked for comprehensive unit tests instead, delivered as 312 tests
  including the brief's own worked examples and explicit adversarial cases — real coverage,
  but not the same artifact, and flagged as still open rather than silently marked done.

### Verification

`npx vitest run`: **312 tests, 312 passed, 0 skipped** (25 of them the Phase 1 integration
tests, executed live against PostgreSQL as before). `npm run verify` passes in full: format,
lint, typecheck, tests, build.

## 2026-09-07 — Phase 1 verification: live database

Docker Desktop and the host disk-space issue (see the "Known gap" in the entry below) are
resolved. Re-ran verification against a real PostgreSQL instance rather than the self-skipped
integration suite:

- `docker info` succeeds; `npm run db:up` → `smart-finder-postgres-1` reaches
  `Status: running  Health: healthy`; `pg_isready` confirms it accepts connections.
- `npm run db:migrate` applies `0002_core_schema` (692ms). Re-running is a no-op (0 applied, 2
  skipped) — idempotency holds.
- Schema inspection confirms: 18 domain tables (plus `schema_migration` and PostGIS's
  `spatial_ref_sys`), extensions `pgcrypto`/`pg_trgm`/`postgis` (+ dependents) installed, 63
  indexes, 8 `updated_at` triggers, and the `search_profile` one-active-per-user partial
  unique index — all confirmed via `psql`.
- `npx vitest run`: **82 tests, 82 passed, 0 skipped.** The 25 tests that previously
  self-skipped now run for real, verbosely confirmed one by one, including:
  - `claimJobs` under genuine concurrency — two simultaneous claims for one job, `SKIP LOCKED`
    gives it to exactly one;
  - retry-then-reclaim and terminal-failure backoff behavior;
  - the one-active-profile-per-user replace/history flow;
  - all three IDOR-scoping tests (`getSearchProfileById`, `deactivateSearchProfile`,
    `listSearchProfileHistory` each return nothing to a non-owning user).
- `npm run verify` passes in full: format, lint, typecheck, 82/82 tests, build.

**Phase 1 is now verified-complete**, not merely code-complete. No schema or code changes were
made to reach this result — the code from the entry below was correct as written; only its
verification was previously blocked.

## 2026-09-07 — Phase 1: core domain (code complete; DB verification pending at the time)

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
