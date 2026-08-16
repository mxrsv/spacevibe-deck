# Agent Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browsable, filterable history of past Claude Code and Codex sessions with one primary action — resume a session in a new tab, in its own recorded directory, with the right command line.

**Architecture:** The per-agent transcript scanners that session restore landed in `electron/resume/` are **widened with an options bag** (head budget, file cap, title extraction, archived/interactive filters) instead of being duplicated as the spec's `electron/sessions/` provider files. A thin new `electron/sessions/` module composes those scanners into a capped, mtime-keyed, in-memory snapshot behind one flat `sessions_list` IPC channel. The renderer mirrors the `src/usage/` split (host facade → client seam → signal store) and paints a DL-11.1 full-window screen whose nav rail **is** the agent filter. Resume reuses two seams that already exist and are already tested: `buildResumeCommand` for the command line, and `MaterializeIntent.paneCommands` for the pane — no new command builder, no change to tab materialization.

**Tech Stack:** Electron main process (`node:fs`, sync bounded reads), Preact signals, Vitest, lucide-preact icons.

**Spec:** [`docs/specs/2026-08-14-session-history-design.md`](../specs/2026-08-14-session-history-design.md) `decided`

---

## Open decision — MUST be answered before Task 11

The spec assumes the list rows follow existing `DESIGN-LANGUAGE` rules. They do not: **§15 is explicitly read-only**, §12 is the settings-edit fork, §5 is the config row, and §22 is reserved. A pressable list row inside a full-window screen has **no genre**, which makes this a listed fork in [`AGENTS.md`](../../AGENTS.md) ("a rule in `docs/DESIGN-LANGUAGE.md`").

**Recommendation:** add **§25 "History rows"** as a §5 fork, following the §24 (theme gallery) precedent, with the four rules drafted in Task 11. The alternative — reusing the Open board's `.row` recents genre without writing a rule — leaves an unnumbered pattern in two places and violates R2.

Task 11 is written for the §25 answer. If the owner picks "reuse the board row genre", Task 11 collapses to a ledger note and `sessions-screen.css` reuses `.board-home__list`'s row rules.

## Spec deviations — carry these into the spec when the plan is approved

| Spec says                                                       | This plan does                                                                                         | Why                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `electron/sessions/` provider files per agent (§1.1–§1.3)   | Widen `electron/resume/{claude,codex}.ts` with a `ScanOptions` bag; `electron/sessions/` only composes | The scanners already extract session id + cwd from exactly these files. A second copy forks the parsing and doubles the maintenance (F1).                                                               |
| Channel `sessions:list` (§2)                                    | Channel **`sessions_list`**                                                                            | In `electron/ipc/channels.ts`, colon names are EVENTS (`pty:output`); commands are snake_case (`usage_snapshot`, `resume_lookup`).                                                                      |
| `provider.resumeCommand(meta)` (§1.1)                           | [`buildResumeCommand`](../../src/lib/agent-resume.ts) in the renderer                                  | It already emits `claude --resume <id>` / `codex resume <id>` **and** enforces `SESSION_REF_SAFE` before a string can reach a PTY write. A second builder forks the one sanitization point.             |
| `MaterializeIntent` gains a `command` field; "fork notice" (§4) | Nothing changes in `tab-materialize.ts` or `TabManager.materialize`                                    | Session restore already widened the intent with `paneCommands` and `AgentLauncher.arm(entries)` on 2026-08-15. History is a **caller** of that seam. The materialization fork is closed, not re-opened. |
| Codex head window is `session_meta` only (§1.3)                 | Codex reads the same 64 KiB / 60-line window as Claude                                                 | Measured on this machine's corpus, 2026-08-16: `session_meta` alone is 18.6 KB, so today's 8 KiB cap parses **0 of 300** rollouts (see Task 1).                                                         |
| Title falls back to the session id (§1.1)                       | Same, plus a measured cap note                                                                         | 48 of 52 interactive Codex rollouts expose their first user turn within 64 KiB (p50 20 KiB, p90 38 KiB, max 107 KiB). The remaining ~8% fall back.                                                      |
| Full screen is a list (§3.1)                                    | Full screen is DL-11.1's two-column shell; **the nav rail is the agent filter**                        | DL-11.1 mandates rail + section. A one-item rail would be a shell with nothing in it; the agent filter is the natural rail content and it removes a control from the section head.                      |

## Bug this plan fixes on the way

`electron/resume/codex.ts` reads `HEAD_BYTES = 8 * 1024` and parses one line. Every recent `session_meta` line on this machine is **~18.6 KB**, so `JSON.parse` fails, `headJsonLines` returns `[]`, and every rollout enriches to `null`. Measured 2026-08-16 against the real corpus:

```
claude candidates: 300 with cwd: 298
codex  candidates: 0   with cwd: 0

cap=8KiB  -> parsed 0/300
cap=32KiB -> parsed 300/300
cap=64KiB -> parsed 300/300
```

**Consequence today:** session restore (landed 2026-08-15) resolves no Codex session id, so a restored Codex pane silently starts a fresh conversation instead of resuming. Task 1 fixes it; Task 1's test locks it.

## Global Constraints

> **Correction, 2026-08-16 (found in flight):** every `.tsx` test snippet in Tasks 9 and 10 below was drafted against `@testing-library/preact` (`render` / `screen`). **That package is not installed** — it appears nowhere in `package.json` and has zero usages under `src/`. Do not add it. This repo's convention is `// @vitest-environment jsdom` on line 1, `render` from `preact`, `act` from `preact/test-utils`, a `host: HTMLDivElement` built in `beforeEach`, and assertions through `host.querySelector*` / `dispatchEvent`. See [`src/ui/toolbar/deck-toolbar.test.tsx`](../../src/ui/toolbar/deck-toolbar.test.tsx) and [`src/ui/usage/usage-screen.test.tsx`](../../src/ui/usage/usage-screen.test.tsx). **Keep every assertion those snippets specify; change only how the DOM is reached.**


- **Electron only.** No Tauri implementation. The renderer facade reports `unsupported` on Tauri and browser `npm run dev`, and the toolbar control is then not rendered at all. Say "Electron only" in docs, never "Deck has session history".
- **R1:** English only — strings, comments, docs, commit messages.
- **R2:** Chrome styling follows numbered DL rules and code comments cite them. A violation fixed also updates the DL ledger.
- **R4:** `tab-manager.ts` and the overlay-rank model are load-bearing seams. Every change there lands with its test in the same task; no drive-by refactors. **Nothing in `tab-materialize.ts` or `TabManager.materialize` changes.**
- **R5:** Renderer state uses Preact signals; module stores are window-scoped.
- **R6:** IPC payloads use **flat keys**. `scripts/electron-ipc-contract.test.ts` must stay green (it scans `invoke(...)` against `ipcMain.handle` destructuring).
- **R7:** No shipping module imports `src/gallery/`.
- **Security:** a session id scanned off disk is untrusted. It reaches a PTY write **only** through `buildResumeCommand`, which gates it on `/^[A-Za-z0-9._-]{1,128}$/`. Never interpolate `entry.sessionId` into a command string anywhere else.
- **Privacy:** titles and cwds live in RAM only. Nothing read from a transcript is written to disk — no index file, no cache file. `electron/usage/` is imported **read-only** for its path constants and is not modified (its Rust golden-fixture parity test locks it).
- **C1 immutability**, kebab-case filenames, ≤ 800 lines per file, feature-scoped modules.
- Per-task gate: `npm test`. Repo finish gate: `npm test && npm run build && npm run generate:menu:check && npm run electron:build`.
- Rendered UI requires screenshot approval (DL §9.6). Automated checks do not establish visual correctness.
- **The working tree carries unrelated uncommitted work.** Every commit stages task files **by explicit path** — never `git add -A` / `git add .`.
- Commits: conventional with scope, one concern each (`fix(resume): …`, `feat(sessions): …`, `feat(ui): …`, `docs(sessions): …`).
- **Do NOT commit this plan document** until the owner has reviewed it (D14).

## File Structure (new/modified)

```text
electron/resume/head.ts              MOD  ScanOptions, SessionRecord, ScanResult
electron/resume/claude.ts            MOD  scanClaude(home, options); candidates() keeps its signature
electron/resume/codex.ts             MOD  scanCodex(home, options); 64 KiB head (bug fix); interactive/archived filters
electron/sessions/model.ts           NEW  wire types + caps, main-process side
electron/sessions/list.ts            NEW  compose scanners, cap, mtime-keyed cache, cwd filter
electron/sessions/list.test.ts       NEW
electron/ipc/channels.ts             MOD  sessionsList: "sessions_list"
electron/main.ts                     MOD  sessions_list handler
src/lib/session-history.ts           NEW  renderer mirror of the wire types + EMPTY snapshot
src/host/sessions-host.ts            NEW  renderer facade + capability probe
src/sessions/sessions-client.ts      NEW  client seam (host client + memory client)
src/sessions/sessions-store.ts       NEW  signals: entries, totals, filters, loading/error, liveness
src/sessions/session-filters.ts      NEW  pure filter/derive helpers
src/sessions/resume-session.ts       NEW  entry → materialize call (uses buildResumeCommand)
src/chrome/events.ts                 MOD  sessionsOpen signal
src/ui/app.tsx                       MOD  three-way exclusion, toggle, mount, popover suppression, attention dismiss
src/terminal/tab-manager.ts          MOD  openOverlayRanks() reads sessionsOpen
src/ui/attention-focus-coordinator.ts MOD  overlays.sessions + dismissSessions
src/ui/sessions/sessions-screen.tsx  NEW  DL-11.1 shell
src/ui/sessions/sessions-nav.tsx     NEW  rail = agent filter
src/ui/sessions/session-row.tsx      NEW  one pressable row
src/ui/sessions/sessions-list.tsx    NEW  project filter, rows, cap notice, empty state
src/ui/toolbar/deck-toolbar.tsx      MOD  history control
src/open-board/open-board-home.tsx   MOD  "Recent sessions" block for the selected workspace
src/styles.css                       MOD  .sessions-screen block
docs/DESIGN-LANGUAGE.md              MOD  §25 (pending the open decision)
docs/CONTEXT.md, AGENTS.md           MOD  fork record, drift row, direction bullet
```

---

### Task 1: Codex head-cap bug fix + scan options in `electron/resume/`

**Files:**

- Modify: `electron/resume/head.ts`
- Modify: `electron/resume/claude.ts`
- Modify: `electron/resume/codex.ts`
- Test: `electron/resume/resolve.test.ts` (append), `electron/resume/scan.test.ts` (create)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `interface FileCandidate { readonly filePath: string; readonly mtimeMs: number; readonly size: number }` — stat-level only, no bytes read.
  - `interface ScanOptions { readonly maxFiles: number; readonly headBytes: number; readonly headLines: number; readonly withTitle: boolean }`
  - `interface SessionRecord extends CandidateSession { readonly sourcePath: string; readonly title: string | null }`
  - `interface ScanResult { readonly total: number; readonly records: readonly SessionRecord[] }`
  - `listClaudeFiles(home: string): FileCandidate[]` / `listCodexFiles(home: string, includeArchived: boolean): FileCandidate[]` — newest-first, **stat only**.
  - `readClaudeRecord(file: FileCandidate, options: ScanOptions): SessionRecord | null` / `readCodexRecord(file: FileCandidate, options: CodexScanOptions): SessionRecord | null` — the head read, one file.
  - `scanClaude(home: string, options: ScanOptions): ScanResult` / `scanCodex(home: string, options: CodexScanOptions): ScanResult` — list + slice + read, the uncached convenience the boot path uses.
  - `candidates(home: string): CandidateSession[]` — unchanged signature in both files.

**Why the list/read split exists:** spec §1.4 requires "re-opening the screen re-stats and re-reads only changed files". A cache that runs _after_ a scan has already read every head saves nothing. Task 2 keys its cache on `path + mtime + size` and calls `read*Record` only on a miss, which is only possible if listing and reading are separate entry points.

- [ ] **Step 1: Write the failing test for the Codex head cap**

Create `electron/resume/scan.test.ts`:

