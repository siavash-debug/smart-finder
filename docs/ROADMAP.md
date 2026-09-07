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

## Phase 3 — Matching ⬜

- ⬜ `packages/matching` — pure, zero-dependency `score(listing, profile)`
- ⬜ Three-state (`true` / `false` / `unknown`) criterion evaluation
- ⬜ Phase 1 strict gate, Phase 2 relaxed near-match
- ⬜ Tiers: `EXACT`, `STRONG`, `NEAR`, `WEAK`
- ⬜ Explanation objects citing only stored facts, `نامشخص` for unknowns
- ⬜ Indexed candidate-profile selection query
- ⬜ Evaluation fixtures: 200 representative listing descriptions

**Exit criteria:** matching tests green; no numeric percentage exposed in the UI contract.

## Phase 4 — Telegram ⬜

- ⬜ Bot client and message templates (Persian)
- ⬜ Login-widget HMAC verification and `auth_date` bound
- ⬜ Session issuance
- ⬜ `notification` state machine with idempotency key
- ⬜ Retry, per-user caps, quiet hours, suppression
- ⬜ Tests: signature verification, idempotency under duplicate job execution

**Exit criteria:** a retried notification job provably sends at most once.

## Phase 5 — Source ingestion ⬜

- ⬜ **Compliance check first:** robots.txt, terms, and access constraints for Divar
- ⬜ `SourceAdapter` interface (`discover`, `fetchDetail`, `parse`)
- ⬜ Divar adapter with low concurrency, backoff, circuit breaker, honest user agent
- ⬜ Collection-run health tracking; delisting only after a healthy run (§22)
- ⬜ Parser fixture tests from saved fixtures

**Gate:** if access is not permitted, stop and report. No evasion, fingerprint spoofing, IP
rotation, or CAPTCHA bypass will be built (MASTER_PROMPT §20).

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
