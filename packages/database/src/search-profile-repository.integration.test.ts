/**
 * Integration tests against a real PostgreSQL instance, covering:
 *  - the one-active-profile-per-user replace/history flow, and
 *  - IDOR scoping (MASTER_PROMPT §24): every read here is filtered by `user_id` in SQL, so a
 *    caller who knows another user's profile id gets `null`, not that user's data.
 *
 * Skips itself when no database is reachable — see `test-support/db.ts`.
 */

import { afterAll, describe, expect, it } from "vitest";

import { createUser } from "./user-repository.js";
import {
  deactivateSearchProfile,
  getActiveSearchProfile,
  getSearchProfileById,
  listSearchProfileHistory,
  replaceActiveSearchProfile,
  type SearchProfileInput,
} from "./search-profile-repository.js";
import {
  closeTestPool,
  deleteTestUser,
  getTestPool,
  isTestDatabaseAvailable,
  randomTelegramUserId,
} from "./test-support/db.js";

const available = await isTestDatabaseAvailable();

const BASE_INPUT: SearchProfileInput = {
  transactionType: "sale",
  propertyType: "apartment",
  minAreaSqm: 80,
  maxAreaSqm: 110,
  minRooms: 2,
  requireElevator: true,
  requireParking: true,
  maxPriceToman: 15_000_000_000n,
};

async function createTestUser() {
  const pool = getTestPool();
  return createUser(pool, { telegramUserId: randomTelegramUserId() });
}

describe("search-profile repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("returns null when the user has no active profile", async () => {
    const pool = getTestPool();
    const user = await createTestUser();

    const profile = await getActiveSearchProfile(pool, user.id);

    expect(profile).toBeNull();
    await deleteTestUser(user.id);
  });

  it.runIf(available)("creates the first active profile for a user", async () => {
    const pool = getTestPool();
    const user = await createTestUser();

    const created = await replaceActiveSearchProfile(pool, user.id, BASE_INPUT);

    expect(created).toMatchObject({
      user_id: user.id,
      is_active: true,
      min_area_sqm: 80,
      max_area_sqm: 110,
      require_elevator: true,
      max_price_toman: 15_000_000_000n,
    });
    // Three-state fields not given a preference must stay unknown, never coerced to false.
    expect(created.require_storage).toBeNull();

    await deleteTestUser(user.id);
  });

  it.runIf(available)(
    "replacing the active profile deactivates the old one and snapshots it to history",
    async () => {
      const pool = getTestPool();
      const user = await createTestUser();

      const first = await replaceActiveSearchProfile(pool, user.id, {
        ...BASE_INPUT,
        rawQueryText: "۹۰ تا ۱۱۰ متر، دو خواب",
      });
      const second = await replaceActiveSearchProfile(pool, user.id, {
        ...BASE_INPUT,
        minAreaSqm: 100,
        rawQueryText: "حالا ۱۰۰ متر به بالا",
      });

      expect(second.id).not.toBe(first.id);
      expect(second.is_active).toBe(true);

      const active = await getActiveSearchProfile(pool, user.id);
      expect(active?.id).toBe(second.id);

      const history = await listSearchProfileHistory(pool, user.id, first.id);
      expect(history).toHaveLength(1);
      expect(history[0]?.snapshot).toMatchObject({ id: first.id, is_active: true });

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)("enforces one active profile per user at the database level", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    await replaceActiveSearchProfile(pool, user.id, BASE_INPUT);

    // Bypassing the repository to attempt a direct second active insert must violate the
    // unique partial index — this is the DB-level guarantee, not just an application check.
    await expect(
      pool.query(
        `INSERT INTO search_profile (user_id, transaction_type, property_type, is_active)
         VALUES ($1, 'sale', 'apartment', true)`,
        [user.id],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    await deleteTestUser(user.id);
  });

  it.runIf(available)("deactivateSearchProfile stops returning it as active", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    const profile = await replaceActiveSearchProfile(pool, user.id, BASE_INPUT);

    const didDeactivate = await deactivateSearchProfile(pool, user.id, profile.id);
    const active = await getActiveSearchProfile(pool, user.id);

    expect(didDeactivate).toBe(true);
    expect(active).toBeNull();

    await deleteTestUser(user.id);
  });

  describe("IDOR scoping", () => {
    it.runIf(available)(
      "getSearchProfileById returns null for a profile owned by a different user",
      async () => {
        const pool = getTestPool();
        const owner = await createTestUser();
        const attacker = await createTestUser();
        const profile = await replaceActiveSearchProfile(pool, owner.id, BASE_INPUT);

        const asOwner = await getSearchProfileById(pool, owner.id, profile.id);
        const asAttacker = await getSearchProfileById(pool, attacker.id, profile.id);

        expect(asOwner?.id).toBe(profile.id);
        expect(asAttacker).toBeNull();

        await deleteTestUser(owner.id);
        await deleteTestUser(attacker.id);
      },
    );

    it.runIf(available)(
      "deactivateSearchProfile is a no-op when the profile belongs to a different user",
      async () => {
        const pool = getTestPool();
        const owner = await createTestUser();
        const attacker = await createTestUser();
        const profile = await replaceActiveSearchProfile(pool, owner.id, BASE_INPUT);

        const didDeactivate = await deactivateSearchProfile(pool, attacker.id, profile.id);
        const stillActive = await getActiveSearchProfile(pool, owner.id);

        expect(didDeactivate).toBe(false);
        expect(stillActive?.id).toBe(profile.id);

        await deleteTestUser(owner.id);
        await deleteTestUser(attacker.id);
      },
    );

    it.runIf(available)(
      "listSearchProfileHistory returns nothing for a profile owned by a different user",
      async () => {
        const pool = getTestPool();
        const owner = await createTestUser();
        const attacker = await createTestUser();
        const first = await replaceActiveSearchProfile(pool, owner.id, BASE_INPUT);
        await replaceActiveSearchProfile(pool, owner.id, { ...BASE_INPUT, minAreaSqm: 95 });

        const asOwner = await listSearchProfileHistory(pool, owner.id, first.id);
        const asAttacker = await listSearchProfileHistory(pool, attacker.id, first.id);

        expect(asOwner.length).toBeGreaterThan(0);
        expect(asAttacker).toEqual([]);

        await deleteTestUser(owner.id);
        await deleteTestUser(attacker.id);
      },
    );
  });
});
