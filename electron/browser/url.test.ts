import { describe, expect, it } from "vitest";
import { displayHost, isLoadableUrl, normalizeBrowserUrl } from "./url";

describe("normalizeBrowserUrl", () => {
  it("keeps a full URL as it is", () => {
    expect(normalizeBrowserUrl("https://example.com/x?y=1")).toBe("https://example.com/x?y=1");
  });

  it("reads `localhost:5173` as a host and port, not a scheme", () => {
    // `new URL("localhost:5173")` parses cleanly with protocol `localhost:`,
    // which is the whole reason this function exists: the most common input in
    // this panel is the one the platform parser gets wrong.
    expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
  });

  it("defaults local hosts to http and everything else to https", () => {
    expect(normalizeBrowserUrl("127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
    expect(normalizeBrowserUrl("deck.local")).toBe("http://deck.local/");
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
  });

  it("resolves a scheme-relative URL as https", () => {
    expect(normalizeBrowserUrl("//example.com/a")).toBe("https://example.com/a");
  });

  it("refuses schemes that are not http(s)", () => {
    // `javascript:` would run in the page; `file:` is the user's disk, and the
    // panel injects a script into whatever it loads.
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses input that is not an address at all", () => {
    expect(normalizeBrowserUrl("")).toBeNull();
    expect(normalizeBrowserUrl("   ")).toBeNull();
    expect(normalizeBrowserUrl("how do I fix this")).toBeNull();
    // No dot and not a known local host: a bare word is a search, and this
    // panel never turns the user's text into a search query.
    expect(normalizeBrowserUrl("dashboard")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBrowserUrl("  localhost:3000  ")).toBe("http://localhost:3000/");
  });
});

describe("isLoadableUrl", () => {
  it("accepts http and https only", () => {
    expect(isLoadableUrl("http://localhost:3000/")).toBe(true);
    expect(isLoadableUrl("https://example.com/")).toBe(true);
    expect(isLoadableUrl("file:///tmp/x")).toBe(false);
    expect(isLoadableUrl("not a url")).toBe(false);
  });
});

describe("displayHost", () => {
  it("returns host and port, and empty for junk", () => {
    expect(displayHost("http://localhost:5173/a/b")).toBe("localhost:5173");
    expect(displayHost("nonsense")).toBe("");
  });
});
