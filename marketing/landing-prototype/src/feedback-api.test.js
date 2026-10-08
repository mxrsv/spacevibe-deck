import { describe, expect, it } from "vitest";
import {
  FeedbackSubmitError,
  groupFeedbackBoard,
  submitFeedback,
  fetchFeedbackBoard,
  fetchFeedbackConfig,
} from "./feedback-api.js";

const card = (overrides) => ({
  id: "report-id",
  title: "Split panes",
  description: "Steps",
  category: "idea",
  status: "pending",
  updatedAt: "2026-09-14T10:00:00.000Z",
  ...overrides,
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

describe("public board", () => {
  it("groups approved cards and drops malformed/private cards", () => {
    const board = groupFeedbackBoard({
      items: [
        card({ id: "older", updatedAt: "2026-09-12T00:00:00Z" }),
        card({ id: "newer" }),
        card({ id: "done", status: "done" }),
        card({ status: "private" }),
        card({ description: undefined }),
      ],
    });
    expect(board.pending.map((x) => x.id)).toEqual(["newer", "older"]);
    expect(board.review).toEqual([]);
    expect(board.done.map((x) => x.id)).toEqual(["done"]);
    expect(() => groupFeedbackBoard({})).toThrow();
  });
  it("requests older pages without auth and preserves the next cursor", async () => {
    let requested;
    const page = await fetchFeedbackBoard("123:uuid", async (url, init) => {
      requested = { url, init };
      return json({ items: [card()], nextCursor: "122:uuid" });
    });
    expect(new URL(requested.url).searchParams.get("cursor")).toBe("123:uuid");
    expect(requested.init.headers.authorization).toBeUndefined();
    expect(page.nextCursor).toBe("122:uuid");
    expect(page.board.pending).toHaveLength(1);
    await expect(
      fetchFeedbackBoard(null, async () => json({ items: [], nextCursor: {} })),
    ).rejects.toThrow();
  });
});

describe("durable submission", () => {
  const input = {
    title: "Split panes",
    body: "",
    category: "idea",
    website: "",
    id: "draft-uuid",
    credential: "google-credential",
  };
  it("sends attached images as multipart without forcing a content-type boundary", async () => {
    const file = new File(["image"], "shot.png", { type: "image/png" });
    let sent;
    await submitFeedback({ ...input, images: [file] }, async (_url, init) => {
      sent = init;
      return json({ id: "stored-id", status: "private" }, 201);
    });
    expect(sent.body).toBeInstanceOf(FormData);
    expect(sent.headers["content-type"]).toBeUndefined();
    expect(sent.body.getAll("images")).toHaveLength(1);
    expect(JSON.parse(sent.body.get("feedback")).id).toBe(input.id);
  });
  it("sends auth only in the header and accepts a persisted receipt", async () => {
    let sent;
    await submitFeedback(input, async (_url, init) => {
      sent = init;
      return json({ id: "stored-id", status: "private" }, 201);
    });
    expect(sent.headers.authorization).toBe("Bearer google-credential");
    expect(JSON.parse(sent.body)).toEqual({
      title: input.title,
      body: "",
      category: "idea",
      website: "",
      id: "draft-uuid",
    });
    expect(sent.signal).toBeInstanceOf(AbortSignal);
  });
  it("never treats an empty or malformed success response as persisted feedback", async () => {
    for (const response of [
      new Response(null, { status: 204 }),
      json({ status: "private" }, 201),
      json({ id: "x", status: "public" }, 201),
    ]) {
      await expect(submitFeedback(input, async () => response)).rejects.toBeInstanceOf(
        FeedbackSubmitError,
      );
    }
  });
  it("distinguishes sign-in expiry and idempotency conflicts from retryable errors", async () => {
    for (const [status, reason] of [
      [400, "invalid"],
      [413, "invalid"],
      [401, "auth"],
      [409, "conflict"],
      [429, "rate"],
      [503, "server"],
    ]) {
      await expect(
        submitFeedback(input, async () => new Response(null, { status })),
      ).rejects.toMatchObject({ reason });
    }
    await expect(
      submitFeedback(input, async () => {
        throw new Error("offline");
      }),
    ).rejects.toMatchObject({ reason: "server" });
  });
});

describe("feedback configuration", () => {
  it("validates provider config without treating a server error as open intake", async () => {
    const config = { googleClientId: "test-client", submissionsOpen: false };
    expect(await fetchFeedbackConfig(async () => json(config))).toEqual(config);
    await expect(fetchFeedbackConfig(async () => json({}))).rejects.toThrow();
    await expect(fetchFeedbackConfig(async () => json({}, 503))).rejects.toThrow();
  });
});
