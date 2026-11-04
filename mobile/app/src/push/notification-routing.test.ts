import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "@protocol/crypto-node";
import { sealPush } from "@protocol/push";
import { createNobleCrypto } from "@/crypto/noble";
import {
  extractPushData,
  foregroundCopy,
  GENERIC_PUSH_BODY,
  localNotificationData,
  routeTap,
} from "./notification-routing";
import { createTapInbox } from "./tap-inbox";

const desktopCrypto = createNodeCrypto();
const phoneCrypto = createNobleCrypto((n) => new Uint8Array(randomBytes(n)));
const KEY = new Uint8Array(randomBytes(32));
const sealed = sealPush(desktopCrypto, KEY, {
  title: "Claude Code needs you",
  body: "Do you want to proceed?",
  paneId: 7,
  kind: "requested",
  desktop: "Studio Mac",
  at: 1,
});
const keyOf = (id: string): Uint8Array | null => (id === "pair-1" ? KEY : null);
const apns = { d: { p: "pair-1", c: sealed }, aps: {} };

function tampered(data: string): string {
  const flipped = data.slice(0, 20) + (data[20] === "A" ? "B" : "A") + data.slice(21);
  return flipped;
}

describe("extractPushData", () => {
  it("reads APNs's `d`, Expo's flat data and the extension's userInfo", () => {
    expect(extractPushData(apns)).toEqual({ pairingId: "pair-1", sealed, paneId: null });
    expect(extractPushData({ p: "pair-1", c: sealed })).toEqual({
      pairingId: "pair-1",
      sealed,
      paneId: null,
    });
    expect(extractPushData({ ...apns, paneId: 3, pairingId: "pair-1" })).toMatchObject({
      paneId: 3,
    });
    expect(extractPushData({})).toBeNull();
    expect(extractPushData(null)).toBeNull();
    expect(extractPushData({ d: { p: 5 } })).toBeNull();
  });
});

describe("routeTap (MOB23)", () => {
  it("opens the pane named by the sealed payload of a known pairing", () => {
    expect(routeTap(apns, phoneCrypto, keyOf)).toEqual({
      kind: "pane",
      desktopId: "pair-1",
      paneId: 7,
    });
  });

  it("falls back to the pane id the extension already put in the data", () => {
    const data = { d: { p: "pair-1", c: "garbage" }, paneId: 4 };
    expect(routeTap(data, phoneCrypto, keyOf)).toEqual({
      kind: "pane",
      desktopId: "pair-1",
      paneId: 4,
    });
  });

  it("opens Home for an unknown pairing, an undecryptable payload with no pane id, or no data", () => {
    expect(routeTap({ d: { p: "other", c: sealed } }, phoneCrypto, keyOf)).toEqual({
      kind: "home",
    });
    expect(routeTap({ d: { p: "pair-1", c: tampered(sealed) } }, phoneCrypto, keyOf)).toEqual({
      kind: "home",
    });
    expect(routeTap(undefined, phoneCrypto, keyOf)).toEqual({ kind: "home" });
  });

  it("opens the pane of our own local notification (real copy shown in the foreground)", () => {
    const copy = foregroundCopy(apns, phoneCrypto, keyOf);
    expect(copy).not.toBeNull();
    expect(routeTap(localNotificationData(copy!), phoneCrypto, keyOf)).toEqual({
      kind: "pane",
      desktopId: "pair-1",
      paneId: 7,
    });
  });
});

describe("foregroundCopy", () => {
  it("decrypts a sealed push made by the protocol with the pairing's key", () => {
    expect(foregroundCopy(apns, phoneCrypto, keyOf)).toEqual({
      title: "Claude Code needs you · Studio Mac",
      body: "Do you want to proceed?",
      paneId: 7,
      pairingId: "pair-1",
    });
  });

  it("returns null for a tampered or foreign push, so the generic line stands", () => {
    expect(
      foregroundCopy({ d: { p: "pair-1", c: tampered(sealed) } }, phoneCrypto, keyOf),
    ).toBeNull();
    expect(foregroundCopy({ d: { p: "other", c: sealed } }, phoneCrypto, keyOf)).toBeNull();
    expect(foregroundCopy({ d: { p: "pair-1" } }, phoneCrypto, keyOf)).toBeNull();
    expect(GENERIC_PUSH_BODY).toBe("An agent needs you");
  });
});

describe("tap inbox", () => {
  it("holds a tap until it is taken, once, and wakes listeners", () => {
    const inbox = createTapInbox();
    let woke = 0;
    inbox.subscribe(() => woke++);
    expect(inbox.take()).toBeNull();
    inbox.put({ a: 1 });
    expect(woke).toBe(1);
    expect(inbox.take()).toEqual({ data: { a: 1 } });
    expect(inbox.take()).toBeNull();
    inbox.put(undefined);
    expect(inbox.take()).toEqual({ data: undefined });
  });
});
