import { describe, expect, it } from "vitest";
import { DEFAULT_RELAY_URL, resolveRelayUrl } from "./relay-config";

describe("resolveRelayUrl", () => {
  it("uses the shipped relay when nothing overrides it", () => {
    expect(resolveRelayUrl(true, {})).toBe(DEFAULT_RELAY_URL);
    expect(resolveRelayUrl(false, {})).toBe(DEFAULT_RELAY_URL);
  });

  it("honours DECK_RELAY_URL in an unpackaged run, without a trailing slash", () => {
    expect(resolveRelayUrl(false, { DECK_RELAY_URL: "http://192.168.1.5:8787/" })).toBe(
      "http://192.168.1.5:8787",
    );
  });

  it("ignores the variable in a packaged app", () => {
    expect(resolveRelayUrl(true, { DECK_RELAY_URL: "https://evil.example" })).toBe(
      DEFAULT_RELAY_URL,
    );
  });

  it("refuses an override that is not a plain http(s) URL", () => {
    expect(resolveRelayUrl(false, { DECK_RELAY_URL: "ftp://x" })).toBeNull();
    expect(resolveRelayUrl(false, { DECK_RELAY_URL: "not a url" })).toBeNull();
    expect(resolveRelayUrl(false, { DECK_RELAY_URL: "https://x.dev/relay?a=1" })).toBeNull();
  });
});
