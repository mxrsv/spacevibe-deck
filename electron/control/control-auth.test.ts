import { describe, expect, it } from "vitest";
import { CONTROL_MAX_BODY_BYTES, authorizeControlHead, controlCommandOfUrl } from "./control-auth";

const TOKEN = "0123456789abcdef0123456789abcdef";
const TTY = "ttys009";
const tokenFor = (paneId: number) => (paneId === 7 ? TOKEN : null);
const ttyFor = (paneId: number) => (paneId === 7 ? TTY : null);

function head(over: {
  method?: string;
  url?: string;
  headers?: Record<string, string | undefined>;
}) {
  return {
    method: over.method ?? "POST",
    url: over.url ?? "/control/v1/status",
    headers: {
      "x-deck-pane": "7",
      "x-deck-token": TOKEN,
      "x-deck-tty": TTY,
      ...over.headers,
    },
  };
}

const check = (over: Parameters<typeof head>[0]) =>
  authorizeControlHead(head(over), tokenFor, ttyFor);

describe("controlCommandOfUrl", () => {
  it("names status and group/verb routes and nothing else", () => {
    expect(controlCommandOfUrl("/control/v1/status")).toBe("status");
    expect(controlCommandOfUrl("/control/v1/worktree/create?x=1")).toBe("worktree/create");
    expect(controlCommandOfUrl("/control/v1/pane/wait")).toBe("pane/wait");
    for (const url of [
      undefined,
      "/control/v1/",
      "/control/v1/pane",
      "/control/v1/pane/",
      "/control/v1/pane/list/extra",
      "/control/v1/Pane/list",
      "/control/v2/status",
      "/control/v1/../hook",
      "/hook",
    ]) {
      expect(controlCommandOfUrl(url)).toBeNull();
    }
  });
});

describe("authorizeControlHead", () => {
  it("accepts a POST from a live pane with its token on its own tty", () => {
    expect(check({})).toEqual({ ok: true, paneId: 7, command: "status" });
    expect(check({ url: "/control/v1/pane/send", headers: { "x-deck-tty": " ttys009 " } })).toEqual(
      { ok: true, paneId: 7, command: "pane/send" },
    );
  });

  it("answers one 403 for an unknown pane, a wrong token, a wrong tty and a missing tty", () => {
    const refusals = [
      check({ headers: { "x-deck-pane": "8" } }),
      check({ headers: { "x-deck-token": "wrong" } }),
      check({ headers: { "x-deck-token": undefined } }),
      check({ headers: { "x-deck-tty": "ttys010" } }),
      check({ headers: { "x-deck-tty": "??" } }),
      check({ headers: { "x-deck-tty": undefined } }),
    ];
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({ ok: false, status: 403, error: "forbidden" });
    }
    // The caller learns nothing that tells the cases apart; only the log does.
    expect(new Set(refusals.map((r) => (r.ok ? "" : r.error))).size).toBe(1);
    expect(refusals.map((r) => (r.ok ? "" : r.reason))).toEqual([
      "no such pane",
      "wrong token",
      "wrong token",
      "wrong tty",
      "wrong tty",
      "wrong tty",
    ]);
  });

  it("refuses when the pane's own tty is unknown, even if the caller reports one", () => {
    const result = authorizeControlHead(head({}), tokenFor, () => null);
    expect(result).toMatchObject({ ok: false, status: 403, reason: "wrong tty" });
  });

  it("answers a malformed pane header with the same 403, not the hooks' 400", () => {
    for (const pane of [undefined, "", "0", "07", "-1", "1e3", "12345678901", "7 "]) {
      expect(check({ headers: { "x-deck-pane": pane } })).toMatchObject({
        ok: false,
        status: 403,
        error: "forbidden",
      });
    }
  });

  it("answers 405 for any method but POST, and 404 for a path it does not serve", () => {
    expect(check({ method: "GET" })).toMatchObject({ ok: false, status: 405 });
    expect(check({ method: "PUT" })).toMatchObject({ ok: false, status: 405 });
    expect(check({ url: "/control/v1/nope/nope/nope" })).toMatchObject({ ok: false, status: 404 });
    expect(check({ url: "/hook" })).toMatchObject({ ok: false, status: 404 });
  });

  it("tells an unauthenticated caller nothing about the command set", () => {
    const stranger = { headers: { "x-deck-token": "wrong" } };
    expect(check({ url: "/control/v1/pane/close", ...stranger })).toMatchObject({ status: 403 });
    expect(check({ url: "/control/v1/not/a-command", ...stranger })).toMatchObject({
      status: 403,
    });
  });

  it("refuses an oversize Content-Length with 413, after identity is proven", () => {
    const length = String(CONTROL_MAX_BODY_BYTES + 1);
    expect(check({ headers: { "content-length": length } })).toMatchObject({
      ok: false,
      status: 413,
      error: "too-large",
    });
    expect(check({ headers: { "content-length": length, "x-deck-token": "wrong" } })).toMatchObject(
      { status: 403 },
    );
    expect(check({ headers: { "content-length": String(CONTROL_MAX_BODY_BYTES) } }).ok).toBe(true);
  });
});
