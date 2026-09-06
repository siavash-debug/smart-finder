-- 0002 — core domain schema (MASTER_PROMPT §8).
--
-- Naming note: the user entity is named `app_user`, not `user` — `user` is a reserved
-- keyword in PostgreSQL and would require quoting at every call site. This is a naming
-- detail, not a scope change (MASTER_PROMPT §43).
--
-- Money is BIGINT Toman everywhere (ADR-0005). Timestamps are timestamptz, UTC.
-- Three-state booleans (has_elevator, has_parking, has_storage, require_*) are left
-- nullable rather than defaulted to false: NULL means "unknown", never "no"
-- (MASTER_PROMPT §9). Enumerated fields are TEXT + CHECK rather than a native ENUM type,
-- so adding a value later is a plain constraint migration instead of an ALTER TYPE.
--
-- §28 requires uncertain duplicate pairs to stay unmerged with a recorded confidence.
-- `duplicate_candidate` implements that; `posting.property_id` + `property_confidence`
-- represents an accepted (possibly automatic, above-threshold) resolution.

-- ── trigger helper ────────────────────────────────────────────────────────────────────────

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── app_user ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE app_user (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id   bigint      NOT NULL UNIQUE,
    telegram_username  text,
    display_name       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER app_user_set_updated_at
    BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── auth_session ──────────────────────────────────────────────────────────────────────────
-- Telegram login is verified once (Phase 4); this table only holds the resulting session.
-- The token itself is never stored — only its hash — so a database leak does not leak
-- live sessions (MASTER_PROMPT §24).

CREATE TABLE auth_session (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    session_token_hash text        NOT NULL UNIQUE,
    user_agent         text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz
);

CREATE INDEX idx_auth_session_user_id ON auth_session(user_id);
-- Session validation is a hot path: look up by hash, only among sessions still live.
CREATE INDEX idx_auth_session_active
    ON auth_session(session_token_hash)
    WHERE revoked_at IS NULL;

-- ── geo_area ──────────────────────────────────────────────────────────────────────────────
-- Tehran geography model: city → district → neighborhood, self-referencing.

CREATE TABLE geo_area (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text        NOT NULL CHECK (kind IN ('city', 'district', 'neighborhood')),
    name_fa     text        NOT NULL,
    parent_id   uuid        REFERENCES geo_area(id) ON DELETE RESTRICT,
    centroid    geography(Point, 4326),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_geo_area_parent_id ON geo_area(parent_id);
CREATE INDEX idx_geo_area_kind ON geo_area(kind);
-- Fuzzy lookup when resolving a source's free-text area label to a geo_area.
CREATE INDEX idx_geo_area_name_fa_trgm ON geo_area USING gin (name_fa gin_trgm_ops);

-- ── source ────────────────────────────────────────────────────────────────────────────────

CREATE TABLE source (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    text        NOT NULL UNIQUE,
    display_name            text        NOT NULL,
    base_url                text        NOT NULL,
    enabled                 boolean     NOT NULL DEFAULT true,
    robots_txt_checked_at   timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- ── source_area_alias ─────────────────────────────────────────────────────────────────────
-- Maps a source's own area code/label to our geo_area. Left unresolved (geo_area_id NULL)
-- until a human or a deterministic rule confirms the mapping — never guessed.

CREATE TABLE source_area_alias (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id      uuid        NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    external_code  text        NOT NULL,
    external_name  text        NOT NULL,
    geo_area_id    uuid        REFERENCES geo_area(id) ON DELETE SET NULL,
    confidence     numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_code)
);

CREATE INDEX idx_source_area_alias_geo_area_id ON source_area_alias(geo_area_id);

-- ── collection_run ────────────────────────────────────────────────────────────────────────
-- One row per collector execution. Delisting is only trusted after a completed, healthy
-- run (MASTER_PROMPT §22) — never from a single missing observation.

CREATE TABLE collection_run (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id        uuid        NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    status           text        NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running', 'completed', 'failed')),
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    postings_seen    integer     NOT NULL DEFAULT 0,
    postings_new     integer     NOT NULL DEFAULT 0,
    postings_updated integer     NOT NULL DEFAULT 0,
    error_message    text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collection_run_source_started
    ON collection_run(source_id, started_at DESC);

-- ── property ──────────────────────────────────────────────────────────────────────────────
-- The physical unit. Canonical attributes are filled in by property resolution (Phase 6)
-- from its linked postings and stay NULL — "نامشخص", never guessed — until then.

CREATE TABLE property (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    district_geo_area_id      uuid        REFERENCES geo_area(id) ON DELETE SET NULL,
    neighborhood_geo_area_id  uuid        REFERENCES geo_area(id) ON DELETE SET NULL,
    area_sqm                  integer     CHECK (area_sqm IS NULL OR area_sqm > 0),
    rooms                     integer     CHECK (rooms IS NULL OR rooms >= 0),
    floor                     integer,
    building_age_years        integer     CHECK (building_age_years IS NULL OR building_age_years >= 0),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER property_set_updated_at
    BEFORE UPDATE ON property
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_property_district ON property(district_geo_area_id);
CREATE INDEX idx_property_neighborhood ON property(neighborhood_geo_area_id);

-- ── posting ───────────────────────────────────────────────────────────────────────────────
-- One advertisement on one source. Identity is (source_id, source_posting_id)
-- (MASTER_PROMPT §21). MVP scope is sale/apartment only, but the CHECK list is a plain
-- constraint to extend later rather than a schema change (MASTER_PROMPT §5 — do not build
-- rent or other types yet, but do not hard-code the schema to a single value either).

CREATE TABLE posting (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id                 uuid        NOT NULL REFERENCES source(id) ON DELETE RESTRICT,
    source_posting_id         text        NOT NULL,

    property_id               uuid        REFERENCES property(id) ON DELETE SET NULL,
    property_confidence       numeric(4,3) CHECK (property_confidence IS NULL OR property_confidence BETWEEN 0 AND 1),

    transaction_type          text        NOT NULL CHECK (transaction_type IN ('sale')),
    property_type             text        NOT NULL CHECK (property_type IN ('apartment')),

    title                     text,
    description                text,
    price_toman               bigint      CHECK (price_toman IS NULL OR price_toman >= 0),
    area_sqm                  integer     CHECK (area_sqm IS NULL OR area_sqm > 0),
    rooms                     integer     CHECK (rooms IS NULL OR rooms >= 0),
    floor                     integer,
    total_floors               integer,
    building_age_years        integer     CHECK (building_age_years IS NULL OR building_age_years >= 0),
    has_elevator               boolean,
    has_parking                boolean,
    has_storage                boolean,

    district_geo_area_id      uuid        REFERENCES geo_area(id) ON DELETE SET NULL,
    neighborhood_geo_area_id  uuid        REFERENCES geo_area(id) ON DELETE SET NULL,
    raw_address                text,

    content_hash               text        NOT NULL,
    status                     text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'delisted', 'unknown')),

    first_seen_at              timestamptz NOT NULL DEFAULT now(),
    last_seen_at                timestamptz NOT NULL DEFAULT now(),
    delisted_at                 timestamptz,
    last_collection_run_id     uuid        REFERENCES collection_run(id) ON DELETE SET NULL,

    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    UNIQUE (source_id, source_posting_id)
);

CREATE TRIGGER posting_set_updated_at
    BEFORE UPDATE ON posting
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Match fan-out (MASTER_PROMPT §12): a changed posting looks up candidate search profiles by
-- these indexed fields, never the other way around.
CREATE INDEX idx_posting_fanout
    ON posting(transaction_type, property_type, status, district_geo_area_id, price_toman, area_sqm);
CREATE INDEX idx_posting_property_id ON posting(property_id) WHERE property_id IS NOT NULL;
CREATE INDEX idx_posting_neighborhood ON posting(neighborhood_geo_area_id);
CREATE INDEX idx_posting_status ON posting(status);
-- Duplicate-candidate detection (§28): trigram similarity over normalized text.
CREATE INDEX idx_posting_title_trgm ON posting USING gin (title gin_trgm_ops);

-- ── posting_version ───────────────────────────────────────────────────────────────────────
-- Append-only. Price history and every other change track are derived from this, so
-- source-specific history is never lost (MASTER_PROMPT §21, §29).

CREATE TABLE posting_version (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    posting_id         uuid        NOT NULL REFERENCES posting(id) ON DELETE CASCADE,
    content_hash       text        NOT NULL,
    price_toman        bigint      CHECK (price_toman IS NULL OR price_toman >= 0),
    area_sqm           integer,
    rooms              integer,
    floor              integer,
    title              text,
    description        text,
    has_elevator       boolean,
    has_parking        boolean,
    has_storage        boolean,
    raw_payload        jsonb,
    collection_run_id  uuid        REFERENCES collection_run(id) ON DELETE SET NULL,
    observed_at        timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_posting_version_posting_observed
    ON posting_version(posting_id, observed_at DESC);
-- Price-drop detection scans consecutive versions per posting.
CREATE INDEX idx_posting_version_price
    ON posting_version(posting_id, observed_at DESC)
    WHERE price_toman IS NOT NULL;

-- ── duplicate_candidate ───────────────────────────────────────────────────────────────────
-- Uncertain posting-pairs suspected to describe the same property. Never auto-merged below
-- threshold (MASTER_PROMPT §28). posting_a_id < posting_b_id is enforced by the application
-- layer so a pair is never stored twice in reversed order.

CREATE TABLE duplicate_candidate (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    posting_a_id   uuid        NOT NULL REFERENCES posting(id) ON DELETE CASCADE,
    posting_b_id   uuid        NOT NULL REFERENCES posting(id) ON DELETE CASCADE,
    confidence     numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    signals        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status         text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'confirmed', 'rejected')),
    reviewed_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (posting_a_id < posting_b_id),
    UNIQUE (posting_a_id, posting_b_id)
);

CREATE INDEX idx_duplicate_candidate_posting_a ON duplicate_candidate(posting_a_id);
CREATE INDEX idx_duplicate_candidate_posting_b ON duplicate_candidate(posting_b_id);
CREATE INDEX idx_duplicate_candidate_status ON duplicate_candidate(status) WHERE status = 'pending';

-- ── search_profile ────────────────────────────────────────────────────────────────────────
-- MVP: one active profile per user (MASTER_PROMPT §4). Editing does not delete history —
-- see search_profile_history — it creates a new snapshot of the same row.

CREATE TABLE search_profile (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,

    transaction_type            text        NOT NULL CHECK (transaction_type IN ('sale')),
    property_type                text        NOT NULL CHECK (property_type IN ('apartment')),

    min_price_toman              bigint      CHECK (min_price_toman IS NULL OR min_price_toman >= 0),
    max_price_toman              bigint      CHECK (max_price_toman IS NULL OR max_price_toman >= 0),
    min_area_sqm                 integer     CHECK (min_area_sqm IS NULL OR min_area_sqm > 0),
    max_area_sqm                 integer     CHECK (max_area_sqm IS NULL OR max_area_sqm > 0),
    min_rooms                    integer     CHECK (min_rooms IS NULL OR min_rooms >= 0),
    max_rooms                    integer     CHECK (max_rooms IS NULL OR max_rooms >= 0),
    min_floor                    integer,
    max_floor                    integer,
    min_building_age_years       integer     CHECK (min_building_age_years IS NULL OR min_building_age_years >= 0),
    max_building_age_years       integer     CHECK (max_building_age_years IS NULL OR max_building_age_years >= 0),

    require_elevator             boolean,
    require_parking              boolean,
    require_storage              boolean,

    district_geo_area_id         uuid        REFERENCES geo_area(id) ON DELETE SET NULL,
    neighborhood_geo_area_id     uuid        REFERENCES geo_area(id) ON DELETE SET NULL,

    raw_query_text                text,
    interpretation_version        text,

    is_active                     boolean     NOT NULL DEFAULT true,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now(),

    CHECK (
        min_price_toman IS NULL OR max_price_toman IS NULL OR min_price_toman <= max_price_toman
    ),
    CHECK (
        min_area_sqm IS NULL OR max_area_sqm IS NULL OR min_area_sqm <= max_area_sqm
    )
);

CREATE TRIGGER search_profile_set_updated_at
    BEFORE UPDATE ON search_profile
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_search_profile_user_id ON search_profile(user_id);
-- MVP: one active profile per user.
CREATE UNIQUE INDEX uq_search_profile_one_active_per_user
    ON search_profile(user_id) WHERE is_active;
-- Match fan-out reads candidate profiles by these fields for a given posting.
CREATE INDEX idx_search_profile_fanout
    ON search_profile(transaction_type, property_type, district_geo_area_id)
    WHERE is_active;

-- ── search_profile_history ────────────────────────────────────────────────────────────────

CREATE TABLE search_profile_history (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    search_profile_id      uuid        NOT NULL REFERENCES search_profile(id) ON DELETE CASCADE,
    snapshot               jsonb       NOT NULL,
    raw_query_text         text,
    interpretation_version text,
    changed_at             timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_profile_history_profile
    ON search_profile_history(search_profile_id, changed_at DESC);

-- ── match ─────────────────────────────────────────────────────────────────────────────────
-- The scored relationship between one posting and one search profile. `score` is internal
-- ranking only — the user-facing surface is `tier` and `criteria` (MASTER_PROMPT §10).
-- Recomputing a match updates the existing row rather than inserting a duplicate.

CREATE TABLE match (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    search_profile_id   uuid        NOT NULL REFERENCES search_profile(id) ON DELETE CASCADE,
    posting_id          uuid        NOT NULL REFERENCES posting(id) ON DELETE CASCADE,
    property_id         uuid        REFERENCES property(id) ON DELETE SET NULL,
    tier                text        NOT NULL CHECK (tier IN ('EXACT', 'STRONG', 'NEAR', 'WEAK')),
    score               integer     NOT NULL CHECK (score BETWEEN 0 AND 100),
    criteria            jsonb       NOT NULL,
    violations          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    computed_at         timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (search_profile_id, posting_id)
);

-- Results page: a user's matches ordered by tier/recency.
CREATE INDEX idx_match_profile_tier
    ON match(search_profile_id, tier, computed_at DESC);
CREATE INDEX idx_match_posting_id ON match(posting_id);

-- ── user_listing_action ───────────────────────────────────────────────────────────────────
-- One state per (user, posting) — save / not-interested. Upserted, not appended.

CREATE TABLE user_listing_action (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    posting_id  uuid        NOT NULL REFERENCES posting(id) ON DELETE CASCADE,
    action      text        NOT NULL CHECK (action IN ('saved', 'not_interested')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, posting_id)
);

CREATE TRIGGER user_listing_action_set_updated_at
    BEFORE UPDATE ON user_listing_action
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_user_listing_action_user_id ON user_listing_action(user_id);

-- ── notification ──────────────────────────────────────────────────────────────────────────
-- State machine: pending → sent | failed | suppressed (MASTER_PROMPT §19).
-- `idempotency_key` is the mechanism that makes a worker retry safe to run twice.

CREATE TABLE notification (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    match_id         uuid        REFERENCES match(id) ON DELETE SET NULL,
    posting_id       uuid        REFERENCES posting(id) ON DELETE SET NULL,
    channel          text        NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram')),
    template         text        NOT NULL,
    payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key  text        NOT NULL UNIQUE,
    status           text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'failed', 'suppressed')),
    attempts         integer     NOT NULL DEFAULT 0,
    last_error       text,
    scheduled_for    timestamptz NOT NULL DEFAULT now(),
    sent_at          timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_set_updated_at
    BEFORE UPDATE ON notification
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Worker claim query: due, still-pending notifications.
CREATE INDEX idx_notification_pending_due
    ON notification(scheduled_for)
    WHERE status = 'pending';
CREATE INDEX idx_notification_user_id ON notification(user_id, created_at DESC);

-- ── job ───────────────────────────────────────────────────────────────────────────────────
-- The queue (MASTER_PROMPT §25). Workers claim with SELECT ... FOR UPDATE SKIP LOCKED.

CREATE TABLE job (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type      text        NOT NULL,
    payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status        text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority      integer     NOT NULL DEFAULT 0,
    attempts      integer     NOT NULL DEFAULT 0,
    max_attempts  integer     NOT NULL DEFAULT 5,
    run_at        timestamptz NOT NULL DEFAULT now(),
    locked_at     timestamptz,
    locked_by     text,
    run_id        text,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz
);

CREATE TRIGGER job_set_updated_at
    BEFORE UPDATE ON job
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The claim query: pending jobs due to run, highest priority first. Partial on status keeps
-- this index small as completed/failed jobs accumulate.
CREATE INDEX idx_job_claim
    ON job(run_at, priority DESC)
    WHERE status = 'pending';
CREATE INDEX idx_job_type_status ON job(job_type, status);

-- ── audit_log ─────────────────────────────────────────────────────────────────────────────
-- Privileged operations (MCP guarded writes, admin actions) — MASTER_PROMPT §31.

CREATE TABLE audit_log (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor        text        NOT NULL,
    action       text        NOT NULL,
    target_type  text,
    target_id    text,
    detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);

-- ── llm_call ──────────────────────────────────────────────────────────────────────────────
-- Every AI call, for the cache and the daily spend cap (MASTER_PROMPT §15).

CREATE TABLE llm_call (
    id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider                 text        NOT NULL,
    model                    text        NOT NULL,
    purpose                  text        NOT NULL,
    input_hash               text        NOT NULL,
    output                   jsonb,
    prompt_tokens            integer,
    completion_tokens        integer,
    estimated_cost_usd_cents integer,
    success                  boolean     NOT NULL,
    error_message            text,
    created_at               timestamptz NOT NULL DEFAULT now()
);

-- Content-hash cache lookup (§15) and daily spend aggregation.
CREATE INDEX idx_llm_call_cache ON llm_call(purpose, input_hash) WHERE success;
CREATE INDEX idx_llm_call_created_at ON llm_call(created_at);