```ts
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanClaude } from "./claude";
import { scanCodex, CODEX_RESTORE_SCAN } from "./codex";
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSIONS_DIR,
  TRANSCRIPT_EXTENSION,
} from "../usage/model";

const T0 = Date.parse("2026-08-01T00:00:00Z");

function writeAt(filePath: string, contents: string, mtimeMs: number): void {
  writeFileSync(filePath, contents);
  utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A `session_meta` line padded past 8 KiB, the way a real rollout's embedded
 *  base_instructions pads it (~18.6 KB measured, 2026-08-16). */
function codexMeta(id: string, cwd: string, source: unknown): string {
  return JSON.stringify({
    type: "session_meta",
    payload: {
      id,
      cwd,
      source,
      base_instructions: { text: "x".repeat(12_000) },
    },
  });
}

describe("scanCodex", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-scan-"));
    const live = path.join(
      home,
      CODEX_DIR,
      CODEX_SESSIONS_DIR,
      "2026",
      "08",
      "01",
    );
    mkdirSync(live, { recursive: true });
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}cli${TRANSCRIPT_EXTENSION}`),
      [
        codexMeta("cli-id", "/work/repo", "cli"),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "text",
                text: "<environment_context>ignore me</environment_context>",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "text", text: "make the thing work" }],
          },
        }),
      ].join("\n"),
      T0 + 3000,
    );
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}exec${TRANSCRIPT_EXTENSION}`),
      codexMeta("exec-id", "/work/repo", "exec"),
      T0 + 2000,
    );
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}sub${TRANSCRIPT_EXTENSION}`),
      codexMeta("sub-id", "/work/repo", { subagent: { depth: 1 } }),
      T0 + 1000,
    );
    // No `source` key at all — the shape `resolve.test.ts` already writes.
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}legacy${TRANSCRIPT_EXTENSION}`),
      JSON.stringify({
        type: "session_meta",
        payload: { id: "legacy-id", cwd: "/work/repo" },
      }),
      T0 + 500,
    );
    const old = path.join(home, CODEX_DIR, CODEX_ARCHIVED_DIR);
    mkdirSync(old, { recursive: true });
    writeAt(
      path.join(old, `${CODEX_ROLLOUT_PREFIX}old${TRANSCRIPT_EXTENSION}`),
      codexMeta("old-id", "/work/repo", "cli"),
      T0,
    );
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  // The shipped bug: an 8 KiB head cannot parse an 18 KB session_meta line.
  it("parses a session_meta line larger than 8 KiB", () => {
    const result = scanCodex(home, CODEX_RESTORE_SCAN);
    expect(result.records.map((r) => r.id)).toContain("cli-id");
  });

  it("drops exec and subagent rollouts when interactiveOnly is set", () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      interactiveOnly: true,
    });
    const ids = result.records.map((r) => r.id);
    expect(ids).toContain("cli-id");
    expect(ids).not.toContain("exec-id");
    expect(ids).not.toContain("sub-id");
  });

  // `resolve.test.ts`'s own codex fixture writes `payload: { id, cwd }` with
  // NO `source` at all (verified 2026-08-16, resolve.test.ts:98). A filter
  // that requires a known-good marker would delete that session and break a
  // test this task must keep green — so the filter names what to REJECT.
  it("keeps a rollout whose session_meta carries no source field", () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      interactiveOnly: true,
    });
    expect(result.records.map((r) => r.id)).toContain("legacy-id");
  });

  it("drops archived rollouts when includeArchived is false", () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      includeArchived: false,
    });
    expect(result.records.map((r) => r.id)).not.toContain("old-id");
  });

  it("keeps archived rollouts by default, as restore always has", () => {
    const result = scanCodex(home, CODEX_RESTORE_SCAN);
    expect(result.records.map((r) => r.id)).toContain("old-id");
  });

  it("takes the first user turn that is not an injected context block as the title", () => {
    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, withTitle: true });
    const cli = result.records.find((r) => r.id === "cli-id");
    expect(cli?.title).toBe("make the thing work");
  });

  it("reports the pre-cap candidate total", () => {
    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, maxFiles: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(5);
  });
});

describe("scanClaude", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-scan-claude-"));
    const project = path.join(
      home,
      CLAUDE_DIR,
      CLAUDE_PROJECTS_DIR,
      "-work-repo",
    );
    mkdirSync(project, { recursive: true });
    writeAt(
      path.join(project, `sid${TRANSCRIPT_EXTENSION}`),
      [
        JSON.stringify({ type: "last-prompt", sessionId: "sid" }),
        JSON.stringify({ type: "mode", sessionId: "sid" }),
        JSON.stringify({ type: "system", sessionId: "sid", cwd: "/work/repo" }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "not a prompt" }],
          },
        }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "ship the feature" },
        }),
      ].join("\n"),
      T0,
    );
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("reads the session id from line one and the cwd from a later line", () => {
    const [record] = scanClaude(home, {
      maxFiles: 10,
      headBytes: 64 * 1024,
      headLines: 60,
      withTitle: false,
    }).records;
    expect(record.id).toBe("sid");
    expect(record.cwd).toBe("/work/repo");
    expect(record.sourcePath.endsWith(`sid${TRANSCRIPT_EXTENSION}`)).toBe(true);
  });

  it("skips tool_result user lines when picking a title", () => {
    const [record] = scanClaude(home, {
      maxFiles: 10,
      headBytes: 64 * 1024,
      headLines: 60,
      withTitle: true,
    }).records;
    expect(record.title).toBe("ship the feature");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run electron/resume/scan.test.ts`
Expected: FAIL — `scanClaude`, `scanCodex`, `CODEX_RESTORE_SCAN` are not exported.

- [ ] **Step 3: Add the shared scan types to `electron/resume/head.ts`**

Append to `electron/resume/head.ts`:

```ts
/**
 * How wide a scan reads and how much it extracts. Session restore and the
 * session-history surface run the SAME scanners with different budgets: the
 * boot path wants ids and cwds as cheaply as possible, the history surface
 * additionally wants a display title. Keeping this a parameter rather than a
 * second copy of each scanner is why there is no `electron/sessions/claude.ts`
 * (plan 2026-08-16, deviation 1).
 */
export interface ScanOptions {
  /** Newest-first bound on files actually read. */
  readonly maxFiles: number;
  /** Bytes read from the head of each file. */
  readonly headBytes: number;
  /** JSON lines parsed out of that window. */
  readonly headLines: number;
  /** Extract a display title. Off for the boot path, which never shows one. */
  readonly withTitle: boolean;
}

/**
 * One transcript file as `lstat` sees it — no bytes read yet.
 *
 * Listing and reading are separate entry points so a caller that already has
 * a record for this exact `path + mtime + size` can skip the head read
 * entirely (spec §1.4 step 3). Fold them back together and the cache in
 * `electron/sessions/list.ts` becomes decorative.
 */
export interface FileCandidate {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** `path + mtime + size`, the enrichment cache key. NUL-separated so no path
 *  can forge another path's key by ending in digits. */
export function fileCacheKey(file: FileCandidate): string {
  return `${file.filePath}\u0000${file.mtimeMs}\u0000${file.size}`;
}

/** A `CandidateSession` plus what only the history surface needs. */
export interface SessionRecord extends CandidateSession {
  readonly sourcePath: string;
  /** First user-authored text in the head window; null when none was found. */
  readonly title: string | null;
}

/** Records, plus how many candidate files existed BEFORE `maxFiles` cut in —
 *  the number the "showing latest N" notice is computed from. */
export interface ScanResult {
  readonly total: number;
  readonly records: readonly SessionRecord[];
}

/** Longest title kept; the rest is dropped rather than rendered and clipped. */
export const TITLE_MAX_CHARS = 160;

/** Collapse whitespace and bound the length. Empty input answers null. */
export function normalizeTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "") {
    return null;
  }
  return collapsed.length <= TITLE_MAX_CHARS
    ? collapsed
    : `${collapsed.slice(0, TITLE_MAX_CHARS - 1)}…`;
}
```

- [ ] **Step 4: Rewrite `electron/resume/claude.ts`'s scan around the options**

Replace the constants and the bottom half of `electron/resume/claude.ts`:

```ts
import { IDENTITY_HEAD_BYTES } from "../usage/model";
import {
  headBytes,
  headJsonLines,
  normalizeTitle,
  type CandidateSession,
  type FileCandidate,
  type ScanOptions,
  type ScanResult,
  type SessionRecord,
} from "./head";

/**
 * `sessionId` is on line one; `cwd` lands within the first few lines (line 5
 * on this machine's corpus, measured 2026-08-16) and the first real user turn
 * within the first ten. 64 KiB / 60 lines covers all three.
 */
export const CLAUDE_RESTORE_SCAN: ScanOptions = Object.freeze({
  maxFiles: 300,
  headBytes: IDENTITY_HEAD_BYTES,
  headLines: 60,
  withTitle: false,
});

/**
 * A `type: "user"` line whose content is a tool result is the transcript
 * echoing a tool back, not something the user typed. Only a plain string, or
 * a `{ type: "text" }` part, is user-authored.
 */
function claudeUserText(line: Record<string, unknown>): string | null {
  if (line.type !== "user") {
    return null;
  }
  const message = line.message;
  if (message === null || typeof message !== "object") {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  for (const part of content) {
    if (part === null || typeof part !== "object") {
      continue;
    }
    const node = part as Record<string, unknown>;
    if (node.type === "text" && typeof node.text === "string") {
      return node.text;
    }
  }
  return null;
}

export function readClaudeRecord(
  entry: FileCandidate,
  options: ScanOptions,
): SessionRecord | null {
  const head = headBytes(entry.filePath, options.headBytes);
  if (head === null) {
    return null;
  }
  const lines = headJsonLines(head, options.headLines);
  const first = lines[0];
  if (first === null || typeof first !== "object") {
    return null;
  }
  const sessionId = (first as Record<string, unknown>).sessionId;
  if (typeof sessionId !== "string" || sessionId === "") {
    return null;
  }
  let cwd: string | null = null;
  let title: string | null = null;
  for (const line of lines) {
    if (line === null || typeof line !== "object") {
      continue;
    }
    const node = line as Record<string, unknown>;
    if (cwd === null && typeof node.cwd === "string" && node.cwd !== "") {
      cwd = node.cwd;
    }
    if (options.withTitle && title === null) {
      const text = claudeUserText(node);
      if (text !== null) {
        title = normalizeTitle(text);
      }
    }
    if (cwd !== null && (!options.withTitle || title !== null)) {
      break;
    }
  }
  return {
    id: sessionId,
    cwd,
    mtimeMs: entry.mtimeMs,
    sourcePath: entry.filePath,
    title,
  };
}

/** Every transcript, newest first, stat only — no file is opened here. */
export function listClaudeFiles(home: string): FileCandidate[] {
  const root = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR);
  return datedTranscripts(root).sort(
    (left, right) => right.mtimeMs - left.mtimeMs,
  );
}

/** List + cap + read, with no cache. The boot path's shape; the history
 *  surface uses `listClaudeFiles` + `readClaudeRecord` so it can skip reads. */
export function scanClaude(home: string, options: ScanOptions): ScanResult {
  const newestFirst = listClaudeFiles(home);
  const records: SessionRecord[] = [];
  for (const entry of newestFirst.slice(0, options.maxFiles)) {
    const record = readClaudeRecord(entry, options);
    if (record !== null) {
      records.push(record);
    }
  }
  return { total: newestFirst.length, records };
}

/** The boot path's shape, unchanged: ids and cwds, no titles. */
export function candidates(home: string): CandidateSession[] {
  return scanClaude(home, CLAUDE_RESTORE_SCAN).records.slice();
}
```

Widen the file's local `DatedFile` into `head.ts`'s `FileCandidate` — `datedTranscripts` must now record `size` alongside `mtimeMs` from the same `lstatSync` call it already makes, and the local interface is deleted in favour of the shared one. Delete the now-unused `HEAD_BYTES`, `HEAD_LINES`, `MAX_FILES` constants and the old `readCandidate`.

- [ ] **Step 5: Rewrite `electron/resume/codex.ts`'s scan and fix the head cap**

Replace the constants and bottom half of `electron/resume/codex.ts`:

