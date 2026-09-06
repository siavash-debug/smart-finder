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

## Phase 1 — Core domain ⬜

Database schema and typed data access.

- ⬜ Migration for the full core schema: `user`, `auth_session`, `geo_area`,
  `source_area_alias`, `source`, `collection_run`, `posting`, `posting_version`, `property`,
  `search_profile`, `search_profile_history`, `match`, `user_listing_action`, `notification`,
  `job`, `audit_log`, `llm_call`
- ⬜ Extensions: `pgcrypto`, `pg_trgm`, `postgis`
- ⬜ Indexes for match fan-out and dedup candidate lookup
- ⬜ Repository layer per aggregate, every user-scoped query filtered by `user_id`
- ⬜ Job queue implementation: claim with `FOR UPDATE SKIP LOCKED`, retry, backoff
- ⬜ Integration tests against a real Postgres container

**Exit criteria:** migrations apply from empty, repositories covered by tests, IDOR-scoping
asserted in tests.

## Phase 2 — Persian engine ⬜

- ⬜ Character normalization (`ي→ی`, `ك→ک`, ZWNJ, diacritics)
- ⬜ Digit normalization (Persian, Arabic-Indic, Latin)
- ⬜ Number parsing including Persian number words (میلیارد، میلیون)
- ⬜ Currency: Rial → Toman, `bigint` output
- ⬜ Area parsing (`متر`, `متری`, `m2`, `sqm`)
- ⬜ Jalali ↔ Gregorian conversion
- ⬜ Tehran geography model: districts, neighborhoods, aliases
- ⬜ Deterministic (non-AI) preference extraction from Persian text
- ⬜ Fixture corpus: 50–100 Persian search sentences

**Exit criteria:** normalization unit tests green; deterministic extractor benchmarked against
the sentence corpus with a recorded accuracy baseline.

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
