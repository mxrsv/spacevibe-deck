import { parseFeedback, readFeedback } from "./feedback-payload.mjs";
import { PayloadError } from "./payload.mjs";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 3;
const UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function matchesType(bytes, type) {
  const starts = (...signature) => signature.every((value, index) => bytes[index] === value);
  if (type === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (type === "image/jpeg") return starts(255, 216, 255);
  return (
    type === "image/webp" &&
    starts(82, 73, 70, 70) &&
    [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value)
  );
}

async function readBoundedForm(request) {
  if (!request.body) throw new PayloadError(400);
  // A fixed bounded buffer avoids repeatedly copying a growing 15 MB upload.
  const bytes = new Uint8Array(UPLOAD_MAX_BYTES);
  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.byteLength > UPLOAD_MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new PayloadError(413);
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(bytes.subarray(0, length), { headers: request.headers }).formData();
  } catch {
    throw new PayloadError(400);
  }
}

export async function readFeedbackUpload(request) {
  if (request.headers.get("content-type")?.startsWith("application/json")) {
    return { feedback: await readFeedback(request), images: [] };
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new PayloadError(400);
  const form = await readBoundedForm(request);
  if (
    [...form.keys()].some((key) => !["feedback", "images"].includes(key)) ||
    form.getAll("feedback").length !== 1
  )
    throw new PayloadError(400);
  let feedback;
  try {
    feedback = parseFeedback(JSON.parse(form.get("feedback")));
  } catch {
    throw new PayloadError(400);
  }
  if (!feedback) throw new PayloadError(400);
  const files = form.getAll("images");
  if (files.length > IMAGE_MAX_COUNT) throw new PayloadError(400);
  const images = [];
  for (const file of files) {
    if (typeof file === "string" || !TYPES[file.type] || !file.size) throw new PayloadError(400);
    if (file.size > IMAGE_MAX_BYTES) throw new PayloadError(413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesType(bytes, file.type)) throw new PayloadError(400);
    images.push({
      bytes,
      hash: await sha256(bytes),
      type: file.type,
      extension: TYPES[file.type],
      size: file.size,
    });
  }
  return { feedback, images };
}
