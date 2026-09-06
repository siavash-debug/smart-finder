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
