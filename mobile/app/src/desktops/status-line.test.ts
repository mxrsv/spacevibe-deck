import { describe, expect, it } from "vitest";
import type { PairingSummary } from "@/pairing/pairing-store";
import type { ConnectionSnapshot } from "@/session/connection";
import { formatAge, osSymbol, statusLine } from "./status-line";

const summary: PairingSummary = {
  pairingId: "id",
  relayUrl: "https://relay.test",
  desktopName: "Studio Mac",
  os: "macos",
  pairedAt: 0,
};
const base: ConnectionSnapshot = {
  status: "online",
  path: "relay",
  lastSeen: null,
  block: null,
  problem: null,
  live: null,
};
const NOW = 10_000_000;

describe("statusLine", () => {
  it("shows the OS and the path in use when online", () => {
    expect(statusLine(summary, base, NOW)).toEqual({
      dot: "online",
      text: "macOS · Relay",
      blocked: false,
    });
    expect(statusLine(summary, { ...base, path: "lan" }, NOW).text).toBe("macOS · Local network");
  });

  it("shows offline with the last-seen age (MOB11)", () => {
    const line = statusLine(
      summary,
      { ...base, status: "offline", lastSeen: NOW - 2 * 3_600_000 },
      NOW,
    );
    expect(line).toMatchObject({ dot: "offline", text: "macOS · offline · seen 2 h ago" });
    expect(statusLine(summary, { ...base, status: "offline" }, NOW).text).toBe("macOS · offline");
  });

  it("names the side to update when versions do not overlap (MOB10)", () => {
    expect(
      statusLine(summary, { ...base, status: "blocked", block: "update-desktop" }, NOW),
    ).toEqual({
      dot: "problem",
      text: "Update Deck on Studio Mac",
      blocked: true,
    });
    expect(
      statusLine(summary, { ...base, status: "blocked", block: "update-phone" }, NOW).text,
    ).toBe("Update this app from TestFlight or the App Store");
  });

  it("shows a revoked desktop as unusable (MOB2) and a relay problem as its own sentence (MOB8)", () => {
    expect(statusLine(summary, { ...base, status: "revoked" }, NOW).blocked).toBe(true);
    expect(
      statusLine(summary, { ...base, status: "failed", problem: "Pair it again." }, NOW).text,
    ).toBe("Pair it again.");
  });
});

describe("formatAge and osSymbol", () => {
  it("rounds to the unit a person reads", () => {
    expect(formatAge(0, 30_000)).toBe("just now");
    expect(formatAge(0, 5 * 60_000)).toBe("5 min ago");
    expect(formatAge(0, 3 * 3_600_000)).toBe("3 h ago");
    expect(formatAge(0, 2 * 86_400_000)).toBe("2 d ago");
    expect(formatAge(100, 0)).toBe("just now");
  });
  it("uses a laptop for a Mac and a desktop for the rest", () => {
    expect(osSymbol("macos")).toBe("laptopcomputer");
    expect(osSymbol("windows")).toBe("desktopcomputer");
  });
});
