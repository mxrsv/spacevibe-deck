/** The schema-1 wire contract mirrored from Deck's src/telemetry/payload.ts. */
export const AGENT_KEYS = [
  "claude",
  "codex",
  "opencode",
  "agy",
  "gemini",
  "cursor-agent",
  "custom",
];
export const SURFACE_KEYS = ["browser", "explorer", "usage"];
export const BODY_LIMIT = 4096;
export const COUNTER_CAP = 1_000_000;
const FIELDS = [
  "schemaVersion",
  "dailyId",
  "day",
  "version",
  "platform",
  "arch",
  "agents",
  "surfaces",
  "maxTabs",
  "maxPanes",
  "restoredSessions",
];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value) {
  return Number.isInteger(value) && value >= 0 && value <= COUNTER_CAP;
}

function counters(value, keys, required) {
  return (
    record(value) &&
    Object.entries(value).every(([key, amount]) => keys.includes(key) && count(amount)) &&
    (!required || keys.every((key) => Object.hasOwn(value, key)))
  );
}

function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validPayload(value) {
  return (
    record(value) &&
    Object.keys(value).length === FIELDS.length &&
    FIELDS.every((key) => Object.hasOwn(value, key)) &&
    value.schemaVersion === 1 &&
    typeof value.dailyId === "string" &&
    UUID_V4.test(value.dailyId) &&
    day(value.day) &&
    typeof value.version === "string" &&
    value.version.length <= 64 &&
    VERSION.test(value.version) &&
    ["darwin", "win32"].includes(value.platform) &&
    ["arm64", "x64"].includes(value.arch) &&
    counters(value.agents, AGENT_KEYS, false) &&
    counters(value.surfaces, SURFACE_KEYS, true) &&
    count(value.maxTabs) &&
    count(value.maxPanes) &&
    typeof value.restoredSessions === "boolean"
  );
}

export class PayloadError extends Error {
  constructor(status) {
    super("Invalid usage snapshot");
    this.status = status;
  }
}

/** Stream the body so an omitted or false Content-Length cannot bypass the cap. */
export async function readPayload(request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  ) {
    throw new PayloadError(400);
  }
  if (!request.body) throw new PayloadError(400);
  const reader = request.body.getReader();
  let bytes = new Uint8Array();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes.byteLength + value.byteLength > BODY_LIMIT) {
        // Cancellation is advisory; its failure must not turn a 413 into a retry.
        void reader.cancel().catch(() => undefined);
        throw new PayloadError(413);
      }
      bytes = new Uint8Array([...bytes, ...value]);
    }
  } finally {
    reader.releaseLock();
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PayloadError(400);
  }
  if (!validPayload(payload)) throw new PayloadError(400);
  return payload;
}
