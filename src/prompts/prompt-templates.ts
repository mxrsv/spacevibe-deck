/**
 * The prompt template catalog: what the Prompt Board can paste, and how a new
 * template gets its id. Pure — no signals, no Tauri, no DOM.
 *
 * Mirrors the split in `lib/agent-catalog.ts`: the type, the size limits and
 * the id generator live here, while the settings store's array-level
 * validation sits beside `validateCustomAgents` in `settings-schema.ts`. Ids
 * are minted once from the label and frozen across renames — a template's
 * identity must not move when its display name does.
 */

export interface PromptTemplate {
  /** Stable `tpl:<slug>` id. Generated once from the label, never re-derived. */
  readonly id: string;
  readonly label: string;
  /** Multi-line prompt body, injected verbatim (plus composer lines). */
  readonly body: string;
  /** Submit after paste — subject to the triple gate, never unconditional. */
  readonly autoSend: boolean;
}

export const TEMPLATE_ID_PREFIX = "tpl:";

/** Long enough to name a prompt, short enough to stay one row. */
export const TEMPLATE_LABEL_MAX = 48;

/**
 * Upper bound on a body. Not a UI nicety: the whole body is pasted into a live
 * PTY in one bracketed-paste frame, and an unbounded blob would be pasted into
 * an agent's composer with no way to interrupt it.
 */
export const TEMPLATE_BODY_MAX = 20_000;

const FALLBACK_SLUG = "prompt";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A stable id for a new template, unique among `existing`. Same shape as
 * `createCustomAgentId`: slug, then a numeric suffix on collision.
 */
export function createPromptTemplateId(label: string, existing: readonly PromptTemplate[]): string {
  const base = slugify(label) || FALLBACK_SLUG;
  const taken = new Set(existing.map((entry) => entry.id));
  const first = `${TEMPLATE_ID_PREFIX}${base}`;
  if (!taken.has(first)) {
    return first;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${TEMPLATE_ID_PREFIX}${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Whether one stored template is well-formed. Shared with the popover so what
 * the form accepts and what survives a reload cannot drift apart — the same
 * contract `isValidCustomAgent` holds for declared agents.
 */
export function isValidPromptTemplate(value: unknown): value is PromptTemplate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    !entry.id.startsWith(TEMPLATE_ID_PREFIX) ||
    entry.id.length <= TEMPLATE_ID_PREFIX.length
  ) {
    return false;
  }
  if (
    typeof entry.label !== "string" ||
    entry.label.trim() === "" ||
    entry.label.length > TEMPLATE_LABEL_MAX
  ) {
    return false;
  }
  if (
    typeof entry.body !== "string" ||
    entry.body.trim() === "" ||
    entry.body.length > TEMPLATE_BODY_MAX
  ) {
    return false;
  }
  return typeof entry.autoSend === "boolean";
}
