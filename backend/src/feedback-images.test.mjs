import assert from "node:assert/strict";
import { test } from "node:test";
import { readFeedbackUpload, IMAGE_MAX_BYTES } from "./feedback-images.mjs";

const input = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  title: "Image report",
  body: "Steps",
  category: "bug",
  website: "",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
function request(files = []) {
  const form = new FormData();
  form.set("feedback", JSON.stringify(input));
  for (const file of files) form.append("images", file);
  return new Request("https://example.test", { method: "POST", body: form });
}

test("multipart feedback preserves validated text and hashes image bytes", async () => {
  const result = await readFeedbackUpload(
    request([new File([png], "shot.png", { type: "image/png" })]),
  );
  assert.equal(result.feedback.title, input.title);
  assert.equal(result.images.length, 1);
  assert.match(result.images[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(result.images[0].type, "image/png");
  assert.deepEqual(Buffer.from(result.images[0].bytes), png);
});

test("rejects disguised SVG, oversized images, extra fields, and too many files", async () => {
  const file = new File([png], "shot.png", { type: "image/png" });
  for (const files of [
    [new File(["<svg onload='alert(1)'/>"], "shot.png", { type: "image/png" })],
    [new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], "shot.png", { type: "image/png" })],
    [file, file, file, file],
  ])
    await assert.rejects(readFeedbackUpload(request(files)), (error) =>
      [400, 413].includes(error.status),
    );
  const form = new FormData();
  form.set("feedback", JSON.stringify(input));
  form.set("unexpected", "value");
  await assert.rejects(
    readFeedbackUpload(new Request("https://example.test", { method: "POST", body: form })),
    { status: 400 },
  );
});

test("limits the streamed body even without Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
      controller.close();
    },
  });
  await assert.rejects(
    readFeedbackUpload(
      new Request("https://example.test", {
        method: "POST",
        body: stream,
        duplex: "half",
        headers: { "content-type": "multipart/form-data; boundary=test" },
      }),
    ),
    { status: 413 },
  );
});
