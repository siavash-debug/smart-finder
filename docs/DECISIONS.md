# DECISIONS

Architecture Decision Records. Newest last. Statuses: `Proposed`, `Accepted`, `Superseded`, `Rejected`.

Decisions marked **Locked** come directly from `MASTER_PROMPT.md` and must not be changed
without explicit user approval (see MASTER_PROMPT §43).

---

## ADR-0001 — Monorepo with npm workspaces

- **Date:** 2026-09-06
- **Status:** Accepted
- **Context:** The brief mandates a monorepo (§6) but does not name a package manager. The
  development machine has Node v26.7.0 and npm 9.6.2. `pnpm` is not installed and `corepack`
  is not available on this Node build, so a pnpm-based monorepo would add a mandatory install
  step before anyone can build.
- **Decision:** Use npm workspaces, which ship with the bundled npm. Root `package.json`
  declares `workspaces: ["apps/*", "packages/*"]`. Internal packages are referenced as
  `@smart-finder/<name>` with `"*"` version specifiers, resolved by workspace symlink.
- **Reason:** Simplest and most portable option (MASTER_PROMPT §39.1, §39.2). Zero extra
  toolchain. Works identically in Docker, CI, and Vercel.
- **Alternatives:** pnpm workspaces (faster, stricter, but needs installation); Turborepo or
  Nx (task orchestration we do not yet need — premature per §39); a single flat package
  (rejected, the brief mandates a monorepo).
- **Consequences:** No strict peer isolation — a package can accidentally import a dependency
  it did not declare. Mitigated by per-package `tsconfig.json` with explicit project
  references. Migration to pnpm later is mechanical (the workspace layout is identical).

---

## ADR-0002 — TypeScript 5.9.x, not 7.x

