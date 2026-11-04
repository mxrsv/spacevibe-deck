import assert from "node:assert/strict";
import { createVerify } from "node:crypto";
import { after, before, test } from "node:test";
import {
  claimAs,
  connectAs,
  es256Key,
  makePairing,
  register,
  startRelay,
} from "./test-harness.mjs";

const key = es256Key();
const sent = [];
let status = 200;
let responseBody = "{}";

let relay;
before(async () => {
  relay = await startRelay({
    bindings: { APNS_KEY_P8: key.pem, APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456" },
    outboundService: async (request) => {
      sent.push({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: JSON.parse(await request.text()),
      });
      return new Response(responseBody, { status });
    },
  });
});
after(() => relay.dispose());

const DEVICE = "a".repeat(64);
const SEALED = "c2VhbGVkLXB1c2gtYm9keQ";

const waitFor = async (condition, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

async function pairedWithToken(pushToken = { kind: "apns", token: DEVICE, env: "sandbox" }) {
  const pairing = makePairing();
  await register(relay, pairing);
  const desktop = await connectAs(relay, pairing, "desktop");
  const phone = await claimAs(relay, pairing);
  await desktop.client.nextText();
  if (pushToken) {
    phone.client.sendText({ t: "push-token", ...pushToken });
    // A ping/pong round trip would not prove the relay read the message (the runtime answers
    // pings itself), so wait for the stored record.
    for (let i = 0; i < 100; i += 1) {
      if ((await relay.dump(pairing.pairingId)).stored.pairing.push !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  return { pairing, desktop: desktop.client, phone: phone.client };
}

test("a push becomes an APNs request with the generic alert and the sealed data", async () => {
  sent.length = 0;
  const { pairing, desktop } = await pairedWithToken();
  desktop.sendText({ t: "push", data: SEALED });
  await waitFor(() => sent.length === 1, "the APNs request");
  const [request] = sent;
  assert.equal(request.url, `https://api.sandbox.push.apple.com/3/device/${DEVICE}`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers["apns-topic"], "dev.spacevibe.deck.mobile");
  assert.equal(request.headers["apns-push-type"], "alert");
  assert.equal(request.headers["apns-priority"], "10");
  assert.equal(request.headers["apns-collapse-id"], pairing.pairingId);
  assert.deepEqual(request.body, {
    aps: {
      alert: { title: "SpaceVibe Deck", body: "An agent needs you" },
      "mutable-content": 1,
      sound: "default",
      "thread-id": pairing.pairingId,
    },
    d: { p: pairing.pairingId, c: SEALED },
  });

  // The provider token is a real ES256 JWT for the configured key and team.
  const [header, claims, signature] = request.headers.authorization
    .replace("bearer ", "")
    .split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "ES256",
    kid: "ABC123DEFG",
  });
  const parsedClaims = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(parsedClaims.iss, "TEAM123456");
  assert.ok(Math.abs(parsedClaims.iat - Date.now() / 1000) < 60);
  const verifier = createVerify("SHA256").update(`${header}.${claims}`);
  assert.ok(
    verifier.verify(
      { key: key.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  );
});

test("the provider token is reused between pushes; production tokens use the production host", async () => {
  sent.length = 0;
  const first = await pairedWithToken({ kind: "apns", token: DEVICE, env: "production" });
  first.desktop.sendText({ t: "push", data: SEALED });
  first.desktop.sendText({ t: "push", data: SEALED });
  await waitFor(() => sent.length === 2, "two APNs requests");
  assert.equal(sent[0].url, `https://api.push.apple.com/3/device/${DEVICE}`);
  assert.equal(sent[0].headers.authorization, sent[1].headers.authorization);
});

test("an Expo token goes to the Expo push service with the same generic text", async () => {
  sent.length = 0;
  responseBody = JSON.stringify({ data: { status: "ok", id: "x" } });
  const expo = "ExponentPushToken[abcdEFGH1234]";
  const { pairing, desktop } = await pairedWithToken({
    kind: "expo",
    token: expo,
    env: "production",
  });
  desktop.sendText({ t: "push", data: SEALED });
  await waitFor(() => sent.length === 1, "the Expo request");
  assert.equal(sent[0].url, "https://exp.host/--/api/v2/push/send");
  assert.deepEqual(sent[0].body, {
    to: expo,
    title: "SpaceVibe Deck",
    body: "An agent needs you",
    sound: "default",
    priority: "high",
    mutableContent: true,
    data: { p: pairing.pairingId, c: SEALED },
  });
  responseBody = "{}";
});

test("a push is limited to 30 a minute per pairing", async () => {
  sent.length = 0;
  const { desktop } = await pairedWithToken();
  for (let i = 0; i < 35; i += 1) desktop.sendText({ t: "push", data: SEALED });
  await waitFor(() => sent.length >= 30, "30 requests");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(sent.length, 30);
  // The socket is still open: a dropped push is not a protocol error.
  desktop.sendText({ t: "ping" });
  assert.deepEqual(await desktop.nextText(), { t: "pong" });
});

test("only the desktop can push, and nothing is sent without a stored token", async () => {
  sent.length = 0;
  const withToken = await pairedWithToken();
  withToken.phone.sendText({ t: "push", data: SEALED });
  const without = await pairedWithToken(null);
  without.desktop.sendText({ t: "push", data: SEALED });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(sent.length, 0);
});

test("APNs 410 forgets the device token, so the next push sends nothing", async () => {
  sent.length = 0;
  status = 410;
  const { pairing, desktop } = await pairedWithToken();
  desktop.sendText({ t: "push", data: SEALED });
  await waitFor(() => sent.length === 1, "the APNs request");
  for (let i = 0; i < 100; i += 1) {
    if ((await relay.dump(pairing.pairingId)).stored.pairing.push === null) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  status = 200;
  assert.equal((await relay.dump(pairing.pairingId)).stored.pairing.push, null);
  desktop.sendText({ t: "push", data: SEALED });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(sent.length, 1);
});

test("a malformed push token or push body is ignored", async () => {
  sent.length = 0;
  const { pairing, desktop, phone } = await pairedWithToken();
  phone.sendText({ t: "push-token", kind: "apns", token: "!!", env: "sandbox" });
  desktop.sendText({ t: "push", data: "not base64url!" });
  desktop.sendText({ t: "push", data: "A".repeat(4097) });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(sent.length, 0);
  assert.equal((await relay.dump(pairing.pairingId)).stored.pairing.push.token, DEVICE);
});
