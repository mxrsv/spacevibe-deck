import { PayloadError, readPayload } from "./payload.mjs";
import { createUsageRepository } from "./usage-repository.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCEPTED_HISTORY_DAYS = 30;
const LOCAL_DAY_SKEW_DAYS = 1;

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/ping") return new Response(null, { status: 404, headers: HEADERS });
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { ...HEADERS, allow: "POST" } });
    try {
      const payload = await readPayload(request);
      const now = Date.now();
      const today = Math.floor(now / DAY_MS);
      const day = Date.parse(payload.day) / DAY_MS;
      // Close days before their raw deduplication keys can expire at day 34.
      // One future UTC day accommodates local dates in positive time zones.
      if (day < today - ACCEPTED_HISTORY_DAYS || day > today + LOCAL_DAY_SKEW_DAYS) {
        return new Response(null, { status: 400, headers: HEADERS });
      }
      // A shared per-location budget bounds writes without reading an IP address.
      const limit = await env.INGEST_LIMITER.limit({ key: "schema-1-ingest" });
      if (!limit.success) return new Response(null, { status: 429, headers: HEADERS });
      await createUsageRepository(env.DB).upsert(payload, now);
      return new Response(null, { status: 204, headers: HEADERS });
    } catch (error) {
      // Never log a request, payload or D1 error, which can contain bound values.
      // Only schema/body errors are terminal; infrastructure failures are retryable.
      const status = error instanceof PayloadError ? error.status : 503;
      return new Response(null, { status, headers: HEADERS });
    }
  },
  async scheduled(controller, env) {
    // Reject on failure so the platform records a failed cron invocation.
    // The transaction leaves raw rows intact if aggregation cannot complete.
    await createUsageRepository(env.DB).expire(controller.scheduledTime);
  },
};