```ts
import { discoverCodex } from "../usage/discover";
import { IDENTITY_HEAD_BYTES } from "../usage/model";
import {
  headBytes,
  headJsonLines,
  normalizeTitle,
  type CandidateSession,
  type FileCandidate,
  type ScanOptions,
  type ScanResult,
  type SessionRecord,
} from "./head";

/** Extra knobs only Codex has: two directories and two kinds of non-human run. */
export interface CodexScanOptions extends ScanOptions {
  readonly includeArchived: boolean;
  readonly interactiveOnly: boolean;
}

/**
 * 64 KiB, NOT the 8 KiB this file shipped with. Measured 2026-08-16 against
 * the real corpus: `session_meta` embeds `base_instructions`, so the head line
 * alone is ~18.6 KB and an 8 KiB window parsed 0 of 300 rollouts — every Codex
 * pane restored as a fresh conversation. 32 KiB parsed 300/300; 64 KiB is the
 * same `IDENTITY_HEAD_BYTES` the rest of the codebase reads with, and also
 * reaches the first user turn in 48 of 52 interactive rollouts (p50 20 KiB,
 * p90 38 KiB, max 107 KiB).
 *
 * `interactiveOnly` is ON for the boot path too: resuming a pane INTO an
 * `exec` run or a subagent thread would be wrong, not merely noisy.
 */
export const CODEX_RESTORE_SCAN: CodexScanOptions = Object.freeze({
  maxFiles: 300,
  headBytes: IDENTITY_HEAD_BYTES,
  headLines: 60,
  withTitle: false,
  includeArchived: true,
  interactiveOnly: true,
});

/**
 * Names what to REJECT, not what to accept. `source` is a plain string for a
 * human-driven run (`"cli"`, `"vscode"`), the literal `"exec"` for the
 * non-interactive CLI, and an OBJECT for a spawned one (`{ subagent: … }`).
 * Measured share of the newest 300 rollouts on this machine, 2026-08-16:
 * vscode 168, subagent 77, cli 38, exec 15.
 *
 * An ABSENT `source` is kept: older rollouts predate the field (that is the
 * shape `resolve.test.ts`'s own fixture writes), and a filter phrased as
 * "must carry a known-good marker" would delete them from restore.
 */
function isNonInteractiveSource(source: unknown): boolean {
  if (source === "exec") {
    return true;
  }
  return source !== null && typeof source === "object";
}

/** Injected context blocks open with a tag; a person's first line does not. */
function codexUserText(payload: Record<string, unknown>): string | null {
  if (payload.type === "user_message" && typeof payload.message === "string") {
    return payload.message;
  }
  if (payload.type !== "message" || payload.role !== "user") {
    return null;
  }
  const content = payload.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  for (const part of content) {
    if (part !== null && typeof part === "object") {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") {
        return text;
      }
    }
  }
  return null;
}

/** Every rollout, newest first, stat only — no file is opened here. */
export function listCodexFiles(
  home: string,
  includeArchived: boolean,
): FileCandidate[] {
  const discovery = discoverCodex(home);
  const files = includeArchived
    ? [...discovery.active, ...discovery.archived]
    : discovery.active;
  const out: FileCandidate[] = [];
  for (const filePath of files) {
    try {
      const info = statSync(filePath);
      out.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      continue;
    }
  }
  return out.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function readCodexRecord(
  entry: FileCandidate,
  options: CodexScanOptions,
): SessionRecord | null {
  const head = headBytes(entry.filePath, options.headBytes);
  if (head === null) {
    return null;
  }
  const lines = headJsonLines(head, options.headLines);
  const first = lines[0];
  if (first === null || typeof first !== "object") {
    return null;
  }
  const payload = (first as Record<string, unknown>).payload;
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const meta = payload as Record<string, unknown>;
  if (options.interactiveOnly && isNonInteractiveSource(meta.source)) {
    return null;
  }
  const id = meta.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }
  const cwd = typeof meta.cwd === "string" && meta.cwd !== "" ? meta.cwd : null;
  let title: string | null = null;
  if (options.withTitle) {
    for (const line of lines.slice(1)) {
      if (line === null || typeof line !== "object") {
        continue;
      }
      const body = (line as Record<string, unknown>).payload;
      if (body === null || typeof body !== "object") {
        continue;
      }
      const text = codexUserText(body as Record<string, unknown>);
      if (text === null || text.trimStart().startsWith("<")) {
        continue;
      }
      title = normalizeTitle(text);
      if (title !== null) {
        break;
      }
    }
  }
  return { id, cwd, mtimeMs: entry.mtimeMs, sourcePath: entry.filePath, title };
}

export function scanCodex(home: string, options: CodexScanOptions): ScanResult {
  const newestFirst = listCodexFiles(home, options.includeArchived);
  const records: SessionRecord[] = [];
  for (const entry of newestFirst.slice(0, options.maxFiles)) {
    const record = readCodexRecord(entry, options);
    if (record !== null) {
      records.push(record);
    }
  }
  return { total: newestFirst.length, records };
}

export function candidates(home: string): CandidateSession[] {
  return scanCodex(home, CODEX_RESTORE_SCAN).records.slice();
}
```

- [ ] **Step 6: Run the new suite and the restore suite together**

Run: `npx vitest run electron/resume/`
Expected: PASS — `scan.test.ts` green and `resolve.test.ts` still green (its fixtures write small `session_meta` lines, which a wider cap reads identically).

- [ ] **Step 7: Prove the bug fix against the real corpus**

Run:

```bash
npx tsx -e "import{candidates as c}from'./electron/resume/codex';import{homedir}from'node:os';const x=c(homedir());console.log('codex candidates:',x.length,'with cwd:',x.filter(e=>e.cwd!==null).length)"
```

Expected: a non-zero count (was `0` before this task). Paste the output into the commit body.

- [ ] **Step 8: Commit**

```bash
git add electron/resume/head.ts electron/resume/claude.ts electron/resume/codex.ts electron/resume/scan.test.ts
git commit -m "fix(resume): read 64 KiB of a codex rollout so session_meta parses"
```

---

### Task 2: `electron/sessions/` — compose, cap, cache

**Files:**

- Create: `electron/sessions/model.ts`
- Create: `electron/sessions/list.ts`
- Test: `electron/sessions/list.test.ts`

**Interfaces:**

- Consumes: `listClaudeFiles`, `readClaudeRecord`, `listCodexFiles`, `readCodexRecord`, `fileCacheKey`, `CLAUDE_RESTORE_SCAN`, `CODEX_RESTORE_SCAN`, `FileCandidate`, `SessionRecord` (Task 1).
- Produces:
  - `type SessionAgent = "claude" | "codex"`
  - `interface SessionEntry { readonly agent: SessionAgent; readonly sessionId: string; readonly cwd: string; readonly lastActivityMs: number; readonly title: string | null; readonly sourcePath: string }`
  - `interface SessionsSnapshot { readonly entries: readonly SessionEntry[]; readonly totals: Readonly<Record<SessionAgent, number>>; readonly limit: number }`
  - `const SESSIONS_DEFAULT_LIMIT = 500`
  - `interface SessionReaders { readonly claude: (file: FileCandidate) => SessionRecord | null; readonly codex: (file: FileCandidate) => SessionRecord | null }` — injectable so a test can COUNT reads.
  - `listSessions(home: string, limit?: number, readers?: SessionReaders): SessionsSnapshot`
  - `clearSessionsCache(): void` (test seam)

- [ ] **Step 1: Write the failing test**

Create `electron/sessions/list.test.ts`:

```ts
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSessionsCache, listSessions } from "./list";
import { CLAUDE_RESTORE_SCAN, readClaudeRecord } from "../resume/claude";
import type { FileCandidate } from "../resume/head";
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  TRANSCRIPT_EXTENSION,
} from "../usage/model";

const T0 = Date.parse("2026-08-01T00:00:00Z");

function claudeSession(
  home: string,
  id: string,
  cwd: string | null,
  title: string,
  mtimeMs: number,
): void {
  const project = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, `-p-${id}`);
  mkdirSync(project, { recursive: true });
  const file = path.join(project, `${id}${TRANSCRIPT_EXTENSION}`);
  const lines = [JSON.stringify({ type: "last-prompt", sessionId: id })];
  if (cwd !== null) {
    lines.push(JSON.stringify({ type: "system", sessionId: id, cwd }));
  }
  lines.push(
    JSON.stringify({ type: "user", message: { role: "user", content: title } }),
  );
  writeFileSync(file, lines.join("\n"));
  utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

describe("listSessions", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-list-"));
    clearSessionsCache();
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("sorts newest first across agents", () => {
    claudeSession(home, "older", "/a", "first", T0);
    claudeSession(home, "newer", "/b", "second", T0 + 60_000);
    const snapshot = listSessions(home);
    expect(snapshot.entries.map((e) => e.sessionId)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("drops a session whose transcript names no cwd", () => {
    claudeSession(home, "nocwd", null, "orphan", T0);
    expect(listSessions(home).entries).toHaveLength(0);
  });

  it("carries the title and the agent id", () => {
    claudeSession(home, "sid", "/work", "make it green", T0);
    const [entry] = listSessions(home).entries;
    expect(entry.agent).toBe("claude");
    expect(entry.title).toBe("make it green");
    expect(entry.cwd).toBe("/work");
  });

  it("caps entries per agent and reports the pre-cap total", () => {
    for (let i = 0; i < 4; i += 1) {
      claudeSession(home, `s${i}`, "/work", `t${i}`, T0 + i * 1000);
    }
    const snapshot = listSessions(home, 2);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.totals.claude).toBe(4);
    expect(snapshot.limit).toBe(2);
  });

  it("re-reads a file whose mtime changed", () => {
    claudeSession(home, "sid", "/work", "first title", T0);
    expect(listSessions(home).entries[0].title).toBe("first title");
    claudeSession(home, "sid", "/work", "second title", T0 + 60_000);
    expect(listSessions(home).entries[0].title).toBe("second title");
  });

  // The assertion that makes the cache real. A cache applied AFTER the scan
  // would pass the mtime test above and still read every head twice — this
  // one counts the reads, so it can only pass if the key is checked BEFORE
  // the file is opened (spec §1.4 step 3).
  it("opens no file on a second scan when nothing changed", () => {
    claudeSession(home, "a", "/work", "one", T0);
    claudeSession(home, "b", "/work", "two", T0 + 1000);
    let reads = 0;
    const readers = {
      claude: (file: FileCandidate) => {
        reads += 1;
        return readClaudeRecord(file, {
          ...CLAUDE_RESTORE_SCAN,
          withTitle: true,
        });
      },
      codex: () => null,
    };
    listSessions(home, 500, readers);
    expect(reads).toBe(2);
    listSessions(home, 500, readers);
    expect(reads).toBe(2);
  });

  it("answers an empty snapshot when no state directory exists", () => {
    const snapshot = listSessions(path.join(home, "nowhere"));
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.totals.claude).toBe(0);
    expect(snapshot.totals.codex).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run electron/sessions/list.test.ts`
Expected: FAIL — `./list` does not exist.

- [ ] **Step 3: Write `electron/sessions/model.ts`**

```ts
/**
 * Wire shape of the session-history list. Mirrored verbatim by the renderer in
 * `src/lib/session-history.ts` — the two files are a pair; changing one without
 * the other is the exact drift `scripts/electron-ipc-contract.test.ts` cannot
 * see (it checks argument keys, not reply shapes).
 */

export type SessionAgent = "claude" | "codex";

export const SESSION_AGENTS: readonly SessionAgent[] = Object.freeze([
  "claude",
  "codex",
]);

/** One resumable past session. `cwd` is non-null by construction: an entry
 *  with no recorded directory cannot be resumed in the right place, so it is
 *  dropped rather than shown (spec §1.4). */
export interface SessionEntry {
  readonly agent: SessionAgent;
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastActivityMs: number;
  readonly title: string | null;
  readonly sourcePath: string;
}

export interface SessionsSnapshot {
  readonly entries: readonly SessionEntry[];
  /** Candidate FILES per agent before the cap — what "showing latest N" reads. */
  readonly totals: Readonly<Record<SessionAgent, number>>;
  readonly limit: number;
}

/** Spec §1.4: newest 500 per agent get a head read. */
export const SESSIONS_DEFAULT_LIMIT = 500;

/** Hard ceiling on a renderer-supplied limit — the renderer is not the trust
 *  boundary, and an unbounded limit is an unbounded read. */
export const SESSIONS_MAX_LIMIT = 2000;

export const EMPTY_SESSIONS_SNAPSHOT: SessionsSnapshot = Object.freeze({
  entries: Object.freeze([]),
  totals: Object.freeze({ claude: 0, codex: 0 }),
  limit: SESSIONS_DEFAULT_LIMIT,
});
```

