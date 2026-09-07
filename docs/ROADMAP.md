# ROADMAP

Phase sequence from `MASTER_PROMPT.md` §37. A phase is complete only when the quality bar in
§38 passes: typecheck, lint, tests, build, docs updated.

Status legend: ✅ done · 🔄 in progress · ⬜ not started

---

## Phase 0 — Foundation ✅

Make the repository build cleanly end to end.

- ✅ Git repository + `.gitignore`
- ✅ npm workspaces monorepo (ADR-0001)
- ✅ Project memory documents in `docs/`
- ✅ `packages/shared` — env validation, structured logger, domain primitives
- ✅ `packages/database` — pool, query helpers, migration runner, health probe
- ✅ `apps/web` — Next.js 16, Persian RTL shell, self-hosted Vazirmatn
- ✅ `apps/worker` — job poll loop skeleton, graceful shutdown, health server
- ✅ TypeScript project references, ESLint flat config, Prettier
- ✅ Vitest configured with workspace projects
- ✅ Docker: Postgres 16 + PostGIS compose, web and worker Dockerfiles
- ✅ `.env.example` with every variable documented
- ✅ `/healthz` (liveness) and `/readyz` (readiness) on both planes (ADR-0010)

**Exit criteria:** `npm run verify` (format check, lint, typecheck, test, build) passes. ✅

Outstanding: the web container image has not completed a build — the host disk filled to 100%
mid-build and Docker's storage went read-only. Environmental, not a Dockerfile defect; the app
builds natively. Re-run `docker build -f infrastructure/docker/Dockerfile.web .` once disk is
free. Tracked in `PROJECT_CONTEXT.md`.

## Phase 1 — Core domain ✅

Database schema and typed data access.

