# CHANGELOG

Meaningful implementation changes, newest first. Dates are UTC.

---

## 2026-09-07 — Phase 5: Divar ingestion foundation

New package: `packages/scraper` — the first package with a real external dependency
(`playwright`), isolated entirely from every other package (ADR-0016). New `apps/worker` job
type `collect_divar`, composing `@smart-finder/scraper` with `@smart-finder/database` the same
way Phase 4 composed `@smart-finder/telegram`. 73 new tests (611 total across the repository,
up from 538 after Phase 4): 610 executed live plus one live-network smoke test that self-skips
without `RUN_LIVE_SMOKE=1`, the same way database integration tests self-skip without
Postgres — run for real during this phase (see below), not left permanently skipped.

### A genuine Access Spike ran before any adapter code was written

Per MASTER_PROMPT's explicit instruction: `curl` first confirmed both fixture URLs
(`https://divar.ir/s/tehran/rent-apartment`, `https://divar.ir/v/gaSebQzv`) are
`robots.txt`-permitted and the site returns 200 over plain HTTPS with no block encountered.
Then two real (not mocked) Playwright sessions ran against exactly those URLs — no other
pages, no large-scale scraping — and captured Divar's actual page structure: list cards are
`a[href^="/v/"]` anchors that render client-side; a posting id is reliably the _last path
segment_ of any `/v/...` URL; detail-page structured fields come from two DOM patterns
(`data-testid="unexpandable-info-row"` label/value rows and a `table.kt-group-row`
thead/tbody pairing) plus JSON-LD; amenities are plain "{label}"/"{label} ندارد" text.
`DivarAdapter` is built directly from these captured findings (ADR-0016).

### `packages/scraper`

- `types.ts` — the `SourceAdapter<RawPage, ParsedFields>` discover/fetch/parse/normalize
  contract; `DivarAdapter` is the only implementation, but a second source is a new adapter
  module, not a change to the pipeline shape.
- `errors.ts` — `IngestionError` with nine classified categories
  (`NAVIGATION_TIMEOUT`/`ACCESS_DENIED`/`CAPTCHA`/`SELECTOR_MISSING`/`PARSE_ERROR`/
  `NORMALIZATION_ERROR`/`PERSISTENCE_ERROR`/`BROWSER_ERROR`/`UNKNOWN_ERROR`);
  `ACCESS_DENIED`/`CAPTCHA` are `isHardStop`.
- `browser.ts` — `BrowserManager` (one reused `chromium` process, not one per listing;
  free-tier-cost-conscious), `navigateSafely` (classifies a 403 as `ACCESS_DENIED`, page text
  naming Divar's own CSP-declared CAPTCHA provider as `CAPTCHA` — recognition only, never a
  bypass), `CircuitBreaker` (a hard-stop latch primitive).
- `content-hash.ts` — `computeContentHash`, a deterministic sha256 over exactly the fields
  that count as "meaningful content," independent of key insertion order.
- `divar/selectors.ts` — every Divar-specific selector, centralized in one file.
- `divar/{url,parse,normalize,adapter}.ts` — `DivarAdapter`'s implementation, split into pure
  (unit-testable without Playwright) URL/parse/normalize functions plus the
  Playwright-touching `discover`/`fetch` methods. `normalizeDivarFields` reuses Phase 2's
  `parseMoney`/`parseFloor`/`parseBuildingAge`/`parseAttribute`/`gregorianToJalali` directly —
  no new parsing logic invented — with one documented deviation (`parseInteger`, not
  `parseArea`/`parseRooms`, for متراژ/اتاق — see ADR-0016) and one new normalization-boundary
  function (`buildingAgeYearsFromRaw`, converting Divar's absolute Jalali construction year to
  the schema's relative age, with an explicit injected `referenceDate` — never a hidden
  `Date.now()` read).

### `packages/database`

- New migration `0004_seed_divar_source.sql` — a data seed only (`ON CONFLICT DO NOTHING`),
  not a schema change; `source`'s table already existed from Phase 1's schema.
- `domain.ts` — `SourceRow`/`CollectionRunRow`/`PostingRow`/`PostingVersionRow`, matching
  migration `0002_core_schema.sql`'s columns exactly (grepped from the actual SQL, not
  memory).
