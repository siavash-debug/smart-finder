/**
 * The Phase 5 live Access Spike, captured as a real (not mocked) automated test — a genuine
 * Playwright session against exactly the two fixture URLs MASTER_PROMPT specified:
 * `https://divar.ir/s/tehran/rent-apartment` (list page, structure only — never product scope)
 * and `https://divar.ir/v/gaSebQzv` (one real detail page). No large-scale scraping, no other
 * URLs. Skipped by default (real network access to a third party) — set `RUN_LIVE_SMOKE=1` to
 * run it; this mirrors how the database integration tests skip themselves when Postgres isn't
 * reachable, rather than being deleted once the initial spike was done manually.
 */

import { describe, expect, it } from "vitest";

import { BrowserManager, createCloudflareCdpLaunch } from "../browser.js";
import { DivarAdapter } from "./adapter.js";

const RUN_LIVE_SMOKE = process.env.RUN_LIVE_SMOKE === "1";

describe.runIf(RUN_LIVE_SMOKE)(
  "DivarAdapter live smoke test (real network, local Chromium)",
  () => {
    it("discovers real listings from the rent-apartment list page and fetches/parses one real detail page", async () => {
      const manager = new BrowserManager({ navigationTimeoutMs: 30_000 });
      const adapter = new DivarAdapter(30_000);

      try {
        const listings = await manager.withPage((page) =>
          adapter.discover(page, "https://divar.ir/s/tehran/rent-apartment"),
        );
        expect(listings.length).toBeGreaterThan(0);
        // eslint-disable-next-line no-console -- deliberate: this is the smoke test's report
        console.log(`[smoke] discovered ${listings.length.toString()} listings from the list page`);

        const raw = await manager.withPage((page) =>
          adapter.fetch(page, { sourcePostingId: "gaSebQzv", url: "https://divar.ir/v/gaSebQzv" }),
        );
        const parsed = adapter.parse(raw);
        const normalized = adapter.normalize(
          parsed,
          { transactionType: "sale", propertyType: "apartment" },
          new Date(),
        );

        // eslint-disable-next-line no-console -- deliberate: this is the smoke test's report
        console.log("[smoke] extracted fields from https://divar.ir/v/gaSebQzv:", {
          title: parsed.title,
          areaSqm: normalized.areaSqm,
          rooms: normalized.rooms,
          floor: normalized.floor,
          totalFloors: normalized.totalFloors,
          priceToman: normalized.priceToman?.toString(),
          hasElevator: normalized.hasElevator,
          hasParking: normalized.hasParking,
          hasStorage: normalized.hasStorage,
        });

        expect(parsed.sourcePostingId).toBe("gaSebQzv");
        expect(normalized.areaSqm).toBe(110);
      } finally {
        await manager.close();
      }
    }, 60_000);
  },
);

// Stage 2 of the Browser Rendering migration (docs/DECISIONS.md): the same real fixture, the
// same unmodified DivarAdapter, but the browser is Cloudflare Browser Rendering reached over
// CDP instead of a locally-launched Chromium — proving the production `createCloudflareCdpLaunch`
// path end to end, not just the local-launch path above. Requires both `RUN_LIVE_SMOKE_CDP=1`
// and real Cloudflare credentials; skipped otherwise, exactly like the Postgres integration
// tests skip themselves when no database is reachable.
const RUN_LIVE_SMOKE_CDP = process.env.RUN_LIVE_SMOKE_CDP === "1";
const CDP_ACCOUNT_ID = process.env.CLOUDFLARE_BROWSER_RENDERING_ACCOUNT_ID;
const CDP_API_TOKEN = process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN;

describe.runIf(RUN_LIVE_SMOKE_CDP && CDP_ACCOUNT_ID !== undefined && CDP_API_TOKEN !== undefined)(
  "DivarAdapter live smoke test (real network, Cloudflare Browser Rendering via CDP)",
  () => {
    it("fetches/parses the same real detail page through Cloudflare's CDP endpoint", async () => {
      const manager = new BrowserManager({
        navigationTimeoutMs: 30_000,
        launch: createCloudflareCdpLaunch({
          accountId: CDP_ACCOUNT_ID!,
          apiToken: CDP_API_TOKEN!,
        }),
      });
      const adapter = new DivarAdapter(30_000);

      try {
        const raw = await manager.withPage((page) =>
          adapter.fetch(page, { sourcePostingId: "gaSebQzv", url: "https://divar.ir/v/gaSebQzv" }),
        );
        const parsed = adapter.parse(raw);
        const normalized = adapter.normalize(
          parsed,
          { transactionType: "sale", propertyType: "apartment" },
          new Date(),
        );

        // eslint-disable-next-line no-console -- deliberate: this is the smoke test's report
        console.log("[smoke:cdp] extracted fields from https://divar.ir/v/gaSebQzv:", {
          title: parsed.title,
          areaSqm: normalized.areaSqm,
          rooms: normalized.rooms,
          floor: normalized.floor,
        });

        expect(parsed.sourcePostingId).toBe("gaSebQzv");
        expect(normalized.areaSqm).toBe(110);
      } finally {
        await manager.close();
      }
    }, 60_000);
  },
);
