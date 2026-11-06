import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { connect, connectAs, makePairing, register, startRelay } from "./test-harness.mjs";

let relay;
before(async () => {
  relay = await startRelay();
});
after(() => relay.dispose());

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("an unclaimed pairing is deleted at its expiry and its sockets hear expired", async () => {
  const pairing = makePairing(1500);
  assert.equal(await register(relay, pairing), 201);
  const desktop = await connectAs(relay, pairing, "desktop");
  assert.deepEqual(await desktop.client.nextText(5000), { t: "error", code: "expired" });
  assert.equal(await desktop.client.closed, 4408);
  // Gone for good: nothing stored, and a phone that arrives now finds nothing.
  assert.deepEqual((await relay.dump(pairing.pairingId)).stored, {});
  const late = await connect(relay, pairing.pairingId);
  assert.deepEqual(await late.nextText(), { t: "error", code: "unknown" });
});

test("a claimed pairing outlives its original expiry", async () => {
  const pairing = makePairing(1500);
  await register(relay, pairing);
  const client = await connect(relay, pairing.pairingId);
  client.sendText({
    t: "claim",
    claimToken: pairing.claimToken,
    phoneTokenHash: pairing.phoneTokenHash,
  });
  assert.equal((await client.nextText()).t, "ready");
  await wait(2500);
  const desktop = await connectAs(relay, pairing, "desktop");
  assert.equal(desktop.ready.peerOnline, true);
  assert.equal((await relay.dump(pairing.pairingId)).alarm, null);
});

test(
  "a socket that never authenticates is closed after the auth timeout",
  { timeout: 20000 },
  async () => {
    const pairing = makePairing();
    await register(relay, pairing);
    const idle = await connect(relay, pairing.pairingId);
    assert.deepEqual(await idle.nextText(15000), { t: "error", code: "auth-timeout" });
    // The close code is not asserted: under Miniflare a close the alarm starts on an idle,
    // hibernated socket completes its handshake ten seconds late; the error message is the signal.
  },
);
