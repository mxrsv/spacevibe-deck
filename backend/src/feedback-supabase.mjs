import { PayloadError, UUID_V4 } from "./payload.mjs";
import { PAGE_SIZE, PUBLIC_STATUSES, parseBoardCursor } from "./feedback-repository.mjs";
import { readFeedbackUpload, sha256 } from "./feedback-images.mjs";

const TABLE = "feedback_reports";
const BUCKET = "feedback-images";
const TIMEOUT_MS = 15_000;
const PREFIX = "/v1/feedback";
const PUBLIC_FILTER = `ready=eq.true&status=in.(${PUBLIC_STATUSES.join(",")})`;
const PUBLIC_COLUMNS = "id,title,body,category,status,created_at,updated_at,images";

export function supabaseFeedbackConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

async function requestSupabase(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (error?.message === "feedback_intake_limit") throw new PayloadError(429);
    throw new Error(`Feedback storage unavailable (${response.status})`);
  }
  return response;
}

async function rows(env, query) {
  return (await requestSupabase(env, `/rest/v1/${TABLE}?${query}`)).json();
}

function imagePath(id, image) {
  return `${id}/${image.hash}.${image.extension}`;
}

async function reserve(env, feedback, images) {
  const metadata = images.map(({ hash, type, extension, size }) => ({
    hash,
    type,
    extension,
    size,
  }));
  const requestHash = await sha256(
    new TextEncoder().encode(
      JSON.stringify({
        title: feedback.title,
        body: feedback.body,
        category: feedback.category,
        images: metadata,
      }),
    ),
  );
  const response = await requestSupabase(env, `/rest/v1/${TABLE}?on_conflict=draft_id`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify({
      draft_id: feedback.id,
      request_hash: requestHash,
      title: feedback.title,
      body: feedback.body,
      category: feedback.category,
      images: metadata,
    }),
  });
  const inserted = await response.json();
  const row =
    inserted[0] ??
    (await rows(env, `draft_id=eq.${feedback.id}&select=id,request_hash,ready&limit=1`))[0];
  if (!row) throw new Error("Feedback receipt missing");
  if (row.request_hash !== requestHash) throw new PayloadError(409);
  return row;
}

export async function submitSupabaseFeedback(request, env) {
  // Limit before parsing or allocating the upload buffer. No IP or user agent is stored.
  const limit = await env.FEEDBACK_LIMITER.limit({ key: "feedback-anonymous-submit" });
  if (!limit.success) throw new PayloadError(429);
  const { feedback, images } = await readFeedbackUpload(request);
  if (feedback.spam) throw new PayloadError(400);
  const row = await reserve(env, feedback, images);
  if (!row.ready) {
    for (const image of images) {
      // Retrying identical bytes is safe; the request hash prevents replacing attachments.
      await requestSupabase(env, `/storage/v1/object/${BUCKET}/${imagePath(row.id, image)}`, {
        method: "POST",
        headers: { "content-type": image.type, "x-upsert": "true" },
        body: image.bytes,
      });
    }
    const receipt = await requestSupabase(env, `/rest/v1/${TABLE}?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({ ready: true }),
    });
    if (!(await receipt.json())[0]?.ready) throw new Error("Feedback finalization failed");
  }
  return { id: row.id, status: "private" };
}

export async function listSupabaseFeedback(url, env) {
  const cursor = parseBoardCursor(url.searchParams.get("cursor"));
  const pageFilter = cursor
    ? `&or=(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`
    : "";
  const found = await rows(
    env,
    `${PUBLIC_FILTER}&select=${PUBLIC_COLUMNS}&order=created_at.desc,id.desc&limit=${PAGE_SIZE + 1}${pageFilter}`,
  );
  const page = found.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.body,
      category: row.category,
      status: row.status,
      updatedAt: new Date(row.updated_at).toISOString(),
      images: row.images.map((_, index) => `${PREFIX}/images/${row.id}/${index}`),
    })),
    nextCursor: found.length > PAGE_SIZE ? `${last.created_at}:${last.id}` : null,
  };
}

export async function readSupabaseFeedbackImage(url, env, headers) {
  const match = url.pathname.match(/^\/v1\/feedback\/images\/([^/]+)\/([0-2])$/);
  if (!match || !UUID_V4.test(match[1])) throw new PayloadError(404);
  const [row] = await rows(env, `${PUBLIC_FILTER}&id=eq.${match[1]}&select=id,images&limit=1`);
  const image = row?.images[Number(match[2])];
  if (!image) throw new PayloadError(404);
  const response = await requestSupabase(
    env,
    `/storage/v1/object/authenticated/${BUCKET}/${imagePath(row.id, image)}`,
  );
  // Check moderation on every read. Hiding a report immediately revokes its image URLs.
  return new Response(response.body, {
    headers: {
      ...headers,
      "content-type": image.type,
      "content-disposition": 'inline; filename="feedback-image"',
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
