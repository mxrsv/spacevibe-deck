import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildInjection,
  GRAB_EVENT,
  inspectCall,
  MAX_GRAB_CHARS,
  PAGE_API,
  parseGrabPayload,
} from "./inject";

const VENDOR = "electron/vendor/react-grab/index.global.js";

describe("the vendored bundle", () => {
  /**
   * The record in `SOURCE.md` is what a reviewer reads instead of 386 kB of
   * minified source. If the two ever disagree, the record is fiction — so this
   * fails rather than letting an unrecorded bundle ship.
   */
  const EXPECTED_SHA256 = "G0pDLX1cafQAR421uH6kUJIQQY+veOYL1yHBO/8qWvY=";

  it("matches the hash recorded beside it", () => {
    const bytes = readFileSync(VENDOR);
    expect(createHash("sha256").update(bytes).digest("base64")).toBe(EXPECTED_SHA256);
  });

  it("still exposes the three names the bootstrap depends on", () => {
    // Not a style check: the bootstrap calls exactly these, and an upgrade that
    // renamed one would leave Inspect silently inert on every page.
    const source = readFileSync(VENDOR, "utf8");
    expect(source).toContain("__REACT_GRAB_MODULE__");
    expect(source).toContain("__REACT_GRAB_DISABLED__");
    expect(source).toContain("generateSnippet");
  });
});

describe("buildInjection", () => {
  const vendor = "/*vendor*/ globalThis.__REACT_GRAB_MODULE__ = {};";
  const script = buildInjection(vendor);

  it("is syntactically valid JavaScript", () => {
    // The one assertion that would have caught the real bug: an escape written
    // as `\n` inside this module's template literal is consumed by TypeScript
    // and emits a REAL newline into the generated script, landing inside a
    // string literal. Every `toContain` below still passed while the whole
    // injection was a SyntaxError and Inspect was dead on every page.
    expect(() => new Function(script)).not.toThrow();
  });

  it("disables the bundle's self-init before the bundle runs", () => {
    // Order is the whole point: self-init takes telemetry-on defaults and no
    // content hook, and it happens the moment the bundle is evaluated.
    const flag = script.indexOf("__REACT_GRAB_DISABLED__ = true");
    const bundle = script.indexOf("/*vendor*/");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(bundle);
  });

  it("initialises with telemetry off", () => {
    // Deck ships "no accounts, no telemetry"; react-grab's default is a
    // version-check request to react-grab.com on every init.
    expect(script).toContain("telemetry: false");
  });

  it("runs at most once per document", () => {
    expect(script).toContain(`if (!window.${PAGE_API})`);
  });

  it("returns the content react-grab copies, so ⌘C is unchanged", () => {
    expect(script).toContain(GRAB_EVENT);
    expect(script).toContain("return body;");
  });

  it("sends only after the copy is decided, never from getContent", () => {
    // The bundle races `getContent` against its own abort signal and discards
    // the result when the user cancels — while calling the hook with a single
    // argument, so the hook cannot tell. Sending from there pasted text the
    // user had abandoned. The copy hooks run after that decision.
    const contentAt = script.indexOf("function getContent");
    const hooksAt = script.indexOf("onCopySuccess");
    expect(hooksAt).toBeGreaterThan(-1);
    expect(script).toContain("onAfterCopy");
    expect(script).toContain("onCopyError");
    // `getContent` stashes; it does not dispatch.
    const body = script.slice(contentAt, script.indexOf("registerPlugin"));
    expect(body).toContain("inFlight = {");
    expect(body).not.toContain("send(");
  });

  it("adopts an instance the page already installed", () => {
    expect(script).toContain("getGlobalApi");
    expect(script).toContain("setOptions");
  });

  it("always produces something for the user, even if react-grab stalls", () => {
    // `getContent` sits between ⌘C and both destinations. An unsettled promise
    // there means no paste AND no clipboard, with nothing on screen saying so.
    expect(script).toContain("plainMarkup");
    expect(script).toContain("Promise.race");
    expect(script).toContain("outerHTML");
  });

  it("caps what one grab may carry", () => {
    expect(script).toContain(String(MAX_GRAB_CHARS));
  });

  it("does not wrap the bundle in a function", () => {
    // The bundle's first statement is `this.globalThis = …`, so a function
    // wrapper would change `this` and the module global would never be set.
    const bundleAt = script.indexOf("/*vendor*/");
    const before = script.slice(0, bundleAt);
    expect(before).not.toMatch(/function\s*\(|=>/);
  });
});

describe("inspectCall", () => {
  it("activates and deactivates through the page API", () => {
    expect(inspectCall(true)).toContain(`window.${PAGE_API}.activate()`);
    expect(inspectCall(false)).toContain(`window.${PAGE_API}.deactivate()`);
  });

  it("is inert when the bootstrap never ran", () => {
    // A page that failed to inject must not throw into the host's promise.
    expect(inspectCall(true)).toContain(`window.${PAGE_API} ?`);
  });
});

describe("parseGrabPayload", () => {
  const valid = JSON.stringify({
    text: "[<button> in Submit (at src/x.tsx:1:1)]",
    url: "http://localhost:3000/",
    title: "App",
    count: 1,
  });

  it("accepts a well-formed payload", () => {
    expect(parseGrabPayload(valid)).toEqual({
      text: "[<button> in Submit (at src/x.tsx:1:1)]",
      url: "http://localhost:3000/",
      title: "App",
      count: 1,
    });
  });

  it("rejects anything that is not a grab", () => {
    // The page is untrusted and can dispatch this event itself, so every
    // branch here is reachable by a hostile page rather than only by a bug.
    expect(parseGrabPayload(undefined)).toBeNull();
    expect(parseGrabPayload({ text: "x" })).toBeNull();
    expect(parseGrabPayload("{not json")).toBeNull();
    expect(parseGrabPayload(JSON.stringify(null))).toBeNull();
    expect(parseGrabPayload(JSON.stringify({ text: "   " }))).toBeNull();
    expect(parseGrabPayload("x".repeat(MAX_GRAB_CHARS * 2 + 1))).toBeNull();
  });

  it("truncates an oversized text instead of trusting it", () => {
    const huge = JSON.stringify({ text: "a".repeat(MAX_GRAB_CHARS + 500) });
    expect(parseGrabPayload(huge)?.text.length).toBe(MAX_GRAB_CHARS);
  });

  it("clamps a nonsense count", () => {
    expect(parseGrabPayload(JSON.stringify({ text: "x", count: -5 }))?.count).toBe(1);
    expect(parseGrabPayload(JSON.stringify({ text: "x", count: 1e9 }))?.count).toBe(99);
    expect(parseGrabPayload(JSON.stringify({ text: "x", count: "3" }))?.count).toBe(1);
  });

  it("defaults the fields a payload omits", () => {
    const parsed = parseGrabPayload(JSON.stringify({ text: "x" }));
    expect(parsed).toEqual({ text: "x", url: "", title: "", count: 1 });
  });
});
