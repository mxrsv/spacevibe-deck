/**
 * The flat payload of `pane_attention_report` (spec 2026-11-03-agent-orchestration, ORC17).
 *
 * The renderer owns each pane's attention state; main keeps a copy so `deck pane list` and
 * `deck pane wait` can answer without a round trip. Both sides import the closed sets from here,
 * so a phase the renderer can say is exactly a phase main accepts. Main still re-checks every
 * field with `parsePaneAttentionReport`, because the renderer is not the trust boundary and the
 * values end up printed in a terminal.
 */

export const REPORT_PHASES = ["unknown", "idle", "working", "exited"] as const;
export const REPORT_ATTENTIONS = ["none", "completed", "requested", "warning", "error"] as const;
export const REPORT_CONFIDENCES = ["explicit", "inferred", "unknown"] as const;

export type ReportPhase = (typeof REPORT_PHASES)[number];
export type ReportAttention = (typeof REPORT_ATTENTIONS)[number];
export type ReportConfidence = (typeof REPORT_CONFIDENCES)[number];

export interface PaneAttentionReport {
  readonly paneId: number;
  readonly phase: ReportPhase;
  readonly attention: ReportAttention;
  /** What produced the attention (`hook`, `osc-notification`, ...); null while it is `none`. */
  readonly source: string | null;
  /** How the PHASE was learned: the weaker axis the coordinator decides on (ORC18). */
  readonly confidence: ReportConfidence;
  /** The agent id running in the pane, or null for a shell. */
  readonly agent: string | null;
  /** The agent process id, or null when no agent runs. */
  readonly pid: number | null;
}

/** Longest `source` or `agent` main will keep; real ids are a dozen characters. */
const MAX_LABEL_LENGTH = 64;
const CONTROL_CHARACTER = /\p{Cc}/u;

function oneOf<T extends string>(set: readonly T[], value: unknown): T | null {
  return typeof value === "string" ? (set.find((member) => member === value) ?? null) : null;
}

/** A short printable label, or `undefined` for something that is neither that nor null. */
function label(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (value === "" || value.length > MAX_LABEL_LENGTH || CONTROL_CHARACTER.test(value)) {
    return undefined;
  }
  return value;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The checked report, or null when any field is outside its closed set or shape. */
export function parsePaneAttentionReport(
  fields: Readonly<Record<keyof PaneAttentionReport, unknown>>,
): PaneAttentionReport | null {
  const paneId = positiveInteger(fields.paneId);
  const phase = oneOf(REPORT_PHASES, fields.phase);
  const attention = oneOf(REPORT_ATTENTIONS, fields.attention);
  const confidence = oneOf(REPORT_CONFIDENCES, fields.confidence);
  const source = label(fields.source);
  const agent = label(fields.agent);
  const pid = fields.pid === null ? null : positiveInteger(fields.pid);
  if (
    paneId === null ||
    phase === null ||
    attention === null ||
    confidence === null ||
    source === undefined ||
    agent === undefined ||
    (fields.pid !== null && pid === null)
  ) {
    return null;
  }
  return { paneId, phase, attention, source, confidence, agent, pid };
}
