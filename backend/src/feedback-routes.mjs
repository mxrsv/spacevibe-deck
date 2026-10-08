import { authenticateFeedback } from "./feedback-auth.mjs";
import { readFeedback } from "./feedback-payload.mjs";
import { createFeedbackRepository, parseBoardCursor } from "./feedback-repository.mjs";
import { PayloadError } from "./payload.mjs";
import {
  supabaseFeedbackConfigured,
  submitSupabaseFeedback,
  listSupabaseFeedback,
  readSupabaseFeedbackImage,
} from "./feedback-supabase.mjs";

export const FEEDBACK_PATH = "/v1/feedback";
export const FEEDBACK_CONFIG_PATH = `${FEEDBACK_PATH}/config`;
const ALLOWED_ORIGINS = [
  "https://deck.spacevibe.dev",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];
const METHODS = "GET, POST, OPTIONS";
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function headersFor(request) {
  const origin = request.headers.get("origin");
  return {
    ...HEADERS,
    vary: "origin",
    ...(ALLOWED_ORIGINS.includes(origin) ? { "access-control-allow-origin": origin } : {}),
  };
}

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}

export function feedbackConfigured(env) {
  if (env.FEEDBACK_STORAGE === "supabase") return supabaseFeedbackConfigured(env);
  return Boolean(
    env.FEEDBACK_SYNC_ENABLED === "true" &&
    env.GOOGLE_CLIENT_ID &&
    env.LINEAR_API_KEY &&
    env.LINEAR_WEBHOOK_SECRET &&
    env.FEEDBACK_PROGRESS_STATE_ID &&
    env.RESEND_API_KEY &&
    env.FEEDBACK_EMAIL_FROM &&
    env.DB,
  );
}

export async function handleFeedback(request, env) {
  const headers = headersFor(request);
  const url = new URL(request.url);
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "access-control-allow-methods": METHODS,
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "86400",
      },
    });
  try {
    if (url.pathname === FEEDBACK_CONFIG_PATH && request.method === "GET") {
      return json(
        {
          googleClientId: env.GOOGLE_CLIENT_ID || null,
          authMode: env.FEEDBACK_STORAGE === "supabase" ? "anonymous" : "google",
          submissionsOpen: env.FEEDBACK_SUBMISSIONS_OPEN === "true" && feedbackConfigured(env),
        },
        headers,
      );
    }
    if (env.FEEDBACK_STORAGE === "supabase") {
      if (!supabaseFeedbackConfigured(env)) throw new PayloadError(503);
      if (request.method === "GET") {
        const limit = await env.FEEDBACK_READ_LIMITER.limit({ key: "feedback-public-read" });
        if (!limit.success) throw new PayloadError(429);
      }
      if (request.method === "GET" && url.pathname.startsWith(`${FEEDBACK_PATH}/images/`))
        return await readSupabaseFeedbackImage(url, env, headers);
      if (url.pathname !== FEEDBACK_PATH) throw new PayloadError(404);
      if (request.method === "GET") return json(await listSupabaseFeedback(url, env), headers);
      if (request.method !== "POST") return new Response(null, { status: 405, headers });
      if (!ALLOWED_ORIGINS.includes(request.headers.get("origin"))) throw new PayloadError(403);
      if (env.FEEDBACK_SUBMISSIONS_OPEN !== "true") throw new PayloadError(503);
      return json(await submitSupabaseFeedback(request, env), headers, 201);
    }
    if (url.pathname !== FEEDBACK_PATH) return new Response(null, { status: 405, headers });
    const repository = createFeedbackRepository(env.DB);
    if (request.method === "GET") {
      return json(
        await repository.listPublic(parseBoardCursor(url.searchParams.get("cursor"))),
        headers,
      );
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { ...headers, allow: METHODS } });
    if (!ALLOWED_ORIGINS.includes(request.headers.get("origin"))) throw new PayloadError(403);
    if (env.FEEDBACK_SUBMISSIONS_OPEN !== "true" || !feedbackConfigured(env))
      throw new PayloadError(503);
    const feedback = await readFeedback(request);
    // Never acknowledge a discarded submission as saved.
    if (feedback.spam) throw new PayloadError(400);
    const preAuth = await env.FEEDBACK_LIMITER.limit({ key: "feedback-auth" });
    if (!preAuth.success) throw new PayloadError(429);
    const user = await authenticateFeedback(request, env);
    const limit = await env.FEEDBACK_LIMITER.limit({ key: `feedback-user:${user.sub}` });
    if (!limit.success) throw new PayloadError(429);
    const id = await repository.create(feedback, user);
    return json({ id, status: "private" }, headers, 201);
  } catch (error) {
    // Do not echo provider/SQL failures, which can contain private content.
    return new Response(null, {
      status: error instanceof PayloadError ? error.status : 503,
      headers,
    });
  }
}
