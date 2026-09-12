import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.mjs";

const snapshot = {
  schemaVersion: 1,
  dailyId: "9f2ce125-9b07-41a5-8476-94cff98463c5",
  day: new Date().toISOString().slice(0, 10),
  version: "1.1.0",
  platform: "darwin",
  arch: "arm64",
  agents: { claude: 2, custom: 1 },
  surfaces: { browser: 1, explorer: 0, usage: 0 },
  maxTabs: 2,
  maxPanes: 4,
  restoredSessions: false,
};

function request(body = snapshot) {
  return new Request("https://api.deck.spacevibe.dev/v1/ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("unknown fields are terminal and never reach D1", async () => {
  for (const body of [
    { ...snapshot, prompt: "private" },
    { ...snapshot, agents: { "private-agent": 1 } },
    { ...snapshot, surfaces: { ...snapshot.surfaces, private: 1 } },
  ]) {
    assert.equal((await worker.fetch(request(body), {})).status, 400);
  }
});

const updates = {
  checked: 2,
  checkFailed: 1,
  available: 0,
  downloaded: 0,
  downloadFailed: 0,
  installAttempted: 0,
};

test("update counters are optional, but complete and closed when present", async () => {
  const env = { INGEST_LIMITER: { limit: async () => ({ success: false }) } };
  // Both shapes pass validation (429 comes after it): 1.1.x–1.2.0 never send
  // `updates`, and a 400 would drop their whole day.
  assert.equal((await worker.fetch(request(snapshot), env)).status, 429);
  assert.equal((await worker.fetch(request({ ...snapshot, updates }), env)).status, 429);
  const { checked: _checked, ...incomplete } = updates;
  for (const changes of [
    { updates: incomplete },
    { updates: { ...updates, errorMessage: 1 } },
    { updates: { ...updates, checked: -1 } },
    { updates: null },
  ]) {
    assert.equal((await worker.fetch(request({ ...snapshot, ...changes }), {})).status, 400);
  }
  // `updates` cannot stand in for a required field.
  const { restoredSessions: _restored, ...swapped } = snapshot;
  assert.equal((await worker.fetch(request({ ...swapped, updates }), {})).status, 400);
});

test("invalid dates, UUIDs, counters and dimensions are rejected", async () => {
  for (const changes of [
    { day: "2026-02-30" },
    { dailyId: "permanent-id" },
    { version: "../../secret" },
    { platform: "private-host" },
    { arch: "private-cpu" },
    { agents: { claude: -1 } },
    { maxTabs: 1.5 },
    { maxPanes: 1000001 },
    { restoredSessions: "true" },
    { schemaVersion: 2 },
    { day: undefined },
    { surfaces: null },
  ]) {
    assert.equal((await worker.fetch(request({ ...snapshot, ...changes }), {})).status, 400);
  }
});

test("body cap is measured in bytes, without trusting Content-Length", async () => {
  const response = await worker.fetch(
    new Request("https://api.deck.spacevibe.dev/v1/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...snapshot, prompt: "📝".repeat(1100) }),
    }),
    {},
  );
  assert.equal(response.status, 413);
});

test("malformed JSON is terminal; missing infrastructure remains retryable", async () => {
  const invalid = new Request("https://api.deck.spacevibe.dev/v1/ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await worker.fetch(invalid, {})).status, 400);
  assert.equal((await worker.fetch(request(), {})).status, 503);
});

test("there is no public read API", async () => {
  assert.equal(
    (await worker.fetch(new Request("https://api.deck.spacevibe.dev/v1/stats"), {})).status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request("https://api.deck.spacevibe.dev/v1/ping"), {})).status,
    405,
  );
});

export { snapshot, request };

test("rate limiting returns retryable 429 before a database write", async () => {
  const response = await worker.fetch(request(), {
    INGEST_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(response.status, 429);
});

test("ingestion waits for D1 and rejects an actual failed write", async () => {
  let calls = 0;
  const write = Promise.withResolvers();
  const env = {
    INGEST_LIMITER: { limit: async () => ({ success: true }) },
    DB: {
      prepare: () => ({
        bind: () => ({
          run: () => {
            calls++;
            return write.promise;
          },
        }),
      }),
    },
  };
  let settled = false;
  const response = worker.fetch(request(), env).then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(settled, false);
  write.resolve({ success: true });
  assert.equal((await response).status, 204);
  const failed = {
    ...env,
    DB: {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            calls++;
            throw new Error("D1 unavailable");
          },
        }),
      }),
    },
  };
  assert.equal((await worker.fetch(request(), failed)).status, 503);
  assert.equal(calls, 2);
});

test("closed historical days cannot be reinserted after raw expiry", async (t) => {
  t.mock.method(Date, "now", () => Date.UTC(2026, 9, 12, 12));
  const env = { INGEST_LIMITER: { limit: async () => ({ success: false }) } };
  for (const day of ["2026-09-07", "2026-09-11", "2026-10-14"]) {
    assert.equal((await worker.fetch(request({ ...snapshot, day }), env)).status, 400);
  }
  for (const day of ["2026-09-12", "2026-10-11", "2026-10-12", "2026-10-13"]) {
    assert.equal((await worker.fetch(request({ ...snapshot, day }), env)).status, 429);
  }
});
