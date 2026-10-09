import { describe, expect, it } from "vitest";
import { buildView, chipSummary, identificationText, scanLine } from "./dev-server-model";
import { subjectFor } from "./dev-server-scope";
import { NOW, deckScans, row, snapshot } from "./dev-server-fixtures";

const MINUTE = 60_000;
const scans = deckScans();
const subject = subjectFor("/w/deck", scans);

describe("buildView", () => {
  it("names a row by its endpoint and leaves the scope's own detail off", () => {
    const view = buildView(snapshot([row()]), "worktree", subject, scans, NOW);

    expect(view.items[0]).toMatchObject({
      title: "127.0.0.1:5173",
      detail: null,
      state: "running",
      stateWord: "Running",
      url: "http://127.0.0.1:5173/",
      openReason: null,
    });
  });

  it("puts project and branch beside a row outside the one-checkout scope", () => {
    const view = buildView(
      snapshot([row({ id: "r", displayRoot: "/w/deck-redesign" })]),
      "project",
      subject,
      scans,
      NOW,
    );

    expect(view.items[0].detail).toBe("deck · redesign");
  });

  it("names the project after the primary checkout when the scan ran in a linked worktree", () => {
    const [primaryScan] = [...scans.values()];
    const linked = new Map([["/w/deck-redesign", { ...primaryScan, root: "/w/deck-redesign" }]]);
    const view = buildView(
      snapshot([row({ id: "r", displayRoot: "/w/deck-redesign" })]),
      "project",
      subject,
      linked,
      NOW,
    );

    expect(view.items[0].detail).toBe("deck · redesign");
  });

  it("brackets an IPv6 endpoint and never invents localhost", () => {
    const view = buildView(
      snapshot([
        row({ url: null, protocol: "unknown", bindings: [{ family: "IPv6", address: "::1" }] }),
      ]),
      "worktree",
      subject,
      scans,
      NOW,
    );

    expect(view.items[0].title).toBe("[::1]:5173");
  });

  it("orders running, then unknown, then stopped", () => {
    const view = buildView(
      snapshot([
        row({ id: "s", port: 3000, liveness: "stopped", stoppedAt: NOW - MINUTE }),
        row({ id: "u", port: 3001, liveness: "unknown" }),
        row({ id: "r", port: 3002 }),
      ]),
      "worktree",
      subject,
      scans,
      NOW,
    );

    expect(view.items.map((item) => item.id)).toEqual(["r", "u", "s"]);
  });

  it("counts what the scope hides", () => {
    const view = buildView(
      snapshot([row(), row({ id: "o", displayRoot: "/w/api", port: 8787 })]),
      "worktree",
      subject,
      scans,
      NOW,
    );

    expect(view.hiddenElsewhere).toBe(1);
    expect(view.running).toBe(1);
  });

  it("gives a stopped row an age and no protocol, and leaves its open actions unavailable", () => {
    const [item] = buildView(
      snapshot([row({ liveness: "stopped", stoppedAt: NOW - 2 * MINUTE })]),
      "worktree",
      subject,
      scans,
      NOW,
    ).items;

    expect(item.age).toBe("stopped 2 minutes ago");
    expect(item.protocol).toBeNull();
    expect(item.openReason).toBe("Not running");
  });

  it("gives an unknown row the age of its last reading", () => {
    const [item] = buildView(
      snapshot([row({ liveness: "unknown", observedAt: NOW - 5 * MINUTE })]),
      "worktree",
      subject,
      scans,
      NOW,
    ).items;

    expect(item.age).toBe("last seen 5 minutes ago");
    expect(item.openReason).toBe("Can’t confirm it is still running");
  });

  it("keeps the protocol token apart from the state", () => {
    const [https] = buildView(
      snapshot([row({ protocol: "https", url: "https://127.0.0.1:5173/" })]),
      "worktree",
      subject,
      scans,
      NOW,
    ).items;
    const [untrusted] = buildView(
      snapshot([
        row({ protocol: "unknown", url: null, identificationError: "tls:CERT_HAS_EXPIRED" }),
      ]),
      "worktree",
      subject,
      scans,
      NOW,
    ).items;

    expect(https.protocol).toEqual({ text: "HTTPS", tone: "ok" });
    expect(untrusted.state).toBe("running");
    expect(untrusted.protocol).toEqual({ text: "Certificate not trusted", tone: "faint" });
    expect(untrusted.url).toBeNull();
    expect(untrusted.openReason).toBe("Certificate not trusted");
  });
});

describe("identificationText", () => {
  it("reads a known probe code, and an unknown or missing one as not identified", () => {
    expect(identificationText("not-http")).toBe("Not an HTTP server");
    expect(identificationText("something-new")).toBe("Not identified as a web server");
    expect(identificationText(null)).toBe("Not identified as a web server");
  });
});

describe("chipSummary", () => {
  it("counts running servers in the active checkout only", () => {
    const snap = snapshot([
      row(),
      row({ id: "u", port: 3001, liveness: "unknown" }),
      row({ id: "r", displayRoot: "/w/deck-redesign", port: 3002 }),
    ]);

    expect(chipSummary(snap, false, subject, scans)).toEqual({ running: 1, scanFailed: false });
  });

  it("reports a failed scan from either the store or the snapshot", () => {
    expect(chipSummary(snapshot([]), true, subject, scans).scanFailed).toBe(true);
    expect(
      chipSummary(snapshot([], { completeness: "failed" }), false, subject, scans).scanFailed,
    ).toBe(true);
  });
});

describe("scanLine", () => {
  it("says it is scanning until the first reading", () => {
    const empty = buildView(null, "worktree", subject, scans, NOW);

    expect(scanLine(null, empty, NOW)).toBe("Scanning for listening servers…");
    expect(scanLine(snapshot([], { completeness: "pending", observedAt: null }), empty, NOW)).toBe(
      "Scanning for listening servers…",
    );
  });

  it("counts over what is listed and says when the scan was partial", () => {
    const snap = snapshot([row(), row({ id: "u", port: 1, liveness: "unknown" })], {
      completeness: "partial",
      observedAt: NOW - 3 * MINUTE,
    });
    const view = buildView(snap, "worktree", subject, scans, NOW);

    expect(scanLine(snap, view, NOW)).toBe(
      "Scanned 3 minutes ago · 1 running · 1 unknown · partial scan",
    );
    expect(
      scanLine(
        snapshot([row()]),
        buildView(snapshot([row()]), "worktree", subject, scans, NOW),
        NOW,
      ),
    ).toBe("Scanned just now · 1 running");
  });
});
