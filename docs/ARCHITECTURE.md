# ARCHITECTURE

How the components connect, what flows between them, and why each technology was chosen.
Authority: `MASTER_PROMPT.md`. Rationale for individual choices: `DECISIONS.md`.

---

## 1. Two execution planes

The system is split into a **serve plane** and an **ingest plane**. They share a database and
a set of libraries, and nothing else. Neither imports the other (ADR-0004).

```
                    ┌──────────────── SERVE PLANE ────────────────┐
                    │                                             │
   User ──▶ Cloudflare ──▶ Next.js (apps/web) ──┐                 │
   (Persian, RTL)   │      App Router            │                │
                    └────────────────────────────┼────────────────┘
                                                 │
                                                 ▼
                                    ┌────────────────────────┐
                                    │   PostgreSQL 16+       │
                                    │   pg_trgm · postgis    │
                                    │   + job queue table    │
                                    └────────────────────────┘
                                                 ▲
                    ┌────────────────────────────┼────────────────┐
                    │                            │                │
                    │   Worker (apps/worker) ────┘                │
                    │   long-running Node process                 │
                    │                                             │
                    └──────────────── INGEST PLANE ───────────────┘
                                      │
                                      ▼
                              Telegram Bot API
```

The worker never depends on an HTTP request staying alive. Both planes are independently
restartable and independently deployable.

## 2. Ingest pipeline

The worker runs a poll loop against the `job` table and executes handlers per job type:

```
scheduled tick
      │
      ▼
  Collector ──▶ Parser ──▶ Normalizer ──▶ Deduplication ──▶ Property resolution
  (discover,    (raw →     (Persian       (candidate         (posting → property,
   fetch)        fields)    canonical)     pairs +            with confidence)
                                           confidence)
                                                                    │
                                                                    ▼
                                                            Match fan-out
                                                    (new/changed posting → candidate
                                                     search profiles via indexed
                                                     query → deterministic scoring)
                                                                    │
                                                                    ▼
                                                        Notification jobs ──▶ Telegram
                                                        (state machine, idempotent)
```

Fan-out direction is **listing → candidate profiles**, never profile → all listings
(MASTER_PROMPT §12). Candidate profiles are selected with indexed SQL predicates, then scored
in memory by the pure matching library.

## 3. Repository layout

```
smart-finder/
├── apps/
│   ├── web/                 Next.js 16 App Router · Persian RTL UI · serve plane
│   └── worker/              long-running Node process · ingest plane
├── packages/
│   ├── shared/              env loading, structured logging, domain primitives, errors
│   ├── database/            pg pool, typed query helpers, migrations, health probe
│   ├── normalizer/          (Phase 2) Persian text/number/currency/area/date normalization
│   ├── matching/            (Phase 3) pure deterministic scoring — zero dependencies
│   ├── telegram/            (Phase 4) bot client, login-signature verification
│   ├── scraper/             (Phase 5) SourceAdapter interface + per-source adapters
│   └── ai/                  (Phase 7) provider abstraction, schema-constrained extraction
├── infrastructure/docker/   Dockerfiles, compose, Postgres init
└── docs/                    project memory (this directory)
```

Packages not yet listed on disk are created by the phase that first implements them
(ADR-0008). Dependency direction is strictly one-way:

```
apps/web ──┐
           ├──▶ packages/database ──▶ packages/shared
apps/worker┘                              ▲
                                          │
           packages/matching ─────────────┘  (types only; no runtime deps)
```

`packages/*` must never import from `apps/*`, and must never import `next/*` — they run in
both planes.

## 4. Serve plane — `apps/web`

- **Next.js 16 App Router**, React 19, TypeScript.
- **Tailwind CSS 4** with `dir="rtl"` on `<html>` and logical properties (`ps-*`, `pe-*`,
  `ms-*`, `me-*`) rather than left/right (MASTER_PROMPT §17).
- **Vazirmatn** self-hosted via the `@fontsource-variable/vazirmatn` package, which ships the
  woff2 files locally — no third-party font CDN.
- All user-facing copy is Persian. Identifiers, comments and commits are English.
- Route handlers under `app/*/route.ts` are `runtime = "nodejs"` and `dynamic = "force-dynamic"`
  so health endpoints are never statically prerendered.

Health endpoints (ADR-0010):

| Path       | Meaning   | Dependencies probed | Failure code |
| ---------- | --------- | ------------------- | ------------ |
| `/healthz` | liveness  | none                | never fails  |
| `/readyz`  | readiness | PostgreSQL          | 503          |

