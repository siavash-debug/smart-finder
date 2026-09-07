# PROJECT CONTEXT

Current state of the project. Updated at the end of every meaningful task.

**Last updated:** 2026-09-07 · **Phase:** 5 (Divar ingestion foundation) — implemented, `npm run verify` green, live access spike + smoke test run for real; see below for what's genuinely verified vs. what remains a known limitation

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

**Phase 2 — Persian engine. Verified complete** — `packages/normalizer`, deterministic,
zero-dependency (no AI, no database — ADR-0012). Eleven modules; full detail in
`ROADMAP.md`'s Phase 2 section and `CHANGELOG.md`. Summary:

- `text.ts` (character/whitespace/punctuation normalization, idempotent), `digits.ts`
  (Persian/Arabic-Indic/Latin digits, strict decimal parsing, exact `bigint` scaling —
  never floating point), `number-words.ts` (Persian number words including
  هزار/میلیون/میلیارد).
- `money.ts`, `area.ts`, `rooms.ts`, `floor.ts`, `building-age.ts`, `attributes.ts` — each
  documented in detail in ADR-adjacent module comments; every one returns an explicit
  `unknown` result rather than a guess when the input doesn't clearly justify a value
  (MASTER_PROMPT §16). Attributes are tri-state (`true`/`false`/`null`=unknown) — absence of
  a mention is never coerced to `false`.
- `geography.ts` — a small seeded Tehran neighborhood/district alias list, not a database
  dependency (ADR-0012).
- `jalali.ts` — Jalali↔Gregorian conversion implemented in-house (ADR-0013), verified by
  round-trip and structural tests plus two documented reference dates.
- `preferences.ts` — `extractPreferences(text)`, the non-AI extraction pipeline MASTER_PROMPT
  §12 asks for. Both of the brief's own worked examples (§12 and §14, including the full
  multi-clause Persian sentence) are direct test cases and pass.
- 312 tests total across the whole repository (up from 82 after Phase 1), all executed live
  — 0 skipped. `npm run verify` passes in full: format, lint, typecheck, tests, build.
- **Not built:** a standalone 50–100-sentence evaluation corpus with a recorded accuracy
  baseline, which `ROADMAP.md`'s Phase 2 entry (written back in Phase 0, before this
  session's actual Phase 2 instructions arrived) had listed as an exit criterion. This
  session's real instructions asked for comprehensive unit tests, which were delivered in
  depth (312 tests, including the brief's own worked examples and explicit adversarial
  false-positive cases) — but that is not the same artifact as a separate corpus file with a
  measured accuracy percentage. Flagged as an open item rather than silently marked done;
  see `ROADMAP.md` for detail.

**Phase 3 — Matching. Verified complete** — `packages/matching`, pure, synchronous,
zero-dependency (no database, network, LLM, or wall-clock reads — ADR-0007, ADR-0014). Full
detail in `ROADMAP.md`'s Phase 3 section and `CHANGELOG.md`. Summary:

- `score(listing, profile) -> { total, tier, criteria, violations }`, composed from ten
  independently-exported pure evaluators.
- Hard/soft constraint split established and documented (ADR-0014): budget, area, rooms,
  parking/elevator/storage, and district are hard (a confirmed violation caps `tier` at
  `"near"`, unconditionally); floor, building age, and neighborhood are soft.
- Tri-state semantics throughout: "not requested" (`null` profile value) is always
  `not_applicable`, never coerced to "required false"; "unknown" (`null` listing value
  against a stated preference) is always distinguished from a confirmed violation.
