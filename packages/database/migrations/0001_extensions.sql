-- 0001 — required PostgreSQL extensions.
--
-- pgcrypto : gen_random_uuid() for primary keys.
-- pg_trgm  : trigram similarity, used by duplicate-candidate detection (MASTER_PROMPT §28).
-- postgis  : geography types for neighborhood/district geometry (MASTER_PROMPT §7, "prefer").
--
-- pgcrypto and pg_trgm are required and fail the migration if unavailable.
-- postgis is optional: many managed Postgres offerings do not ship it, and the MVP must stay
-- portable (MASTER_PROMPT §33). Geography-dependent features check for it at runtime.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
    WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
        RAISE NOTICE 'postgis is unavailable on this server; geography features stay disabled';
END
$$;