## 5. Ingest plane — `apps/worker`

A plain Node process (`tsx` in development, compiled JS in the container). Responsibilities:

- poll the `job` table with `FOR UPDATE SKIP LOCKED`,
- dispatch to a job handler registry,
- retry with exponential backoff and a bounded attempt count,
- expose `/healthz` and `/readyz` on its own port for container probes,
- shut down gracefully on `SIGINT`/`SIGTERM`: stop claiming new jobs, let in-flight work
  finish within a timeout, then close the pool.

Every job execution carries a `run_id` through the logger so a whole pipeline pass can be
traced from one log field.

## 6. Data model shape

Full DDL lands in Phase 1. The shape that matters architecturally:

- `posting` — one advertisement on one source. Identity is
  `(source_id, source_posting_id)`. A `content_hash` drives change detection.
- `posting_version` — an append-only history row per observed content change; price history
  is derived from it, so source-specific history is never lost.
- `property` — one physical unit. Postings link to it with a confidence value. Uncertain
  links stay unresolved rather than being merged (MASTER_PROMPT §28).
- `search_profile` — the user's structured specification, plus the original Persian free-text
  query and the interpretation version that produced it.
- `match` — the scored relationship between a property/posting and a search profile, with the
  criteria breakdown that justified it.
- `job` — the queue.
- `notification` — a state machine (`pending → sent | failed | suppressed`) with an
  idempotency key so worker retries cannot re-send.

Money is `BIGINT` Toman everywhere (ADR-0005). Timestamps are `timestamptz` stored in UTC and
rendered in Jalali at the UI boundary only.

## 7. Configuration and secrets

`packages/shared/src/env.ts` validates the environment with Zod at process start and fails
fast on a missing or malformed required variable. Two disjoint sets:

- **server-only** — `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, AI provider keys. Never referenced
  from a client component.
- **public** — `NEXT_PUBLIC_*` only. Never a secret (MASTER_PROMPT §24).

The worker loads a deliberately narrower schema than the web app: it does not receive web
session secrets, and the collector path receives no application credentials it does not need.

## 8. Observability

`packages/shared/src/logger.ts` emits structured JSON lines: `level`, `time`, `msg`, plus
context fields (`run_id`, `job_id`, `source`, `posting_id`, `property_id`, `user_id`,
`duration_ms`, `status`, `error_type`). Child loggers bind context so handlers do not repeat
it on every call.

Redaction is applied at the logger level for `password`, `token`, `authorization`,
`DATABASE_URL`, and `phone`.

The headline product metric is **posting-to-notification latency** (p50, p95) — measured from
the posting's first observation to a successful Telegram send.

## 9. Technology rationale

| Choice                | Why                                                                          |
| --------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL 16+        | One dependency serves storage, fuzzy dedup (`pg_trgm`), geography, and queue |
| npm workspaces        | Ships with Node; no extra toolchain to install (ADR-0001)                    |
| TypeScript 5.9        | Type-aware linting still requires < 6.1 (ADR-0002)                           |
| Next.js 16 App Router | Server components keep database access off the client; RTL-friendly          |
| Tailwind 4            | Logical properties are first-class; no runtime CSS-in-JS cost                |
| Vitest 5              | Same ESM/TS resolution as the source; fast; no separate Babel step           |
| `pg` (node-postgres)  | Thin, explicit SQL. No ORM — the dedup and fan-out queries are hand-tuned    |
| Zod 4                 | One validator for env, API input, and AI output (MASTER_PROMPT §14)          |
| Docker Compose        | Reproducible Postgres locally; portable deployment (MASTER_PROMPT §33)       |

No ORM is used deliberately: the deduplication and match fan-out queries are the performance-
critical paths, and they are written as explicit indexed SQL.

## 10. Security boundaries

- Listing text is **untrusted external content**. It is escaped on render, never interpolated
  into SQL as anything but a bound parameter, and never passed to an LLM or an MCP tool as
  instruction context (MASTER_PROMPT §31).
- Every user-scoped query filters by the authenticated `user_id` — no object is fetched by ID
  alone (IDOR defence).
- Telegram login payloads are verified by HMAC signature and a bounded `auth_date` before a
  session is issued.
- Scheduled/administrative endpoints require an authenticated caller.
- Seller phone numbers are not stored (MASTER_PROMPT §23).
