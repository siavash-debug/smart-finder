/**
 * URL helpers, isolated from Playwright/DOM concerns so they're trivially unit-testable.
 *
 * Confirmed live (spike): both the bare `/v/{id}` and slug-prefixed `/v/{slug}/{id}` forms
 * resolve to the same content, and the posting id is reliably the LAST path segment of a
 * `/v/...` URL either way.
 */

import { DIVAR_BASE_URL } from "./selectors.js";

/** Extracts the posting id from a Divar `/v/...` URL (absolute or relative). Returns `null`
 *  for anything that isn't a `/v/...` path — never guesses an id out of an unrelated URL. */
export function extractSourcePostingId(url: string): string | null {
  let path: string;
  try {
    path = url.startsWith("http") ? new URL(url).pathname : url;
  } catch {
    return null;
  }
  const match = /^\/v\/(.+)$/.exec(path);
  if (match === null) return null;
  const segments = match[1]!.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last === undefined || last === "" ? null : last;
}

export function toAbsoluteUrl(href: string): string {
  return new URL(href, DIVAR_BASE_URL).toString();
}

/** The canonical detail URL smart-finder stores/links to — always the bare `/v/{id}` form, so
 *  the same posting never produces two different URLs across observations even if Divar's slug
 *  text changes (e.g. after a title edit). */
export function canonicalDetailUrl(sourcePostingId: string): string {
  return `${DIVAR_BASE_URL}/v/${sourcePostingId}`;
}
