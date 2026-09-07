import { describe, expect, it } from "vitest";

import { canonicalDetailUrl, extractSourcePostingId, toAbsoluteUrl } from "./url.js";

describe("extractSourcePostingId", () => {
  it("extracts the id from a bare /v/{id} url (real spike fixture URL)", () => {
    expect(extractSourcePostingId("https://divar.ir/v/gaSebQzv")).toBe("gaSebQzv");
  });

  it("extracts the id from a slug-prefixed /v/{slug}/{id} url — same posting, same id", () => {
    const slugUrl = "https://divar.ir/v/۱۱۰-متر-تک-واحدی-تخلیه-سعادت-آباد-صراف-ها/gaSebQzv";
    expect(extractSourcePostingId(slugUrl)).toBe("gaSebQzv");
  });

  it("extracts the id from a relative href", () => {
    expect(extractSourcePostingId("/v/80متری-دو-خواب-غرق-نور/gaemYCJC")).toBe("gaemYCJC");
  });

  it("returns null for a non-/v/ path — never guesses an id from an unrelated url", () => {
    expect(extractSourcePostingId("https://divar.ir/s/tehran/rent-apartment")).toBeNull();
  });

  it("returns null for a malformed url", () => {
    expect(extractSourcePostingId("not a url at all")).toBeNull();
  });
});

describe("toAbsoluteUrl / canonicalDetailUrl", () => {
  it("resolves a relative href against the Divar base url", () => {
    expect(toAbsoluteUrl("/v/gaSebQzv")).toBe("https://divar.ir/v/gaSebQzv");
  });

  it("builds the bare canonical form from a posting id, regardless of slug drift", () => {
    expect(canonicalDetailUrl("gaSebQzv")).toBe("https://divar.ir/v/gaSebQzv");
  });
});
