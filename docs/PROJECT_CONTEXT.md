# PROJECT CONTEXT

Current state of the project. Updated at the end of every meaningful task.

**Last updated:** 2026-09-07 · **Phase:** 1 (Core domain) — code complete, DB verification pending

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

**Phase 1 — core domain. Code complete; database verification blocked by environment, not
by the code — see "What is currently broken" below.**

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
  under concurrency, retry/backoff, the one-active-profile-per-user flow, and — the item this
  phase's exit criteria specifically calls for — IDOR scoping: a `search_profile` id known to
  one user resolves to `null` when looked up by a different user's id. They self-skip (not
  fail) when no database is reachable.
- 20 new unit tests for `computeBackoffMs` and the job dispatcher's pure dispatch logic.

## What is currently broken or unverified?

- **The 25 integration tests written this phase have not been run against a live database.**
  Docker Desktop on this machine went down as a downstream effect of the disk-full event
  recorded in Phase 0: the host disk filled to 100%, which corrupted Docker's own image/
  container storage (`input/output error` reading its content-addressed blobs), and by the
  time this phase started Docker Desktop itself was no longer running
  (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`). This
  is environmental, not a defect in the migration or the repository code — the schema and
  every query were written and reviewed carefully, and the same `job-queue.integration.test.ts`
  file's non-DB-dependent tests (`computeBackoffMs`) do pass. **Once Docker is back:**
  ```
  npm run db:up
  npm run db:migrate
  npm test
  ```
  A clean pass (25 previously-skipped tests now passing, nothing failing) is required before
  Phase 1 can be called verified-complete, not just code-complete.
- The `Dockerfile.web` build gap from Phase 0 is unresolved for the same underlying reason.
- No listings are collected and search is not available — expected this early.

## What is the next step?

Once Docker/Postgres is back and the integration suite passes for real:

**Phase 2 — Persian engine.** Character/digit normalization, currency (Rial→Toman), area
parsing, Jalali dates, Tehran geography model, deterministic (non-AI) preference extraction,
plus the 50–100 sentence fixture corpus named in MASTER_PROMPT §32.

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
