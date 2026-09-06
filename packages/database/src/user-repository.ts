/**
 * `app_user` repository.
 *
 * The user aggregate root is looked up by its own id or by the Telegram id used at login —
 * both identify a user directly, so unlike every other repository in this package there is no
 * separate "owner" to scope by (ARCHITECTURE §10 still applies to *this* table's callers,
 * just not within it).
 */

import type { Queryable } from "./pool.js";
import type { AppUserRow } from "./domain.js";

export interface CreateUserInput {
  telegramUserId: bigint;
  telegramUsername?: string;
  displayName?: string;
}

export async function createUser(pool: Queryable, input: CreateUserInput): Promise<AppUserRow> {
  const { rows } = await pool.query<AppUserRow>(
    `INSERT INTO app_user (telegram_user_id, telegram_username, display_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.telegramUserId, input.telegramUsername ?? null, input.displayName ?? null],
  );
  return rows[0]!;
}

export async function findUserById(pool: Queryable, userId: string): Promise<AppUserRow | null> {
  const { rows } = await pool.query<AppUserRow>("SELECT * FROM app_user WHERE id = $1", [userId]);
  return rows[0] ?? null;
}

export async function findUserByTelegramId(
  pool: Queryable,
  telegramUserId: bigint,
): Promise<AppUserRow | null> {
  const { rows } = await pool.query<AppUserRow>(
    "SELECT * FROM app_user WHERE telegram_user_id = $1",
    [telegramUserId],
  );
  return rows[0] ?? null;
}

/**
 * Looks the user up by Telegram id, creating one on first sight. Login is the only place a
 * user is implicitly created — everywhere else an absent user is an error, not something to
 * paper over.
 *
 * A single `INSERT ... ON CONFLICT` rather than read-then-write: two logins racing for the
 * same new Telegram id would otherwise both see "not found" and one insert would fail on the
 * unique constraint. `COALESCE` on the update branch means a login that carries no username
 * or display name (Telegram permits both to be unset) never blanks out a value fetched by an
 * earlier login.
 */
export async function findOrCreateUserByTelegramId(
  pool: Queryable,
  input: CreateUserInput,
): Promise<AppUserRow> {
  const { rows } = await pool.query<AppUserRow>(
    `INSERT INTO app_user (telegram_user_id, telegram_username, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_user_id) DO UPDATE
       SET telegram_username = COALESCE(EXCLUDED.telegram_username, app_user.telegram_username),
           display_name = COALESCE(EXCLUDED.display_name, app_user.display_name)
     RETURNING *`,
    [input.telegramUserId, input.telegramUsername ?? null, input.displayName ?? null],
  );
  return rows[0]!;
}
