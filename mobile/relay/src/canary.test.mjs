// MOB7: the relay forwards sealed bytes and nothing of them survives in what it stores or logs.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  es256Key,
  claimAs,
  connectAs,
  makePairing,
  register,
  startRelay,
} from "./test-harness.mjs";

const key = es256Key();
const CANARIES = ["CANARY-7f3a91c2d4e85b06-terminal", "CANARY-0b5e66d1a9c37f48-push"];
const sent = [];

let relay;
before(async () => {
  relay = await startRelay({
    bindings: { APNS_KEY_P8: key.pem, APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456" },
    outboundService: async (request) => {
      sent.push(await request.text());
      return new Response("{}");
    },
  });
});
after(() => relay.dispose());

/** The canary as raw text, base64 at all three alignments, base64url and hex. */
function forms(canary) {
  const bytes = Buffer.from(canary);
  const out = new Set([canary, bytes.toString("hex"), bytes.toString("base64url")]);
  for (let offset = 0; offset < 3; offset += 1) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    // Characters that mix in the padding bytes before, or the missing bytes after, vary.
    const stable = encoded.slice(Math.ceil((offset * 8) / 6), -3);
    out.add(stable);
    out.add(stable.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return [...out];
}

test("canary frames and push data leave no trace in storage or logs", async () => {
  const pairing = makePairing();
  await register(relay, pairing);
  const desktop = await connectAs(relay, pairing, "desktop");
  const phone = await claimAs(relay, pairing);
  await desktop.client.nextText();
  phone.client.sendText({ t: "push-token", kind: "apns", token: "d".repeat(64), env: "sandbox" });

  // Canaries inside binary frames, both ways, both as plain bytes and as a base64 string.
  const frame = (text) => Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from(text)]);
  for (const canary of CANARIES) {
    phone.client.sendBinary(frame(canary));
    assert.deepEqual(Buffer.from(await desktop.client.nextBinary()), frame(canary));
    desktop.client.sendBinary(frame(Buffer.from(canary).toString("base64")));
    await phone.client.nextBinary();
  }
  // And inside a push `data` (base64url alphabet only, like a real sealed push).
  desktop.client.sendText({ t: "push", data: CANARIES[1] });
  for (let i = 0; i < 100 && sent.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(sent.length, 1, "the push reached the (fake) APNs");
  assert.ok(sent[0].includes(CANARIES[1]), "and carried the data, which is its job");

  desktop.client.close();
  phone.client.close();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Everything the Durable Object keeps, and everything the Worker printed.
  const dump = JSON.stringify(await relay.dump(pairing.pairingId));
  const logs = relay.logs.join("");
  // Guard against a vacuous pass: the dump has the record and the logs have lines.
  assert.ok(dump.includes(pairing.pairingId) && dump.includes("desktopTokenHash"));
  assert.ok(logs.includes('"event":"forwarded"'));

  for (const canary of CANARIES) {
    for (const form of forms(canary)) {
      assert.ok(!dump.includes(form), `storage contains ${form}`);
      assert.ok(!logs.includes(form), `logs contain ${form}`);
    }
  }
  // The log also never carries a token, the pairing id or the device token.
  for (const secret of [
    pairing.desktopToken,
    pairing.phoneToken,
    pairing.claimToken,
    pairing.pairingId,
    "d".repeat(64),
  ]) {
    assert.ok(!logs.includes(secret), "a secret or id reached the logs");
  }
  // Storage holds hashes, never the tokens themselves.
  for (const secret of [pairing.desktopToken, pairing.phoneToken, pairing.claimToken]) {
    assert.ok(!dump.includes(secret), "a raw token reached storage");
  }
});