- `source-repository.ts` — `getSourceBySlug`.
- `collection-run-repository.ts` — `startCollectionRun`/`completeCollectionRun`/
  `failCollectionRun`/`getCollectionRunById`. A failed run's postings are never trusted for
  delisting (MASTER_PROMPT §22) — no counts recorded beyond what was true at the failure.
- `posting-repository.ts` — `upsertPosting`, the core new/unchanged/changed decision, inside
  one transaction per posting: **new** inserts `posting` + one `posting_version`;
  **unchanged** touches only `last_seen_at`/`last_collection_run_id`, no new version row;
  **changed** updates `posting` and appends (never overwrites) a new `posting_version`, never
  changing the posting's own `id`. Also `getPostingBySourceId`, `getPostingVersions`, and
  `delistUntouchedPostings` (implemented/tested, not yet called anywhere — see below).
- **A real bug, caught by the first live-Postgres run of the new integration tests**:
  `upsertPosting`'s UPDATE-path parameter numbering was off by one (`UPDATABLE_FIELDS` used
  `$3..$18` against a values array supplying only `$1..$17`), so `$2` was never referenced in
  the query text and Postgres rejected every "changed" update with "could not determine data
  type of parameter $2." Fixed (`$2..$17`), re-verified against live Postgres.

### `apps/worker`

- `divar-collection-handler.ts` — the `collect_divar` job handler: orchestrates
  DISCOVER→FETCH→PARSE→NORMALIZE→PERSIST, owns database bookkeeping (starting/
  completing/failing the `collection_run`), and never touches a Playwright selector directly.
  One listing's `IngestionError` is caught and skipped (a bad listing must not sink the whole
  run); a hard-stop category aborts the entire run immediately and marks it `failed`. Rejects
  a job payload asking for a transaction/property type the schema doesn't support (see below)
  before any browser navigation happens.
- `index.ts` — registers `collect_divar` alongside Phase 4's `send_telegram_notification`;
  the worker's `BrowserManager` is closed on graceful shutdown alongside the pool and health
  server.

### Compliance and scope boundaries, enforced in code, not just documentation

- No CAPTCHA bypass, proxy rotation, stealth, or header spoofing anywhere in
  `packages/scraper` — `ACCESS_DENIED`/`CAPTCHA` are recognized and hard-stop, never retried
  past or worked around.
- `TransactionType`/`PropertyType` stay locked to `"sale"`/`"apartment"` (`packages/database`,
  unchanged from Phase 1) even though the rent list URL was genuinely crawled for structure —
  `divar-collection-handler.ts`'s `isSupportedListingContext` rejects any other combination at
  the job-payload boundary, so rent can never silently become product scope.
- `delistUntouchedPostings` exists and is unit-tested but is deliberately never called from
  `collect_divar` — Phase 5's collection runs are small/bounded (one category URL's worth of
  listings), so calling it would wrongly delist every previously-known posting the run simply
  didn't happen to revisit. Its own doc comment explains the full-catalog precondition; a
  correct full-sweep design is future work.
- `match.tier`'s already-known conflict (ADR-0014/ADR-0015) was not touched — Phase 5 never
  writes to `match`.

### A second real bug, caught by the live smoke test

`discover`/`fetch` initially extracted DOM content immediately after `domcontentloaded`,
before Divar's client-side render had populated the listing cards / structured detail fields
— a first live run against the real list page returned zero listings. Fixed by adding a
bounded `waitForSelector` before extraction in both stages (waiting for the page's own first
paint, not a retry-past-access-denial or a polling loop). Re-run live afterward: 8 real
listings discovered from `https://divar.ir/s/tehran/rent-apartment`, and
`https://divar.ir/v/gaSebQzv` correctly extracted to price 4,100,000,000 Toman, area 110 sqm,
2 rooms, floor 3 of 5 — matching the original manual spike's own findings exactly. One
intermittent limitation observed directly during these live runs: the amenities section
(elevator/parking/storage) is occasionally not yet rendered at extraction time — every other
field was reliably extracted across multiple live runs; documented as a known limitation, not
hidden.

### Testing

- Fixture-based parser/normalization tests built from the real spike output (not raw HTML
  dumps) — including a direct regression test for the RLM-mark price-parsing fix below.
- Error-classification tests with a mocked Playwright `Page`/`Browser`, covering every
  `IngestionError` category and the `CircuitBreaker`'s hard-stop latch behavior.
