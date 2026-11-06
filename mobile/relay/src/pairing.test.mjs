import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { claimAs, connect, connectAs, makePairing, register, startRelay } from "./test-harness.mjs";

let relay;
before(async () => {
  relay = await startRelay();
});
after(() => relay.dispose());

/** A registered, claimed pairing with both sides online and their join notices read. */
async function pairedBoth() {
  const pairing = makePairing();
  assert.equal(await register(relay, pairing), 201);
  const desktop = await connectAs(relay, pairing, "desktop");
  assert.deepEqual(desktop.ready, {
    t: "ready",
    role: "desktop",
    peerOnline: false,
    peerLastSeen: null,
  });
  const phone = await claimAs(relay, pairing);
  assert.equal(phone.ready.t, "ready");
  assert.equal(phone.ready.peerOnline, true);
  const joined = await desktop.client.nextText();
  assert.equal(joined.t, "peer");
  assert.equal(joined.online, true);
  return { pairing, desktop: desktop.client, phone: phone.client };
}

test("health answers on both the routed and the local path", async () => {
  for (const path of ["/v1/health", "/relay/v1/health"]) {
    const response = await relay.mf.dispatchFetch(`${relay.origin}${path}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, protocol: 1 });
  }
  const other = await relay.mf.dispatchFetch(`${relay.origin}/relay/nothing`);
  assert.equal(other.status, 404);
  await other.arrayBuffer();
});

test("registration: 201 once, then 409 for the same id", async () => {
  const pairing = makePairing();
  assert.equal(await register(relay, pairing), 201);
  assert.equal(await register(relay, pairing), 409);
});

test("registration refuses bad bodies, a past expiry and one too far ahead", async () => {
  const pairing = makePairing();
  const good = pairing.registration();
  const bodies = [
    "not json",
    "[]",
    JSON.stringify({ ...good, pairingId: "short" }),
    JSON.stringify({ ...good, claimHash: undefined }),
    JSON.stringify({ ...good, desktopTokenHash: "x".repeat(43) + "!" }),
    JSON.stringify({ ...good, expiresAt: Date.now() - 1000 }),
    JSON.stringify({ ...good, expiresAt: Date.now() + 11 * 60_000 }),
  ];
  for (const body of bodies) {
    const response = await relay.post("/v1/pairings", body);
    assert.equal(response.status, 400, body.slice(0, 40));
    await response.arrayBuffer();
  }
  const huge = await relay.post("/v1/pairings", JSON.stringify({ ...good, pad: "a".repeat(5000) }));
  assert.equal(huge.status, 413);
  await huge.arrayBuffer();
  // None of the refused bodies registered anything.
  assert.equal(await register(relay, pairing), 201);
});

test("the socket route needs a valid id and a WebSocket upgrade", async () => {
  const badId = await relay.mf.dispatchFetch(`${relay.origin}/v1/pairings/short/socket`, {
    headers: { upgrade: "websocket" },
  });
  assert.equal(badId.status, 404);
  const pairing = makePairing();
  const plain = await relay.mf.dispatchFetch(
    `${relay.origin}/v1/pairings/${pairing.pairingId}/socket`,
  );
  assert.equal(plain.status, 426);
});

test("a socket for an id nobody registered is told unknown", async () => {
  const client = await connect(relay, makePairing().pairingId);
  assert.deepEqual(await client.nextText(), { t: "error", code: "unknown" });
  assert.equal(await client.closed, 4404);
});

test("claim works once; a second claim is refused as claimed", async () => {
  const pairing = makePairing();
  await register(relay, pairing);
  const desktop = await connectAs(relay, pairing, "desktop");
  const first = await claimAs(relay, pairing);
  assert.deepEqual(first.ready, {
    t: "ready",
    role: "phone",
    peerOnline: true,
    peerLastSeen: first.ready.peerLastSeen,
  });
  assert.equal((await desktop.client.nextText()).t, "peer");

  const second = await claimAs(relay, pairing);
  assert.deepEqual(second.ready, { t: "error", code: "claimed" });
  assert.equal(await second.client.closed, 4409);
});

test("a wrong claim token is unauthorized and does not use up the claim", async () => {
  const pairing = makePairing();
  await register(relay, pairing);
  const wrong = await connect(relay, pairing.pairingId);
  wrong.sendText({
    t: "claim",
    claimToken: pairing.phoneToken,
    phoneTokenHash: pairing.phoneTokenHash,
  });
  assert.deepEqual(await wrong.nextText(), { t: "error", code: "unauthorized" });
  assert.equal(await wrong.closed, 4401);
  assert.equal((await claimAs(relay, pairing)).ready.t, "ready");
});

test("authentication: right token passes for each role, wrong or foreign tokens do not", async () => {
  const { pairing, desktop, phone } = await pairedBoth();
  desktop.close();
  phone.close();

  const swapped = await connect(relay, pairing.pairingId);
  swapped.sendText({ t: "auth", role: "desktop", token: pairing.phoneToken });
  assert.deepEqual(await swapped.nextText(), { t: "error", code: "unauthorized" });
  assert.equal(await swapped.closed, 4401);

  const phoneWithDesktopToken = await connect(relay, pairing.pairingId);
  phoneWithDesktopToken.sendText({ t: "auth", role: "phone", token: pairing.desktopToken });
  assert.equal((await phoneWithDesktopToken.nextText()).code, "unauthorized");

  const garbage = await connect(relay, pairing.pairingId);
  garbage.sendText("{not json");
  assert.equal((await garbage.nextText()).code, "unauthorized");
  assert.equal(await garbage.closed, 4401);

  const earlyBinary = await connect(relay, pairing.pairingId);
  earlyBinary.sendBinary(new Uint8Array([1, 2, 3]));
  assert.equal((await earlyBinary.nextText()).code, "unauthorized");

  await connectAs(relay, pairing, "desktop");
  await connectAs(relay, pairing, "phone");
});

test("the phone cannot authenticate before it has claimed", async () => {
  const pairing = makePairing();
  await register(relay, pairing);
  const client = await connect(relay, pairing.pairingId);
  client.sendText({ t: "auth", role: "phone", token: pairing.phoneToken });
  assert.equal((await client.nextText()).code, "unauthorized");
});

test("binary frames are forwarded untouched in both directions", async () => {
  const { desktop, phone } = await pairedBoth();
  const toDesktop = new Uint8Array([3, 0, 255, 1, 2, 3, 4]);
  phone.sendBinary(toDesktop);
  assert.deepEqual(await desktop.nextBinary(), toDesktop);
  const toPhone = new Uint8Array(5000).map((_, i) => i % 251);
  desktop.sendBinary(toPhone);
  assert.deepEqual(await phone.nextBinary(), toPhone);
});

test("a frame is dropped when the peer is offline and is not replayed later", async () => {
  const { pairing, desktop, phone } = await pairedBoth();
  phone.close();
  assert.deepEqual(
    { ...(await desktop.nextText()), lastSeen: "n" },
    { t: "peer", online: false, lastSeen: "n" },
  );
  desktop.sendBinary(new Uint8Array([9, 9, 9]));
  const again = await connectAs(relay, pairing, "phone");
  assert.equal(again.ready.peerOnline, true);
  assert.equal(await again.client.quiet(), true);
});

test("text control messages are never forwarded to the peer", async () => {
  const { desktop, phone } = await pairedBoth();
  phone.sendText({
    t: "push-token",
    kind: "expo",
    token: "ExponentPushToken[abc12345]",
    env: "production",
  });
  phone.sendText('{"t":"ping"}');
  assert.deepEqual(await phone.nextText(), { t: "pong" });
  assert.equal(await desktop.quiet(), true);
});

test("peer notices follow the other role going online and offline", async () => {
  const { pairing, desktop, phone } = await pairedBoth();
  // A second phone socket does not announce a second arrival.
  const second = await connectAs(relay, pairing, "phone");
  assert.equal(second.ready.peerOnline, true);
  assert.equal(await desktop.quiet(), true);
  // Offline is announced only when the last phone socket goes.
  phone.close();
  assert.equal(await desktop.quiet(), true);
  second.client.close();
  const gone = await desktop.nextText();
  assert.equal(gone.t, "peer");
  assert.equal(gone.online, false);
  assert.equal(typeof gone.lastSeen, "number");
  // Coming back reports when it was last seen.
  desktop.close();
  const back = await connectAs(relay, pairing, "desktop");
  assert.equal(back.ready.peerOnline, false);
  assert.equal(back.ready.peerLastSeen, gone.lastSeen);
});

test("revoke from the phone reaches the desktop; the pairing is then unknown", async () => {
  const { pairing, desktop, phone } = await pairedBoth();
  phone.sendText({ t: "revoke" });
  assert.deepEqual(await desktop.nextText(), { t: "revoked" });
  assert.equal(await desktop.closed, 4410);
  assert.deepEqual(await phone.nextText(), { t: "revoked" });
  assert.equal(await phone.closed, 4410);
  const later = await connect(relay, pairing.pairingId);
  assert.deepEqual(await later.nextText(), { t: "error", code: "unknown" });
  assert.equal(await later.closed, 4404);
  const dump = await relay.dump(pairing.pairingId);
  assert.deepEqual(dump.stored, {});
});

test("revoke from the desktop reaches the phone", async () => {
  const { desktop, phone } = await pairedBoth();
  desktop.sendText({ t: "revoke" });
  assert.deepEqual(await phone.nextText(), { t: "revoked" });
  assert.equal(await phone.closed, 4410);
});

test("a revoke from a socket that has not authenticated does nothing", async () => {
  const { pairing, desktop } = await pairedBoth();
  const intruder = await connect(relay, pairing.pairingId);
  intruder.sendText({ t: "revoke" });
  assert.equal((await intruder.nextText()).code, "unauthorized");
  assert.equal(await desktop.quiet(), true);
});

test("a frame over the limit closes the socket as too-large", async () => {
  const { desktop } = await pairedBoth();
  desktop.sendBinary(new Uint8Array(128 * 1024 + 1));
  assert.deepEqual(await desktop.nextText(), { t: "error", code: "too-large" });
  assert.equal(await desktop.closed, 4413);
});

test("a frame exactly at the limit still goes through", async () => {
  const { desktop, phone } = await pairedBoth();
  desktop.sendBinary(new Uint8Array(128 * 1024));
  assert.equal((await phone.nextBinary(5000)).byteLength, 128 * 1024);
});

test("a flood is closed as rate-limited after the burst allowance", async () => {
  const { desktop, phone } = await pairedBoth();
  // RELAY_RATE in mobile/protocol/src/limits.ts allows 1500 messages per 10 s.
  for (let i = 0; i < 1700; i += 1) desktop.sendBinary(new Uint8Array([3, i % 256]));
  let received = 0;
  for (;;) {
    const item = await phone.next(3000).catch(() => null);
    if (item === null) break;
    received += 1;
  }
  assert.ok(received >= 1495 && received <= 1540, `forwarded ${received}`);
  const error = await desktop.nextText();
  assert.deepEqual(error, { t: "error", code: "rate-limited" });
  assert.equal(await desktop.closed, 4429);
});

test("a third socket of one role closes the oldest with too-many-sockets", async () => {
  const { pairing, desktop: first } = await pairedBoth();
  const second = await connectAs(relay, pairing, "desktop");
  const third = await connectAs(relay, pairing, "desktop");
  assert.deepEqual(await first.nextText(), { t: "error", code: "too-many-sockets" });
  assert.equal(await first.closed, 4430);
  // The two newest still work.
  const phone = (await connectAs(relay, pairing, "phone")).client;
  phone.sendBinary(new Uint8Array([7]));
  assert.deepEqual(await second.client.nextBinary(), new Uint8Array([7]));
  assert.deepEqual(await third.client.nextBinary(), new Uint8Array([7]));
});