- ✅ Migration `0002_core_schema` for the full core schema: `app_user` (`user` is a reserved
  keyword — ARCHITECTURE §1), `auth_session`, `geo_area`, `source_area_alias`, `source`,
  `collection_run`, `posting`, `posting_version`, `property`, `duplicate_candidate` (implements
  §28's uncertain-pair requirement), `search_profile`, `search_profile_history`, `match`,
  `user_listing_action`, `notification`, `job`, `audit_log`, `llm_call`
- ✅ Extensions: `pgcrypto`, `pg_trgm`, `postgis` (migration `0001`, already applied)
- ✅ Indexes for match fan-out and dedup candidate lookup
- ✅ Repository layer for `app_user`, `search_profile`, and the `job` queue — every
  `search_profile` query filtered by `user_id`. Repositories for the remaining aggregates are
  deferred to the phase that first consumes them (ADR-0011), same reasoning as ADR-0008.
- ✅ Job queue implementation: `claimJobs` (`FOR UPDATE SKIP LOCKED`), `completeJob`,
  `failJob` with full-jitter exponential backoff, wired into the worker's poll loop via
  `job-dispatcher.ts`
- ✅ Integration tests against a real Postgres container — **written and executed against a
  live database on 2026-09-07.** All 25 previously-skipped tests ran and passed (0 skipped).

**Exit criteria:** migrations apply from empty, repositories covered by tests, IDOR-scoping
asserted in tests. **Met and verified against a live database — see below.**

**Verification history:** this phase was first implemented while Docker Desktop was down on
the host (a consequence of a disk-full event during Phase 0), so its 25 integration tests
could only self-skip rather than run. On 2026-09-07, with Docker restored and the disk issue
resolved, `npm run db:up && npm run db:migrate && npm test` was re-run for real:
`schema_migration` shows `0002` applied (692ms), all 18 domain tables exist with 63 indexes
and 8 `updated_at` triggers, and all 82 tests pass with 0 skipped — including SKIP LOCKED
concurrency, retry/backoff, and all three IDOR-scoping tests. `npm run verify` passes in
full: format, lint, typecheck, tests, build. Detail in `CHANGELOG.md`.

## Phase 2 — Persian engine ✅

`packages/normalizer` — deterministic, zero-dependency (ADR-0012): no AI, no database.

- ✅ Character normalization (`text.ts`): `ي/ى→ی`, `ك→ک`, Heh variants, hamza-Alef variants
  (madda `آ` deliberately excluded — a real letter, not a typo), zero-width characters
  (ZWSP/ZWNJ/ZWJ/BOM), Unicode-width whitespace, punctuation. Idempotent (tested directly).
- ✅ Digit normalization (`digits.ts`): Persian/Arabic-Indic/Latin digits; strict grouped/
  decimal parsing via `parseDecimalLiteral` (rejects malformed grouping, e.g. `"12,5"`);
  exact `bigint` scaling (`scaleDecimalToBigInt`) — no floating point, ever.
- ✅ Persian number words (`number-words.ts`): units, tens, hundreds, هزار/میلیون/میلیارد,
  one algorithm serving both plain counts ("صد و بیست و پنج") and money's cross-scale
  compounds ("پنج میلیارد و دویست میلیون").
- ✅ Money (`money.ts`): total vs. per-square-meter, exact vs. range, approximate flag,
  Rial→Toman (exact, rejects a non-whole-Toman result), ambiguous-currency rejection when
  neither an explicit currency nor a scale word is present.
- ✅ Area (`area.ts`): unit required (`متر`/`متری`/`m`/`m2`/`sqm`) — a bare number is too
  ambiguous and stays `unknown`; approximate flag; `at_least`/`at_most` comparators.
- ✅ Rooms (`rooms.ts`): digit and word counts with `خواب`/`خوابه`/`اتاق`/`اتاق خواب`;
  structurally cannot false-positive on an unrelated number (MASTER_PROMPT's own
  "۱۲۵ متر، ۲ پارکینگ" example is a direct test case).
- ✅ Floor (`floor.ts`): numeric, ordinal words, "N از M", and `همکف`/`زیرزمین`/`پنت‌هاوس` as
  their own category — never mapped to an arbitrary numeric floor, since the schema has no
  such column to map them onto.
- ✅ Building age (`building-age.ts`): explicit Jalali year, `نوساز`/`کلیدنخورده`, and
  relative age (`۵ ساله`) kept as _relative_, not resolved to an absolute year without a
  reference date.
- ✅ Boolean attributes (`attributes.ts`): parking/elevator/storage/balcony/pool/guard/lobby/
  jacuzzi, tri-state (`true`/`false`/`null`=unknown) — absence of a mention is always
  unknown, never `false`; a bare checklist-style mention defaults to `true`; contradictory
  mentions resolve to unknown rather than a guess.
- ✅ Tehran geography (`geography.ts`): a small, explicitly-seeded alias list (not a
  speculative database) resolving a name to a canonical district/neighborhood identity.
- ✅ Jalali↔Gregorian conversion (`jalali.ts`, ADR-0013): implemented in-house from the
  standard Borkowski/Fliegel-Van-Flandern algorithms, verified by round-trip and structural
  tests across a wide year range plus documented reference dates (Nowruz 1400 and 1403).
- ✅ Deterministic preference extraction (`preferences.ts`): `extractPreferences(text)`,
  comma-clause splitting with a windowed sub-parser search so a field embedded in a longer
  sentence (not its own clause) is still found; explicit `required`/`forbidden`/
  `no_preference`/`unknown` states for attributes; MASTER_PROMPT's own two worked examples
  (§12 and §14) are direct test cases.
- 🔄 Fixture corpus: **not built as a separate 50–100-sentence artifact.** What exists
  instead is 312 unit tests across all eleven modules, including the exact worked examples
  from MASTER_PROMPT §12/§14, adversarial false-positive cases (§5's parking/bedroom
  example), and idempotency/round-trip property tests. This is real coverage, but it is not
  the discrete evaluation corpus + accuracy-benchmark artifact this line originally
  described — flagged here rather than marked done, since no such file exists on disk.

**Exit criteria:** normalization unit tests green (312/312, live-verified) — met. A
benchmarked accuracy baseline against a standalone sentence corpus — **not met**; see above.

## Phase 3 — Matching ✅

`packages/matching` — pure, synchronous, zero-dependency (ADR-0007, ADR-0014): no database,
network, LLM, or wall-clock dependency.

- ✅ `score(listing: MatchListingSnapshot, profile: MatchProfileSnapshot) -> MatchResult`
  (`{ total, tier, criteria, violations }`), composed from ten small pure evaluators
  (`evaluateBudget`, `evaluateArea`, `evaluateRooms`, `evaluateFloor`, `evaluateBuildingAge`,
  `evaluateAttribute` ×3, `evaluateDistrict`, `evaluateNeighborhood`), each independently
  exported and unit-tested.
- ✅ Tri-state (`true`/`false`/`null`=unknown) criterion evaluation throughout — a `null`
  profile bound is `not_applicable` (never "required false"); a `null` listing value against
  a stated preference is `unknown` (never a confirmed violation, but distinguished from a
  match via a small bounded penalty — ADR-0014).
- ✅ Hard-constraint gate before soft scoring: budget/area/rooms/parking/elevator/storage/
  district are hard (a confirmed violation forces `tier = "near"`, unconditionally — no score
  can override it); floor/building-age/neighborhood are soft (ADR-0014 documents the exact
  split and its reasoning, following MASTER_PROMPT §6's own reasonable-default example).
- ✅ Tiers: `exact` / `strong` / `near` — three, lowercase, per this phase's explicit
  instruction. **Known gap, not silently resolved:** `MASTER_PROMPT.md` §10 and the
  already-migrated `match.tier` CHECK constraint both name a fourth tier, `WEAK`, uppercase.
  Raised with the user before implementation; resolved as three lowercase tiers now, with
  DB/`MASTER_PROMPT` alignment explicitly deferred (Phase 3 does not persist to `match` yet).
  Full detail in ADR-0014.
- ✅ Explanation strings are structured statements of fact only ("Price is within the
  requested budget.") — never a value judgement, never LLM-generated. A UI localizes to
  Persian from the structured `key`/`status`/`requested`/`actual` fields, not this package's
  English prose.
- ✅ Bounded integer score `0 <= total <= 100`: `100 - 40×hard - 12×soft - 4×unknown`,
  clamped. Secondary to tier; `classifyTier` never reads it.
- 🔄 Not implemented in this phase, correctly out of scope: the indexed candidate-profile
  selection query and match fan-out wiring (Phase 6+ — this phase delivers only the pure
  scorer those later phases call), and a standalone 200-listing-description evaluation
  fixture set (same reasoning as Phase 2's fixture-corpus gap — see that phase's entry — this
  phase's actual instructions asked for comprehensive unit/property/adversarial tests
  instead, delivered as 103 new tests including every adversarial case the brief names by
  name).

**Exit criteria:** matching tests green (415/415 repo-wide, live-verified, 0 skipped) — met.
No numeric percentage exposed anywhere in the public contract (`total` is a plain bounded
integer, never formatted as a percentage) — met. Indexed candidate-profile query and the
200-listing fixture corpus — not built; see above, tracked as open in `PROJECT_CONTEXT.md`.

## Phase 4 — Telegram ✅

`packages/telegram` — pure (no database; every network call goes through an injectable
`fetch`) — composed by `apps/web` (webhook) and `apps/worker` (notification delivery).

- ✅ Bot client (`client.ts`): typed `sendMessage`/`answerCallbackQuery`, bounded timeout,
  classifies every failure as `transient`/`permanent`/`malformed_response`; the bot token
  never appears in a request body or a thrown error message.
- ✅ Message templates (Persian, centralized in `messages.ts`) — no business logic hard-coded
  into a string.
- ✅ Webhook endpoint (`apps/web`'s `POST /api/telegram/webhook`): constant-time secret-token
  verification before the body is even parsed, then update-shape validation, both failing
  closed with a generic response.
- ✅ Commands: `/start` (idempotent identity linking via the existing `findOrCreateUserByTelegramId`
  — concurrent calls provably cannot duplicate an `app_user`, enforced by `app_user.
telegram_user_id`'s `UNIQUE` constraint), `/help`, `/status`, and an explicit
  unknown-command reply.
- ✅ Deterministic preference-extraction interaction: free text → `@smart-finder/normalizer`'s
  `extractPreferences` (no AI) → a structured Persian summary + `تأیید`/`ویرایش` inline
  buttons carrying no identifying data at all (ADR-0015 explains why, and why confirmation is
  eager-save rather than a held draft — the schema has no draft state, and Telegram's
  64-byte `callback_data` cap can't carry the structure back anyway).
- ✅ `notification` state machine — unchanged Phase 1 schema
  (`pending → sent | failed | suppressed`), `idempotency_key` `UNIQUE`. Delivery is claimed
  and retried via the existing `job` table, not a new mechanism (ADR-0015).
- ✅ Retry: transient Telegram failures throw and let the `job` table's existing backoff
  (Phase 1, unchanged) retry; permanent failures (e.g. the user blocked the bot) terminally
  fail the notification without retrying.
- ✅ Quiet hours: fixed policy, 23:00–08:00 Asia/Tehran, computed via `Intl.DateTimeFormat`
  (not a hard-coded offset) — deferred notifications stay `pending` with `scheduled_for`
  moved forward and a fresh job enqueued, never a retry of the original.
- ✅ Rate limiting: command processing per Telegram user id (new `telegram_command_log`
  table, migration `0003_telegram_rate_limit.sql`) and notification creation per user
  (reuses the existing `notification` table — no new table needed there); both deterministic
  sliding-window checks, pure and unit-tested.
- ✅ A real, already-locked conflict was found and resolved with the user _before_ any tier-
  related code was touched: `match.tier`'s CHECK constraint names four uppercase tiers,
  `packages/matching`'s public API has three lowercase ones (Phase 3, ADR-0014). Confirmed
  out of scope for Phase 4 — nothing here persists a `MatchResult`. Documented again in
  ADR-0015 rather than silently touched.
- 🔄 **Not built:** a browser-based Telegram Login Widget / `auth_session` issuance. This
  ROADMAP line was written speculatively in Phase 0, before this session's actual Phase 4
  instructions arrived, which scope Phase 4 entirely to the bot webhook flow — a Telegram
  webhook update is already self-authenticating per-message (Telegram sets `from.id`
  server-side; the webhook secret proves the request came from Telegram's servers), so the
  bot flow never needed a browser session at all. `auth_session` remains exactly as Phase 1
  left it, unused so far; a future browser sign-in flow is the first real consumer.

**Exit criteria:** a retried notification job provably sends at most once — verified directly
(`telegram-notification-handler.integration.test.ts`'s idempotency test creates a
notification, runs the handler twice, and asserts the Telegram API was called exactly once).

## Phase 5 — Source ingestion foundation ✅

`packages/scraper` — the first package with a real external dependency (`playwright`),
isolated entirely from every other package (ADR-0016). Composed with `@smart-finder/database`
by a new `apps/worker` job type, `collect_divar`.

- ✅ **Compliance check first, for real:** `curl` confirmed both fixture URLs
  (`https://divar.ir/s/tehran/rent-apartment`, `https://divar.ir/v/gaSebQzv`) are
  `robots.txt`-permitted and the site is reachable with no block/CAPTCHA over plain HTTPS —
  before any Playwright code was written.
- ✅ **A genuine live Access Spike ran next**, against exactly those two URLs (no other pages,
  no large-scale crawl) — two real Playwright sessions that captured Divar's actual DOM
  structure (client-side-rendered list cards, `data-testid="unexpandable-info-row"` +
  `table.kt-group-row` detail-page patterns, JSON-LD, the last-path-segment posting-id rule).
  `DivarAdapter` is built directly from these findings, not assumed ones.
- ✅ `SourceAdapter<RawPage, ParsedFields>` interface (`discover`/`fetch`/`parse`/`normalize`)
  — `DivarAdapter` the only implementation; every Divar-specific selector centralized in one
  file (`divar/selectors.ts`).
- ✅ `BrowserManager` — one reused `chromium` process (not one per listing), bounded
  navigation timeouts, `IngestionError` classification (`NAVIGATION_TIMEOUT`/`ACCESS_DENIED`/
  `CAPTCHA`/`SELECTOR_MISSING`/`PARSE_ERROR`/`NORMALIZATION_ERROR`/`PERSISTENCE_ERROR`/
  `BROWSER_ERROR`/`UNKNOWN_ERROR`), a `CircuitBreaker` primitive. No evasion, fingerprint
  spoofing, IP rotation, or CAPTCHA bypass anywhere (MASTER_PROMPT §20) —
  `ACCESS_DENIED`/`CAPTCHA` always hard-stop the whole collection run.
- ✅ Posting identity `(source_id, source_posting_id)`; `upsertPosting` decides
  new/unchanged/changed from a caller-computed `content_hash`, one transaction per posting,
  append-only `posting_version` history. New migration `0004_seed_divar_source.sql` (data
  seed only — the `source` table already existed from Phase 1).
- ✅ Collection-run health tracking (`startCollectionRun`/`completeCollectionRun`/
  `failCollectionRun`, reusing Phase 1's schema as-is) — a run that hard-stops is marked
  `failed`, never partially `completed`.
- 🔄 **Delisting only after a healthy, full-catalog run (§22):** `delistUntouchedPostings` is
  implemented and unit-tested, but deliberately not wired into `collect_divar` — Phase 5's
  runs are small/bounded (one category URL's worth of listings), so calling it would delist
  every previously-known posting the run simply didn't happen to revisit. A future
  full-catalog-sweep design is required first (ADR-0016); flagged, not silently skipped.
- ✅ Parser/normalization tests from real spike-derived fixtures (not raw HTML dumps) —
  covering the exact real price string (with its RLM mark), floor, room, area, and
  construction-year text from `https://divar.ir/v/gaSebQzv`.
- ✅ A real live smoke test (not just the manual spike) — `adapter.smoke.test.ts`, gated behind
  `RUN_LIVE_SMOKE=1` the same way the database integration tests gate on Postgres being
  reachable — ran for real against the two fixture URLs and extracted genuine matching data.
- 🔄 **Known limitation:** amenities extraction (elevator/parking/storage) is intermittently
  timing-sensitive against the live site's client-side render — observed directly during the
  live smoke test, not hidden. Every other field was reliably extracted across multiple live
  runs.
- ✅ Two real bugs found and fixed via the tests actually being run against live systems
  rather than assumed correct: an off-by-one SQL parameter numbering in `upsertPosting`'s
  UPDATE path (caught by the first live-Postgres integration-test run), and a
  render-timing race in `discover`/`fetch` (caught by the live smoke test) — see ADR-0016.
- ✅ `TransactionType`/`PropertyType` stay locked to `"sale"`/`"apartment"` — the rent list URL
  was genuinely crawled (structure only, per instruction) but a `collect_divar` job asking for
  `"rent"` is rejected at the worker boundary, not silently allowed through or used to widen
  the schema.
- 🔄 **Not touched, per explicit instruction:** the `match.tier` schema/matcher conflict
  (ADR-0014/ADR-0015) — Phase 5 never writes to `match`, so it never came up.
- 🔄 **Not built (Phase 6+ territory):** scheduled/recurring collection (the job runs on an
  explicit payload, not a cron), a second source, candidate-fan-out into `match`, geo-area
  resolution for `raw_address` (left `null`, never guessed).

**Exit criteria:** the live Access Spike ran for real against the two given fixture URLs and
is documented with its actual findings (not assumed); `DivarAdapter` is built from those
findings; the full DISCOVER→FETCH→PARSE→NORMALIZE→PERSIST pipeline is exercised end-to-end
against a real PostgreSQL instance (`divar-collection-handler.integration.test.ts`); a hard
access-denial provably aborts a collection run rather than being retried past
(`ACCESS_DENIED` test in the same suite); `npm run verify` passes in full.

## Phase 6 — Dedup + property ⬜

- ⬜ Content hashing and posting version diffing
- ⬜ Duplicate candidate detection using `pg_trgm` plus structured signals
- ⬜ Confidence scoring; auto-merge only above a high threshold
- ⬜ Property resolution and stable property identity
- ⬜ Price history and price-drop detection

**Exit criteria:** dedup precision measured on a labelled fixture set; no automatic merge
below the threshold.

## Phase 7 — AI ⬜

- ⬜ Provider abstraction with a deterministic fallback path
- ⬜ Schema-constrained extraction validated by Zod
- ⬜ Content-hash cache; AI only for fields deterministic extraction could not fill
- ⬜ `llm_call` logging: provider, model, purpose, input hash, tokens, estimated cost
- ⬜ Configurable daily spend cap with hard stop
- ⬜ Persian free-text → structured spec → **user confirmation** flow

**Constraint:** AI never decides a match (ADR-0007).

## Phase 8 — UI polish ⬜

- ⬜ Persian UX pass, RTL correctness audit
- ⬜ Mobile-first layout refinement
- ⬜ Accessibility: focus order, contrast, labels, reduced motion
- ⬜ Loading, empty, and error states
- ⬜ Match explanation presentation
- ⬜ Saved listings and notification settings

## Future — explicitly deferred

Not to be built without an explicit request (MASTER_PROMPT §5): additional sources, rent,
embeddings, vector search, learned ranking, image analysis, map polygon UI, price prediction,
mobile apps, multilingual UI, payments, admin dashboard, Redis, Kafka, Kubernetes.