- Tiers: `exact`/`strong`/`near` (three, lowercase) — a real, already-locked conflict was
  found and raised with the user before writing any tier logic: `MASTER_PROMPT.md` §10 and
  the already-migrated `match.tier` CHECK constraint both name a fourth tier, `WEAK`,
  uppercase. Resolved (user's explicit choice): three lowercase tiers now, DB/`MASTER_PROMPT`
  alignment deferred since Phase 3 doesn't persist to `match` yet. Documented in ADR-0014.
  Two further schema-shape gaps also surfaced and are documented there rather than silently
  worked around: `MASTER_PROMPT` §19's construction-year examples assume an absolute Jalali
  year, but the locked schema stores a relative age in years instead (`evaluateBuildingAge`
  is built around what's actually stored); and floor categories (`ground`/`basement`/
  `penthouse`, from Phase 2's `parseFloor`) have no backing database column, so
  `MatchListingSnapshot`'s `floorCategory` field is correct in logic but unreachable from
  data sourced purely from today's database.
- 103 new tests (415 total repo-wide, up from 312 after Phase 2, all executed live, 0
  skipped): every adversarial case MASTER_PROMPT names by name (125 sqm vs. a 100 sqm
  minimum, 5B vs. a 6B max, unknown parking against a required preference, a 2-vs-3-bedroom
  mismatch not masked by an excellent price/area, district 2 vs. requested district 5, unknown
  price against a budget cap), plus determinism/purity/bounded-score/tier-consistency/
  explainability property tests.
- **Not built:** the indexed candidate-profile selection query and match fan-out wiring
  (correctly out of scope — Phase 6+), and a standalone 200-listing-description evaluation
  fixture set (same reasoning as Phase 2's fixture-corpus gap: this phase's actual
  instructions asked for comprehensive tests, delivered in depth, but not that specific
  artifact). Flagged as open rather than silently marked done.

**Phase 4 — Telegram. Verified complete** — `packages/telegram` (pure, no database; every
network call goes through an injectable `fetch`), composed by `apps/web` (webhook) and
`apps/worker` (notification delivery). Full detail in `ROADMAP.md`'s Phase 4 section and
`CHANGELOG.md`. Summary:

- New migration `0003_telegram_rate_limit.sql` — one table, `telegram_command_log`, for the
  command rate limit. Everything else Phase 4 needed (`app_user.telegram_user_id`,
  `auth_session`, `notification`, `job`) already existed from Phase 1 — inspected first,
  reused as-is, no other schema change.
- Identity: Telegram's numeric user id only, never username/display name. `/start` is
  idempotent under both repeat and concurrency — verified directly (5 concurrent `/start`
  calls for the same Telegram id produce exactly one `app_user` row), enforced by
  `app_user.telegram_user_id`'s existing `UNIQUE` constraint plus the existing
  `findOrCreateUserByTelegramId`'s single `INSERT ... ON CONFLICT`.
- Webhook (`POST /api/telegram/webhook`): constant-time secret-token verification before the
  body is parsed, then update-shape validation — both fail closed (401/400), generic
  response, secret never echoed.
- Commands `/start`/`/help`/`/status` plus an unknown-command reply; a deterministic (no AI)
  preference-extraction interaction reusing Phase 2's `extractPreferences` directly.
- Notification delivery reuses the Phase 1 `job` table for claim/retry/backoff rather than
  polling `notification` directly — `notification.status` has no `processing` value in its
  CHECK constraint, so a direct poll can't be claimed race-safely the way `job` already is
  (ADR-0015). Quiet hours (23:00–08:00 Asia/Tehran, fixed policy, `Intl`-computed offset) and
  two independent rate limits (commands per Telegram user; notification creation per user)
  are all deterministic and unit-tested.
- **A real, already-locked conflict was found and resolved with the user before any related
  code was written**: `match.tier`'s CHECK constraint (`EXACT/STRONG/NEAR/WEAK`, uppercase)
  doesn't match `packages/matching`'s public API (`exact/strong/near`, lowercase, three
  values — Phase 3, ADR-0014). Confirmed out of scope for Phase 4 (nothing here persists a
  `MatchResult`) and left untouched, per the explicit instruction not to invent a mapping or
  migration without approval.
- 123 new tests (538 total repo-wide, up from 415 after Phase 3, all executed live, 0
  skipped), covering every category the phase's instructions named: identity
  (idempotent/concurrent `/start`, username-change safety), security (bad webhook secret,
  malformed update, invalid callback, attacker text cannot alter another user's profile),
  commands, the full notification lifecycle (pending→sent, pending→failed terminal, transient
  retry, idempotent duplicate-delivery prevention, quiet-hours deferral), Telegram API client
  failure classification (transient/permanent/malformed/timeout), and rate limiting.
- **Not built:** a browser-based Telegram Login Widget / `auth_session` issuance — an older
  `ROADMAP.md` line from Phase 0, superseded by this session's actual Phase 4 instructions,
  which scope the phase entirely to the bot webhook flow. `auth_session` is unused so far,
  exactly as Phase 1 left it. Flagged as open, not silently built or silently dropped.

**Phase 5 — Divar ingestion foundation.** New package `packages/scraper` (the first with a
real external dependency, `playwright`), isolated entirely from every other package
(ADR-0016). New `apps/worker` job type `collect_divar`. Full detail in ADR-0016 and
`ROADMAP.md`'s Phase 5 section; summary:

- **A genuine live Access Spike ran first, against real Divar pages**, exactly the two fixture
  URLs given (`https://divar.ir/s/tehran/rent-apartment` for structure only,
  `https://divar.ir/v/gaSebQzv` for one real detail page) — confirmed via `curl` that both
  paths are `robots.txt`-permitted and the site is reachable over plain HTTPS with no
  block/CAPTCHA encountered, then via two real (not mocked) Playwright sessions that captured
  the actual DOM structure the adapter is built from. See ADR-0016 for the findings.
- `DivarAdapter` (`packages/scraper/src/divar/adapter.ts`) implements a generic
  `SourceAdapter` discover/fetch/parse/normalize contract; every Divar-specific selector is
  centralized in `divar/selectors.ts`, built from the spike, not assumed.
- Posting identity is `(source_id, source_posting_id)`; `upsertPosting`
  (`packages/database/src/posting-repository.ts`) decides new/unchanged/changed purely from a
  caller-computed `content_hash`, inside one transaction per posting, and never invents a
  value — a field that doesn't parse cleanly comes out `null`, matching the normalizer's own
  discipline. New migration `0004_seed_divar_source.sql` (a data seed, not a schema change —
  `source`'s table already existed from Phase 1's schema).
- Compliance: no CAPTCHA bypass, proxy rotation, stealth, or header spoofing anywhere in
  `packages/scraper`. `ACCESS_DENIED`/`CAPTCHA` are classified (`IngestionError.isHardStop`)
  and hard-stop the whole `collection_run` (marked `failed`, not partially `completed`) — see
  `divar-collection-handler.ts`. Every other failure category is caught and skips just that
  one listing.
- The worker stays free-tier-cost-conscious: one reused Playwright `chromium` process per
  worker (not one per listing), the existing Postgres job queue (no Redis), and Phase 5's own
  collection runs are deliberately small/bounded — a handful of listings from one category URL
  — not a full-catalog crawl.
- **A real bug was found and fixed by the integration tests, not just written and assumed
  correct**: `upsertPosting`'s UPDATE-path parameter numbering was off by one (`$3..$18`
  against a values array that only supplied `$1..$17`), so Postgres rejected every "changed"
  update with "could not determine data type of parameter $2" — caught immediately by the
  first live-Postgres test run of that path, fixed, re-verified.
- A second real bug was found and fixed via the live smoke test: `discover`/`fetch` initially
  ran the DOM extraction immediately after `domcontentloaded`, before Divar's client-side
  render had populated the listing cards / structured detail fields, returning zero results
  against the live site. Fixed with a bounded `waitForSelector` before extraction in both
  stages (never a poll loop or retry-past-403 — this is waiting for the page's own first
  paint, not working around access denial).
- 610 tests pass repo-wide (up from ~538 after Phase 4 — see `CHANGELOG.md` for the exact
  delta), including a live-Postgres integration suite for the new repositories and the
  `collect_divar` handler, unit tests for parsing/normalization against real spike-derived
  fixtures, error-classification tests with mocked Playwright behavior, and a live smoke test
  (`RUN_LIVE_SMOKE=1`, skipped by default like the database integration tests are when
  Postgres is unavailable) that ran for real against the two fixture URLs and extracted
  genuine data matching the spike's own findings exactly (price 4,100,000,000 Toman, area 110
  sqm, 2 rooms, floor 3 of 5).
- **Known limitation, not silently hidden:** the amenities section (elevator/parking/storage)
  occasionally isn't rendered yet at the point `fetch` extracts it — observed intermittently
  during the live smoke test itself (one run returned all three `undefined`, immediately
  re-run and they were correctly extracted). A longer or retried wait would likely close this
  gap but wasn't added this phase to avoid tuning against live-site timing under time
  pressure; every other field (price, area, rooms, floor) was reliably extracted across
  multiple live runs.
- `delistUntouchedPostings` (`packages/database`) is implemented and unit-tested but
  deliberately not called from `divar-collection-handler.ts` — see ADR-0016; it is only
  correct once a run covers a source's entire active catalog, which Phase 5's small/bounded
  runs do not.
- **Not touched, per explicit instruction:** the `match.tier` schema/matcher tier conflict
  (ADR-0014/ADR-0015) — Phase 5 doesn't write to `match` at all, so this didn't come up in
  practice, and it wasn't looked at speculatively either.
- **Not built:** anything beyond the access foundation — no candidate-fan-out to `match`, no
  scheduled/recurring collection (the job is invoked with an explicit payload, not on a cron),
  no second source, no geo-area resolution for `raw_address` (left `null`, not guessed).

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
- A standalone 50–100-sentence Persian evaluation corpus with a measured accuracy baseline
  was not built in Phase 2 — see the Phase 2 summary above and `ROADMAP.md` for detail. The
  312-test suite covers the same ground in a different, arguably more rigorous shape
  (exact worked examples, adversarial cases, property tests), but not as that specific
  artifact.
- `packages/normalizer` is not yet wired into `apps/web` or `apps/worker` — expected: its
  first real consumers are the Phase 8 UI (search-profile creation) and the Phase 5
  collector (listing attribute extraction).
- `packages/matching` is likewise not yet wired anywhere — expected: it has no caller until
  the candidate-fan-out pipeline (Phase 6+) or a manual test harness invokes it.
- A standalone 200-listing-description evaluation fixture set for the matcher was not built
  — see the Phase 3 summary above and `ROADMAP.md` for detail.
- Three schema-shape gaps documented in ADR-0014, not silently worked around: (1) the tier
  naming/count mismatch between this phase's 3-lowercase-tier scope and the already-locked
  4-tier uppercase `match.tier` CHECK constraint / `MASTER_PROMPT.md` §10; (2) building age
  is modeled as a relative-years range, not the absolute Jalali construction year
  `MASTER_PROMPT` §19's examples assume; (3) floor categories have no database column to
  persist to.
- `packages/telegram` powers the bot flow only; a browser-based Telegram Login Widget and
  `auth_session` issuance were not built (superseded ROADMAP line from Phase 0 — see the
  Phase 4 summary above). `auth_session` remains unused, exactly as Phase 1 left it.
- Notification delivery has only one real template exercised end-to-end
  (`telegram_welcome`) — no match-alert trigger exists yet (Phase 6+ fan-out is what would
  create one). `createSendTelegramNotificationHandler`'s `renderNotificationText` falls back
  to a generic placeholder for any other template rather than fabricating content.
- Listings can now be collected from Divar via the `collect_divar` job, but nothing schedules
  that job automatically yet (no cron/recurring trigger exists) and nothing consumes collected
  postings into `match` yet — search is still not available end-to-end.
- The amenities-extraction timing gap noted in the Phase 5 summary above — intermittent, not
  reproduced on every run, not silently ignored.
- `delistUntouchedPostings` is implemented/tested but not wired in — see the Phase 5 summary
  and ADR-0016 for why a full-catalog-sweep design is required first.

## What is the next step?

Awaiting explicit go-ahead — the user's instructions say not to start Phase 6 without it.
Phase 5's own stop conditions (13-point checklist in this session's instructions) require
stopping here regardless. When Phase 6 is approved, MASTER_PROMPT scopes it to property
deduplication and market intelligence (candidate matching against `duplicate_candidate`,
price-history-aware "opportunity" detection) — built on top of the `posting`/`posting_version`
rows Phase 5 now actually populates.

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
- `packages/normalizer` is fully deterministic: no AI, no database dependency (ADR-0012).
  Every parse function returns an explicit unknown result rather than a guess when a rule
  doesn't confidently apply.
