# PROJECT CONTEXT

Current state of the project. Updated at the end of every meaningful task.

**Last updated:** 2026-09-07 · **Phase:** 1 (Core domain) — verified complete

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

**Phase 0 — foundation. Complete and verified** (see `CHANGELOG.md` for detail).

**Phase 1 — core domain. Verified complete** — schema, repositories, and job queue built,
then confirmed against a live PostgreSQL instance on 2026-09-07 (see "What is currently
broken or unverified" below for the verification history, including the earlier environment
failure).

- Migration `0002_core_schema.sql` — all eighteen tables from MASTER_PROMPT §8 (`user` is
  named `app_user`; `user` is a reserved SQL keyword), with the fan-out and dedup indexes,
  `updated_at` triggers, and check constraints called for by §9–§30. `duplicate_candidate`
  implements §28's "uncertain pairs stay unmerged with a recorded confidence" requirement,
  which is described in prose in the brief but not named as its own table.
- `packages/database/src/pool.ts` — added a `Queryable` type (`Pick<pg.Pool, "query">`) that
  every repository and queue function now accepts, so a caller can pass a plain pool or a
  client already inside a transaction. `replaceActiveSearchProfile` is the one function that
  still requires a real `Pool`, because it opens its own transaction.
- `packages/database/src/job-queue.ts` — `enqueueJob`, `claimJobs` (single atomic
  `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)`), `completeJob`, `failJob` with
  full-jitter exponential backoff (`computeBackoffMs`, pure and unit-tested).
- `packages/database/src/user-repository.ts` and `search-profile-repository.ts` — the two
  repositories built this phase (ADR-0011 explains why not all eighteen tables got one yet).
  Every `search_profile` read/write is scoped by `user_id` in SQL.
- `apps/worker/src/job-dispatcher.ts` — dispatches claimed jobs to a handler registry; the
  registry is empty (no job producer exists until the Phase 5 collector). Split into a pure
  dispatch core (unit-tested with no database) and a thin wrapper bound to the real queue.
  `apps/worker/src/index.ts` now runs this instead of the Phase 0 idle tick.
- 25 integration tests (`*.integration.test.ts` in `packages/database`) covering job claiming
  under concurrency (including a genuine race between two concurrent `claimJobs` calls for the
  same row, asserting `SKIP LOCKED` gives it to exactly one), retry/backoff, the
  one-active-profile-per-user flow, and — the item this phase's exit criteria specifically
  calls for — IDOR scoping: a `search_profile` id known to one user resolves to `null` when
  looked up by a different user's id. **Executed against a live database on 2026-09-07 — see
  below.**
- 20 new unit tests for `computeBackoffMs` and the job dispatcher's pure dispatch logic.

## What is currently broken or unverified?

- **Resolved — Phase 1's integration tests have now been run against a live database.**
  History, so this is not lost: while Phase 1 was first implemented, Docker Desktop on this
  machine was down as a downstream effect of the disk-full event recorded in Phase 0 — the
  host disk filled to 100%, which corrupted Docker's own image/container storage
  (`input/output error` reading its content-addressed blobs), and Docker Desktop itself had
  stopped running (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file
specified`). The 25 integration tests self-skipped rather than failing, and Phase 1 was
  reported as code-complete but not verified-complete.

  On 2026-09-07, with the disk issue resolved and Docker Desktop restored, verification was
  re-run for real:
  - `docker info` succeeds; `npm run db:up` brings `smart-finder-postgres-1` to
    `Status: running  Health: healthy`; `pg_isready` confirms it accepts connections.
  - `npm run db:migrate` applies `0002_core_schema` (692ms) on top of the already-applied
    `0001_extensions`; re-running is a no-op (0 applied, 2 skipped) — idempotency confirmed.
  - Schema inspection: 18 domain tables present (plus `schema_migration` and PostGIS's
    `spatial_ref_sys`), 7 extensions installed (`pgcrypto`, `pg_trgm`, `postgis` and its
    dependents), 63 indexes, 8 `updated_at` triggers, and the `search_profile`
    one-active-per-user partial unique index all confirmed via `psql \d` and catalog queries.
  - `npx vitest run`: **82 tests, 82 passed, 0 skipped** — the 25 previously-skipped
    integration tests all ran and passed, verbosely confirmed test-by-test, including the
    SKIP LOCKED concurrency test and all three IDOR-scoping tests.
  - `npm run verify`: format, lint, typecheck, tests, build all pass.

  Phase 1 is now genuinely verified-complete, not just code-complete.

- The `Dockerfile.web` build gap from Phase 0 remains open — unrelated to this verification
  and out of scope for it; revisit separately.
- No listings are collected and search is not available — expected this early.

## What is the next step?

**Phase 2 — Persian engine.** Character/digit normalization, currency (Rial→Toman), area
parsing, Jalali dates, Tehran geography model, deterministic (non-AI) preference extraction,
plus the 50–100 sentence fixture corpus named in MASTER_PROMPT §32.

Not started yet — awaiting explicit go-ahead per current instructions.

## What decisions are locked?

Locked by `MASTER_PROMPT.md` and recorded in `DECISIONS.md`; changing any of these needs
explicit user approval (MASTER_PROMPT §43):

- PostgreSQL is the primary database **and** the job queue. No Redis, Kafka, or D1 (ADR-0003).
- Two independent execution planes; the worker never depends on request lifetime (ADR-0004).
- Money is `BIGINT` Toman carried as `bigint`. Never floating point (ADR-0005).
- `posting` (one advertisement) and `property` (one physical unit) are distinct entities;
  uncertain duplicates are never auto-merged (ADR-0006) — now implemented as the
  `duplicate_candidate` table.
- Matching is deterministic and dependency-free. AI may interpret and extract, but never
  decides a match. Unknown is `نامشخص`, never `false` (ADR-0007) — reflected in the schema as
  nullable three-state booleans (`has_elevator`, `require_parking`, etc.), never a default of
  `false`.

Reversible engineering choices, changeable without approval: npm workspaces (ADR-0001),
TypeScript 5.9 (ADR-0002), lazy package creation (ADR-0008), Node 24 LTS in containers
(ADR-0009), the `/healthz` + `/readyz` split (ADR-0010), lazy repository creation (ADR-0011).

## Working agreements

- Read this file, `MASTER_PROMPT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, and `DECISIONS.md`
  before starting a task. Update them when the answer changes.
- `npm run verify` must pass before a phase is called complete (MASTER_PROMPT §38). A phase
  whose tests self-skip for lack of infrastructure is **code complete**, not **verified
  complete** — say so explicitly, as this file does above, rather than reporting it as done.
- Never report a phase complete with a failing or skipped check silently absorbed. Say what
  was skipped and why.
- **Git identity:** every commit uses the user's own identity — `git config user.name` /
  `user.email` (currently `siavashsafi76 <theexxo2@hotmail.com>`) — verified before each
  commit. No `Co-Authored-By` trailer of any kind, ever, for this project.
