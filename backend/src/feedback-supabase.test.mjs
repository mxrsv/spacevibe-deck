import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.mjs";

const ORIGIN = "https://deck.spacevibe.dev";
const API = "https://api.deck.spacevibe.dev/v1/feedback";
const ID = "0bde3d10-3cc3-4f10-8d83-37f7c9ae3bb3";
const input = {
  id: crypto.randomUUID(),
  title: "Anonymous report",
  body: "Steps",
  category: "bug",
  website: "",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function setup(t) {
  let row;
  let fail = "";
  let allowed = true;
  let uploads = 0;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.authorization, "Bearer test-service-key");
    const path = new URL(url);
    if (path.pathname.startsWith("/storage/")) {
      if (fail === "upload") return json({}, 500);
      if (options.method === "POST") uploads += 1;
      return new Response(png);
    }
    if (options.method === "POST") {
      if (fail === "reserve") return json({}, 500);
      if (fail === "quota") return json({ message: "feedback_intake_limit" }, 400);
      if (row) return json([]);
      row = {
        ...JSON.parse(options.body),
        id: ID,
        ready: false,
        status: JSON.parse(options.body).status ?? "private",
        created_at: 1000,
        updated_at: 1000,
      };
      return json([row]);
    }
    if (options.method === "PATCH") {
      if (fail === "finalize") return json({}, 500);
      row = { ...row, ...JSON.parse(options.body) };
      return json([row]);
    }
    if (path.searchParams.has("ready")) {
      assert.equal(path.searchParams.get("ready"), "eq.true");
      assert.equal(path.searchParams.get("status"), "in.(pending,review,done)");
      assert.equal(path.searchParams.get("select").includes("request_hash"), false);
      assert.equal(path.searchParams.get("select").includes("draft_id"), false);
    }
    const visible =
      !path.searchParams.has("ready") ||
      (row?.ready && path.searchParams.get("status").includes(row.status));
    const selected = path.searchParams.get("select")?.split(",");
    return json(
      row && visible
        ? [selected ? Object.fromEntries(selected.map((key) => [key, row[key]])) : row]
        : [],
    );
  });
  const env = {
    FEEDBACK_STORAGE: "supabase",
    FEEDBACK_SUBMISSIONS_OPEN: "true",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    FEEDBACK_LIMITER: { limit: async () => ({ success: allowed }) },
    FEEDBACK_READ_LIMITER: { limit: async () => ({ success: allowed }) },
  };
  return {
    env,
    calls,
    row: () => row,
    uploads: () => uploads,
    fail: (value) => {
      fail = value;
    },
    allow: (value) => {
      allowed = value;
    },
    moderate: (status) => {
      row = { ...row, status };
    },
  };
}
function post(data = input, image = false, origin = ORIGIN) {
  let body = JSON.stringify(data);
  const headers = { origin, "content-type": "application/json" };
  if (image) {
    body = new FormData();
    body.set("feedback", JSON.stringify(data));
    body.append("images", new File([png], "shot.png", { type: "image/png" }));
    delete headers["content-type"];
  }
  return new Request(`${API}?receipt=state`, { method: "POST", headers, body });
}

test("anonymous receipt publishes a complete report immediately in Pending", async (t) => {
  const db = setup(t);
  const result = await worker.fetch(post(), db.env);
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { id: ID, status: "pending" });
  assert.equal(db.row().ready, true);
  const board = await worker.fetch(new Request(API), db.env);
  assert.equal((await board.json()).items[0].id, ID);
  const config = await worker.fetch(new Request(`${API}/config`), db.env);
  assert.equal((await config.json()).authMode, "anonymous");
});

test("Supabase mode never runs legacy Linear or email jobs", async (t) => {
  const db = setup(t);
  for (const cron of ["* * * * *", "17 * * * *"])
    await worker.scheduled({ cron }, { ...db.env, FEEDBACK_SYNC_ENABLED: "true" });
  assert.equal(db.calls.length, 0);
});

test("already-open clients keep their original receipt while reports become public", async (t) => {
  const db = setup(t);
  const request = new Request(API, post());
  const response = await worker.fetch(request, db.env);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: ID, status: "private" });
  assert.equal(db.row().status, "pending");
  assert.equal(db.row().ready, true);
});

test("same draft retries once and changed content conflicts without replacing data", async (t) => {
  const db = setup(t);
  assert.equal((await worker.fetch(post(input, true), db.env)).status, 201);
  for (const status of ["pending", "review", "done", "private", "hidden"]) {
    db.moderate(status);
    const retry = await worker.fetch(post(input, true), db.env);
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), { id: ID, status });
  }
  assert.equal(db.uploads(), 1);
  assert.equal(
    (await worker.fetch(post({ ...input, title: "Different" }, true), db.env)).status,
    409,
  );
  assert.equal(db.row().title, input.title);
});

test("failed upload stays invisible even if moderated, and retry completes it", async (t) => {
  const db = setup(t);
  db.fail("upload");
  assert.equal((await worker.fetch(post(input, true), db.env)).status, 503);
  db.moderate("pending");
  assert.equal(db.row().ready, false);
  assert.equal((await worker.fetch(new Request(`${API}/images/${ID}/0`), db.env)).status, 404);
  db.fail("");
  assert.equal((await worker.fetch(post(input, true), db.env)).status, 201);
  assert.equal(db.row().ready, true);
});

test("storage and finalization failures never acknowledge success", async (t) => {
  for (const failure of ["reserve", "finalize", "quota"]) {
    await t.test(failure, async (t) => {
      const db = setup(t);
      db.fail(failure);
      assert.equal((await worker.fetch(post(), db.env)).status, failure === "quota" ? 429 : 503);
    });
  }
});

test("manual privacy overrides remain respected; hiding revokes image access", async (t) => {
  const db = setup(t);
  await worker.fetch(post(input, true), db.env);
  db.moderate("private");
  assert.equal((await worker.fetch(new Request(`${API}/images/${ID}/0`), db.env)).status, 404);
  db.moderate("pending");
  const board = await (await worker.fetch(new Request(API), db.env)).json();
  assert.equal(board.items[0].images[0], `/v1/feedback/images/${ID}/0`);
  assert.equal(JSON.stringify(board).includes(input.id), false);
  assert.equal(JSON.stringify(board).includes("request_hash"), false);
  const image = await worker.fetch(new Request(`${API}/images/${ID}/0`), db.env);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("cache-control"), "no-store");
  assert.equal(image.headers.get("content-type"), "image/png");
  db.moderate("hidden");
  assert.equal((await worker.fetch(new Request(`${API}/images/${ID}/0`), db.env)).status, 404);
});

test("closed intake, foreign origins, honeypot and rate limit stop all writes", async (t) => {
  const db = setup(t);
  assert.equal((await worker.fetch(post(input, false, "https://evil.test"), db.env)).status, 403);
  assert.equal(
    (await worker.fetch(post(), { ...db.env, FEEDBACK_SUBMISSIONS_OPEN: "false" })).status,
    503,
  );
  assert.equal((await worker.fetch(post({ ...input, website: "spam" }), db.env)).status, 400);
  db.allow(false);
  assert.equal((await worker.fetch(post(), db.env)).status, 429);
  assert.equal((await worker.fetch(new Request(`${API}/images/${ID}/0`), db.env)).status, 429);
  assert.equal((await worker.fetch(new Request(API), db.env)).status, 429);
  assert.equal(db.calls.length, 0);
});