- **Date:** 2026-09-06
- **Status:** Accepted
- **Context:** `typescript@latest` is 7.0.2 (the native compiler port). However
  `typescript-eslint@8.69.0` declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`, so
  type-aware linting does not support TypeScript 7 yet.
- **Decision:** Pin TypeScript `5.9.3` across the monorepo.
- **Reason:** Type-aware lint rules are a core part of the quality bar (§38). Losing them to
  gain a faster compiler is a bad trade at this stage. Stability over novelty (§39.1).
- **Alternatives:** TypeScript 7 with untyped linting (weakens §38); TypeScript 7 with lint
  disabled (unacceptable).
- **Consequences:** We forgo the native compiler's speed. Revisit once typescript-eslint
  supports TS 7; the upgrade is a version bump plus a typecheck run.

---

## ADR-0003 — PostgreSQL is the primary database and the job queue

- **Date:** 2026-09-06
- **Status:** Accepted — **Locked** (MASTER_PROMPT §7, §25)
- **Context:** The system needs durable storage, fuzzy text matching for deduplication, and a
  work queue for the ingest plane.
- **Decision:** PostgreSQL 16+ for both. Job queue implemented as a `job` table consumed with
  `SELECT ... FOR UPDATE SKIP LOCKED`. Extensions: `pg_trgm` (dedup similarity), `postgis`
  (geography), `pgcrypto` (UUID generation).
- **Reason:** One dependency instead of three. `SKIP LOCKED` is a correct, well-understood
  queue primitive at our scale. Portable to any Postgres host.
- **Alternatives:** Redis/BullMQ or Kafka — both explicitly excluded by §5. Cloudflare D1 —
  explicitly excluded by §7.
- **Consequences:** Queue throughput is bounded by Postgres. Acceptable for one source and a
  small user base; revisit only against a measured requirement (§39.7).

---

## ADR-0004 — Two independent execution planes

- **Date:** 2026-09-06
- **Status:** Accepted — **Locked** (MASTER_PROMPT §6, §26)
- **Context:** Ingestion is long-running and scheduled; serving is request-scoped.
- **Decision:** `apps/web` (Next.js, serve plane) and `apps/worker` (long-running Node
  process, ingest plane) are separate deployables that share only the database and the
  `packages/*` libraries. Neither imports the other.
- **Reason:** The worker must not depend on serverless request lifetime. Independent restart
  and independent scaling.
- **Alternatives:** Next.js route handlers or cron triggers driving collection (breaks on
  serverless time limits); a single process (couples restart cycles).
- **Consequences:** Two deploy targets and two Dockerfiles. Shared code must stay
  runtime-agnostic — no `next/*` imports inside `packages/*`.

---

## ADR-0005 — Money as BIGINT Toman; no floating point

- **Date:** 2026-09-06
- **Status:** Accepted — **Locked** (MASTER_PROMPT §7)
- **Context:** Iranian property prices reach 10^13 Rial. IEEE-754 doubles lose integer
  precision above 2^53 and cannot represent decimal amounts exactly.
- **Decision:** Canonical currency is Toman. Stored as `BIGINT`. Carried in TypeScript as
  `bigint`, never `number`. Rial input is divided by 10 during normalization.
- **Reason:** Exactness. `BIGINT` max (~9.2 × 10^18) is far beyond any realistic price.
- **Consequences:** JSON has no bigint type — serialization boundaries must convert to string
  explicitly. The `pg` driver returns `int8` as string by default; `packages/database` sets a
  type parser to produce `bigint`.

---

## ADR-0006 — Posting and Property are distinct entities

- **Date:** 2026-09-06
- **Status:** Accepted — **Locked** (MASTER_PROMPT §8, §29)
- **Decision:** `posting` = one advertisement on one source. `property` = one physical unit.
  Many postings may resolve to one property, with an explicit confidence value. Uncertain
  associations are never auto-merged (§28).
- **Reason:** Deduplication is a core product capability, not a cleanup step. Collapsing the
  two entities would make it unrepresentable.
- **Consequences:** Every listing read path must decide whether it means posting or property.
  Price history is kept per posting so source-specific history is never lost.

---

## ADR-0007 — Matching is deterministic; AI is an assistant only

- **Date:** 2026-09-06
- **Status:** Accepted — **Locked** (MASTER_PROMPT §9, §13, §40)
- **Decision:** `packages/matching` is a pure function library — no database, network, or LLM
  dependency. AI may interpret Persian free text into a structured spec and extract attributes
  from messy listing text, but never decides a match. User-facing explanations cite only
  stored facts. Unknown renders as `نامشخص`, never as `false`.
- **Reason:** Testability, reproducibility, and honesty about uncertainty.
- **Consequences:** The matching package must be unit-testable in isolation. Enforced by
  keeping its `package.json` dependency list empty.

---

## ADR-0008 — Create packages when their phase begins

- **Date:** 2026-09-06
- **Status:** Accepted
- **Context:** §6 lists seven packages (`database`, `matching`, `normalizer`, `scraper`, `ai`,
  `telegram`, `shared`). Scaffolding all seven in Phase 0 produces five packages whose only
  content is a placeholder export.
- **Decision:** Phase 0 creates `shared` and `database` only, because `/healthz` and the
  worker need them now. The rest are created by the phase that first implements them:
  `normalizer` (Phase 2), `matching` (Phase 3), `telegram` (Phase 4), `scraper` (Phase 5),
  `ai` (Phase 7). The full target layout is documented in `ARCHITECTURE.md`.
- **Reason:** §2 forbids speculative code; §38 forbids dead code. The layout is a documented
  plan, not a set of empty directories.
- **Alternatives:** Stub all seven now — rejected as dead code.
- **Consequences:** The directory tree does not match §6 verbatim until Phase 7 completes.
  This is an implementation detail, not an architecture change (§43).

---

## ADR-0009 — Node 24 LTS is the runtime target

- **Date:** 2026-09-06
- **Status:** Accepted
- **Context:** The development machine runs Node v26.7.0 (Current). Node 24 is Active LTS.
- **Decision:** Docker images use `node:24-alpine`. `engines.node` is `>=22` so local
  development on 24 or 26 both work.
- **Reason:** Production runs on a supported LTS line; development is not artificially
  constrained.
- **Consequences:** A small version skew between local and container runtimes. CI should build
  against the Docker image to catch anything that depends on it.

---

## ADR-0010 — `/healthz` is liveness; `/readyz` is readiness

- **Date:** 2026-09-06
- **Status:** Accepted
- **Context:** §27 requires `/healthz`. A single endpoint that also probes the database
  conflates "the process is wedged, restart it" with "a dependency is down, stop routing to
  it" — an orchestrator restarting web pods because Postgres is briefly unavailable makes an
  outage worse.
- **Decision:** `/healthz` returns 200 whenever the process can serve, touching no dependency.
  `/readyz` probes the database and returns 200 `ready` or 503 `not_ready` with per-component
  detail. The worker exposes the same two paths on its own HTTP port.
- **Reason:** Standard liveness/readiness split; more observable, and it makes the failure
  mode explicit.
- **Alternatives:** One `/healthz` that checks everything — causes restart storms.
- **Consequences:** Two endpoints to document. Deployment probes must be wired to the right
  one. This extends §27 rather than contradicting it.

---

## ADR-0011 — Repositories are built when their consumer arrives, not all at once

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** Migration `0002_core_schema` creates all eighteen tables from MASTER_PROMPT §8
  in one pass, because they are interlinked by foreign keys and have to exist together. The
  roadmap's Phase 1 item "repository layer per aggregate" could be read as requiring a
  repository module for all eighteen immediately. Most of them have no caller yet: `posting`
  and `property` are written by the Phase 5 collector and read by Phase 3 matching; `match` is
  written by Phase 3; `notification` by Phase 4; `duplicate_candidate` by Phase 6; `audit_log`
  and `llm_call` by whichever privileged operation or AI call first needs them.
- **Decision:** Phase 1 ships repositories for `app_user`, `search_profile`, and the `job`
  queue — the three with an actual consumer right now (the worker's poll loop, and the
  explicit IDOR-scoping requirement). Every other table's repository is written by the phase
  that first reads or writes it, same reasoning as ADR-0008 for package scaffolding.
- **Reason:** MASTER_PROMPT §2 and §38 rule out speculative code with no caller. A repository
  written now for a table nothing touches until Phase 5 would be exercised by nothing but its
  own tests, and its shape would likely be wrong once the collector's actual access patterns
  are known.
- **Alternatives:** Write all eighteen now — rejected as speculative, untestable-by-use code.
  Write none until a repository is strictly required — rejected because the job queue is a
  concrete Phase 1 deliverable the worker needs immediately.
- **Consequences:** `packages/database`'s public surface grows incrementally across phases
  rather than all at once. `ROADMAP.md` and `PROJECT_CONTEXT.md` track which repositories
  exist versus which tables merely have a schema.
- **Related:** every repository function takes a `Queryable` (`Pick<pg.Pool, "query">`)
  rather than a concrete `Pool`, so it can run against a plain pool or against a client already
  inside a transaction (see `pool.ts`). `replaceActiveSearchProfile` is the one exception — it
  opens its own transaction internally and so needs a real `Pool`, not a `Queryable`.

---

## ADR-0012 — `packages/normalizer` is fully deterministic: no AI, no database dependency

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** Phase 2 builds Persian text/number/money/area/rooms/floor/age/attribute/
  geography parsing and `extractPreferences`. MASTER_PROMPT §13/§17 explicitly forbid an LLM
  dependency in this phase, and §2 (AI policy) says AI may assist deterministic systems but
  must never replace them. It would have been possible to build a thinner rule-based layer
  now and defer the harder cases (ambiguous phrasing, novel neighborhood names) to an AI
  fallback in Phase 7.
- **Decision:** `packages/normalizer` has zero runtime dependencies — no AI provider, no
  database — and every function returns an explicit `unknown`/`null` result rather than a
  best guess when a rule doesn't confidently apply (§16: "if not justified, return unknown").
  Geography resolution (`geography.ts`) is a small in-memory seed list, not a call into the
  `source_area_alias`/`geo_area` database tables from Phase 1 — this package cannot depend on
  `packages/database` (ARCHITECTURE's one-way dependency graph) and must stay usable with no
  I/O, matching `packages/matching`'s existing "pure, dependency-free" precedent.
  `extractPreferences`'s output is explicitly designed to be handed to Phase 7's AI layer
  later as a _baseline/fallback structure_ — a deterministic first pass an AI extraction can
  be validated against or fall back to, per §15's cost-control priority order (deterministic
  extraction before AI, AI only for what's left unknown).
- **Reason:** Matches the explicit Phase 2 instruction and the project's general principle
  (§40) that the system must be honest about uncertainty and never fabricate. Building the
  deterministic layer properly now, with real coverage and adversarial tests, gives Phase 7's
  AI layer something concrete to fall back to and cache against rather than starting from
  nothing.
- **Alternatives:** A thinner ruleset with AI filling remaining gaps — rejected as premature:
  it would introduce an AI dependency and cost before the deterministic ceiling is even known,
  and MASTER_PROMPT explicitly scopes AI to Phase 7.
- **Consequences:** Some real language is genuinely out of scope for now — e.g. a
  never-before-seen neighborhood name, or a construction-era description outside `building-
age.ts`'s recognized patterns — and returns `unknown` rather than an AI-assisted guess.
  This is intentional and matches the brief, not a gap to silently work around.

---

## ADR-0013 — Jalali↔Gregorian conversion implemented in-house, no date library dependency

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** `jalali.ts` needs accurate Jalali↔Gregorian conversion with correct leap-year
  handling (MASTER_PROMPT §10). A well-known, widely used, MIT-licensed npm package exists
  for this (`jalaali-js` and equivalents), implementing the same published Borkowski/
  Fliegel-Van-Flandern algorithm this module uses.
- **Decision:** The conversion math is implemented directly in `packages/normalizer`, not
  pulled in as a dependency. `packages/normalizer` has zero runtime dependencies (ADR-0012);
  the algorithm itself is well-documented, public-domain astronomical-calendar mathematics
  (not any one project's proprietary implementation), and reproducing it directly keeps the
  package's "no dependencies" property intact rather than making an exception for one module.
- **Reason:** Consistent with §39 (prefer the simplest, most portable option) applied to a
  package that has deliberately stayed dependency-free everywhere else in this phase — adding
  one dependency here would be the only exception in the whole package for no strong reason,
  since the algorithm is compact, standard, and independently testable.
- **Alternatives:** Depend on `jalaali-js` or similar — reasonable, and worth revisiting if
  the hand-rolled implementation shows problems in a range this package doesn't yet exercise
  (dates far outside the ~1200–1500 Jalali / 1821–2121 Gregorian window relevant to a
  present-day Tehran real-estate platform).
- **Consequences:** The implementation is verified by round-trip and structural-invariant
  tests across a wide year range, plus two independently-recalled, publicly documented
  reference dates (`jalali.test.ts`), rather than by relying on an already-widely-tested
  library. `jalCal`'s supported domain is Jalali years `[-61, 3178)`; outside that, every
  public function in the module fails closed (`null`) rather than throwing.

---

## ADR-0014 — Matching engine: hard/soft split, unknown semantics, tier rules, and three known gaps

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** Phase 3 builds `packages/matching`'s `score(listing, profile)`. Neither the
  locked `search_profile`/`posting` schema (migration `0002_core_schema.sql`) nor
  `MASTER_PROMPT.md` specifies which constraints are hard (can reject a listing) versus soft
  (affect ranking only), nor the exact tier thresholds — both are explicitly left to this
  phase to establish conservatively and document (per this phase's own instructions). Three
  concrete conflicts surfaced against already-locked material while doing so; none blocked
  implementation, but all three are documented here rather than silently resolved one way.
- **Decision:**
  - **Hard constraints** (a confirmed violation forces `tier = "near"`, regardless of score):
    budget (`min/max_price_toman`), area (`min/max_area_sqm`), rooms (`min/max_rooms`),
    `require_parking`/`require_elevator`/`require_storage` (both the `true` and `false`
    direction — "must have" and "must not have" are equally hard), and district
    (`district_geo_area_id`).
  - **Soft preferences** (affect score and tier, never force a violation-driven `near`):
    floor (`min/max_floor`), building age (`min/max_building_age_years`), and neighborhood
    (`neighborhood_geo_area_id` — a listing in the right district but the wrong neighborhood
    stays past the hard gate, per MASTER_PROMPT §17's own instruction that a neighborhood
    match should score better than a district-only match, not that a neighborhood mismatch
    should reject the listing).
  - **Unknown semantics:** a `null` profile bound/preference is `not_applicable` (nothing was
    asked, so nothing can be violated) and is evaluated before the listing's value is even
    read — "not requested" can never become "required false". A `null` listing value against
    a _stated_ preference is `unknown`: never a violation, but distinguished from a confirmed
    match by contributing 1 point of "deviation" toward tier classification and a small,
    bounded (4-point) penalty toward the score — enough that an all-unknown listing scores
    below an all-matched one, not so much that unknown functions as a disguised failure.
  - **Tier rule** (`tier.ts`): any hard violation → `near`, unconditionally. Otherwise, sum
    deviation across evaluated criteria (`unknown` = 1, soft `mismatch` = 2); `0` → `exact`,
    `1`-`2` → `strong`, `>= 3` → `near`. Chosen as the simplest rule that satisfies "hard
    violation dominance" and "strong allows _limited_ unknowns/soft mismatches, near reflects
    _meaningful_ deviation" without a weighted formula (MASTER_PROMPT §9-§10 for this phase:
    "avoid overly complicated weighted formulas").
  - **Score** (`score.ts`): `100 - 40×(hard violations) - 12×(soft mismatches) -
4×(unknowns)`, clamped to `[0, 100]`, integer. Secondary to tier; `tier.ts` never reads
    it.
- **Reason:** MASTER_PROMPT §6's own reasonable-default example lists exactly this hard/soft
  split (`budget_max`, `area_min`, `bedrooms_exact`, `parking_required`, `elevator_required`,
  `district_required` as hard; "preferred floor", "preferred newer construction" as soft) —
  followed directly rather than inventing an alternative. The unknown-penalty magnitude (4,
  versus 40 for a hard violation) is chosen so no combination of unknowns can numerically
  exceed a single hard violation's penalty within the bounded `[0, 100]` score, keeping "never
  let unknown function as a disguised failure" true by construction, not just in the common
  case.
- **Alternatives:** A single weighted linear formula across all criteria (rejected — hides
  hard violations inside a number, exactly what MASTER_PROMPT §10 forbids: "do not hide
  violations inside a numeric score"). Treating every populated profile field as
  automatically hard (rejected — explicitly against this phase's instructions, and would make
  a stated floor preference block otherwise-good listings). A four-tier scheme including
  `WEAK` (see "known gaps" below — deferred, not rejected).
- **Known gaps, deliberately deferred rather than silently invented:**
  1. **Tier naming/count.** This package's public `MatchTier` is exactly `"exact" | "strong" |
"near"` (lowercase, three values), per this phase's explicit, repeated instruction.
     `MASTER_PROMPT.md` §10 and the already-migrated `match.tier` CHECK constraint (migration
     `0002_core_schema.sql`) both name a fourth tier, `WEAK`, uppercase. Raised with the user
     before implementation; resolved as: three lowercase tiers now, DB/`MASTER_PROMPT`
     alignment deferred, since Phase 3 does not write to the `match` table yet (no immediate
     collision). Whoever wires `score()`'s output into the `match` table needs either a
     persistence-layer mapping (`"near"` → `'NEAR'`, and a rule for what produces `'WEAK'`)
     or a follow-up migration — not resolved here.
  2. **Construction year vs. building age.** MASTER_PROMPT §19's own worked examples compare
     an absolute Jalali construction year (e.g. "profile minimum = 1400, listing = 1402").
     The locked schema instead stores a _relative_ age in years (`building_age_years`,
     `min/max_building_age_years`) on both `posting` and `search_profile` — not a year at
     all. `evaluateBuildingAge` is built around what the schema actually stores; comparing
     two ages needs no reference "now" either, which keeps this package's "no wall-clock
     dependency" property (MASTER_PROMPT §2) true without needing an explicit reference date
     parameter. If an absolute construction year is wanted later, that's a schema change
     (a new column), not a matcher change.
  3. **Floor categories have no column.** `@smart-finder/normalizer`'s `parseFloor` can
     distinguish `ground`/`basement`/`penthouse` from a plain numeric floor (Phase 2), but
     `posting.floor` is a plain nullable integer with no category column. `MatchListingSnapshot`
     carries an optional `floorCategory` field so the matcher's _logic_ is correct today (a
     category never gets coerced to floor 0/-1, and correctly evaluates to `unknown` against
     a numeric range), but no listing sourced purely from the current database can ever
     populate it — only a caller working from a live `@smart-finder/normalizer` parse result
     could. Persisting floor categories is a future schema change, not something this phase
     invents a workaround for.
  4. **Balcony and other unlisted attributes.** `@smart-finder/normalizer`'s `attributes.ts`
     can parse `balcony`/`pool`/`guard`/`lobby`/`jacuzzi` from text (Phase 2), but neither
     `posting` nor `search_profile` has columns for them (only `has_parking`/`has_elevator`/
     `has_storage` exist). `packages/matching` only evaluates the three attributes the schema
     actually persists.
- **Consequences:** `packages/matching` stays strictly faithful to the locked schema shape —
  every field it reads has a real column behind it (`floorCategory` aside, which is
  explicitly documented as schema-less). The four gaps above are structural, not oversights;
  each is fixable by a future schema change without touching this package's evaluation logic.

---

## ADR-0015 — Telegram integration: notification delivery, quiet hours, preference confirmation

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** Phase 4 adds `packages/telegram` (pure — bot client, webhook-secret
  verification, command parsing, message templates, rate-limit and quiet-hours logic) and
  wires it into `apps/web` (webhook) and `apps/worker` (notification delivery). Four concrete
  design points had no existing precedent in the locked schema/architecture and needed a
  documented decision rather than an implicit one:
  1. **Notification delivery is claimed via the `job` table, not by polling `notification`
     directly**, even though `notification` (migration `0002_core_schema.sql`) already has a
     `scheduled_for` column and an index literally commented "Worker claim query: due, still-
     pending notifications." That index's plan doesn't work safely: `notification.status`'s
     CHECK constraint only allows `pending`/`sent`/`failed`/`suppressed` — no `processing`
     value — so there is no atomic way to claim a row the way `job.status` does (claim flips
     to `processing`, only that claimer proceeds). The `job` table already solves exactly this
     (`SELECT ... FOR UPDATE SKIP LOCKED` then an atomic status flip, tested since Phase 1).
     **Decision:** a `notification` row is created eagerly (the durable, user-facing record of
     what was attempted and its outcome), and a `job` row (`job_type =
'send_telegram_notification'`, `payload.notificationId`) is the thing actually claimed
     and retried. No migration was needed or made; `idx_notification_pending_due` remains in
     the schema, just unused by the claim path — a future direct-poll design could still use
     it if `notification.status` ever gained a `processing` value, but that is not this
     decision to make.
  2. **Quiet hours are a fixed, single, undocumented-until-now policy: 23:00-08:00 Asia/
     Tehran, the same for every user.** The schema has no per-user timezone or quiet-hours
     column. Rather than add one (a real schema change, out of this phase's authority to
     decide unilaterally), the policy is hard-coded in `packages/telegram/quiet-hours.ts`,
     computed via `Intl.DateTimeFormat` (not a hard-coded UTC+03:30 offset, even though that
     is Tehran's actual fixed offset today), so the logic itself doesn't assume a specific
     offset even though it currently is one. A quiet-hours-deferred notification stays
     `pending` with `scheduled_for` moved forward, and a fresh `job` is enqueued at that time
     — not a retry of the original job, since deferral is not a failure.
  3. **Preference confirmation via Telegram's inline keyboard is saved eagerly, not held as a
     pending draft.** MASTER_PROMPT-adjacent Phase 4 §12's example flow shows "تأیید
     می‌کنید؟" gating a save. Two real constraints rule that out as literally specified: the
     schema has no draft/pending-confirmation state on `search_profile`, and Telegram's
     `callback_data` is capped at 64 bytes — nowhere near enough to carry the extracted
     preference structure back on confirm. **Decision:** free text is parsed with
     `extractPreferences` (deterministic, Phase 2, no AI) and saved immediately via the
     already-existing `replaceActiveSearchProfile` (Phase 1, which already archives the
     previous active profile to `search_profile_history`). The `تأیید`/`ویرایش` buttons carry
     no data at all beyond a fixed `pref:ack`/`pref:edit` string — confirming is an
     acknowledgment, editing means "send corrected criteria, which replaces this the same
     way." This is a genuine simplification from the literal example flow, not a hidden one.
  4. **Callback buttons carry no identifying data.** MASTER_PROMPT-adjacent Phase 4 §23 warns
     against encoding sensitive data into `callback_data` and against trusting it without
     validation. Since confirming/editing only ever act on "whichever user tapped the button"
     (resolved fresh from `callback_query.from.id`, which Telegram itself sets server-side —
     never a client-supplied value), there is no user or profile identifier in the callback
     payload for an attacker to substitute in the first place; the two fixed strings are
     matched against an allow-list, anything else gets a rejection reply.
- **Reason:** Every one of these reuses existing, already-tested infrastructure
  (`job`/`search_profile_history`) instead of adding new schema or a new retry mechanism, per
  MASTER_PROMPT §39 (prefer the simplest, most portable, most reversible option) and this
  phase's own "do not create duplicate competing state machines" instruction.
- **Alternatives considered:** A `processing` value added to `notification.status` via a new
  migration, enabling direct polling — rejected as an unnecessary schema change when the `job`
  table already does this safely. A per-user quiet-hours preference column — rejected as
  exactly the kind of schema invention this phase was told to avoid; documented as a
  reasonable future addition instead. A short-lived server-side draft table for preference
  confirmation — rejected as more machinery than "establish the interaction pattern" (the
  phase's own framing) requires.
- **Consequences:** A notification's row and its owning job can, in principle, drift apart
  (e.g. a job manually deleted) — acceptable at MVP scale, and `getNotificationById` finding
  nothing simply short-circuits the handler. Quiet hours are not user-configurable yet. A
  buyer's confirmation tap has no undo beyond resending corrected text.

---

## ADR-0016 — Divar ingestion: Playwright isolation, `DivarAdapter`, access-denial hard-stop, and three normalization-boundary decisions

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** Phase 5 adds the first real external-source dependency (Playwright + a headless
  Chromium) and the first package that talks to a third party at all. MASTER_PROMPT is
  explicit and **Locked** on several points here: no CAPTCHA bypass/proxy rotation/stealth of
  any kind; a genuine Access Spike against the two given fixture URLs before writing adapter
  code; the `rent-apartment` list URL is for learning page _structure_ only and must never
  become product scope; and the already-known `match.tier` schema/matcher conflict from
  earlier phases is explicitly not to be touched here.
- **Decision (isolation):** Playwright lives entirely in the new `packages/scraper` package.
  `normalizer`/`matching`/`database`/`telegram`/`web` never import it and never know Divar
  exists. `apps/worker`'s new `collect_divar` job handler (`divar-collection-handler.ts`) is
  the only place that wires `@smart-finder/scraper`'s `BrowserManager`/`DivarAdapter` to
  `@smart-finder/database`'s repositories — it owns orchestration and persistence bookkeeping
  only, never a selector.
- **Decision (adapter shape):** `SourceAdapter<RawPage, ParsedFields>` (`packages/scraper/src/
types.ts`) is the discover/fetch/parse/normalize contract a second source would implement
  later. `DivarAdapter` is the only implementation; every Divar-specific selector lives in one
  file, `divar/selectors.ts`, built from two live, genuine Playwright sessions against exactly
  `https://divar.ir/s/tehran/rent-apartment` and `https://divar.ir/v/gaSebQzv` — not assumed,
  not copied from documentation. Findings: listing cards are plain `a[href^="/v/"]` anchors
  that render client-side (a `waitForSelector` after `domcontentloaded` is required, confirmed
  by an initial spike run that returned zero cards without it); a posting's id is reliably the
  _last path segment_ of any `/v/...` URL, bare or slug-prefixed, confirmed via Divar's own
  JSON-LD `url` field; JSON-LD supplies `description`/`floorSize`; two independent DOM
  patterns — a `data-testid="unexpandable-info-row"` label/value row (ودیعه, طبقه) and a
  `table.kt-group-row` thead/tbody pairing (متراژ, ساخت, اتاق) — cover every other structured
  field; amenities are plain "{label}"/"{label} ندارد" text handed directly to Phase 2's
  existing `parseAttribute`, needing no new parsing logic.
- **Decision (access denial is a hard stop, not a retryable error):** `IngestionError` carries
  a category (`NAVIGATION_TIMEOUT`, `ACCESS_DENIED`, `CAPTCHA`, `SELECTOR_MISSING`,
  `PARSE_ERROR`, `NORMALIZATION_ERROR`, `PERSISTENCE_ERROR`, `BROWSER_ERROR`,
  `UNKNOWN_ERROR`); only `ACCESS_DENIED`/`CAPTCHA` are `isHardStop`. `navigateSafely`
  classifies a 403 as `ACCESS_DENIED` and page text mentioning Divar's own CSP-declared
  CAPTCHA provider (`arcaptcha`) as `CAPTCHA` — recognition only, never an attempt to solve or
  route around either. A `CircuitBreaker` exists for a future multi-navigation-per-run design
  but the collection-run job handler already gets the equivalent behavior more simply: a
  hard-stop error thrown from inside one listing's processing is re-thrown past the
  per-listing `catch` (which absorbs every _other_ category and just skips that one listing),
  aborting the whole run and marking the `collection_run` `failed` rather than `completed`.
- **Decision (three normalization-boundary calls, each newly required by real Divar data):**
  1. **RLM/LRM stripping in `packages/normalizer/src/text.ts`.** Divar's real price text
     (`"‏۴,۱۰۰,۰۰۰,۰۰۰ تومان"`) has a leading U+200F (RIGHT-TO-LEFT MARK) — a Unicode _Format_
     character, so `.trim()` never removes it. Phase 2's `ZERO_WIDTH` regex covered
     U+200B/200C/200D/FEFF but not U+200E/200F, so `parseMoney` silently returned `unknown`
     for every real Divar price. Fixed by adding both directional marks to that regex, with a
     regression test citing this exact real string. A genuinely required, narrow compatibility
     fix to a completed phase, exactly the kind MASTER_PROMPT permits when documented.
  2. **متراژ/اتاق use `parseInteger`, not `parseArea`/`parseRooms`.** Those two functions
     require an explicit unit word ("متر", "خواب"/"اتاق") specifically to stop _free text_
     from being guessed at — but Divar's own table label (متراژ, اتاق) already disambiguates
     the field unambiguously before the bare digit ever reaches the normalizer, so the guard
     those functions exist for doesn't apply. Deliberate, documented deviation; see
     `packages/scraper/src/divar/normalize.ts`'s own comment on `integerFromRaw`.
  3. **Absolute-year-to-relative-age conversion lives in the adapter's `normalize` stage, not
     in `packages/normalizer`.** Divar states an absolute Jalali construction year ("ساخت
     ۱۳۹۵"); `posting.building_age_years` stores a relative age. Converting requires a "now",
     and Phase 2's `parseBuildingAge` deliberately stays reference-date-free to remain
     unconditionally deterministic (documented in its own file header). So the conversion —
     `currentJalaliYear - constructionJalaliYear`, via `gregorianToJalali` — happens in
     `divar/normalize.ts`'s `buildingAgeYearsFromRaw`, with `referenceDate` an explicit
     parameter threaded from the job handler (`now()`, itself injectable), never a bare
     `Date.now()` read inside the normalization logic. A resulting negative age (a
     "construction year" in the future) comes out `undefined`, not a fabricated value.
- **Decision (`delistUntouchedPostings` exists but is not called this phase):** it correctly
  delists everything `active` a `collection_run` didn't touch, but is only correct when that
  run covers a source's _entire_ active catalog. Phase 5's runs are deliberately small/bounded
  (the access-spike-scoped category URL, no large-scale crawl), so calling it would delist
  every previously-known posting merely for not being in this small run — implemented and unit
  -tested now so a future full-catalog-sweep phase doesn't have to invent it ad hoc, but never
  wired into `divar-collection-handler.ts`.
- **Decision (rent stays structure-only, enforced at the worker boundary, not widened
  anywhere):** `packages/database`'s `TransactionType`/`PropertyType` (`domain.ts`) remain
  locked to `"sale"`/`"apartment"` — unchanged from Phase 1, no migration made. `ListingContext`
  in `@smart-finder/scraper` is intentionally broader (`"sale"|"rent"` ×
  `"apartment"|"house"|"land"|"other"`) because `DivarAdapter` genuinely is that generic — the
  rent list URL was real, valid Divar structure, just out of _product_ scope. The boundary is
  enforced in `divar-collection-handler.ts`'s `isSupportedListingContext`: a `collect_divar`
  job payload asking for anything besides `sale`/`apartment` is rejected outright, before any
  browser navigation happens. This is a worker-level policy check, not a schema change.
- **Alternatives considered:** Widening `TransactionType` to include `"rent"` now that a rent
  URL was genuinely crawled during the spike — rejected, explicitly against MASTER_PROMPT's
  own instruction for this phase. Retrying past a 403/CAPTCHA with backoff — rejected, that is
  exactly the workaround compliance forbids; the existing `job` table's ordinary retry/backoff
  still applies at the _run_ level (a later scheduled run may succeed), which is not a bypass.
  Calling `delistUntouchedPostings` unconditionally after every completed run — rejected per
  the correctness reasoning above.
- **Consequences:** A second source (e.g. a future non-Divar listing site) is a new adapter
  module plus a new job type, not a change to the pipeline shape. The amenities section
  occasionally isn't rendered yet when `fetch` extracts (client-side hydration timing observed
  live, intermittently, during this phase's own smoke test) — `hasElevator`/`hasParking`/
  `hasStorage` can come back `undefined` on a run that would otherwise have found them; a
  future phase could add a longer/second wait or a bounded retry, not done here to avoid
  adding untested timing-tuning under time pressure. `delistUntouchedPostings`'s full-catalog
  precondition means a source's stale postings are not yet ever automatically delisted —
  explicitly future work, not a regression from any prior phase (Phase 5 introduces the table
  it would apply to).

## ADR-0017 — Divar ingestion's browser runtime: Cloudflare Browser Rendering via Playwright's `connectOverCDP`, not `@cloudflare/puppeteer`

- **Date:** 2026-09-08
- **Status:** Accepted
- **Context:** `apps/worker` was planned to move to a low-cost hosting target where a
  persistent Node.js process with a locally-installed Chromium is impractical/costly (see the
  Phase 6 hosting research). Cloudflare Browser Rendering offers a hosted, Free-tier-eligible
  headless Chromium. An isolated spike (`spikes/cloudflare-browser-rendering/`, not part of the
  build) first proved, against the real Phase 5 fixture URL (`https://divar.ir/v/gaSebQzv`),
  that Browser Rendering can drive the exact selectors/extraction `DivarAdapter` already uses.
- **Rejected approach — `@cloudflare/puppeteer`:** its `launch()`/`connect()`/`acquire()` all
  require a `BrowserWorker` argument (`{fetch: typeof fetch}`), a Cloudflare Workers **binding**
  object only constructible inside an actual Workers execution context (confirmed by reading
  the installed package's source, not assumed from its docs). `apps/worker` is a plain,
  persistent Node.js process and was explicitly not going to be converted into a Cloudflare
  Worker — so this package cannot be used from it at all, regardless of how much of the adapter
  were rewritten around it.
- **Decision:** Cloudflare separately exposes Browser Rendering over the plain Chrome DevTools
  Protocol, documented as connectable "from any environment... your local machine, or a cloud
  environment," authenticated by a bearer API token — not a Workers binding. Playwright's own
  `chromium.connectOverCDP(endpointURL, { headers })` speaks this directly; the installed
  version (1.63.0) was confirmed (via its own `.d.ts`) to support a `headers` option, and the
  path was verified experimentally against the real Cloudflare account and the real Divar
  fixture before being wired in (see the Stage 2 live smoke test below). `packages/scraper/src/
browser.ts` gains one new exported function, `createCloudflareCdpLaunch(config)`, building a
  `BrowserManagerOptions.launch` function around this — `BrowserManager` itself, `DivarAdapter`,
  selectors, parsing, and normalization are **unchanged**. `@cloudflare/puppeteer` is not a
  dependency of this repository.
- **Decision (opt-in, not implicit):** `apps/worker` launches a local Chromium by default,
  exactly as Phase 5 always did — unchanged behavior for local dev, CI, and every existing test.
  Cloudflare Browser Rendering is used only when both `CLOUDFLARE_BROWSER_RENDERING_ACCOUNT_ID`
  and `CLOUDFLARE_BROWSER_RENDERING_API_TOKEN` are set (validated together, `packages/shared/
src/env.ts`); a real production deployment sets both, a local `.env` normally sets neither.
- **Decision (concurrency/reuse, unchanged design):** `BrowserManager` already lazily launches
  once (`browserPromise ??= this.launchFn()`) and serves every `withPage()` call — including
  concurrent ones from `apps/worker`'s `job-dispatcher.ts`, which runs claimed jobs concurrently
  via `Promise.all` — a new page per call, never a shared page. This was already correct for
  local Chromium and needed no change for the CDP-connected case; a concurrency test
  (`browser.test.ts`, "launches exactly once when multiple withPage calls race concurrently")
  proves concurrent `withPage()` callers collapse onto one in-flight launch/connect rather than
  each triggering their own — the property that keeps this design within Browser Rendering's
  free-tier "3 concurrent browsers per account" and "~1 new browser instance per 20 seconds"
  limits (the second discovered experimentally during the earlier spike, not assumed).
- **Verified facts vs. documented limits vs. assumptions:** Experimentally verified today:
  `connectOverCDP` + `headers` works against the real endpoint; the real Divar fixture's title/
  area/rooms/floor extract identically through the CDP path as through local Playwright.
  Cloudflare-documented (not independently re-verified every run): the 10-minute/day Free
  browser-time budget, the 3-concurrent-browser limit, the ~20-second new-instance rate limit.
  Assumption, not yet tested: behavior when the free daily budget is actually exhausted
  mid-collection-run (expected: Cloudflare returns a 429-style error, which `navigateSafely`/
  `BrowserManager` would currently surface as an ordinary `BROWSER_ERROR` — not a hard-stop
  category — meaning a job would fail and retry per the existing job-queue backoff rather than
  correctly recognizing "budget exhausted, don't retry until tomorrow"; this refinement is
  explicitly deferred, not silently solved here).
- **Consequences:** Multiple concurrent `apps/worker` **replicas** (not concurrent jobs within
  one process — that case is handled, see above) would each hold their own CDP connection,
  counting separately against the account-wide 3-concurrent-browser limit; single-replica
  operation (today's actual deployment shape) stays well within it. `match.tier`,
  `TransactionType`/`PropertyType`, the Postgres job/retry/idempotency model, and every package
  outside `packages/scraper/src/browser.ts` are untouched by this decision.

## ADR-0018 — Divar ingestion's primary browser runtime reverts to a local, Dockerized Chromium; Cloudflare CDP stays as a selectable, isolated backend

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** ADR-0017 made Cloudflare Browser Rendering the browser backend. In practice its
  Free-tier daily budget was exhausted by cumulative testing within a single day, blocking a
  planned real collection run with no way to proceed except waiting for a UTC reset or
  upgrading the plan — neither acceptable for the immediate goal of proving the ingestion
  pipeline end-to-end against real Neon data. The requirement changed: the primary path must be
  runnable locally/on a VPS without depending on Cloudflare's shared, rate-limited budget, while
  keeping the already-verified CDP path available and selectable, not deleted.
- **Decision (runtime):** `infrastructure/docker/Dockerfile.worker` now builds a
  Playwright-capable image and installs a real Chromium via `playwright install --with-deps
chromium` at build time. Base image is `node:24-bookworm-slim` (Debian/glibc), not Alpine —
  Alpine/musl is not a supported target for Playwright's downloaded browser binaries. Cloudflare
  publishes a pre-built image with Chromium baked in (`mcr.microsoft.com/playwright`), not used
  here because that registry was unreachable from this build environment; Docker Hub's plain
  Node image plus an explicit `playwright install` produces the same effective result and pins
  automatically to whatever `playwright` version `packages/scraper/package.json` declares.
- **Decision (root/sandbox):** The container runs as root (no non-root user switch), because
  Chromium's sandbox needs a specific non-root user/permission setup — the kind Playwright's own
  pre-built image configures — that isn't replicated by simply switching to a plain non-root
  user. `packages/scraper/src/browser.ts` gains one new exported function,
  `createLocalChromiumLaunch({chromiumSandbox})`, alongside `createCloudflareCdpLaunch` from
  ADR-0017; `chromiumSandbox: false` is a standard Playwright launch option controlling only the
  container security model, not a stealth/evasion technique — it has no effect on what Divar
  observes. A new env var, `PLAYWRIGHT_CHROMIUM_SANDBOX` (default `true`, unset everywhere except
  the Docker collector), selects it. `BrowserManager` itself did not change.
- **Decision (selection order, `apps/worker/src/index.ts`):** Cloudflare CDP (both
  `CLOUDFLARE_BROWSER_RENDERING_*` set) → local Chromium with sandbox disabled
  (`PLAYWRIGHT_CHROMIUM_SANDBOX=false`) → `BrowserManager`'s own default local launch (host
  dev/CI, unchanged since Phase 5). All three are mutually exclusive and explicit; nothing
  silently falls back from one to another mid-run — verified by making the unused paths throw
  during a real Docker run (see the corresponding session record) and by the container's own
  startup log (`"status":"local_no_sandbox"`).
- **Decision (which process runs in the container):** The real `apps/worker` entry point,
  unmodified — not a separate scraper microservice. It already depended on
  `@smart-finder/scraper` and wired `BrowserManager`/`DivarAdapter` before this change; the
  Dockerfile was simply missing `packages/normalizer`, `packages/telegram`, and
  `packages/scraper` in its COPY/build steps (written before Phase 5 added the scraper package)
  and is now corrected to include them, using a `tsc --build` invocation scoped to exactly what
  `apps/worker/tsconfig.build.json` references — not the root `build:packages` script, which
  also targets `packages/matching`, a package this image doesn't need and doesn't copy in.
- **Verified (real, not assumed):** A real Docker build succeeded; a real bounded
  `collect_divar` job (`https://divar.ir/s/tehran/buy-apartment`, one real Neon `job` row) ran
  to completion inside the container against the real Neon database, discovering, persisting,
  and versioning real Divar postings with zero failures — recorded in this session, not
  reproduced here. `packages/database`'s existing migrations were applied to Neon unmodified;
  no schema change was needed for this decision.
- **Consequences:** Local/VPS Docker is the primary, always-available path; Cloudflare CDP
  remains a fully wired, tested, selectable alternative (ADR-0017) for whenever a
  non-Docker-hosted deployment target is chosen, without code changes beyond setting env vars.
  `docker-compose.yml`'s general local-dev stack is untouched — this Dockerfile change is
  exercised directly (`docker build`/`docker run`) for the Neon-backed verification run,
  documented separately from the compose file's own local-Postgres-by-default convenience path.

## ADR-0019 — Semantic, resilient Divar info-row classification; a real second rent price UI discovered

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** A real sale collection persisted 0/8 prices because `parse.ts` hardcoded the
  rent-only label "ودیعه" as the sole price source. Investigating the fix properly (not just
  patching in a second hardcoded label) surfaced the deeper, correctly-anticipated risk: Divar's
  labels vary in ways that don't change meaning — confirmed for real, "اجارهٔ ماهانه" (with a
  combining Arabic hamza above the heh, U+0654) vs "اجاره ماهانه" (without it) are the same
  field. Exact-string label matching is the wrong foundation for this regardless of how many
  labels get added to a list.
- **Decision (normalizer fix):** `packages/normalizer/src/text.ts`'s `normalizeText` now also
  strips Arabic combining diacritics (U+064B-U+065F, U+0670) — the same class of fix as
  ADR-0016's RLM/LRM strip, extended to cover this newly-observed real case. Regression test
  added confirming `اجارهٔ` and `اجاره` normalize identically.
- **Decision (semantic classification layer):** New file, `packages/scraper/src/divar/
semantic-fields.ts`. `classifyInfoRowLabel` normalizes a label then matches it against an
  ordered list of keyword-based category matchers (`deposit`, `monthlyRent`,
  `rentConvertibility`, `saleTotalPrice`, `salePricePerSqm`, `floor`) — most-specific first
  (`rentConvertibility`, which itself contains "ودیعه", is checked before plain `deposit`). A
  label matching nothing returns `null`; `classifyInfoRows` groups a full `infoRows` object by
  category and preserves every unmatched row under `unknown` rather than discarding it.
  `parse.ts` now sources `priceRaw` from `deposit ?? saleTotalPrice`, and carries
  `monthlyRentRaw`/`rentConvertibilityRaw`/`salePricePerSqmRaw` through as new `ParsedDivarFields`
  members — recognized, never discarded, but **not yet normalized into a domain field** (see
  the schema-gap decision below). `قیمت هر متر` (`salePricePerSqm`) is a structurally separate
  category from `saleTotalPrice` and never feeds `priceRaw` — verified by a dedicated test using
  the user-provided real example values (۲۱,۲۰۰,۰۰۰,۰۰۰ vs ۳۰۲,۸۵۷,۰۰۰ تومان).
- **Decision (hydration/readiness — real DOM synchronization, not a longer sleep):** The real
  Docker-collector run that found the sale-price bug also showed `floor`/price null far more
  often than `area`/`rooms`/`buildingAge`, correlated almost perfectly (15/16 postings null on
  both together, 1/16 with both populated). `DivarAdapter.fetch` waited only on the title
  selector before extracting; the group-row table (area/rooms/age) apparently hydrates first,
  the `unexpandable-info-row` region (price/floor) sometimes slightly after. Fixed by adding a
  second, real `page.waitForSelector(INFO_ROW_SELECTOR, ...)` wait after the title wait — a
  meaningful DOM readiness condition (React commits that region's rows together; once one
  exists, they all do), not a blind timeout increase. Still never a hard failure: a listing with
  genuinely no info-rows proceeds regardless, same as before.
- **Discovered, out of scope, reported rather than silently solved (real, live finding):**
  Inspecting several real current listings on `https://divar.ir/s/tehran/rent-residential`
  found that **most currently show rent pricing through a completely different DOM structure**
  — an interactive convertible deposit/rent slider ("ودیعه و اجارهٔ این ملک قابل تبدیل است" —
  "this property's deposit and rent are convertible"), with **no `unexpandable-info-row`
  elements for price at all**; the slider's rendered text is a _range_ ("۶۰۰ میلیون" /
  "۴۰۰ میلیون" for deposit, "۳ میلیون" / "۱۰ میلیون" for rent — min/max, not a single value).
  The fixed, non-convertible `unexpandable-info-row` pattern this phase's fix targets (ودیعه/
  اجارهٔ ماهانه/ودیعه و اجاره → غیر قابل تبدیل) is still real and current — confirmed on a live
  listing (`gafqTUo8`) matching the exact fields this phase was asked to support — but appears
  to be the less common case on `rent-residential` right now, not the majority one. Parsing the
  slider requires new selectors and a genuinely different extraction strategy (a value _range_,
  which `priceToman: bigint`, a scalar, cannot represent without a schema decision of its own) —
  a materially larger, separate problem from label-wording resilience, not attempted here.
- **Decision (schema gap, not a schema change):** `NormalizedListingFields`/the `posting` table
  have exactly one price slot, `priceToman`. Divar exposes up to four distinct real numbers
  (rent deposit, rent monthly amount, sale total price, sale price-per-square-meter), plus now a
  convertible-range concept with no scalar representation at all. Per this phase's explicit
  instruction, no schema migration was made. `monthlyRentRaw`/`rentConvertibilityRaw`/
  `salePricePerSqmRaw` are parsed and preserved at the `ParsedDivarFields` layer so the
  information is not lost, but `normalize.ts` does not yet turn them into stored columns —
  documented here as a future domain-model enhancement (new nullable columns, e.g.
  `deposit_toman`/`monthly_rent_toman`/`price_per_sqm_toman`, plus a decision on how or whether
  to represent a convertible range), not implemented in this step.
- **Unresolved, flagged rather than silently worked around:** `divar-collection-handler.ts`'s
  `isSupportedListingContext` still rejects any job payload with `transactionType: "rent"`
  outright (ADR-0016's explicit, MASTER_PROMPT-driven "rent stays structure-only" boundary,
  unchanged and not touched here) — a real rent `collect_divar` job cannot be enqueued and
  persisted through the actual pipeline right now, regardless of how correct the rent-parsing
  logic is. This phase's rent verification is therefore necessarily limited to deterministic
  tests and direct live-DOM inspection (both real, both reported above), not an end-to-end
  Neon-persisted rent collection run — that would require either lifting the boundary or
  building a parse-only verification path, neither of which was authorized in this step.

## ADR-0020 — Description was lost to an array-vs-object JSON-LD shape assumption, not hydration

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** A real listing (`https://divar.ir/v/gaYq3kUB`) has a genuine, non-empty Persian
  description, but every persisted posting had `description = null`. Investigated the full
  pipeline rather than assuming a cause, per instruction.
- **Root cause (confirmed, not a hydration issue):** the Apartment/Product JSON-LD block
  carrying `url`/`floorSize`/`description` is embedded server-rendered markup, present in the
  very first `domcontentloaded` DOM — verified directly against the real listing. The bug was in
  `extractRawDetailPage`'s parsing: Divar sometimes wraps that object in a single-element array
  (`[{...}]`), sometimes leaves it bare (`{...}`) — confirmed both shapes real, on different
  listings. The old code only checked `typeof data.floorSize === "object"` on the parsed value
  directly; against an array, `data.floorSize` is `undefined` (arrays have no such property), so
  the check silently failed. This affected `canonicalUrl` from the same object too, not only
  `description` — both come from the same block. Re-examining the original Phase 5 spike data
  confirms this bug existed from the start; it was not introduced by any later phase.
- **Decision (fix, and made testable in the process):** the JSON-LD parsing logic — previously
  inlined inside `extractRawDetailPage`, which runs inside `page.evaluate` and therefore cannot
  reference any outer-scope function — is now a standalone, pure, exported function,
  `parseJsonLdBlocks(rawJsonLdTexts: string[])`, unit-testable without a browser.
  `extractRawDetailPage` now only does the (cheap, real) DOM read of each `<script
type="application/ld+json">` tag's raw text; `DivarAdapter.fetch` calls `parseJsonLdBlocks` on
  that text outside the browser context. The function normalizes both the array-wrapped and
  bare-object shape into the same candidate loop, so either is handled identically.
  `description` is carried through completely raw — no trimming/cleaning/summarizing, multiline
  formatting preserved exactly — matching this phase's explicit instruction that it remain
  available as free-form source text for later phases (AI extraction, amenities, matching
  explanations), not a semantically-parsed field.
- **Verified real, not just fixture-tested:** the exact real `gaYq3kUB` description text is used
  as a fixture in `adapter.test.ts`'s `parseJsonLdBlocks` tests, alongside a bare-object
  regression case (the original `gaSebQzv` shape, proving no regression), a real bounded Docker
  collection against both `buy-residential` and `rent-residential`, and direct Neon verification
  (see this phase's session record for exact counts).
- **Consequences:** `RawDivarDetailPage`'s public shape (`canonicalUrl`, `jsonLdDescription`,
  etc.) is unchanged — this was purely an internal extraction-path fix, not a schema or
  domain-model change. `parse.ts`/`normalize.ts` needed no changes at all: `description` was
  already wired correctly end-to-end from `ParsedDivarFields` through to the `posting.description`
  column; it was simply never populated with a real value to carry.

## ADR-0021 — Sale price/floor extraction: the timing race is genuine upstream variance, not a fixable hydration-order bug

- **Date:** 2026-09-08
- **Status:** Accepted
- **Context:** Real Docker-collector runs showed `price_toman`/`floor` intermittently missing on
  SALE listings even with `waitForSelector(INFO_ROW_SELECTOR)` already in place (ADR-0019).
  Investigated with repeated, controlled live measurements against fixed, real listing URLs
  before writing any fix, per instruction not to assume the prior diagnosis still held.
- **Finding (the prior diagnosis was incomplete, confirmed by direct repeated measurement):**
  the same real listing, freshly navigated, resolved `[data-testid="unexpandable-info-row"]` in
  ~50ms on one attempt and had still not resolved it after a full 20s — sometimes 45s+ — on the
  very next fresh attempt. One trial left the page open for 58 continuous seconds and the
  selector still never matched, even though the same price/floor text was fully present in
  `document.body.innerText` well before that. This rules out "wrong selector" and "hydration
  ordering" as the root cause: the DOM structure and selector are correct (confirmed via direct
  ancestry inspection — `[data-testid="unexpandable-info-row"]` is genuinely present once the
  data has loaded); the actual variable is upstream — how long Divar's own client takes to fetch
  and render this specific data block, which varies enormously and unpredictably run to run for
  the identical URL.
- **Finding (what actually changes the odds):** a longer continuous wait on the same page load
  does not reliably help (the 58-second trial above disproves it), but a **fresh, independent
  page load** (`page.reload()`) sometimes succeeds where the original stalled — most plausibly
  because Divar's backend/CDN makes an independent routing/caching decision per request rather
  than the client-side JS being stuck in an infinite/long-running wait. Verified end-to-end
  against `DivarAdapter.fetch` on 5 real listings: 3 succeeded (one on the first attempt, at
  least one after the reload), 2 still failed even after both attempts — an honest, materially
  improved but not perfect result, consistent with the finding being real upstream variance
  rather than a deterministic bug with a deterministic fix.
- **Decision:** `DivarAdapter.fetch`'s info-row wait is now two bounded attempts, each on an
  independent page load: `waitForSelector(INFO_ROW_SELECTOR, {timeout: T/2})`, and only if that
  fails, one `page.reload()` followed by a second `waitForSelector(..., {timeout: T/2})`. Total
  worst-case wait is unchanged from before (`T`, the existing `navigationTimeoutMs` budget) —
  this is explicitly not "wait longer," which was tested and does not reliably help; it is two
  independent, shorter, real attempts instead of one long one. A listing with genuinely no
  info-rows still proceeds correctly (both attempts correctly find nothing, extraction continues
  with `null` fields, exactly as before) — this fix cannot and does not distinguish "still
  loading" from "genuinely absent," because no client-observable DOM signal can make that
  distinction when the data simply never arrives within any bounded window.
- **Rejected alternatives:** a single longer timeout (explicitly disallowed by instruction, and
  disproven by the 58-second trial regardless); racing `waitForSelector` against a
  `waitForFunction` on `body.innerText` (tested; results were inconsistent/inconclusive across
  repeated trials — no evidence it outperforms the selector-based wait, so not adopted without
  proof); an unbounded retry loop (violates the bounded-wait requirement and risks materially
  slowing every collection run for a benefit that isn't guaranteed).
- **Consequences — stated honestly, not hidden:** this materially improves reliability but does
  **not** guarantee deterministic extraction on every listing; a small residual failure rate is
  an accepted, understood property of Divar's own response-time distribution for this specific
  data block, not a defect in this codebase. A future phase could explore a bounded number of
  additional reload attempts (diminishing returns, and each attempt adds real wall-clock time to
  every collection run) or server-side signals (none currently exposed) — not pursued here, out
  of this step's explicit scope. `BrowserManager`, `semantic-fields.ts`'s classification logic,
  and raw `description` extraction (ADR-0020) are all unmodified by this change.
