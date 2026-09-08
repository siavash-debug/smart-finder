# Browser Rendering spike (temporary, isolated)

**This is not production code.** It is not part of the `smart-finder` npm workspace, not
referenced by any root build/test/lint config, and not wired into `apps/worker` or
`packages/scraper` in any way. It exists to answer one question: can Cloudflare Browser
Rendering open the real Divar fixture URL Phase 5 already validated
(`https://divar.ir/v/gaSebQzv`, see `packages/scraper/src/divar/adapter.smoke.test.ts`) and
extract the same core fields, using the same selectors (copied verbatim into `src/index.ts`,
not imported — this spike must not depend on or modify the production package)?

Delete this whole directory (`spikes/cloudflare-browser-rendering/`) once the spike's findings
are recorded; it was never meant to be kept.

## Why this cannot be fully tested locally

Cloudflare Browser Rendering is **not emulated by local `wrangler dev`**. Per Cloudflare's own
docs (browser-run "Reuse sessions" / Quick Actions pages, checked 2026-09-08), any Worker code
path that touches a `browser` binding requires **remote mode** — either `wrangler dev --remote`
or `"remote": true` on the binding — which runs your Worker against Cloudflare's real edge
infrastructure using your actual Cloudflare account and **does consume real Browser Rendering
minutes from the account's daily/monthly budget**, even though it is not a full `wrangler deploy`.

There is no way to exercise the real browser binding without this. A pure `wrangler dev` (no
`--remote`) will start, but any request that reaches `puppeteer.launch(env.BROWSER)` will fail
because no local browser backing exists for the binding.

**This spike has NOT been run yet.** Nothing has been executed against the real Cloudflare
account. Running it for real requires your explicit go-ahead because it touches the live
account (see "What running this actually requires" below).

## Files

- `wrangler.jsonc` — smallest possible config: one `browser` binding named `BROWSER`, no KV, no
  Queues, no Durable Objects, no Hyperdrive, no Cron Trigger.
- `src/index.ts` — the entire spike Worker. One `fetch` handler: launches the browser, navigates
  to the target URL, waits for the title selector (mirroring `DivarAdapter.fetch`'s exact wait
  strategy), extracts the same six core fields, returns full diagnostics as JSON, always closes
  the browser in a `finally` block.
- `package.json` / `tsconfig.json` — minimal, standalone; no dependency on the repo's root
  `package.json` workspaces, `tsconfig.base.json`, or `vitest.config.ts`.

## Exact reproduction steps (not yet executed)

```bash
cd spikes/cloudflare-browser-rendering
npm install
npx wrangler login          # if not already authenticated to the Cloudflare account
npm run dev:remote          # = wrangler dev --remote
```

Then, in another terminal or browser tab, once `wrangler dev --remote` prints a local URL
(typically `http://localhost:8787`):

```bash
# Real extraction test, against the Phase 5 fixture URL
curl -s http://localhost:8787/ | jq .

# Controlled failure test (§8 of the spike brief) — a URL with no /v/{id} posting
curl -s "http://localhost:8787/?fail=1" | jq .
```

Expected output shape (both requests return this envelope):

```json
{
  "diagnostics": {
    "targetUrl": "...",
    "controlledFailureTest": false,
    "browserLaunchSuccess": true,
    "navigationSuccess": true,
    "finalUrl": "...",
    "navigationStatus": 200,
    "pageTitle": "...",
    "selectorsFound": { "title": true, "infoRow": true, "groupRowTable": true },
    "accessDeniedOrCaptchaDetected": false,
    "errorCategory": null,
    "errorMessage": null,
    "timingMs": { "browserLaunch": 0, "navigation": 0, "extraction": 0, "total": 0 }
  },
  "extracted": { "title": "...", "canonicalUrl": "...", "infoRows": {}, "groupRow": null, "bodyTextSample": "..." },
  "fields": { "title": "...", "price": "...", "area": "...", "rooms": "...", "floor": "...", "sourceUrl": "..." }
}
```

Record both responses (paste the JSON) — that raw output is what section 5's comparison table
in the final report is built from.

## Cleanup

- `Ctrl+C` to stop `wrangler dev --remote` — this does **not** leave a deployed Worker behind;
  remote dev mode is a live tunnel to a temporary session, not a deployment. Nothing persists on
  the account from `wrangler dev --remote` alone.
- If `npm run deploy` is ever run (it has NOT been run as part of this spike), it would create a
  real Worker named `smart-finder-browser-rendering-spike` on the account — delete it via
  `npx wrangler delete` or the dashboard afterward.
- Delete this directory (`spikes/cloudflare-browser-rendering/`) once findings are recorded.

## What running this actually requires (STOP — explicit approval needed)

Per the spike brief's constraint: *"If a real Cloudflare deployment is required to test Browser
Rendering, STOP and report exactly what resource/permission would be required before creating
it. Do not create it automatically."*

Running `wrangler dev --remote` requires:
1. `wrangler` CLI authenticated to the **existing** Cloudflare account (no new account/resource
   creation — reuses the account already confirmed on Workers Free).
2. Cloudflare's consent to spin up a temporary remote dev session bound to a real Browser
   Rendering browser instance — this **consumes real minutes from the account's 10-minutes/day
   Free Browser Rendering budget** for as long as the session and each request take.
3. No new persistent resource is created by `dev --remote` itself (confirmed above) — only a
   live session for the duration it runs.

I have not run this. I'm stopping here per your instructions, with the spike fully written and
ready, to get your explicit go-ahead before it touches the live Cloudflare account and consumes
part of the daily Browser Rendering budget.