- [ ] **Step 4: Write `electron/sessions/list.ts`**

```ts
/**
 * Session history's data layer: the `electron/resume/` scanners run with the
 * history budget, their records folded into one newest-first list.
 *
 * Stat first, heads lazy (spec §1.4). Every candidate file is stat'ed on every
 * call — that is what makes a re-open notice a changed transcript — but a file
 * whose `path + mtime + size` is already in the enrichment map is never
 * OPENED again. Reversing that order (scan everything, then cache) would leave
 * the map decorative: the reads it was meant to save have already happened.
 *
 * Nothing here is persisted. Titles and cwds are conversation-adjacent data
 * and stay in RAM for the life of the process, matching the contract the usage
 * cache states for itself (spec §1.4, "Privacy").
 */
import {
  CLAUDE_RESTORE_SCAN,
  listClaudeFiles,
  readClaudeRecord,
} from "../resume/claude";
import {
  CODEX_RESTORE_SCAN,
  listCodexFiles,
  readCodexRecord,
} from "../resume/codex";
import {
  fileCacheKey,
  type FileCandidate,
  type SessionRecord,
} from "../resume/head";
import {
  SESSIONS_DEFAULT_LIMIT,
  SESSIONS_MAX_LIMIT,
  type SessionAgent,
  type SessionEntry,
  type SessionsSnapshot,
} from "./model";

/** The history budget: the restore budget plus titles. */
const CLAUDE_HISTORY_SCAN = { ...CLAUDE_RESTORE_SCAN, withTitle: true };
const CODEX_HISTORY_SCAN = {
  ...CODEX_RESTORE_SCAN,
  withTitle: true,
  // Archived means the user put it away (spec §1.3).
  includeArchived: false,
  interactiveOnly: true,
};

/** One head read per agent, injectable so a test can count them. */
export interface SessionReaders {
  readonly claude: (file: FileCandidate) => SessionRecord | null;
  readonly codex: (file: FileCandidate) => SessionRecord | null;
}

const DEFAULT_READERS: SessionReaders = {
  claude: (file) => readClaudeRecord(file, CLAUDE_HISTORY_SCAN),
  codex: (file) => readCodexRecord(file, CODEX_HISTORY_SCAN),
};

/** `path + mtime + size` → the record read from it. A miss is the ONLY thing
 *  that opens a file. `null` is cached too: a transcript that names no session
 *  will not name one on the next open either. */
const enriched = new Map<string, SessionRecord | null>();

export function clearSessionsCache(): void {
  enriched.clear();
}

function toEntry(
  agent: SessionAgent,
  record: SessionRecord,
): SessionEntry | null {
  // No recorded directory means no correct place to resume, so the row is
  // dropped rather than shown and then refused (spec §1.4).
  if (record.cwd === null) {
    return null;
  }
  return {
    agent,
    sessionId: record.id,
    cwd: record.cwd,
    lastActivityMs: record.mtimeMs,
    title: record.title,
    sourcePath: record.sourcePath,
  };
}

function safeList(run: () => FileCandidate[]): FileCandidate[] {
  try {
    return run();
  } catch {
    // A missing or unreadable state directory is a normal answer, not a
    // failure: the surface says "nothing found", it does not say "broken".
    return [];
  }
}

function collect(
  agent: SessionAgent,
  files: readonly FileCandidate[],
  limit: number,
  read: (file: FileCandidate) => SessionRecord | null,
  into: SessionEntry[],
): void {
  for (const file of files.slice(0, limit)) {
    const key = fileCacheKey(file);
    let record: SessionRecord | null;
    if (enriched.has(key)) {
      record = enriched.get(key) ?? null;
    } else {
      record = read(file);
      enriched.set(key, record);
    }
    if (record === null) {
      continue;
    }
    const entry = toEntry(agent, record);
    if (entry !== null) {
      into.push(entry);
    }
  }
}

export function listSessions(
  home: string,
  limit: number = SESSIONS_DEFAULT_LIMIT,
  readers: SessionReaders = DEFAULT_READERS,
): SessionsSnapshot {
  const capped = Math.max(1, Math.min(Math.floor(limit), SESSIONS_MAX_LIMIT));
  const claudeFiles = safeList(() => listClaudeFiles(home));
  const codexFiles = safeList(() =>
    listCodexFiles(home, CODEX_HISTORY_SCAN.includeArchived),
  );

  const entries: SessionEntry[] = [];
  collect("claude", claudeFiles, capped, readers.claude, entries);
  collect("codex", codexFiles, capped, readers.codex, entries);
  entries.sort((left, right) => right.lastActivityMs - left.lastActivityMs);

  return {
    entries,
    // Pre-cap FILE counts — what "showing latest N of M" reads.
    totals: { claude: claudeFiles.length, codex: codexFiles.length },
    limit: capped,
  };
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run electron/sessions/list.test.ts`
Expected: PASS (7/7).

- [ ] **Step 6: Commit**

```bash
git add electron/sessions/model.ts electron/sessions/list.ts electron/sessions/list.test.ts
git commit -m "feat(sessions): compose claude and codex scans into a capped history list"
```

---

### Task 3: `sessions_list` IPC channel and handler

**Files:**

- Modify: `electron/ipc/channels.ts`
- Modify: `electron/main.ts`
- Test: `scripts/electron-ipc-contract.test.ts` (no edit expected — it auto-scans; run it as the gate)

**Interfaces:**

- Consumes: `listSessions`, `SESSIONS_DEFAULT_LIMIT` (Task 2).
- Produces: channel constant `CHANNELS.sessionsList === "sessions_list"`, request payload `{ limit }` (flat, R6), reply `SessionsSnapshot`.

- [ ] **Step 1: Add the channel constant**

In `electron/ipc/channels.ts`, directly after the `themesReveal` entry:

```ts
  // Session history. Electron-only like the blocks above: no `#[tauri::command]`
  // counterpart, and the renderer hides its control wherever this is
  // unanswered. Flat `{ limit }` per R6; the reply is
  // `electron/sessions/model.ts`'s `SessionsSnapshot`.
  sessionsList: "sessions_list",
```

- [ ] **Step 2: Add the handler**

In `electron/main.ts`, next to the `usageSnapshot` handler:

```ts
ipcMain.handle(CHANNELS.sessionsList, (_event, { limit }) =>
  listSessions(
    app.getPath("home"),
    typeof limit === "number" ? limit : undefined,
  ),
);
```

and the import beside the existing `./resume/resolve` import:

```ts
import { listSessions } from "./sessions/list";
```

- [ ] **Step 3: Run the contract gate**

Run: `npx vitest run scripts/electron-ipc-contract.test.ts`
Expected: PASS.

**Correction, 2026-08-16 (found in flight, `scripts/electron-ipc-contract.test.ts:239`):** an earlier draft of this plan claimed the test tolerates a call site whose handler does not exist yet. **It does not.** The `has a handler for every channel the renderer invokes` assertion collects every `invoke("…")` under `src/` and every `ipcMain.handle(…)` under `electron/` and asserts `expect(unhandled).toEqual([])` — no skip list, no not-yet-implemented allowance. The tolerance runs the other way: a HANDLER with no call site is fine, a CALL SITE with no handler fails.

**Ordering consequence — this is a hard constraint, not a preference:** `sessions_list` must exist in `electron/main.ts` before or in the same landing as `src/host/sessions-host.ts`. Task 4 can be *written* first, but the contract gate stays red until this task lands, so **Tasks 1 → 2 → 3 must complete before Task 4's Step 5 can pass**, and neither may be committed alone.

- [ ] **Step 4: Typecheck the main process**

Run: `npm run electron:build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/channels.ts electron/main.ts
git commit -m "feat(sessions): expose sessions_list over IPC"
```

---

### Task 4: Renderer wire types and host facade

**Files:**

- Create: `src/lib/session-history.ts`
- Create: `src/host/sessions-host.ts`
- Test: `src/host/sessions-host.test.ts`

**Interfaces:**

- Consumes: `CHANNELS.sessionsList` by string.
- Produces:
  - `src/lib/session-history.ts`: `SessionAgent`, `SessionEntry`, `SessionsSnapshot`, `EMPTY_SESSIONS_SNAPSHOT`, `SESSION_AGENTS`, `SESSIONS_DEFAULT_LIMIT` — the renderer mirror of `electron/sessions/model.ts`.
  - `src/host/sessions-host.ts`: `listSessions(limit: number): Promise<SessionsSnapshot | null>` — `null` means the host has no such channel.

- [ ] **Step 1: Write the failing test**

Create `src/host/sessions-host.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { listSessions } from "./sessions-host";
import * as bridge from "./bridge";
import { SESSIONS_DEFAULT_LIMIT } from "../lib/session-history";

afterEach(() => vi.restoreAllMocks());

