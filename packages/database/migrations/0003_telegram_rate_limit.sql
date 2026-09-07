-- 0003 — Telegram command rate limiting (Phase 4).
--
-- app_user, auth_session, and notification already fully support the Telegram identity and
-- notification-delivery needs of Phase 4 (Phase 1 schema) — no changes to them here. This
-- migration adds exactly one new table: a minimal event log the webhook consults to decide
-- whether a Telegram user is sending commands too fast (MASTER_PROMPT-adjacent Phase 4 §17).
--
-- Deliberately NOT reusing `audit_log`: that table's documented purpose (migration
-- 0002_core_schema.sql) is privileged/admin operations, not routine per-message rate-limit
-- bookkeeping — overloading it would blur a distinction Phase 1 drew on purpose.

CREATE TABLE telegram_command_log (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id  bigint      NOT NULL,
    command           text        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- The only query this table serves: "how many commands has this Telegram user sent recently?"
CREATE INDEX idx_telegram_command_log_rate
    ON telegram_command_log(telegram_user_id, created_at DESC);
