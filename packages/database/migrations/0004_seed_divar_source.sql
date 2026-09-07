-- 0004 — seed the Divar `source` row (Phase 5).
--
-- A data seed, not a schema change: `source` (migration 0002_core_schema.sql) already has
-- every column ingestion needs. `posting.source_id` is a required FK, so a real row must
-- exist before any posting can be persisted. `ON CONFLICT DO NOTHING` keeps this migration
-- safe to apply more than once, matching the idempotency every migration in this project
-- already has to satisfy (`migrate.ts`'s checksum guard aside — this is about re-running
-- against a database that already has the row, e.g. a restored backup).

INSERT INTO source (slug, display_name, base_url, robots_txt_checked_at)
VALUES ('divar', 'Divar', 'https://divar.ir', now())
ON CONFLICT (slug) DO NOTHING;
