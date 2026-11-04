import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { claimAs, connectAs, makePairing, register, startRelay } from "./test-harness.mjs";

const sent = [];
let relay;
before(async () => {
  // No APNS_* secrets: the deployment before the owner has set them.
  relay = await startRelay({
    outboundService: async (request) => {
      sent.push(request.url);
      return new Response("{}");
    },
  });
});
after(() => relay.dispose());

test("without APNs secrets an APNs push is a counted no-op, not an error", async () => {
  const pairing = makePairing();
  await register(relay, pairing);
  const desktop = await connectAs(relay, pairing, "desktop");
  const phone = await claimAs(relay, pairing);
  await desktop.client.nextText();
  phone.client.sendText({
    t: "push-token",
    kind: "apns",
    token: "b".repeat(64),
    env: "production",
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  desktop.client.sendText({ t: "push", data: "c2VhbGVk" });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(sent, []);
  assert.ok(relay.logs.join("").includes('"event":"push-skipped"'));
  desktop.client.sendText({ t: "ping" });
  assert.deepEqual(await desktop.client.nextText(), { t: "pong" });
});