- `divar-collection-handler.integration.test.ts` — the full pipeline exercised against a real
  PostgreSQL instance (a stub `BrowserManager`/adapter stands in for Playwright itself, since
  that side is covered by the adapter's own unit tests and the live smoke test): new listings
  persist and complete the run; a re-run with unchanged content reports `unchanged`, not
  `new`; one listing's non-hard-stop failure is skipped while the run completes; a hard-stop
  (`ACCESS_DENIED`) aborts the whole run and marks it `failed`; an out-of-scope payload
  (`rent`) is rejected.
- `adapter.smoke.test.ts` — the live Access Spike captured as a real, re-runnable automated
  test (`RUN_LIVE_SMOKE=1`), not left only in a scratch directory.

### A compatibility fix to a completed phase, genuinely required and documented

`packages/normalizer/src/text.ts`'s `ZERO_WIDTH` regex covered U+200B/200C/200D/FEFF but not
U+200E (LRM) / U+200F (RLM) — both Unicode _Format_ characters, so `.trim()` never strips
them. A real Divar price string (`"‏۴,۱۰۰,۰۰۰,۰۰۰ تومان"`, with a leading RLM) returned
`{"kind":"unknown"}` from `parseMoney` instead of parsing correctly. Fixed by adding both
marks to the regex, with a regression test citing the exact real string and a doc-comment
explanation; the normalizer suite (230→231 tests) re-verified green, plus an independent
direct check that the exact real string now parses to
`{"kind":"exact","amountToman":"4100000000"}`.

## 2026-09-07 — Phase 4: Telegram integration

New package: `packages/telegram`, pure — no database dependency, every network call goes
through an injectable `fetch` so its own tests never touch the real Telegram API (ADR-0007-
style precedent). Composed by `apps/web` (webhook) and `apps/worker` (notification delivery).
123 new tests (538 total across the repository, up from 415 after Phase 3, all executed
live, none skipped).

### A conflict confirmed, not silently touched

Before writing anything Telegram-related, the already-known tier mismatch from Phase 3
(`match.tier`'s CHECK constraint: `EXACT/STRONG/NEAR/WEAK`, uppercase, vs. `packages/
matching`'s public API: `exact/strong/near`, lowercase, three values) was checked against
whether Phase 4 needed to persist a `MatchResult` anywhere. It does not — nothing in this
phase writes to `match`. Confirmed out of scope and left exactly as Phase 3/ADR-0014 left it;
documented again in ADR-0015 rather than silently resolved either way.

### Schema

- One new migration, `0003_telegram_rate_limit.sql`: a single table,
  `telegram_command_log` (`telegram_user_id`, `command`, `created_at`), for the command rate
  limit. Everything else Phase 4 needed — `app_user.telegram_user_id` (already `UNIQUE`),
  `auth_session`, `notification` (full `pending/sent/failed/suppressed` state machine,
  `idempotency_key` already `UNIQUE`), `job` — already existed from Phase 1 and needed no
  change. Deliberately not reusing `audit_log` for rate-limit bookkeeping: that table's
  documented purpose is privileged/admin operations, not routine per-message logging.

### `packages/database`

- `notification-repository.ts`: `createNotification` (idempotent — `ON CONFLICT DO NOTHING`
  plus a follow-up read, so two concurrent callers with the same `idempotency_key` get back
  the same row), `markNotificationSent`/`markNotificationFailed`/`markNotificationSuppressed`
  (each a no-op once the row has left `pending` — duplicate delivery is structurally
  prevented, not just discouraged), `recordNotificationAttemptFailure` (keeps a transient
  failure `pending` for the job queue to retry), `rescheduleNotification` (quiet-hours
  deferral — moves `scheduled_for`, changes nothing else).
- `telegram-rate-limit-repository.ts`: `recordTelegramCommand`, `getRecentCommandTimestamps`.

### `packages/telegram`

- `client.ts` — `TelegramClient`: `sendMessage`, `answerCallbackQuery`. Every failure is
  classified `transient` (network error, timeout, 429, 5xx — worth retrying),
  `permanent` (other 4xx — e.g. the user blocked the bot — not worth retrying), or
  `malformed_response`. The bot token appears only in the request URL, never in a logged or
  thrown value — verified directly by a test that asserts the token is absent from every
  error message and from the captured request body.
- `webhook-secret.ts` — `verifyWebhookSecret`: `node:crypto`'s `timingSafeEqual`, not `===`,
  so a wrong secret's response time doesn't leak how many leading characters matched.
- `types.ts` — a minimal structural `isTelegramUpdate` guard (not a full Telegram SDK): only
  the fields this bot reads, rejecting anything malformed without throwing.
- `commands.ts` — deterministic `/start`/`/help`/`/status` parsing (case-insensitive, strips
  a `@botusername` suffix); anything else with a leading `/` is `unknown_command`, anything
  without one is plain `text`.
- `messages.ts` — every user-facing string, centralized, Persian. `preferenceSummaryMessage`
  lists only the fields actually extracted — never fabricates an unstated one.
- `rate-limit.ts` — `checkRateLimit`, a pure sliding-window decision over caller-supplied
  timestamps (no Redis, no external service).
- `quiet-hours.ts` — fixed policy, 23:00–08:00 Asia/Tehran (ADR-0015), computed via
  `Intl.DateTimeFormat` rather than a hard-coded UTC+03:30 offset, even though that
  happens to be Tehran's current fixed offset — the logic itself doesn't assume it.

### `apps/web`

- `POST /api/telegram/webhook`: verifies the secret-token header before the body is even
  read, then the update's shape, both failing closed (401/400) with a generic response —
  never echoing the secret, never logging the raw payload.
- `lib/telegram/handle-update.ts`: the orchestration — identity resolution (always from the
  update's own `from.id`, Telegram-authenticated server-side; never a client-supplied value),
  command routing, the free-text preference-extraction interaction (`extractPreferences` →
  Persian summary + `تأیید`/`ویرایش` buttons carrying no identifying data → saved eagerly via
  the existing `replaceActiveSearchProfile`, since the schema has no draft state and
  `callback_data`'s 64-byte cap can't carry the structure back on confirm — ADR-0015),
  callback-query handling (unrecognized `callback_data` gets a rejection reply, not a crash).

### `apps/worker`

- `telegram-notification-handler.ts` — the `send_telegram_notification` job handler: claimed
  via the existing `job` table, not by polling `notification` directly (`notification.
status` has no `processing` value in its CHECK constraint, so there's no race-safe way to
  claim a row that way — `job` already solves this, tested since Phase 1; ADR-0015). Throws
  on a transient send failure (the job's own retry/backoff takes it from there); resolves
  normally on success, a permanent failure (terminally marks the notification `failed`), or a
  quiet-hours deferral (reschedules the notification, enqueues a fresh job at the deferred
  time, retries nothing).

### Tests

123 new tests covering every category the phase's instructions named: identity (first
`/start` creates one user; repeated and 5-way-concurrent `/start` are idempotent — verified
by a direct row-count query, not just by inspecting return values; a username change on a
later `/start` does not create another identity), security (wrong/missing webhook secret,
malformed JSON, a malformed update shape, an unrecognized callback payload, attacker-
controlled message text proven unable to alter a different user's profile), commands (all
three plus unknown), the full notification lifecycle end-to-end against a real job
(`enqueue → claim → handle → sent`, pending→sent, pending→failed terminal, transient-failure
retry-throw, idempotent duplicate-delivery prevention — a second handler call for an
already-sent notification never calls the Telegram API again — and quiet-hours deferral),
Telegram API client failure classification (transient/permanent/malformed/timeout), and rate
limiting (a legitimate request always succeeds; repeated rapid requests eventually stop).

### Verification

`npx vitest run`: **538 tests, 538 passed, 0 skipped** (25 Phase 1 integration tests plus all
of Phase 4's own database-backed tests, executed live against PostgreSQL). `npm run verify`
passes in full: format, lint, typecheck, tests, build (the build output now lists
`ƒ /api/telegram/webhook` alongside the existing routes).

Live Telegram delivery was not exercised — no real bot token or webhook were available in
this session. Every Telegram-API-touching test runs against `TelegramClient`'s injectable
`fetch`, not the real network; this is stated plainly rather than implied otherwise.

## 2026-09-07 — Phase 3: deterministic matching engine

New package: `packages/matching`, pure and dependency-free — no database, network, LLM, or
wall-clock reads (ADR-0007, ADR-0014). 103 new tests (415 total across the repository, up
from 312 after Phase 2, all executed live, none skipped).

### A conflict raised and resolved before implementation

The `match.tier` CHECK constraint (migration `0002_core_schema.sql`, already applied and
verified in Phase 1) and `MASTER_PROMPT.md` §10 both name four uppercase tiers — `EXACT`,
`STRONG`, `NEAR`, `WEAK`. This phase's own instructions repeatedly specify three lowercase
tiers instead (`exact`/`strong`/`near`) and explicitly forbid introducing other names
"unless there is an existing locked domain reason" — which the DB constraint is. Raised with
the user before any tier logic was written; resolved as three lowercase tiers now, with
DB/`MASTER_PROMPT` alignment explicitly deferred, since Phase 3 does not write to the `match`
table yet. Full detail in ADR-0014.

### `score(listing, profile) -> { total, tier, criteria, violations }`

Composed from ten independently-exported pure evaluators:

- `budget.ts` / `area.ts` / `rooms.ts` / `building-age.ts` — all built on one shared generic,
  `range.ts`'s `evaluateRange<T extends number | bigint>`, so a `[min, max]` bound-vs-actual
  comparison is written once and reused with `bigint` for money (ADR-0005) and `number`
  everywhere else. Budget/area/rooms are hard; building age is soft.
- `floor.ts` — soft. Respects `@smart-finder/normalizer`'s floor categories
  (`ground`/`basement`/`penthouse`) rather than coercing them to floor 0/-1: a category with
  no numeric floor against a stated numeric range is `unknown`, never a guess.
- `attribute.ts` — hard, generic over parking/elevator/storage. Full tri-state × tri-state
  truth table per MASTER_PROMPT §16: "not requested" always short-circuits to
  `not_applicable` before the listing's value is even read, so it can never become "required
  false".
- `location.ts` — district (hard) and neighborhood (soft) as two separate criteria: a
  listing in the right district but wrong neighborhood passes the hard gate and scores lower
  than an exact neighborhood match, per MASTER_PROMPT §17.
- `tier.ts` — hard violation → `near`, unconditionally, regardless of score. Otherwise, a
  deviation sum (`unknown` = 1, soft `mismatch` = 2) with thresholds `0` → `exact`, `1`-`2` →
  `strong`, `>= 3` → `near`.
- `score.ts` — `100 - 40×hard - 12×soft - 4×unknown`, clamped to `[0, 100]`, integer. Never
  read by `tier.ts` — a high score can never override a hard violation.

### Documented gaps (ADR-0014), not silently resolved

- Tier naming/count vs. the locked `WEAK` tier — see above.
- MASTER_PROMPT §19's construction-year examples assume an absolute Jalali year; the locked
  schema stores a relative age in years instead (`building_age_years`,
  `min/max_building_age_years`). `evaluateBuildingAge` is built around what's actually
  stored — which also means comparing two ages needs no reference "now", keeping this
  package's "no wall-clock dependency" property true without an explicit reference-date
  parameter.
- Floor categories have no backing database column (`posting.floor` is a plain integer).
  `MatchListingSnapshot.floorCategory` exists so the matcher's logic is correct when a
  caller has one (e.g. straight from a live `parseFloor` result), even though nothing
  sourced purely from today's database can populate it.
- `balcony`/`pool`/`guard`/`lobby`/`jacuzzi` are parseable by Phase 2's `attributes.ts` but
  have no `posting`/`search_profile` columns; only parking/elevator/storage are evaluated.

### Tests

103 new tests: per-evaluator unit tests for every field (boundary, below/above, unknown,
bigint exactness for budget), the full attribute tri-state truth table, floor-category
handling, tier-threshold tests including hard-violation dominance, score-bound tests, and a
`match.test.ts` integration suite covering mixed profiles, every adversarial case
MASTER_PROMPT names by name (125 sqm vs. a 100 sqm minimum must not fail; 5B vs. a 6B max
must not fail; unknown parking against a required preference must never become `false`; a
2-vs-3-bedroom mismatch must not be masked by an excellent price/area; district 2 vs.
requested district 5 must never reach `exact`; unknown price against a budget cap must not
become a confirmed violation; `همکف` against a numeric floor range must stay `unknown`, never
floor 0), plus determinism, purity (inputs unchanged after scoring), bounded-score, and
tier-consistency property tests.

### Verification

`npx vitest run`: **415 tests, 415 passed, 0 skipped** (25 of them the Phase 1 integration
tests, still executed live against PostgreSQL). `npm run verify` passes in full: format,
lint, typecheck, tests, build.

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
