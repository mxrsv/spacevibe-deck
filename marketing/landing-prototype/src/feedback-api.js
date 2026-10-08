/**
 * The landing's side of the feedback contract served by `backend/`
 * The Worker owns intake policy and durable storage; this
 * module only shapes the request and refuses to trust the response.
 */

export const FEEDBACK_API_URL = "https://api.deck.spacevibe.dev/v1/feedback";

// The Worker configuration remains the authoritative intake switch.
export const SUBMISSIONS_OPEN = true;
// Keep public reads enabled when closing intake after the initial rollout.
export const FEEDBACK_BOARD_OPEN = true;

/** Board columns, left to right. */
export const FEEDBACK_STATUSES = ["pending", "review", "done"];

export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"];

// Allow time for screenshots; failed requests keep the draft for an idempotent retry.
const SUBMIT_TIMEOUT_MS = 60_000;
const BOARD_TIMEOUT_MS = 12_000;

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

/** Why a submission failed, so the page can pick the right sentence. */
export class FeedbackSubmitError extends Error {
  /** @param {"invalid" | "rate" | "server"} reason */
  constructor(reason) {
    super(`Feedback submission failed: ${reason}`);
    this.name = "FeedbackSubmitError";
    this.reason = reason;
  }
}

function isCard(item) {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    typeof item.description === "string" &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    FEEDBACK_STATUSES.includes(item.status) &&
    FEEDBACK_CATEGORIES.includes(item.category) &&
    typeof item.updatedAt === "string" &&
    !Number.isNaN(Date.parse(item.updatedAt)) &&
    (item.images === undefined ||
      (Array.isArray(item.images) &&
        item.images.length <= 3 &&
        item.images.every((path, index) => path === `/v1/feedback/images/${item.id}/${index}`)))
  );
}

/**
 * Group the Worker's flat list into board columns, newest first. Malformed
 * items are dropped rather than failing the whole board.
 *
 * @param {unknown} payload
 * @returns {Record<"pending" | "review" | "done", Array<{ id: string, title: string, category: string, status: string, updatedAt: string }>>}
 */
export function groupFeedbackBoard(payload) {
  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("Feedback board response has no items list.");
  }

  const cards = payload.items
    .filter(isCard)
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return Object.fromEntries(
    FEEDBACK_STATUSES.map((status) => [status, cards.filter((card) => card.status === status)]),
  );
}

export async function fetchFeedbackBoard(cursor = null, fetchImpl = fetch) {
  const url = new URL(FEEDBACK_API_URL);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetchImpl(url.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(BOARD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Feedback board request failed with ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.nextCursor !== null && typeof payload.nextCursor !== "string") {
    throw new Error("Feedback board response has an invalid cursor.");
  }
  return { board: groupFeedbackBoard(payload), nextCursor: payload.nextCursor };
}

/**
 * `id` is the draft's UUID: a resend after a lost answer names the same stored
 * submission instead of creating a second one. Omitted when the browser has none.
 *
 * @param {{ title: string, body: string, category: string, website: string, id: string }} input
 */
export async function submitFeedback(input, fetchImpl = fetch) {
  let response;
  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    category: input.category,
    website: input.website,
    ...(input.id ? { id: input.id } : {}),
  });
  const multipart = Boolean(input.images?.length);
  const body = multipart ? new FormData() : payload;
  if (multipart) {
    body.set("feedback", payload);
    for (const image of input.images) body.append("images", image);
  }

  try {
    response = await fetchImpl(`${FEEDBACK_API_URL}?receipt=state`, {
      method: "POST",
      headers: {
        ...(!multipart ? { "content-type": "application/json" } : {}),
        ...(input.credential ? { authorization: `Bearer ${input.credential}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch {
    throw new FeedbackSubmitError("server");
  }

  if (response.status === 201) {
    const receipt = await response.json();
    if (
      typeof receipt.id !== "string" ||
      !["private", "hidden", ...FEEDBACK_STATUSES].includes(receipt.status)
    ) {
      throw new FeedbackSubmitError("server");
    }
    return;
  }
  if (response.status === 401) throw new FeedbackSubmitError("auth");
  if (response.status === 409) throw new FeedbackSubmitError("conflict");

  if (response.status === 400 || response.status === 413) {
    throw new FeedbackSubmitError("invalid");
  }

  throw new FeedbackSubmitError(response.status === 429 ? "rate" : "server");
}

export async function fetchFeedbackConfig(fetchImpl = fetch) {
  const response = await fetchImpl(`${FEEDBACK_API_URL}/config`, {
    signal: AbortSignal.timeout(BOARD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Feedback configuration unavailable");
  const config = await response.json();
  if (
    typeof config.submissionsOpen !== "boolean" ||
    (config.googleClientId !== null && typeof config.googleClientId !== "string") ||
    (config.authMode !== undefined && !["anonymous", "google"].includes(config.authMode))
  ) {
    throw new Error("Invalid feedback configuration");
  }
  return config;
}