- `packages/matching`'s hard/soft constraint split, unknown-value semantics, and
  exact/strong/near tier rule are fixed as documented in ADR-0014 — a confirmed hard
  violation always caps `tier` at `"near"`; "not requested" is never "required false"; an
  unknown listing value is never a confirmed violation. Changing the hard/soft split for any
  specific field, or the tier thresholds, needs explicit user approval same as any other
  locked decision, even though it isn't verbatim `MASTER_PROMPT` text — it was established
  precisely because `MASTER_PROMPT` left it to this phase to decide conservatively.
- `packages/matching`'s three-lowercase-tier scope (`exact`/`strong`/`near`) stays as decided
  in Phase 3 — Phase 4 confirmed this again rather than touching it (ADR-0015). The
  `match.tier` CHECK constraint / `MASTER_PROMPT.md` §10's four-uppercase-tier mismatch is
  still open; resolving it (a mapping, a migration, or an amendment to `MASTER_PROMPT.md`)
  needs the user's explicit choice, not an implementation guess.
- Notification delivery is claimed via the `job` table, never by polling `notification`
  directly; quiet hours are a fixed 23:00–08:00 Asia/Tehran policy, the same for every user
  (ADR-0015). Changing either — e.g. adding a `processing` value to `notification.status`, or
  a per-user quiet-hours preference — is a schema change and needs explicit approval first.
- Playwright is isolated to `packages/scraper`; no other package may import it (ADR-0016). No
  CAPTCHA bypass, proxy rotation, stealth, or header spoofing, ever — `ACCESS_DENIED`/`CAPTCHA`
  always hard-stop a collection run rather than being retried past. `TransactionType`/
  `PropertyType` stay locked to `"sale"`/`"apartment"`; a rent/other-property collection job
  payload is rejected at the worker boundary, not silently coerced or used to widen the
  schema. `delistUntouchedPostings` must not be called until a collection run genuinely covers
  a source's full active catalog (ADR-0016).

Reversible engineering choices, changeable without approval: npm workspaces (ADR-0001),
TypeScript 5.9 (ADR-0002), lazy package creation (ADR-0008), Node 24 LTS in containers
(ADR-0009), the `/healthz` + `/readyz` split (ADR-0010), lazy repository creation (ADR-0011),
in-house Jalali conversion instead of a date-library dependency (ADR-0013).

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
