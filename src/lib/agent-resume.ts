/**
 * Turns a resolved session reference into the exact command line typed into a
 * restored pane's shell. Pure — no host imports here on purpose: the facade
 * that calls the main process (`src/host/resume-host.ts`) is a separate
 * module so this builder stays unit-testable without a fake bridge.
 */
import type { CustomAgent } from "./agent-catalog";

/** Wire mirror of `electron/resume/resolve.ts`'s `ResumeRef` — see that file. */
export type ResumeRef =
  { readonly kind: "id"; readonly id: string } | { readonly kind: "latest" } | null;

/** Wire mirror of `electron/resume/resolve.ts`'s `ResumeRequest`. */
export interface ResumeRequest {
  readonly agent: string;
  readonly cwd: string | null;
  readonly lastSeenAt: number;
  /** Only the rail's tail path sends one; `resume_lookup` ignores it. */
  readonly preferredId?: string;
}

/** Wire mirror of `electron/resume/session-tail.ts`'s `SessionTailAnswer`. */
export interface SessionTailAnswer {
  readonly id: string;
  readonly tail: string | null;
}

/**
 * A session id from a CLI's own state dir is untrusted input scanned off
 * disk; it must match this before it may reach a PTY write.
 */
const SESSION_REF_SAFE = /^[A-Za-z0-9._-]{1,128}$/;

interface CommandForms {
  readonly id: (id: string) => string;
  readonly latest: string;
  readonly bare: string;
}

/**
 * One entry per built-in agent (`src/lib/agent-catalog.ts`'s `BUILTIN_AGENTS`).
 * `gemini` has no id-precise resume form — `resolveResume` never produces a
 * `{ kind: "id" }` ref for it, but an id form is still defined here (falling
 * back to the latest form) so this table stays total and never throws on an
 * unexpected input.
 */
const COMMAND_TABLE: Readonly<Record<string, CommandForms>> = {
  claude: {
    id: (id) => `claude --resume ${id}`,
    latest: "claude --continue",
    bare: "claude",
  },
  codex: {
    id: (id) => `codex resume ${id}`,
    latest: "codex resume --last",
    bare: "codex",
  },
  opencode: {
    id: (id) => `opencode -s ${id}`,
    latest: "opencode -c",
    bare: "opencode",
  },
  gemini: {
    id: () => "gemini --resume latest",
    latest: "gemini --resume latest",
    bare: "gemini",
  },
  agy: {
    id: (id) => `agy --conversation ${id}`,
    latest: "agy --continue",
    bare: "agy",
  },
  // Added 2026-08-19 with the catalog entry. No Cursor session scanner exists
  // in `electron/resume/`, so `resume_lookup` answers null for these panes and
  // `bare` is what actually gets typed today — the two forms above are here so
  // that adding a scanner later is one file, not two.
  "cursor-agent": {
    id: (id) => `cursor-agent --resume ${id}`,
    latest: "cursor-agent --continue",
    bare: "cursor-agent",
  },
};

/**
 * Command typed into the restored pane's shell.
 * - built-in + id ref → the CLI's exact-resume form
 * - built-in + latest ref → the CLI's continue form
 * - built-in + null ref → the bare agent command (fresh session, best-effort)
 * - custom agent (matched by LABEL — classification stores labels for
 *   declared agents) → its declared command, ref ignored (no resume support)
 * - unknown agent string → null (pane stays a plain shell)
 * An id failing SESSION_REF_SAFE degrades to the null-ref branch — an
 * untrusted state-dir string must never reach a PTY write.
 */
export function buildResumeCommand(
  agent: string,
  ref: ResumeRef,
  customAgents: readonly CustomAgent[],
): string | null {
  const custom = customAgents.find((entry) => entry.label === agent);
  if (custom !== undefined) {
    return custom.command;
  }
  const forms = COMMAND_TABLE[agent];
  if (forms === undefined) {
    return null;
  }
  if (ref === null) {
    return forms.bare;
  }
  if (ref.kind === "latest") {
    return forms.latest;
  }
  if (!SESSION_REF_SAFE.test(ref.id)) {
    return forms.bare;
  }
  return forms.id(ref.id);
}