describe("sessions-host", () => {
  it("sends a flat limit key", async () => {
    const invoke = vi.spyOn(bridge, "invoke").mockResolvedValue({
      entries: [],
      totals: { claude: 0, codex: 0 },
      limit: SESSIONS_DEFAULT_LIMIT,
    });
    await listSessions(SESSIONS_DEFAULT_LIMIT);
    expect(invoke).toHaveBeenCalledWith("sessions_list", {
      limit: SESSIONS_DEFAULT_LIMIT,
    });
  });

  it("answers null on a host without the channel instead of throwing", async () => {
    vi.spyOn(bridge, "invoke").mockRejectedValue(new Error("no handler"));
    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toBeNull();
  });

  it("answers null on a reply that is not a snapshot", async () => {
    vi.spyOn(bridge, "invoke").mockResolvedValue({ nope: true });
    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/host/sessions-host.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/session-history.ts`**

```ts
/**
 * Renderer mirror of `electron/sessions/model.ts`. Kept as its own module
 * (not an import across the boundary) for the same reason
 * `src/lib/usage-snapshot.ts` is: the renderer must build and typecheck with
 * no `electron/` on its path.
 */

export type SessionAgent = "claude" | "codex";

export const SESSION_AGENTS: readonly SessionAgent[] = Object.freeze([
  "claude",
  "codex",
]);

/** Display name per agent — sentence case naming a product (DL-4.3). */
export const SESSION_AGENT_LABELS: Readonly<Record<SessionAgent, string>> =
  Object.freeze({ claude: "Claude Code", codex: "Codex" });

export interface SessionEntry {
  readonly agent: SessionAgent;
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastActivityMs: number;
  readonly title: string | null;
  readonly sourcePath: string;
}

export interface SessionsSnapshot {
  readonly entries: readonly SessionEntry[];
  readonly totals: Readonly<Record<SessionAgent, number>>;
  readonly limit: number;
}

export const SESSIONS_DEFAULT_LIMIT = 500;

export const EMPTY_SESSIONS_SNAPSHOT: SessionsSnapshot = Object.freeze({
  entries: Object.freeze([]),
  totals: Object.freeze({ claude: 0, codex: 0 }),
  limit: SESSIONS_DEFAULT_LIMIT,
});

/** Validate an untyped IPC reply. A host that answers something else — Tauri,
 *  a stale build — is `unsupported`, never a crash. */
export function asSessionsSnapshot(raw: unknown): SessionsSnapshot | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (!Array.isArray(node.entries)) {
    return null;
  }
  const totals = node.totals;
  if (totals === null || typeof totals !== "object") {
    return null;
  }
  const entries: SessionEntry[] = [];
  for (const value of node.entries) {
    if (value === null || typeof value !== "object") {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (
      (entry.agent !== "claude" && entry.agent !== "codex") ||
      typeof entry.sessionId !== "string" ||
      typeof entry.cwd !== "string" ||
      typeof entry.lastActivityMs !== "number" ||
      typeof entry.sourcePath !== "string"
    ) {
      continue;
    }
    entries.push({
      agent: entry.agent,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      lastActivityMs: entry.lastActivityMs,
      title: typeof entry.title === "string" ? entry.title : null,
      sourcePath: entry.sourcePath,
    });
  }
  const counts = totals as Record<string, unknown>;
  return {
    entries,
    totals: {
      claude: typeof counts.claude === "number" ? counts.claude : 0,
      codex: typeof counts.codex === "number" ? counts.codex : 0,
    },
    limit: typeof node.limit === "number" ? node.limit : SESSIONS_DEFAULT_LIMIT,
  };
}
```

- [ ] **Step 4: Write `src/host/sessions-host.ts`**

```ts
/**
 * Session history list, over the host bridge.
 *
 * Fail-soft by contract: a host with no `sessions_list` handler (Tauri,
 * browser `npm run dev`) answers `null` rather than throwing, and the caller
 * treats that as "this host does not have session history" — the toolbar
 * control is then not rendered at all, so the screen is unreachable by
 * construction rather than reachable and empty.
 *
 * Flat `{ limit }` per R6; `scripts/electron-ipc-contract.test.ts` pins it.
 */
import { invoke } from "./bridge";
import {
  asSessionsSnapshot,
  type SessionsSnapshot,
} from "../lib/session-history";

export async function listSessions(
  limit: number,
): Promise<SessionsSnapshot | null> {
  try {
    const raw = await invoke<unknown>("sessions_list", { limit });
    return asSessionsSnapshot(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the tests and the contract gate**

Run: `npx vitest run src/host/sessions-host.test.ts scripts/electron-ipc-contract.test.ts`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/session-history.ts src/host/sessions-host.ts src/host/sessions-host.test.ts
git commit -m "feat(sessions): add the renderer wire types and host facade"
```

---

### Task 5: Pure filter helpers

**Files:**

- Create: `src/sessions/session-filters.ts`
- Test: `src/sessions/session-filters.test.ts`

**Interfaces:**

- Consumes: `SessionEntry`, `SessionAgent` (Task 4).
- Produces:
  - `type AgentFilter = SessionAgent | "all"`
  - `filterSessions(entries, { agent: AgentFilter, project: string | null }): readonly SessionEntry[]`
  - `distinctProjects(entries): readonly string[]` — sorted by most-recent activity, then path.
  - `cappedAgents(totals, limit): readonly SessionAgent[]` — agents whose candidate count exceeded the cap.

- [ ] **Step 1: Write the failing test**

Create `src/sessions/session-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cappedAgents,
  distinctProjects,
  filterSessions,
} from "./session-filters";
import type { SessionEntry } from "../lib/session-history";

function entry(over: Partial<SessionEntry>): SessionEntry {
  return {
    agent: "claude",
    sessionId: "id",
    cwd: "/work/a",
    lastActivityMs: 0,
    title: null,
    sourcePath: "/p",
    ...over,
  };
}

describe("filterSessions", () => {
  const entries = [
    entry({
      sessionId: "1",
      agent: "claude",
      cwd: "/work/a",
      lastActivityMs: 30,
    }),
    entry({
      sessionId: "2",
      agent: "codex",
      cwd: "/work/a",
      lastActivityMs: 20,
    }),
    entry({
      sessionId: "3",
      agent: "codex",
      cwd: "/work/b",
      lastActivityMs: 10,
    }),
  ];

  it("passes everything through on all/null", () => {
    expect(
      filterSessions(entries, { agent: "all", project: null }),
    ).toHaveLength(3);
  });

  it("filters by agent", () => {
    const out = filterSessions(entries, { agent: "codex", project: null });
    expect(out.map((e) => e.sessionId)).toEqual(["2", "3"]);
  });

  it("composes agent and project", () => {
    const out = filterSessions(entries, { agent: "codex", project: "/work/a" });
    expect(out.map((e) => e.sessionId)).toEqual(["2"]);
  });

  it("returns the same array instance semantics, never mutating the input", () => {
    const before = [...entries];
    filterSessions(entries, { agent: "claude", project: null });
    expect(entries).toEqual(before);
  });
});

describe("distinctProjects", () => {
  it("lists each cwd once, most recently active first", () => {
    const out = distinctProjects([
      entry({ cwd: "/work/b", lastActivityMs: 10 }),
      entry({ cwd: "/work/a", lastActivityMs: 30 }),
      entry({ cwd: "/work/b", lastActivityMs: 40 }),
    ]);
    expect(out).toEqual(["/work/b", "/work/a"]);
  });
});

describe("cappedAgents", () => {
  it("names only the agents whose candidates exceeded the cap", () => {
    expect(cappedAgents({ claude: 900, codex: 12 }, 500)).toEqual(["claude"]);
    expect(cappedAgents({ claude: 4, codex: 12 }, 500)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sessions/session-filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/sessions/session-filters.ts`**

```ts
/**
 * Pure derivations over the session list. No signals here on purpose: the
 * store owns state, this file owns the arithmetic, and the arithmetic is what
 * the tests care about.
 */
import {
  SESSION_AGENTS,
  type SessionAgent,
  type SessionEntry,
} from "../lib/session-history";

export type AgentFilter = SessionAgent | "all";

export interface SessionFilterState {
  readonly agent: AgentFilter;
  /** Exact cwd, or null for every project. */
  readonly project: string | null;
}

export function filterSessions(
  entries: readonly SessionEntry[],
  filters: SessionFilterState,
): readonly SessionEntry[] {
  return entries.filter(
    (entry) =>
      (filters.agent === "all" || entry.agent === filters.agent) &&
      (filters.project === null || entry.cwd === filters.project),
  );
}

/** Each cwd once, ordered by the most recent session that used it. */
export function distinctProjects(
  entries: readonly SessionEntry[],
): readonly string[] {
  const newest = new Map<string, number>();
  for (const entry of entries) {
    const seen = newest.get(entry.cwd);
    if (seen === undefined || entry.lastActivityMs > seen) {
      newest.set(entry.cwd, entry.lastActivityMs);
    }
  }
  return [...newest.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([cwd]) => cwd);
}

/** Agents that had more transcripts than the enrichment cap read — the ones
 *  the "showing latest N" notice must name (spec §3.2). */
export function cappedAgents(
  totals: Readonly<Record<string, number>>,
  limit: number,
): readonly SessionAgent[] {
  return SESSION_AGENTS.filter((agent) => (totals[agent] ?? 0) > limit);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sessions/session-filters.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/sessions/session-filters.ts src/sessions/session-filters.test.ts
git commit -m "feat(sessions): add pure filter and cap derivations"
```

---

### Task 6: Client seam and signal store

**Files:**

- Create: `src/sessions/sessions-client.ts`
- Create: `src/sessions/sessions-store.ts`
- Test: `src/sessions/sessions-store.test.ts`

**Interfaces:**

- Consumes: `listSessions` (Task 4), `SessionFilterState`, `AgentFilter` (Task 5), `defaultPtyClient.dirsExist` for the liveness pass.
- Produces:
  - `interface SessionsClient { list(limit: number): Promise<SessionsSnapshot | null>; dirsExist(paths: readonly string[]): Promise<readonly boolean[]> }`
  - `createHostSessionsClient()`, `createMemorySessionsClient(snapshot, options)`
  - signals: `sessionEntries`, `sessionTotals`, `sessionLimit`, `sessionsLoading`, `sessionsSupported`, `sessionAgentFilter`, `sessionProjectFilter`, `deadProjects`
  - `refreshSessions(client?): Promise<void>`, `probeSessionsSupport(client?): Promise<void>` (added by Task 10's boot probe), `resetSessionFilters(): void`

- [ ] **Step 1: Write the failing test**

Create `src/sessions/sessions-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionsClient } from "./sessions-client";
import {
  deadProjects,
  refreshSessions,
  resetSessionFilters,
  sessionAgentFilter,
  sessionEntries,
  sessionsLoading,
  sessionsSupported,
  sessionTotals,
} from "./sessions-store";
import type { SessionEntry } from "../lib/session-history";

function entry(over: Partial<SessionEntry>): SessionEntry {
  return {
    agent: "claude",
    sessionId: "id",
    cwd: "/work/a",
    lastActivityMs: 1,
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

beforeEach(() => {
  sessionEntries.value = [];
  sessionsSupported.value = true;
  deadProjects.value = new Set();
  resetSessionFilters();
});

describe("refreshSessions", () => {
  it("stores entries and totals from one scan", async () => {
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "a" })],
        totals: { claude: 900, codex: 3 },
        limit: 500,
      }),
    );
    expect(sessionEntries.value.map((e) => e.sessionId)).toEqual(["a"]);
    expect(sessionTotals.value.claude).toBe(900);
    expect(sessionsLoading.value).toBe(false);
  });

  it("marks the host unsupported when the facade answers null", async () => {
    await refreshSessions(createMemorySessionsClient(null));
    expect(sessionsSupported.value).toBe(false);
    expect(sessionEntries.value).toEqual([]);
  });

  it("records the cwds that no longer exist", async () => {
    await refreshSessions(
      createMemorySessionsClient(
        {
          entries: [
            entry({ sessionId: "a", cwd: "/gone" }),
            entry({ sessionId: "b", cwd: "/here" }),
          ],
          totals: { claude: 2, codex: 0 },
          limit: 500,
        },
        { alive: (path) => path === "/here" },
      ),
    );
    expect([...deadProjects.value]).toEqual(["/gone"]);
  });

  it("keeps the previous list when a scan throws", async () => {
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "a" })],
        totals: { claude: 1, codex: 0 },
        limit: 500,
      }),
    );
    await refreshSessions(createMemorySessionsClient(null, { fail: true }));
    expect(sessionEntries.value.map((e) => e.sessionId)).toEqual(["a"]);
  });

  it("resets filters that no longer match anything", () => {
    sessionAgentFilter.value = "codex";
    resetSessionFilters();
    expect(sessionAgentFilter.value).toBe("all");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sessions/sessions-store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/sessions/sessions-client.ts`**

```ts
/**
 * Scanner seam — real IPC in production, fakes in tests. Mirrors
 * `src/usage/usage-client.ts`, including the reason it exists: the store must
 * be unit-testable with no host bridge at all.
 */
import { listSessions } from "../host/sessions-host";
import { defaultPtyClient } from "../terminal/pty-client";
import type { SessionsSnapshot } from "../lib/session-history";

export interface SessionsClient {
  /** `null` means this host has no session history (Tauri, browser dev). */
  list(limit: number): Promise<SessionsSnapshot | null>;
  /** Liveness for the resume guard — same `dirs_exist` the boot restore uses. */
  dirsExist(paths: readonly string[]): Promise<readonly boolean[]>;
}

export function createHostSessionsClient(): SessionsClient {
  return {
    list: (limit) => listSessions(limit),
    dirsExist: (paths) => defaultPtyClient.dirsExist(paths),
  };
}

export function createMemorySessionsClient(
  snapshot: SessionsSnapshot | null,
  options: {
    readonly fail?: boolean;
    readonly alive?: (path: string) => boolean;
  } = {},
): SessionsClient {
  return {
    async list() {
      if (options.fail === true) {
        throw new Error("sessions_list failed");
      }
      return snapshot;
    },
    async dirsExist(paths) {
      return paths.map((path) => options.alive?.(path) ?? true);
    },
  };
}

export const defaultSessionsClient: SessionsClient = createHostSessionsClient();
```

- [ ] **Step 4: Write `src/sessions/sessions-store.ts`**

```ts
/**
 * Session history state. Window-scoped module store (R5).
 *
 * Deliberately NOT a poll. The usage screen polls because its numbers move
 * while you look at them; a history list does not — the spec is scan-on-open,
 * re-stat on re-open, and the main-process cache makes the second open cheap.
 * A 5 s poll here would re-read up to 1000 transcript heads for nothing.
 */
import { signal } from "@preact/signals";
import { defaultSessionsClient, type SessionsClient } from "./sessions-client";
import type { AgentFilter } from "./session-filters";
import {
  SESSIONS_DEFAULT_LIMIT,
  type SessionAgent,
  type SessionEntry,
} from "../lib/session-history";

export const sessionEntries = signal<readonly SessionEntry[]>([]);
export const sessionTotals = signal<Readonly<Record<SessionAgent, number>>>({
  claude: 0,
  codex: 0,
});
export const sessionLimit = signal(SESSIONS_DEFAULT_LIMIT);

/** A cold scan is running and there is nothing yet to show. */
export const sessionsLoading = signal(false);

/**
 * False once the facade has answered `null` — this host has no
 * `sessions_list`. The toolbar control reads it and renders nothing, so the
 * screen is unreachable rather than reachable and empty.
 */
export const sessionsSupported = signal(true);

/** cwds that no longer exist on disk; their rows cannot resume (spec §4). */
export const deadProjects = signal<ReadonlySet<string>>(new Set());

export const sessionAgentFilter = signal<AgentFilter>("all");
export const sessionProjectFilter = signal<string | null>(null);

export function resetSessionFilters(): void {
  sessionAgentFilter.value = "all";
  sessionProjectFilter.value = null;
}

/** Bumped by every refresh; a reply from a superseded one is dropped. */
let generation = 0;

export async function refreshSessions(
  client: SessionsClient = defaultSessionsClient,
): Promise<void> {
  generation += 1;
  const forGeneration = generation;
  if (sessionEntries.value.length === 0) {
    sessionsLoading.value = true;
  }
  try {
    const snapshot = await client.list(SESSIONS_DEFAULT_LIMIT);
    if (forGeneration !== generation) {
      return;
    }
    if (snapshot === null) {
      sessionsSupported.value = false;
      sessionEntries.value = [];
      return;
    }
    sessionsSupported.value = true;
    sessionEntries.value = snapshot.entries;
    sessionTotals.value = snapshot.totals;
    sessionLimit.value = snapshot.limit;
    const projects = [...new Set(snapshot.entries.map((entry) => entry.cwd))];
    const alive = await client.dirsExist(projects);
    if (forGeneration !== generation) {
      return;
    }
    deadProjects.value = new Set(
      projects.filter((_, index) => alive[index] !== true),
    );
  } catch (error: unknown) {
    // Keep whatever is on screen. Blanking it would turn one failed scan into
    // "you have no sessions", which is a lie — the same rule usage-store
    // states for its own failure path.
    console.warn("sessions_list failed:", error);
  } finally {
    if (forGeneration === generation) {
      sessionsLoading.value = false;
    }
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/sessions/sessions-store.test.ts`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add src/sessions/sessions-client.ts src/sessions/sessions-store.ts src/sessions/sessions-store.test.ts
git commit -m "feat(sessions): add the client seam and signal store"
```

---

### Task 7: Resume a session into a new tab

**Files:**

- Create: `src/sessions/resume-session.ts`
- Test: `src/sessions/resume-session.test.ts`

**Interfaces:**

- Consumes: `buildResumeCommand` (`src/lib/agent-resume.ts`), `MaterializeIntent` (`src/terminal/tab-materialize.ts`), `BUILT_IN_PRESET`, `SessionEntry` (Task 4), `deadProjects` (Task 6).
- Produces: `resumeSession(entry, deps): Promise<boolean>` where
  `deps = { materialize(intent: MaterializeIntent): Promise<boolean>; customAgents: readonly CustomAgent[]; isDead(cwd: string): boolean }`.

**Do not touch `tab-materialize.ts` or `TabManager.materialize`.** `paneCommands` already exists and already carries a per-pane command line; this task is a caller.

- [ ] **Step 1: Write the failing test**

Create `src/sessions/resume-session.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resumeSession } from "./resume-session";
import type { SessionEntry } from "../lib/session-history";
import type { MaterializeIntent } from "../terminal/tab-materialize";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "8f0f0e2c-1111-2222-3333-444455556666",
    cwd: "/work/repo",
    lastActivityMs: 1,
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

function deps(over: Partial<Parameters<typeof resumeSession>[1]> = {}) {
  return {
    materialize: vi
      .fn<(intent: MaterializeIntent) => Promise<boolean>>()
      .mockResolvedValue(true),
    customAgents: [],
    isDead: () => false,
    ...over,
  };
}

describe("resumeSession", () => {
  it("materializes one pane in the session's own cwd with its resume command", async () => {
    const d = deps();
    await expect(resumeSession(entry(), d)).resolves.toBe(true);
    const intent = vi.mocked(d.materialize).mock.calls[0][0];
    expect(intent.cwds).toEqual(["/work/repo"]);
    expect(intent.paneCommands).toEqual([
      "claude --resume 8f0f0e2c-1111-2222-3333-444455556666",
    ]);
    expect(intent.workspacePath).toBe("/work/repo");
    expect(intent.agent).toBeUndefined();
  });

  it("uses codex's own resume form", async () => {
    const d = deps();
    await resumeSession(entry({ agent: "codex", sessionId: "abc123" }), d);
    expect(d.materialize.mock.calls[0][0].paneCommands).toEqual([
      "codex resume abc123",
    ]);
  });

  // A dead cwd landing in $HOME is worse than not resuming (spec §4).
  it("refuses to spawn when the recorded directory is gone", async () => {
    const d = deps({ isDead: () => true });
    await expect(resumeSession(entry(), d)).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it("refuses a session id that fails the PTY-safe pattern", async () => {
    const d = deps();
    await expect(
      resumeSession(entry({ sessionId: "a; rm -rf /" }), d),
    ).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sessions/resume-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/sessions/resume-session.ts`**

```ts
/**
 * A history row's one action: open a single-pane tab in the session's own
 * directory and type that CLI's exact resume command.
 *
 * Two seams are reused rather than rebuilt, deliberately:
 * - `buildResumeCommand` is the ONE place a scanned session id is checked
 *   against `SESSION_REF_SAFE` before it can reach a PTY write. A second
 *   builder here would fork that check, which is a security boundary.
 * - `MaterializeIntent.paneCommands` already carries a per-pane command line
 *   (session restore, 2026-08-15). Nothing in tab materialization changes for
 *   this feature — it is a caller of an existing seam, not a widening of it.
 */
import { buildResumeCommand } from "../lib/agent-resume";
import type { CustomAgent } from "../lib/agent-catalog";
import { BUILT_IN_PRESET } from "../lib/preset-schema";
import type { SessionEntry } from "../lib/session-history";
import type { MaterializeIntent } from "../terminal/tab-materialize";

export interface ResumeSessionDeps {
  materialize(intent: MaterializeIntent): Promise<boolean>;
  readonly customAgents: readonly CustomAgent[];
  /** True when the session's recorded cwd no longer exists on disk. */
  isDead(cwd: string): boolean;
}

export async function resumeSession(
  entry: SessionEntry,
  deps: ResumeSessionDeps,
): Promise<boolean> {
  // Checked BEFORE spawn: Deck must not inherit the silent
  // dead-cwd-lands-in-$HOME behaviour here. Resuming a conversation in the
  // wrong directory is worse than not resuming it (spec §4).
  if (deps.isDead(entry.cwd)) {
    return false;
  }
  const command = buildResumeCommand(
    entry.agent,
    { kind: "id", id: entry.sessionId },
    deps.customAgents,
  );
  // `buildResumeCommand` degrades an unsafe id to the BARE agent command. A
  // bare `claude` here would silently open a NEW conversation while the user
  // asked to resume an old one, so this path refuses instead.
  //
  // The empty-string arm is not redundant, it is the hole the containment
  // check alone leaves open: `""` fails SESSION_REF_SAFE (`{1,128}`) so the
  // command degrades to bare `claude`, and `"claude".includes("")` is `true`
  // for EVERY JavaScript string — the refusal would pass and the pane would
  // start a fresh conversation. Found and closed 2026-08-16; proven
  // load-bearing by mutation (drop this line and the suite goes 1 failed).
  if (
    command === null ||
    entry.sessionId === "" ||
    !command.includes(entry.sessionId)
  ) {
    return false;
  }
  return deps.materialize({
    layout: BUILT_IN_PRESET.layout,
    cwds: [entry.cwd],
    paneCommands: [command],
    workspacePath: entry.cwd,
  });
}
```

`BUILT_IN_PRESET` lives in [`src/lib/preset-schema.ts`](../../src/lib/preset-schema.ts) — verified 2026-08-16; an earlier draft of this plan said `src/lib/layout-presets`, which does not exist. `tab-manager.ts:22` imports it from the same place and `openQuickAgent` uses the same `BUILT_IN_PRESET.layout`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sessions/resume-session.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/sessions/resume-session.ts src/sessions/resume-session.test.ts
git commit -m "feat(sessions): resume a past session into a new single-pane tab"
```

---

### Task 8: Overlay wiring — `sessionsOpen` as a third full-window surface

**Files:**

- Modify: `src/chrome/events.ts`
- Modify: `src/terminal/tab-manager.ts` (`openOverlayRanks` only)
- Modify: `src/ui/attention-focus-coordinator.ts`
- Modify: `src/ui/app.tsx`
- Test: `src/terminal/tab-manager.test.ts` (append), `src/ui/app.test.tsx` (append)

**Interfaces:**

- Produces: `sessionsOpen` signal; `toggleSessionsPanel(focusActive)`, `closeSessionsPanel(focusActive)` exported from `src/ui/app.tsx` beside the usage pair.

This is the one R4 touch in the plan. It lands with its tests in this task.

- [ ] **Step 1: Write the failing tests**

Append to `src/terminal/tab-manager.test.ts`:

```ts
it("blocks pane-tiered actions while the sessions screen is open", () => {
  sessionsOpen.value = true;
  try {
    expect(overlayBlocksActionForTest("close-pane")).toBe(true);
  } finally {
    sessionsOpen.value = false;
  }
});
```

Use whatever accessor the neighbouring `usageOpen` block in that file already uses; copy that test verbatim and swap the signal — do not invent a new seam.

Append to `src/ui/app.test.tsx`, mirroring the existing Settings/Usage mutual-exclusion test:

```ts
it("opening sessions closes settings and usage", () => {
  settingsOpen.value = true;
  usageOpen.value = true;
  toggleSessionsPanel(() => {});
  expect(settingsOpen.value).toBe(false);
  expect(usageOpen.value).toBe(false);
  expect(sessionsOpen.value).toBe(true);
  sessionsOpen.value = false;
});

it("opening usage closes sessions", () => {
  sessionsOpen.value = true;
  toggleUsagePanel(() => {});
  expect(sessionsOpen.value).toBe(false);
  usageOpen.value = false;
});

it("opening settings closes sessions", () => {
  sessionsOpen.value = true;
  openSettingsPanel(() => {});
  expect(sessionsOpen.value).toBe(false);
  settingsOpen.value = false;
});
```

Use the exact exported names `app.tsx` already has for the settings/usage toggles.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/app.test.tsx src/terminal/tab-manager.test.ts`
Expected: FAIL — `sessionsOpen` / `toggleSessionsPanel` are not exported.

- [ ] **Step 3: Add the signal**

In `src/chrome/events.ts`, directly after `usageOpen`:

```ts
/**
 * Session history screen open state.
 *
 * The third full-window surface, and it obeys the same two rules the other
 * two do: it is pushed by `openOverlayRanks()` (tab-manager.ts) so no
 * pane-scoped shortcut stays live behind it, and it is mutually exclusive
 * with Settings and Usage — opening any one of the three closes the other
 * two. Same rank as those two (`TIER_RANK.settings`): it covers the grid the
 * same way, so it wants the same comparison, and a fourth tier nothing is
 * tiered at would explain nothing.
 */
export const sessionsOpen = signal(false);
```

- [ ] **Step 4: Push it into the overlay ranks**

In `src/terminal/tab-manager.ts`, extend the existing condition:

```ts
if (settingsOpen.value || usageOpen.value || sessionsOpen.value) {
  ranks.push(TIER_RANK.settings);
}
```

Amend that function's doc comment to name three surfaces instead of two.

- [ ] **Step 5: Wire the three-way exclusion in `src/ui/app.tsx`**

Add, next to the usage pair:

```ts
/** Pure Sessions-close: sets `sessionsOpen` false and hands focus back. */
export function closeSessionsPanel(focusActive: () => void): void {
  sessionsOpen.value = false;
  focusActive();
}

/**
 * Session-history toggle — shared by the toolbar control and nothing else in
 * v1 (no shortcut, no menu item: spec §3.1). Closing Sessions does not put
 * whatever was open before back, the same rule Usage states for itself.
 */
export function toggleSessionsPanel(focusActive: () => void): void {
  if (sessionsOpen.value) {
    closeSessionsPanel(focusActive);
    return;
  }
  settingsOpen.value = false;
  usageOpen.value = false;
  sessionsOpen.value = true;
}
```

In `openSettingsPanel` and `toggleUsagePanel`, add the mirror line `sessionsOpen.value = false;` beside their existing bare set-states, with the same "a bare set-state, not the closer" comment reason.

Add `sessionsOpen.value ||` to the popover-suppression disjunction that already lists `settingsOpen.value || usageOpen.value` (around `app.tsx:1072`) — the sessions screen is full-bleed over the stage for the same reason.

In `requestAttentionFocus`'s `overlays` bag add `sessions: sessionsOpen.value`, and add the matching non-focusing dismiss:

```ts
      dismissSessions: () => {
        sessionsOpen.value = false;
      },
```

In `src/ui/attention-focus-coordinator.ts`, add `readonly sessions: boolean` to the overlays type and `dismissSessions(): void` to the deps, and dismiss it wherever `dismissUsage` is called.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/ui/app.test.tsx src/terminal/tab-manager.test.ts src/ui/attention-focus-coordinator.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/chrome/events.ts src/terminal/tab-manager.ts src/terminal/tab-manager.test.ts src/ui/attention-focus-coordinator.ts src/ui/attention-focus-coordinator.test.ts src/ui/app.tsx src/ui/app.test.tsx
git commit -m "feat(sessions): add sessionsOpen as the third full-window overlay"
```

---

### Task 9: The screen — shell, rail, list, rows

**Files:**

- Create: `src/ui/sessions/sessions-screen.tsx`
- Create: `src/ui/sessions/sessions-nav.tsx`
- Create: `src/ui/sessions/session-row.tsx`
- Create: `src/ui/sessions/sessions-list.tsx`
- Modify: `src/styles.css`
- Modify: `src/ui/app.tsx` (mount)
- Test: `src/ui/sessions/sessions-screen.test.tsx`, `src/ui/sessions/session-row.test.tsx`

**Interfaces:**

- Consumes: every signal from Task 6, the helpers from Task 5, `resumeSession` from Task 7.
- Produces: `<SessionsScreen open onClose onResume client? />` where `onResume(entry: SessionEntry): void` and `client` is an optional `SessionsClient` override — production omits it, tests must pass one (the open-effect scans, and a real scan resolving mid-test rewrites the store under the next test).

DL citations required in code comments: DL-11.1 (two-column shell), DL-11.2 (rail selection wash), DL-11.3 (rail icons through `DeckIcon` at 16px), DL-11.4 (sentence-case rail labels), DL-11.5 (no foot — this screen has no destructive action), DL-23.6 (unavailable is not disabled — the dead-cwd row), and §25 once Task 11 lands.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/sessions/session-row.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { SessionRow } from "./session-row";
import type { SessionEntry } from "../../lib/session-history";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "sid",
    cwd: "/Users/me/work/repo",
    lastActivityMs: Date.now() - 60_000,
    title: "make the thing work",
    sourcePath: "/p",
    ...over,
  };
}

describe("SessionRow", () => {
  it("shows the title, the agent and the project", () => {
    render(
      <SessionRow
        entry={entry()}
        dead={false}
        homeDir="/Users/me"
        onResume={() => {}}
      />,
    );
    expect(screen.getByText("make the thing work")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("~/work/repo")).toBeTruthy();
  });

  it("falls back to the session id when no title was found", () => {
    render(
      <SessionRow
        entry={entry({ title: null })}
        dead={false}
        homeDir="/Users/me"
        onResume={() => {}}
      />,
    );
    expect(screen.getByText("sid")).toBeTruthy();
  });

  it("resumes on click", () => {
    const onResume = vi.fn();
    render(
      <SessionRow
        entry={entry()}
        dead={false}
        homeDir="/Users/me"
        onResume={onResume}
      />,
    );
    screen.getByRole("button").click();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  // DL-23.6: unavailable keeps its place in the tab order and says why.
  it("stays focusable but does not resume when the directory is gone", () => {
    const onResume = vi.fn();
    render(
      <SessionRow
        entry={entry()}
        dead
        homeDir="/Users/me"
        onResume={onResume}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(false);
    button.click();
    expect(onResume).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
  });
});
```

Create `src/ui/sessions/sessions-screen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionsScreen } from "./sessions-screen";
import {
  deadProjects,
  sessionAgentFilter,
  sessionEntries,
  sessionLimit,
  sessionsLoading,
  sessionsSupported,
  sessionTotals,
} from "../../sessions/sessions-store";
import { createMemorySessionsClient } from "../../sessions/sessions-client";
import type { SessionEntry } from "../../lib/session-history";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "sid",
    cwd: "/work/repo",
    lastActivityMs: 1,
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

beforeEach(() => {
  sessionEntries.value = [];
  sessionTotals.value = { claude: 0, codex: 0 };
  sessionLimit.value = 500;
  sessionsLoading.value = false;
  sessionsSupported.value = true;
  deadProjects.value = new Set();
  sessionAgentFilter.value = "all";
});

/**
 * Every render must pass a fake client. `SessionsScreen`'s open-effect scans,
 * and with the real client that scan resolves `null` on a test host and
 * asynchronously clears `sessionEntries` / `sessionsSupported` in the middle
 * of whichever test is running next.
 */
const quiet = createMemorySessionsClient({
  entries: [],
  totals: { claude: 0, codex: 0 },
  limit: 500,
});

describe("SessionsScreen", () => {
  it("says where Deck looked when nothing was found", () => {
    render(
      <SessionsScreen
        open
        client={quiet}
        onClose={() => {}}
        onResume={() => {}}
      />,
    );
    expect(screen.getByText(/no sessions/i)).toBeTruthy();
  });

  it("names the agent whose candidates exceeded the cap", () => {
    sessionEntries.value = [entry()];
    sessionTotals.value = { claude: 900, codex: 2 };
    render(
      <SessionsScreen
        open
        client={quiet}
        onClose={() => {}}
        onResume={() => {}}
      />,
    );
    expect(screen.getByText(/showing latest 500/i)).toBeTruthy();
  });

  it("filters the list from the rail", () => {
    sessionEntries.value = [
      entry({ sessionId: "c", agent: "claude", title: "from claude" }),
      entry({ sessionId: "x", agent: "codex", title: "from codex" }),
    ];
    sessionAgentFilter.value = "codex";
    render(
      <SessionsScreen
        open
        client={quiet}
        onClose={() => {}}
        onResume={() => {}}
      />,
    );
    expect(screen.queryByText("from claude")).toBeNull();
    expect(screen.getByText("from codex")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/sessions/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/ui/sessions/session-row.tsx`**

```tsx
import { Bot, FolderX, Terminal } from "lucide-preact";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { tildify } from "../../lib/process-info";
import { formatRelativeTime } from "../../lib/workspace-recents";
import {
  SESSION_AGENT_LABELS,
  type SessionEntry,
} from "../../lib/session-history";

const AGENT_ICON = { claude: Bot, codex: Terminal } as const;

interface SessionRowProps {
  readonly entry: SessionEntry;
  /** The recorded directory no longer exists; this row cannot resume. */
  readonly dead: boolean;
  readonly homeDir: string;
  onResume(entry: SessionEntry): void;
}

/**
 * One past session, DL §25: the whole row is the control, and its four parts
 * always appear in the same order — agent, title, project, time.
 *
 * A dead row follows DL-23.6 rather than `disabled`: it keeps its place in the
 * tab order and carries its reason in an accessible description, because a
 * reason nobody can reach by keyboard is not a reason.
 */
export function SessionRow({
  entry,
  dead,
  homeDir,
  onResume,
}: SessionRowProps) {
  const Icon = AGENT_ICON[entry.agent];
  const reasonId = dead ? `session-gone-${entry.sessionId}` : undefined;
  return (
    <li class="session-row__slot">
      <button
        type="button"
        class={`session-row ${dead ? "is-unavailable" : ""}`}
        aria-describedby={reasonId}
        onClick={() => {
          if (!dead) {
            onResume(entry);
          }
        }}
      >
        <DeckIcon
          icon={dead ? FolderX : Icon}
          size={ROW_ICON}
          class="session-row__ico"
        />
        <span class="session-row__body">
          <span class="session-row__title">
            {entry.title ?? entry.sessionId}
          </span>
          <span class="session-row__meta">
            <span class="session-row__agent">
              {SESSION_AGENT_LABELS[entry.agent]}
            </span>
            <span class="session-row__path">
              {homeDir === "" ? entry.cwd : tildify(entry.cwd, homeDir)}
            </span>
            <span class="session-row__time">
              {formatRelativeTime(entry.lastActivityMs, Date.now())}
            </span>
          </span>
        </span>
        {dead ? (
          <span id={reasonId} class="session-row__gone">
            folder is gone
          </span>
        ) : null}
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Write `src/ui/sessions/sessions-nav.tsx`**

Copy `src/ui/usage/usage-nav.tsx` verbatim and swap its content: the items are `All sessions`, `Claude Code`, `Codex` (DL-11.4 sentence case, product names keep their capitals per the 2026-08-15 casing fork); the signal it writes is `sessionAgentFilter`; each item's count comes from `filterSessions(sessionEntries.value, { agent, project: null }).length`. Keep the `role="tablist"` semantics, the `↑`/`↓` wraparound and the "there is no foot" comment (DL-11.5).

- [ ] **Step 5: Write `src/ui/sessions/sessions-list.tsx`**

The section body: a project `<select>` built from `distinctProjects`, the `<ul>` of `SessionRow`s built from `filterSessions`, the cap notice from `cappedAgents` ("showing latest 500 of 912 for Claude Code"), the loading state, and the empty state naming where Deck looked (`~/.claude/projects`, `~/.codex/sessions`). Copy is sentence case (DL §8).

- [ ] **Step 6: Write `src/ui/sessions/sessions-screen.tsx`**

Copy the shell of `src/ui/usage/usage-screen.tsx` exactly — `open` prop, mount-focus with `preventScroll`, the Escape handler with its `.xterm` guard and blur-first rule, `aria-hidden={!open}`, the `usage-screen__head` / `__grid` / `__section` structure. Three differences, all commented:

- the scan effect calls `void refreshSessions(client)` once per open, with **no interval** (see the store's own comment for why);
- the props carry an optional `client?: SessionsClient` that the effect forwards. Production never passes it; tests always do. Without the seam a test render kicks off a real scan whose `null` reply lands after the test finished and rewrites the module store under the next one;
- the head reads `~/deck/sessions` and the scope line reads `this machine, this user`.

- [ ] **Step 7: Style it**

Add a `.sessions-screen` block to `src/styles.css` beside the `/* ── Usage screen` block at line ~4224, reusing the same tokens. Add the new selectors to the motion-suppression list at line ~2600 the way `.usage-screen` is listed there.

- [ ] **Step 8: Mount it**

In `src/ui/app.tsx`, beside `<UsageScreen … />`:

```tsx
<SessionsScreen
  open={sessionsOpen.value}
  onClose={closeSessions}
  onResume={resumeSessionEntry}
/>
```

with

```tsx
const closeSessions = (): void => {
  closeSessionsPanel(restoreFocusAfterSettings);
};

/** Row click → a new tab. Closes the screen first: the tab it opens is
 *  behind it, and a surface covering the thing you just asked for is not a
 *  result. */
const resumeSessionEntry = (entry: SessionEntry): void => {
  closeSessions();
  void resumeSession(entry, {
    materialize: (intent) =>
      tabsRef.current?.materialize(intent) ?? Promise.resolve(false),
    customAgents: settings.value.customAgents,
    isDead: (cwd) => deadProjects.value.has(cwd),
  });
};
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/ui/sessions/ src/ui/app.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/ui/sessions/ src/styles.css src/ui/app.tsx
git commit -m "feat(ui): add the session history screen"
```

---

### Task 10: Toolbar control and the Open board block

**Files:**

- Modify: `src/ui/toolbar/deck-toolbar.tsx`
- Modify: `src/ui/toolbar/deck-toolbar.test.tsx`
- Modify: `src/ui/app.tsx` (pass the two new props)
- Modify: `src/open-board/open-board-home.tsx`
- Test: `src/open-board/open-board-home.test.tsx` (create if absent)

**Interfaces:**

- Consumes: `toggleSessionsPanel` (Task 8), `sessionsSupported`, `sessionEntries`, `deadProjects` (Task 6), `resumeSession` (Task 7).
- Produces: `DeckToolbarProps` gains `readonly sessionsOpen: boolean`, `readonly sessionsAvailable: boolean`, `onToggleSessions(): void`; `OpenBoardHomeProps` gains `readonly recentSessions: readonly SessionEntry[]` and `onResumeSession(entry: SessionEntry): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/toolbar/deck-toolbar.test.tsx` (following the file's existing render helper):

```tsx
it("renders no history control on a host without session history", () => {
  renderToolbar({ sessionsAvailable: false });
  expect(screen.queryByRole("button", { name: /session history/i })).toBeNull();
});

it("renders the history control when the host supports it", () => {
  renderToolbar({ sessionsAvailable: true });
  expect(screen.getByRole("button", { name: /session history/i })).toBeTruthy();
});
```

Create `src/open-board/open-board-home.test.tsx` with:

```tsx
it("lists at most five recent sessions for the selected workspace", () => {
  // render OpenBoardHome with six entries under /work/repo
  expect(screen.getAllByRole("button", { name: /resume/i })).toHaveLength(5);
});

it("renders no recent-sessions block when there are none", () => {
  expect(screen.queryByText(/recent sessions/i)).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/toolbar/deck-toolbar.test.tsx src/open-board/open-board-home.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the toolbar control**

In `src/ui/toolbar/deck-toolbar.tsx`, add above the `toggle-usage` item:

```tsx
    // No registry action and no chord: v1 ships the screen icon-only (spec
    // §3.1), and `ToolbarItem.id` is a plain string, so the label is written
    // here instead of projected through `toolbarLabel`. Sentence case, DL-23.2.
    // Omitted entirely on a host with no `sessions_list` — an icon that opens
    // an empty screen is worse than no icon.
    ...(props.sessionsAvailable
      ? [
          {
            id: "toggle-sessions",
            label: "Session history",
            icon: History,
            group: "tools",
            shortcut: null,
            state: props.sessionsOpen ? ACTIVE : IDLE,
            // Leaves the bar before Usage: both are screens, and this one is
            // the newer, less-reached-for of the two.
            overflowOrder: 0,
            toggles: "pressed",
            onActivate: props.onToggleSessions,
          } satisfies ToolbarItem,
        ]
      : []),
```

Import `History` from `lucide-preact` and extend `DeckToolbarProps`. Amend the file's header comment: it currently narrates which groups grew and when — add the one-line history entry the way Explorer's was added.

- [ ] **Step 4: Pass the props from `app.tsx`**

```tsx
      sessionsOpen={sessionsOpen.value}
      sessionsAvailable={sessionsSupported.value}
      onToggleSessions={toggleSessions}
```

with `const toggleSessions = (): void => toggleSessionsPanel(restoreFocusAfterSettings);`.

**Probe support at boot, do not wait for the first open.** Spec §3.2 says the
screen is unreachable on an unsupported host "by construction". If
`sessionsSupported` only flips after the user has opened the screen once, a
Tauri user clicks the control, gets one empty screen, and _then_ the control
disappears — which is the opposite of by-construction. Add a boot probe beside
the other mount-time effects in `app.tsx`:

```tsx
// One cheap probe, once, at boot: `sessions_list` with a limit of 1 is a
// stat pass plus at most two head reads on Electron, and an immediate
// rejection on a host with no handler. Its ONLY job is to decide whether
// the toolbar control exists at all — the answer is discarded.
useEffect(() => {
  void probeSessionsSupport();
}, []);
```

and in `src/sessions/sessions-store.ts`:

```ts
/** Writes `sessionsSupported` and nothing else. Never touches the entries —
 *  a limit-1 reply is not a list, and storing it would show one row and call
 *  it the history. */
export async function probeSessionsSupport(
  client: SessionsClient = defaultSessionsClient,
): Promise<void> {
  try {
    sessionsSupported.value = (await client.list(1)) !== null;
  } catch {
    sessionsSupported.value = false;
  }
}
```

Add a store test: a memory client returning `null` leaves `sessionsSupported`
false and `sessionEntries` empty; one returning a snapshot leaves it true and
still empty.

- [ ] **Step 5: Add the Open board block**

In `src/open-board/open-board-home.tsx`, below the recents list, render a "Recent sessions" block when `recentSessions.length > 0`. `app.tsx` computes the list:

```ts
const recentSessions = sessionEntries.value
  .filter(
    (entry) =>
      entry.cwd === selectedWorkspace ||
      entry.cwd.startsWith(`${selectedWorkspace}/`),
  )
  .slice(0, 5);
```

Comment the named v1 limitation verbatim from spec §3.3: a session run inside a git worktree living outside the workspace path does not prefix-match and will not appear here; it stays reachable on the full screen. Worktree mapping is future work.

`app.tsx` must call `void refreshSessions()` when the board opens, so the block is not permanently empty for a user who never opens the screen.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/ui/toolbar/ src/open-board/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/toolbar/deck-toolbar.tsx src/ui/toolbar/deck-toolbar.test.tsx src/ui/app.tsx src/open-board/open-board-home.tsx src/open-board/open-board-home.test.tsx
git commit -m "feat(ui): reach session history from the toolbar and the open board"
```

---

### Task 11: `DESIGN-LANGUAGE` §25 — history rows

**Files:**

- Modify: `docs/DESIGN-LANGUAGE.md`

**Blocked on the open decision at the top of this plan.** Do not start until the owner has answered.

- [ ] **Step 1: Add §25 between §24 and the "Chưa khớp thực tế" heading**

```markdown
## 25. History rows

Approved as a fork on 2026-08-16, for the session history screen. §15 is
explicitly read-only and §5's config row is a settings control; neither
describes a list whose rows ARE the action. Numbered 25 as the next free
number above §24 ([session history spec](specs/2026-08-14-session-history-design.md)
`decided`).

- **DL-25.1** A history row is one control, not a row of controls: the whole
  row is the button, and its activation is the surface's primary action. A row
  that needs a second action needs a different genre.
- **DL-25.2** Row content is fixed in order and role: an identity mark, the
  thing's own name, where it came from, and when it last changed. A row never
  reorders these to fit a longer value; the name truncates instead.
- **DL-25.3** A row whose action cannot run is **unavailable, not disabled**
  (DL-23.6): it keeps its place in the tab order, reads `--text-faint` on an
  unchanged surface, drops the hover wash, and carries its reason in an
  accessible description.
- **DL-25.4** A list that shows less than it found says so, in chrome copy at
  the foot of the list, naming the bound and the total. Silence would read as
  "this is everything".
```

- [ ] **Step 2: Add the ledger row**

Append to the §10 migration-status table: the row list is compliant on arrival, so the entry records the new section rather than a violation.

- [ ] **Step 3: Verify docs compliance**

Run:

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

Expected: no new findings. Paste the output.

- [ ] **Step 4: Do NOT commit yet** — D14: docs go to the owner for review first. Stage nothing; report the diff.

---

### Task 12: Repo gates, docs and the ledger

**Files:**

- Modify: `AGENTS.md` (fork queue entry, drift row, direction bullet)
- Modify: `docs/CONTEXT.md` (a dated section)

- [ ] **Step 1: Run the full gate**

Run: `npm test && npm run build && npm run generate:menu:check && npm run electron:build`
Expected: all green. Paste the counts — the pre-change baseline is `npm test` 2619 passing.

- [ ] **Step 2: Add the fork-queue entry to `AGENTS.md`**

Under "Resolved:", newest first:

```markdown
- 2026-08-16: session history landed as a surface over the EXISTING resume
  scanners rather than the spec's separate provider module — touched
  `electron/resume/{head,claude,codex}.ts` (options bag, titles, 64 KiB codex
  head), one new IPC channel (`sessions_list`), the overlay-rank model
  (`sessionsOpen` joins Settings/Usage at `TIER_RANK.settings`) and
  `DESIGN-LANGUAGE` (new §25, a §5 fork). User chose reuse over a second
  scanner. No change to tab materialization: `MaterializeIntent.paneCommands`
  already carried a per-pane command, so history is a caller of that seam, not
  a widening of it (R4 intact). Fixed on the way: the codex scanner read 8 KiB
  of an ~18.6 KB `session_meta` line and enriched 0 of 300 rollouts, so session
  restore could not resume Codex at all.
```

- [ ] **Step 3: Add the drift row**

```markdown
| Session history is available | `decided` | backlog | Landed 2026-08-16, Electron only; no Tauri implementation. Verified by suite/build only — native `npm run electron:dev` pass, owner eye review (DL §9.6) and Windows (Gate C) all owed. Codex titles fall back to the session id for ~8% of rollouts whose first user turn sits past the 64 KiB head |
```

Also update the existing "Session restore resumes agent conversations" row: its Codex arm was non-functional until this task's Task 1.

- [ ] **Step 4: Add a dated `docs/CONTEXT.md` section**

Heading `## Session history — 2026-08-16`. Record: the reuse decision and why; the measured corpus numbers (`codex candidates 0 → N`, head-cap table, title-offset percentiles); the channel-name deviation; the cap and its label; what is NOT done (no transcript viewer, no OpenCode/Gemini/agy providers, no disk index, no worktree→workspace mapping, no shortcut, no Tauri).

- [ ] **Step 5: Verify docs compliance**

Run:

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

Paste the output.

- [ ] **Step 6: Hand the docs to the owner (D14). Do not commit them unreviewed.**

- [ ] **Step 7: Native pass — the gate automated checks cannot close**

Run `npm run electron:dev`, then:

1. open the history control; confirm rows carry titles for Claude and for Codex;
2. filter by agent from the rail, then by project;
3. resume a Claude session — the pane must land in that session's own directory and type `claude --resume <id>`;
4. resume a Codex session — same, with `codex resume <id>`;
5. rename or move a session's directory, reopen the screen, confirm the row is unavailable and refuses to spawn;
6. open the Open board on a workspace with sessions; confirm the block lists up to five and resumes in place;
7. confirm ⌘⇧U, ⌘, and the history control each close the other two surfaces.

Capture a screenshot of the screen and of a resumed pane. **Rendered UI is not done until the owner has eye-reviewed it (DL §9.6).**

---

## Self-review notes

- **Spec coverage.** §1.1 → Task 1 (options bag replaces the provider interface, deviation recorded); §1.2 → Task 1 (`scanClaude`; subagent transcripts were already excluded — `claude.ts` never descends into a project directory's subdirectories); §1.3 → Task 1 (`scanCodex`, archived + non-interactive filters); §1.4 → Tasks 1–2 (stat-first, cap, mtime cache, cap surfaced, `null` drops the row, nothing persisted); §2 → Tasks 3–4, 6; §3.1 → Task 9; §3.2 → Tasks 5, 9; §3.3 → Task 10; §4 → Task 7 (resume, dead-cwd guard, missing binary unchanged — the pane opens as a shell and the typed command fails visibly); §5 → every task's tests plus Task 12's gate; §6's decision table → all fixed as written except the two deviations named at the top.
- **Type consistency.** `SessionEntry`/`SessionsSnapshot` are declared once in `electron/sessions/model.ts` and mirrored once in `src/lib/session-history.ts`; `ScanOptions`/`SessionRecord`/`ScanResult` are declared once in `electron/resume/head.ts` and consumed by both scanners and by `electron/sessions/list.ts`; `AgentFilter` is declared once in `src/sessions/session-filters.ts` and consumed by the store and the rail.
- **Not in this plan, on purpose:** a transcript viewer; OpenCode / Gemini / agy providers (their scanners exist in `electron/resume/` and are one `SESSION_AGENTS` entry away once someone asks); a persistent index; worktree→workspace mapping; a keyboard shortcut; any Tauri implementation.
