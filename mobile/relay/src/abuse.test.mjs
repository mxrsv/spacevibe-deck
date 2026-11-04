import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { claimAs, connect, connectAs, makePairing, startRelay } from "./test-harness.mjs";

let relay;
before(async () => {
  relay = await startRelay({
    ratelimits: { REGISTER_LIMITER: { namespace_id: "34211", simple: { limit: 3, period: 60 } } },
  });
});
after(() => relay.dispose());

const registerFrom = async (ip) => {
  const response = await relay.post("/v1/pairings", makePairing().registration(), {
    headers: { "cf-connecting-ip": ip },
  });
  await response.arrayBuffer();
  return response.status;
};

test("registration is limited per client address with 429", async () => {
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push(await registerFrom("198.51.100.7"));
  assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
  // Another address has its own allowance.
  assert.equal(await registerFrom("198.51.100.8"), 201);
});

test("a claimed pairing gets an idle-expiry alarm only while nobody is connected", async () => {
  const pairing = makePairing();
  const response = await relay.post("/v1/pairings", pairing.registration(), {
    headers: { "cf-connecting-ip": "203.0.113.50" },
  });
  assert.equal(response.status, 201);
  await response.arrayBuffer();
  const desktop = await connectAs(relay, pairing, "desktop");
  const phone = await claimAs(relay, pairing);
  await desktop.client.nextText();
  assert.equal((await relay.dump(pairing.pairingId)).alarm, null);

  desktop.client.close();
  phone.client.close();
  let alarm = null;
  for (let i = 0; i < 100 && alarm === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    alarm = (await relay.dump(pairing.pairingId)).alarm;
  }
  const thirtyDays = 30 * 24 * 60 * 60_000;
  assert.ok(alarm !== null, "an idle alarm was set");
  assert.ok(Math.abs(alarm - (Date.now() + thirtyDays)) < 60_000);

  // Coming back cancels it again.
  await connectAs(relay, pairing, "desktop");
  assert.equal((await relay.dump(pairing.pairingId)).alarm, null);
});

test("unauthenticated sockets are capped; a live pairing keeps working", async () => {
  const pairing = makePairing();
  const response = await relay.post("/v1/pairings", pairing.registration(), {
    headers: { "cf-connecting-ip": "203.0.113.51" },
  });
  await response.arrayBuffer();
  const desktop = await connectAs(relay, pairing, "desktop");
  const phone = await claimAs(relay, pairing);
  await desktop.client.nextText();

  const silent = [];
  for (let i = 0; i < 6; i += 1) silent.push(await connect(relay, pairing.pairingId));
  // Four may wait; the two oldest were told to go.
  for (const old of silent.slice(0, 2)) {
    assert.deepEqual(await old.nextText(), { t: "error", code: "auth-timeout" });
  }
  for (const kept of silent.slice(2)) assert.equal(await kept.quiet(100), true);

  phone.client.sendBinary(new Uint8Array([1, 2, 3]));
  assert.deepEqual(await desktop.client.nextBinary(), new Uint8Array([1, 2, 3]));
});
