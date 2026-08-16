# Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After quitting Deck (or a hard power-off), relaunching restores every tab that was open — terminal tabs with each pane's agent CLI resumed into its exact previous conversation, plus file-editor tabs — and the repository rail's rows for previously-opened worktrees become clickable to rebuild that worktree's last session on demand.

**Architecture:** A continuously-written `session.json` journal (debounced, main-process `JsonStore`, survives power-off) records tabs/layouts/per-pane cwd+agent and file tabs; at boot a new third arm beside "board"/"adopt" reads the journal, asks a new main-process `resume_lookup` IPC to match each agent pane to a session id in that CLI's own state dir (`~/.claude`, `~/.codex`, opencode storage, antigravity conversations), and materializes tabs through the existing `MaterializeIntent` path widened with per-pane launch commands (`claude --resume <id>` etc. typed into the shell exactly like today's agent launch). A per-workspace archive inside the same journal feeds the rail's resumable rows.

**Tech Stack:** Preact signals, existing `Store`/`JsonStore` IPC persistence, node `fs` scans in the Electron main process, Vitest.

**Spec:** No spec file — design approved in chat 2026-08-15 (user chose: full auto-restore on launch; exact session-id matching; all built-in agents best-effort where the CLI cannot do id-precision (gemini → `--resume latest`, agy → mtime/byte-scan match with `--continue` fallback); secondary-window tabs fold into the main window; sidebar reopen restores terminal tabs only; settings kill-switch default ON). This reverses the recorded "no session restore" decision — see Task 11 for the AGENTS.md/CONTEXT.md ledger updates.

## Global Constraints

- **Electron-only.** No Tauri implementation; Tauri is feature-frozen. Say so in docs (Task 11). The Tauri build users currently run will not have this feature.
- **R1:** English only — strings, comments, commits.
- **R4:** `tab-manager.ts`, `agent-launch.ts`, quit flow are load-bearing seams: every change there lands with tests in the same task, no drive-by refactors.
- **R6:** New IPC payloads use flat keys; `scripts/electron-ipc-contract.test.ts` must stay green (it auto-scans `invoke(...)` vs `ipcMain.handle` destructuring).
- **R7:** No shipping module imports `src/gallery/`.
- **Security:** any string interpolated into a PTY write or scanned from an agent's state dir is untrusted. Session refs must match `/^[A-Za-z0-9._-]{1,128}$/` before entering a command line.
- **Immutability (C1)** and existing file conventions (kebab-case, ≤ 800 lines, feature-scoped modules).
- Minimum completion gate per task: `npm test`; repo-wide finish gate: `npm test && npm run build && npm run generate:menu:check && npm run electron:build`.
- Commits: conventional, scoped, one concern each (`feat(session): …`, `feat(resume): …`, `feat(rail): …`).
- **The working tree carries unrelated uncommitted theme/rail work.** Every commit stages task files by explicit path — never `git add -A`/`git add .`.
- Do NOT commit this plan document itself until the owner has reviewed it (D14).

## File Structure (new/modified)

```text
src/lib/session-schema.ts            NEW  journal types + validation + caps (pure)
src/lib/agent-resume.ts              NEW  ResumeRef → command line, sanitization (pure)
src/host/resume-host.ts              NEW  renderer facade for resume_lookup
src/terminal/session-journal.ts      NEW  debounced writer + archive signal + suspend/flush
src/terminal/session-restore.ts      NEW  boot/rail restore orchestration
electron/resume/resolve.ts           NEW  request → ResumeRef dispatch, ranking, dedup
electron/resume/head.ts              NEW  bounded head-bytes/lines reader
electron/resume/claude.ts            NEW  ~/.claude/projects scanner
electron/resume/codex.ts             NEW  ~/.codex rollout scanner (reuses discoverCodex)
electron/resume/opencode.ts          NEW  opencode storage/session scanner
electron/resume/agy.ts               NEW  antigravity conversations scanner
src/terminal/tab-manager.ts          MOD  captureSession(); per-pane arm call
src/terminal/tab-materialize.ts      MOD  MaterializeIntent.paneCommands
src/terminal/agent-launch.ts         MOD  arm() takes per-pane entries
electron/ipc/channels.ts             MOD  resumeLookup channel
electron/main.ts                     MOD  session.json allowlist + resume_lookup handler
src/settings/settings-schema.ts      MOD  restoreSessions toggle
src/ui/app.tsx                       MOD  boot third arm, quit flush, rail wiring
src/repositories/repository-model.ts MOD  resumable rows
src/ui/repository-rail.tsx           MOD  clickable resumable row + onResumeWorktree
src/ui/workspace-sidebar.tsx         MOD  onResumeWorktree (prop parity only)
src/gallery/seed-data.ts, main.tsx   MOD  resumable-row specimen seeds
```

---

### Task 1: Session journal schema (`src/lib/session-schema.ts`)

**Files:**

- Create: `src/lib/session-schema.ts`
- Test: `src/lib/session-schema.test.ts`
- Possibly modify: `src/lib/preset-schema.ts` (export its layout validator if module-private)

**Interfaces:**

- Consumes: `SerializedNode`/`countLeaves` from `src/lib/split-tree.ts`, `TabDotColor` from `src/lib/tab-colors.ts`.
- Produces (later tasks import these exact names):

```ts
export const SESSION_VERSION = 1;
export const MAX_ARCHIVE_WORKSPACES = 24;
export const MAX_JOURNAL_TABS = 32;

export interface SessionPane {
  /** Polled cwd at capture time; null = unknown (spawn falls back to $HOME). */
  readonly cwd: string | null;
  /** PaneAgent string as classified (built-in id, or custom agent label); null = plain shell. */
  readonly agent: string | null;
}

export interface SessionTab {
  readonly workspacePath: string | null;
  readonly layout: SerializedNode;
  /** Zipped to leafIds() left-to-right — same ordering contract as Preset.cwds. */
  readonly panes: readonly SessionPane[];
  readonly name: string | null;
  readonly dotColor: TabDotColor | null;
}

export interface SessionFileTab {
  readonly path: string;
  readonly preview: boolean;
}

export interface SessionFileSurface {
  readonly workspacePath: string;
  readonly tabs: readonly SessionFileTab[];
  readonly activePath: string | null;
}

/** One window's live state; key `window:<label>` in session.json. */
export interface WindowRecord {
  readonly savedAt: number;
  readonly activeTabIndex: number;
  readonly tabs: readonly SessionTab[];
  /** Main window only; secondary windows write []. */
  readonly files: readonly SessionFileSurface[];
  readonly activeFileTab: string | null;
}

/** Last known session per workspace; key `archive`. Survives restore. */
export interface ArchiveEntry {
  readonly savedAt: number;
  readonly tabs: readonly SessionTab[];
}

export function validateWindowRecord(raw: unknown): WindowRecord | null;
export function validateArchive(
  raw: unknown,
): Readonly<Record<string, ArchiveEntry>>;
/** New archive with `entry` set and the oldest entries dropped past the cap. */
export function pushArchiveEntry(
  archive: Readonly<Record<string, ArchiveEntry>>,
  workspacePath: string,
  entry: ArchiveEntry,
): Readonly<Record<string, ArchiveEntry>>;
```

- [ ] **Step 1: Write failing tests** — mirror `workspace-recents.ts`'s validator style: per-entry drop, not whole-file reject.

```ts
// src/lib/session-schema.test.ts
import { describe, expect, it } from "vitest";
import {
  pushArchiveEntry,
  validateArchive,
  validateWindowRecord,
  MAX_ARCHIVE_WORKSPACES,
} from "./session-schema";

const LEAF = { type: "leaf" } as const;
const PANE = { cwd: "/tmp/x", agent: "claude" };
const TAB = {
  workspacePath: "/tmp/x",
  layout: LEAF,
  panes: [PANE],
  name: null,
  dotColor: null,
};
const RECORD = {
  savedAt: 111,
  activeTabIndex: 0,
  tabs: [TAB],
  files: [],
  activeFileTab: null,
};

describe("validateWindowRecord", () => {
  it("accepts a well-formed record", () => {
    expect(validateWindowRecord(RECORD)).toEqual(RECORD);
  });
  it("rejects non-objects", () => {
    expect(validateWindowRecord(null)).toBeNull();
    expect(validateWindowRecord("x")).toBeNull();
  });
  it("drops a tab whose pane count does not match its layout leaves", () => {
    const bad = { ...TAB, panes: [PANE, PANE] }; // leaf layout = 1 leaf
    const result = validateWindowRecord({ ...RECORD, tabs: [bad, TAB] });
    expect(result?.tabs).toEqual([TAB]);
  });
  it("drops a tab with an invalid layout but keeps the rest", () => {
    const bad = { ...TAB, layout: { type: "nope" } };
    expect(validateWindowRecord({ ...RECORD, tabs: [bad, TAB] })?.tabs).toEqual(
      [TAB],
    );
  });
  it("clamps activeTabIndex into the surviving tab range", () => {
    expect(
      validateWindowRecord({ ...RECORD, activeTabIndex: 99 })?.activeTabIndex,
    ).toBe(0);
  });
  it("coerces malformed file surfaces away without rejecting the record", () => {
    const result = validateWindowRecord({
      ...RECORD,
      files: [
        {
          workspacePath: "/w",
          tabs: [{ path: "/w/a.ts", preview: false }],
          activePath: null,
        },
        42,
      ],
    });
    expect(result?.files).toHaveLength(1);
  });
});

describe("archive", () => {
  it("validates entries individually", () => {
    const archive = validateArchive({
      "/w": { savedAt: 1, tabs: [TAB] },
      "/bad": "x",
    });
    expect(Object.keys(archive)).toEqual(["/w"]);
  });
  it("caps at MAX_ARCHIVE_WORKSPACES, dropping oldest savedAt", () => {
    let archive: Readonly<Record<string, never[]>> | Record<string, unknown> =
      {};
    let out = {} as ReturnType<typeof validateArchive>;
    for (let i = 0; i <= MAX_ARCHIVE_WORKSPACES; i += 1) {
      out = pushArchiveEntry(out, `/w${i}`, { savedAt: i, tabs: [TAB] });
    }
    expect(Object.keys(out)).toHaveLength(MAX_ARCHIVE_WORKSPACES);
    expect(out["/w0"]).toBeUndefined();
    void archive;
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail** — `npx vitest run src/lib/session-schema.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement.** Reuse the layout validator `validatePreset` uses (`src/lib/preset-schema.ts:60` area) — if it is module-private, export it (e.g. `export function validateLayout(raw: unknown): SerializedNode | null`) rather than duplicating the recursion. Pane-count check: `panes.length === countLeaves(layout)`. Every collection validated per-entry; `dotColor` validated against `TabDotColor`'s allowed tokens the same way `TabOverride` consumers do (see how `workspace-recents`/`presets` validate — follow that idiom). Cap `tabs` at `MAX_JOURNAL_TABS`.
- [ ] **Step 4: Run tests, confirm pass.** Also `npx vitest run src/lib/preset-schema.test.ts` if you exported a helper from there.
- [ ] **Step 5: Commit** — `feat(session): add session journal schema and validation`

---

### Task 2: `TabManager.captureSession()`

**Files:**

- Modify: `src/terminal/tab-manager.ts` (interface at ~line 368; implementation near `captureActiveLayout` at ~line 1164)
- Test: `src/terminal/tab-manager.test.ts` (existing harness)

**Interfaces:**

- Consumes: `SessionTab` from Task 1; existing internals `tabs`, `overrides`, `poller.infoFor`.
- Produces: on the `TabManager` interface:

```ts
/**
 * Polled snapshot of every tab for the session journal. No IPC and no
 * awaits — reads the 2 s poll cache, which is the deliberate accuracy
 * bound for a journal that survives power-off (there is no "at quit"
 * moment to be fresher at).
 */
captureSession(): readonly SessionTab[];
```

- [ ] **Step 1: Write the failing test.** In the existing tab-manager test file, using its established fake host/poller setup (follow how `captureActiveLayout` or `disposeTab` tests build tabs): open two tabs (one with a workspace + name override, one without), let the fake poller report `{ cwd: "/w/a", agent: "claude" }` for pane 1 and `{ cwd: null, agent: null }` for pane 2, then:

```ts
it("captures every tab with polled cwd/agent and chrome overrides", () => {
  const session = manager.captureSession();
  expect(session).toEqual([
    {
      workspacePath: "/w",
      layout: { type: "leaf" },
      panes: [{ cwd: "/w/a", agent: "claude" }],
      name: "renamed",
      dotColor: null,
    },
    {
      workspacePath: null,
      layout: { type: "leaf" },
      panes: [{ cwd: null, agent: null }],
      name: null,
      dotColor: null,
    },
  ]);
});
```

- [ ] **Step 2: Run it, confirm FAIL** (`captureSession is not a function`).
- [ ] **Step 3: Implement** inside `createTabManager`, beside `captureActiveLayout`:

```ts
function captureSession(): readonly SessionTab[] {
  return tabs.flatMap((entry) => {
    const layout = entry.manager.serializeLayout();
    if (layout === null) {
      return [];
    }
    const override = overrides.get(entry.key);
    const panes = entry.manager.paneIds().map((id) => {
      const info = poller.infoFor(id);
      return { cwd: info?.cwd ?? null, agent: info?.agent ?? null };
    });
    return [
      {
        workspacePath: entry.workspacePath,
        layout,
        panes,
        name: override?.name ?? null,
        dotColor: override?.dotColor ?? null,
      },
    ];
  });
}
```

Export it on the returned object and add it to the `TabManager` interface with the doc comment above.

- [ ] **Step 4: Run the tab-manager suite** — `npx vitest run src/terminal/tab-manager.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(session): TabManager.captureSession polled snapshot`

---

### Task 3: Per-pane launch commands (`agent-launch` + `MaterializeIntent`)

**Files:**

- Modify: `src/terminal/agent-launch.ts` (arm signature), `src/terminal/tab-materialize.ts` (intent field), `src/terminal/tab-manager.ts` (`materialize` call site ~line 1117)
- Test: `src/terminal/agent-launch.test.ts`, `src/terminal/tab-manager.test.ts`

**Interfaces:**

- Produces:

```ts
// agent-launch.ts
export interface AgentLaunchEntry {
  readonly id: number;
  /** Verbatim command typed into the pane's shell; null arms nothing. */
  readonly command: string | null;
}
export interface AgentLauncher {
  arm(entries: readonly AgentLaunchEntry[]): void;
  // noteOutput / notePromptReady / prune / dispose unchanged
}

// tab-materialize.ts — added to MaterializeIntent
/**
 * Per-pane launch commands, zipped to leaves left-to-right. When present it
 * overrides `agent` per pane (a null slot leaves that pane a plain shell).
 * Session restore is the caller: each pane resumes its own conversation.
 */
readonly paneCommands?: readonly (string | null)[];
```

- [ ] **Step 1: Update agent-launch tests to the new shape and add one new case.** Mechanical rewrite of existing `arm([1, 2], "claude")` calls to `arm([{ id: 1, command: "claude" }, { id: 2, command: "claude" }])`. New test:

```ts
it("arms different commands per pane", () => {
  launcher.arm([
    { id: 1, command: "claude --resume abc" },
    { id: 2, command: null },
  ]);
  launcher.noteOutput(1);
  launcher.noteOutput(2);
  expect(writes).toEqual([[1, "claude --resume abc\r"]]);
});
```

- [ ] **Step 2: Run — FAIL** (type errors / old signature).
- [ ] **Step 3: Implement.** In `arm`, iterate entries; skip `command === null` entries entirely (today's `agent === null` early-return becomes per-entry). `Armed.agent` field renames to `command` for honesty; `fire()` writes `entry.command`. Everything else (timers, readiness, prune) unchanged.
- [ ] **Step 4: Update `materialize`** (tab-manager.ts ~1117):

```ts
const paneIds = entry.manager.paneIds();
const agentId = intent.agent ?? null;
const fallback =
  agentId === null
    ? null
    : resolveAgentCommand(agentId, settings.value.customAgents);
launcher.arm(
  paneIds.map((id, index) => ({
    id,
    command: intent.paneCommands?.[index] ?? fallback,
  })),
);
```

- [ ] **Step 5: Add a tab-manager test** proving `materialize({ …, paneCommands: ["claude --resume abc"] })` arms that literal command and that the old `agent: "claude"` path still arms `"claude"` for every pane.
- [ ] **Step 6: Run both suites + typecheck** — `npx vitest run src/terminal/agent-launch.test.ts src/terminal/tab-manager.test.ts && npm run build` → PASS.
- [ ] **Step 7: Commit** — `feat(session): per-pane launch commands through MaterializeIntent`

---

### Task 4: Journal writer (`src/terminal/session-journal.ts` + `session.json` allowlist)

**Files:**

- Create: `src/terminal/session-journal.ts`
- Modify: `electron/main.ts` `STORE_FILES` (~line 712): add `"session.json"` with a comment; add the `window_label` handler below
- Modify: `electron/ipc/channels.ts` (add `windowLabel: "window_label"`), `src/host/window-host.ts` (renderer accessor)
- Test: `src/terminal/session-journal.test.ts`

**Window-label prerequisite (verified gap):** the renderer has NO label accessor today — `DeckWindow` (`src/host/window-host.ts:53`) exposes none and `windowBootMode` returns a `BootMode` without a label, while main derives labels per-request via `labelOf(event)` (`electron/main.ts:181`). Add the smallest possible channel (Electron-only, like `worktreeAdd`):

```ts
// electron/ipc/channels.ts
windowLabel: ("window_label",
  // electron/main.ts, Services block — no payload by contract
  ipcMain.handle(CHANNELS.windowLabel, (event) => labelOf(event)));
// src/host/window-host.ts
export function currentWindowLabel(): Promise<string> {
  return invoke<string>("window_label");
}
```

**Interfaces:**

- Consumes: `Store` (`src/host/store-host.ts`), Task 1 schema, signals `tabViews`/`activeTabIndex` (`tabs-store.ts`), `fileSurfaces`/`activeFileTab` (`files/file-surface-store.ts`), `effect` from `@preact/signals`.
- Produces:

```ts
export const SESSION_STORE_FILE = "session.json";

export interface SessionJournalDeps {
  /** TabManager.captureSession, injected to avoid a manager import cycle. */
  capture(): readonly SessionTab[];
  /** This window's label, from `currentWindowLabel()` (added in this task). */
  windowLabel: string;
  /** True only for the normal-boot (main) window; adopt windows pass false. */
  isMain: boolean;
  store?: Pick<Store, "get" | "set" | "delete" | "save">; // test seam
  debounceMs?: number; // default 1000
}

/** Load the store, seed `sessionArchive`, install the debounced write effect. */
export async function initSessionJournal(
  deps: SessionJournalDeps,
): Promise<void>;
/** Pause captures (restore in flight must not clobber the journal). */
export function suspendSessionJournal(): void;
export function resumeSessionJournal(): void;
/** Write pending state now — the quit flow's flush hook. */
export function flushSessionJournal(): Promise<void>;
/** Read all persisted window records (restore) and the archive. */
export function readWindowRecords(): Promise<ReadonlyMap<string, WindowRecord>>;
export function clearWindowRecord(label: string): Promise<void>;
/** Last known session per workspace — the rail's data source. */
export const sessionArchive: Signal<Readonly<Record<string, ArchiveEntry>>>;
export function resetSessionJournal(): void; // tests only
```

**Behavior requirements (each is a test):**

1. A change in `tabViews` schedules one debounced write of `window:<label>` = `WindowRecord` built from `capture()` + `activeTabIndex.value` + (main only) file surfaces mapped to `SessionFileSurface[]` + `activeFileTab.value`.
2. Identical consecutive snapshots do not write twice — compare `JSON.stringify` of the record (minus `savedAt`) against the last written string. `tabViews` gets a new array identity every 2 s poll, so this dedup is what keeps the journal from writing every poll.
3. Closing the last tab writes `tabs: []` (empty state persists — dead tabs must not resurrect).
4. On every main-window write, each workspace with ≥ 1 live tab gets `archive[workspace] = { savedAt, tabs: <that workspace's tabs> }` via `pushArchiveEntry`; workspaces absent from the current snapshot keep their existing archive entry (archive is "last known", not "currently open").
5. `suspendSessionJournal()` makes effects no-ops until resumed; `flushSessionJournal()` cancels the timer and writes immediately (still respecting suspension).
6. Store failures degrade: `console.warn` + `reportPersistError` (import from `../chrome/events`, same as `workspaces-store.ts`), never throw into the effect.
7. Signal effects run on animation frames in this codebase (see memory: `useSignalEffect` raf) — module-level `effect()` from `@preact/signals` is synchronous, but write the tests with fake timers (`vi.useFakeTimers`) advancing past `debounceMs`, and flush microtasks, following the idiom used in existing store tests (`settings-store.test.ts` is the closest precedent — read it first and copy its timing style).

- [ ] **Step 1: Write failing tests** for behaviors 1–6 with a fake store (`{ get, set, delete, save }` recording calls) and manual signal pokes (`tabViews.value = […]`).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Module-scoped state (window-scoped store per R5): `let suspended = false`, `let timer`, `let lastWritten: string | null`, and a **lazily memoized store opener** — `let storePromise: Promise<Store> | null; function openStore() { return (storePromise ??= Store.load(SESSION_STORE_FILE, { defaults: {}, autoSave: false })); }` — used by `readWindowRecords`, `clearWindowRecord`, the restore marker AND `initSessionJournal` alike. This ordering matters: at boot, `restoreSession` (Task 7) reads records **before** `initSessionJournal` runs, so the read side must not depend on init having happened. `initSessionJournal` awaits `openStore()`, reads + validates `archive` into `sessionArchive`, then installs `effect(() => { tabViews.value; activeTabIndex.value; fileSurfaces.value; activeFileTab.value; schedule(); })`. The write path builds the record, validates nothing (it is our own data), dedups, then `store.set("window:" + label, record)`; main additionally folds the archive and `store.set("archive", next)`; finally `store.save()`.
- [ ] **Step 4: Add `"session.json"` to `STORE_FILES`** in `electron/main.ts` with the comment `// Session journal: live window records + per-workspace archive (restore).`
- [ ] **Step 5: Run tests + `npm run electron:build`** → PASS.
- [ ] **Step 6: Commit** — `feat(session): continuous session.json journal with per-workspace archive`

---

### Task 5: Main-process resume resolvers + `resume_lookup` IPC

**Files:**

- Create: `electron/resume/head.ts`, `electron/resume/claude.ts`, `electron/resume/codex.ts`, `electron/resume/opencode.ts`, `electron/resume/agy.ts`, `electron/resume/resolve.ts`
- Modify: `electron/ipc/channels.ts` (add `resumeLookup: "resume_lookup"` with an Electron-only comment like `worktreeAdd`'s), `electron/main.ts` (handler in the Services block ~line 440)
- Test: `electron/resume/resolve.test.ts` (temp-dir fixtures via `fs.mkdtempSync`)

**Interfaces:**

- Consumes: `discoverCodex` from `electron/usage/discover.ts`; `app.getPath("home")`.
- Produces (wire contract — Task 6 mirrors these types in the renderer):

```ts
// resolve.ts
export interface ResumeRequest {
  readonly agent: string; // built-in id: claude|codex|opencode|gemini|agy
  readonly cwd: string | null;
  readonly lastSeenAt: number; // journal savedAt for ranking
}
export type ResumeRef =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "latest" }
  | null;

/** One answer per request, in order. Never rejects — unknown agents and scan
 *  failures answer null (renderer falls back to a bare agent launch). */
export function resolveResume(
  home: string,
  requests: readonly ResumeRequest[],
): ResumeRef[];

export function validateResumeRequests(raw: unknown): ResumeRequest[];
```

**Per-agent scan contracts** (each module exports `candidates(home): CandidateSession[]` where `CandidateSession = { id: string; cwd: string | null; mtimeMs: number }`):

| Module        | Source                                                                                                                                     | id                          | cwd                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude.ts`   | `<home>/.claude/projects/<proj>/*.jsonl` (files directly in the project dir only — never descend into `<session>/subagents/`)              | first line's `sessionId`    | first line within the head window whose JSON has a non-empty `cwd` (verified on this machine: `cwd` appears within the first few lines, not necessarily line 1) |
| `codex.ts`    | `discoverCodex(home).active` ∪ `.archived`                                                                                                 | head line `payload.id`      | head line `payload.cwd` (verified: `session_meta` carries both)                                                                                                 |
| `opencode.ts` | `<home>/.local/share/opencode/storage/session/*/*.json`                                                                                    | JSON `.id`                  | JSON `.directory`; use `.time.updated` as mtime when present                                                                                                    |
| `agy.ts`      | `<home>/.gemini/antigravity/conversations/*.pb`                                                                                            | filename UUID (strip `.pb`) | best-effort: `cwd` bytes found in the first 512 KB of the file → that cwd, else null                                                                            |
| gemini        | no scan — `resolveResume` answers `{ kind: "latest" }` directly (`gemini --resume latest` is per-project by cwd; the CLI itself scopes it) | —                           | —                                                                                                                                                               |

**Ranking + assignment in `resolveResume`:**

- Scan each needed agent's candidates once per call (lazy, cached in a local `Map`).
- Bound every scan: skip files with `mtimeMs` older than 30 days before `lastSeenAt`; sort newest-first and parse at most 300 files per agent (large `~/.codex` must not stall boot).
- For each request in order: filter candidates to `cwd === request.cwd` (when the request has a cwd and the candidate has one; candidates with null cwd only match requests ranked by time alone — agy's fallback), rank by `Math.abs(mtimeMs - lastSeenAt)` ascending, take the best **not already assigned** id (greedy dedup: two claude panes in one cwd get two different sessions). No candidate → for agy answer `{ kind: "latest" }` (maps to `agy --continue`), for claude/codex/opencode answer `null`.
- `head.ts`: `headBytes(filePath, cap): Buffer | null` (open/readSync/close, same shape as `discover.ts`'s `readFirstLine` but returning the whole window) and `headJsonLines(buffer, maxLines): unknown[]`. Symlinks refused via `lstat` like `discover.ts`'s `entryKind`.

- [ ] **Step 1: Write failing tests.** Build a temp home with fixture trees, e.g.:

```ts
// claude fixture
const proj = join(home, ".claude/projects/-tmp-w");
mkdirSync(proj, { recursive: true });
writeFileSync(
  join(proj, "aaaa.jsonl"),
  [
    '{"sessionId":"aaaa","type":"mode"}',
    '{"sessionId":"aaaa","cwd":"/tmp/w","type":"attachment"}',
  ].join("\n"),
);
utimesSync(join(proj, "aaaa.jsonl"), t1, t1);
```

Cases: (a) claude id matched by cwd+time; (b) two same-cwd claude requests get distinct ids; (c) codex `session_meta` parse; (d) opencode `.directory` match; (e) gemini always `{kind:"latest"}`; (f) agy filename id when cwd bytes match, `{kind:"latest"}` when nothing matches; (g) unknown agent → null; (h) unreadable dirs → null, no throw; (i) `validateResumeRequests` drops malformed entries.

- [ ] **Step 2: Run — FAIL.** Check `vitest` picks up `electron/resume/*.test.ts` — `electron/usage` tests already run under `npm test`; mirror however its config includes them (look at `vitest.config.*` / `package.json` before assuming).
- [ ] **Step 3: Implement the five modules + resolve.**
- [ ] **Step 4: Wire the channel.** `channels.ts`: `resumeLookup: "resume_lookup",` under a comment noting Electron-only. `main.ts` Services block:

```ts
ipcMain.handle(CHANNELS.resumeLookup, (_event, { requests }) =>
  resolveResume(app.getPath("home"), validateResumeRequests(requests)),
);
```

- [ ] **Step 5: Run** — `npx vitest run electron/resume/resolve.test.ts scripts/electron-ipc-contract.test.ts && npm run electron:build` → PASS (the contract test will fail Task 6's renderer call if keys mismatch — it goes green once both sides exist; at this point it must at least not regress).
- [ ] **Step 6: Commit** — `feat(resume): main-process session resolvers and resume_lookup channel`

---

### Task 6: Renderer resume facade + command builder

**Files:**

- Create: `src/lib/agent-resume.ts`, `src/host/resume-host.ts`
- Test: `src/lib/agent-resume.test.ts`

**Interfaces:**

- Consumes: `CustomAgent`/`BUILTIN_AGENTS` from `src/lib/agent-catalog.ts`; `invoke` from `src/host/bridge.ts`.
- Produces:

```ts
// src/lib/agent-resume.ts
export type ResumeRef =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "latest" }
  | null;
export interface ResumeRequest {
  readonly agent: string;
  readonly cwd: string | null;
  readonly lastSeenAt: number;
}
const SESSION_REF_SAFE = /^[A-Za-z0-9._-]{1,128}$/;

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
): string | null;

// src/host/resume-host.ts
export function resumeLookup(
  requests: readonly ResumeRequest[],
): Promise<readonly ResumeRef[]>; // invoke("resume_lookup", { requests }); validates the response array defensively (bad entry → null)
```

**Exact command table (implement as a record, one entry per built-in):**

| agent    | id form                   | latest form              | bare       |
| -------- | ------------------------- | ------------------------ | ---------- |
| claude   | `claude --resume <id>`    | `claude --continue`      | `claude`   |
| codex    | `codex resume <id>`       | `codex resume --last`    | `codex`    |
| opencode | `opencode -s <id>`        | `opencode -c`            | `opencode` |
| gemini   | (id never produced)       | `gemini --resume latest` | `gemini`   |
| agy      | `agy --conversation <id>` | `agy --continue`         | `agy`      |

- [ ] **Step 1: Write failing tests** — one per table row and per degradation branch, plus the injection case:

```ts
it("refuses an unsafe session id", () => {
  expect(
    buildResumeCommand("claude", { kind: "id", id: "x; rm -rf ~" }, []),
  ).toBe("claude");
});
it("matches a custom agent by label and ignores the ref", () => {
  const custom = [
    { id: "custom:mybot", label: "MyBot", command: "mybot --flag" },
  ];
  expect(buildResumeCommand("MyBot", { kind: "id", id: "abc" }, custom)).toBe(
    "mybot --flag",
  );
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS**, and `npx vitest run scripts/electron-ipc-contract.test.ts` now proves both sides of `resume_lookup` agree.
- [ ] **Step 5: Commit** — `feat(resume): renderer resume facade and per-agent command builder`

---

### Task 7: Restore orchestrator (`src/terminal/session-restore.ts`)

**Files:**

- Create: `src/terminal/session-restore.ts`
- Test: `src/terminal/session-restore.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 4, 6; `MaterializeIntent` (Task 3); `materializeChromeFrom` from `tab-materialize.ts`.
- Produces:

```ts
export interface RestoreDeps {
  manager: Pick<TabManager, "materialize" | "selectTab">;
  files: Pick<FileSurfaceController, "openFile" | "activateFile">;
  dirsExist(paths: readonly string[]): Promise<boolean[]>; // defaultPtyClient.dirsExist
  /** FileClient.statFiles — src/files/file-client.ts:59; root-scoped, so call it
   *  once per surface with that surface's workspacePath as root. Filter out
   *  entries whose stat reports the file missing — copy the gone-detection used
   *  at file-surface-controller.ts:593. */
  statFiles(root: string, paths: readonly string[]): Promise<FileStatResult[]>;
  lookup: typeof resumeLookup;
  customAgents(): readonly CustomAgent[];
  journal: {
    readWindowRecords(): Promise<ReadonlyMap<string, WindowRecord>>;
    clearWindowRecord(label: string): Promise<void>;
  };
  marker: {
    // crash-loop guard, update-attempt.json pattern, stored in session.json under key "restoreAttempt"
    take(): Promise<boolean>; // true = a previous attempt never cleared → skip restore
    set(): Promise<void>;
    clear(): Promise<void>;
  };
}

/** Auto-restore at boot. True = at least one tab was materialized. */
export async function restoreSession(
  deps: RestoreDeps,
  mainLabel: string,
): Promise<boolean>;

/** Rail click: rebuild one workspace's archived tabs (terminal only, no files). */
export async function resumeWorkspace(
  deps: Pick<RestoreDeps, "manager" | "dirsExist" | "lookup" | "customAgents">,
  entry: ArchiveEntry,
  workspacePath: string,
): Promise<boolean>;
```

**`restoreSession` flow (each numbered point is a test):**

1. `marker.take()` true → return false immediately (previous restore crashed; board opens; archive still feeds the rail).
2. `marker.set()`; read records; order = main window's record first, then others by `savedAt` descending; concatenate their tabs (fold-in). No records / all empty → `marker.clear()`, return false.
3. Liveness: one batched `dirsExist` over every distinct workspacePath + pane cwd. Dead workspacePath → drop the tab. Dead pane cwd → keep the pane with `cwd: null` (spawn falls back to `$HOME`) but skip its resume request.
4. Resume lookup: one batched `lookup(requests)` where requests = every surviving pane whose `agent` is in `BUILTIN_AGENTS` (`{ agent, cwd, lastSeenAt: record.savedAt }`). Per pane command = `buildResumeCommand(agent, ref, customAgents())`; a pane with a custom-agent label gets `buildResumeCommand(label, null, customAgents())`; a null-agent pane gets `null`.
5. Materialize sequentially (await each) via:

```ts
await deps.manager.materialize({
  layout: tab.layout,
  cwds: tab.panes.map((pane) => pane.cwd),
  paneCommands,
  chrome: materializeChromeFrom(tab.name, tab.dotColor),
  ...(tab.workspacePath !== null ? { workspacePath: tab.workspacePath } : {}),
});
```

A failed materialize skips that tab and continues (count successes). 6. Files (main record only): `statFiles` the union of file-tab paths; for each surviving surface, `openFile(workspacePath, path, keep = !preview)` in order (sequential await), then `activateFile` for `activePath` when it survived. Skip a whole surface whose workspace dir is dead. 7. Select `activeTabIndex` (clamped to materialized count) via `manager.selectTab`; when `activeFileTab` survived, `activateFile` last so the file surface holds the stage as it did at quit. 8. Clear every secondary `window:<label>` key (`clearWindowRecord`) — their tabs now live in the main window; leave the main record alone (the journal rewrites it as soon as it resumes). Add the companion journal test: a key removed via `clearWindowRecord` must not appear in a subsequent `readWindowRecords()`. 9. `marker.clear()`; return `restored > 0`. Any thrown error inside the flow is caught, logged (`console.error("session restore failed:", err)`), and returns whatever was restored so far — the marker still clears in a `finally`; only a hard crash leaves it set, which is exactly what it is for.

**`resumeWorkspace`:** points 3–5 scoped to one archive entry (no marker, no files, no selectTab juggling — materialize already selects the new tab).

- [ ] **Step 1: Write failing tests** for points 1–9 with fake deps (record every call; fake lookup returns scripted refs). Include: two-same-cwd-claude-panes get the two scripted distinct ids in pane order; a dead workspace drops its tab but not its neighbors; marker set→clear bracketing (and clear-on-throw via a lookup that rejects).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** (marker helpers live here too, reading/writing the `restoreAttempt` key through the same `Store` the journal opened — expose `sessionRestoreMarker` from `session-journal.ts` if cleaner, but keep one owner for the file).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(session): boot restore orchestrator with resume lookup and crash-loop marker`

---

### Task 8: Boot wiring, quit flush, settings kill-switch

**Files:**

- Modify: `src/ui/app.tsx` (boot effect ~line 498–566; quit-guard effect ~line 603–639), `src/settings/settings-schema.ts` (+ its validator + `DEFAULT_SETTINGS`), the settings section component that hosts the `agentNotifications` toggle (grep for it under `src/ui/settings/sections/`)
- Test: `src/settings/settings-schema.test.ts` (or wherever the existing settings coercion tests live), `src/ui/app.test.tsx` additions only if an existing harness covers boot (do not build a new app-level harness for this — the orchestrator is already unit-tested; the wiring is covered by the native manual pass in Task 10)

**Interfaces:**

- Consumes: everything above.
- Produces: `Settings.restoreSessions: boolean` (default `true`).

- [ ] **Step 1: Settings field.** Add `restoreSessions: boolean` to `Settings`, `DEFAULT_SETTINGS: { …, restoreSessions: true }`, and the coercer (non-boolean → default). Failing test first: `expect(validateSettings({ restoreSessions: "x" }).restoreSessions).toBe(true)` style, matching the existing validator test idiom. Then a toggle row in the same section as `agentNotifications`, copying its exact row markup: label "Restore sessions on launch", description "Reopen last session's tabs and resume agent conversations." wired to `updateSettings({ restoreSessions: … })`.
- [ ] **Step 2: Boot third arm.** Replace the board branch of the `manager.init()` chain:

```ts
void (
  manager
    .init()
    .then(async () => {
      const label = await currentWindowLabel(); // Task 4's window_label accessor
      if (!bootOpensTheBoard(boot)) {
        const ok = await manager.adoptIntoNewTab(
          boot.kind === "adopt" ? boot.token : "",
        );
        if (!ok) {
          void getCurrentWindow().close();
          return;
        }
        // Adopt windows journal too (isMain: false) so a detached pane is
        // folded into the main window on the next boot.
        await initSessionJournal({
          capture: () => manager.captureSession(),
          windowLabel: label,
          isMain: false,
        });
        return;
      }
      // Restore BEFORE the journal starts writing: the journal's first capture
      // of an empty window must not clobber the record restore is about to read.
      let restored = false;
      if (settings.value.restoreSessions) {
        restored = await restoreSession(restoreDeps(manager), label).catch(
          (err: unknown) => {
            console.error("session restore failed:", err);
            return false;
          },
        );
      }
      await initSessionJournal({
        capture: () => manager.captureSession(),
        windowLabel: label,
        isMain: true,
      });
      if (!restored) {
        boardOpen.value = true;
      }
    })
    .catch(
      /* existing failure branch unchanged, plus journal init is skipped on failure */
    )
);
```

Notes for the implementer: `restoreDeps(manager)` is a small local builder bundling `defaultPtyClient.dirsExist`, the file client's `statFiles`, `fileController`, `resumeLookup`, `() => settings.value.customAgents`, and the journal module's record/marker functions. `currentWindowLabel()` is Task 4's new accessor (`src/host/window-host.ts`).

- [ ] **Step 3: Quit vs close flush — they are OPPOSITES, do not share one closure.** The flush hook runs on `finish(true)` while the panes are still alive (never on cancel — see `quit-guard.ts:114-130`). On **quit**, the journal must persist so the next launch restores. On a **deliberate window close**, the record must be **cleared** — flushing there would write a record containing the very tabs the user is closing, and the next boot's fold-in (or macOS's `activate` recreating a window in the same app run) would resurrect them as ghost tabs. Replace the shared `answering()` flush:

```ts
installQuitGuard({
  quit: {
    ...answering(QUIT_COPY),
    flush: async () => {
      await Promise.all([flushSettingsSave(), flushSessionJournal()]);
    },
    confirm: (requestId: number) => defaultPtyClient.confirmQuit(requestId),
    cancel: (requestId: number) => defaultPtyClient.cancelQuit(requestId),
  },
  close: {
    ...answering(WINDOW_CLOSE_COPY),
    flush: async () => {
      await Promise.all([
        flushSettingsSave(),
        currentWindowLabel().then((label) => clearWindowRecord(label)),
      ]);
    },
    confirm: (requestId: number) =>
      defaultPtyClient.confirmCloseWindow(requestId),
    cancel: (requestId: number) =>
      defaultPtyClient.cancelCloseWindow(requestId),
  },
});
```

(`answering()` keeps building `ask` only; move `flush` out of it.)

- [ ] **Step 4: Verify** — `npm test && npm run build && npm run electron:build` → PASS (this is wiring; the behavior evidence is Task 10's native pass).
- [ ] **Step 5: Commit** — `feat(session): boot restore arm, journal quit flush, restoreSessions setting`

---

### Task 9: Rail resumable rows

**Files:**

- Modify: `src/repositories/repository-model.ts` (`RailInput`, `WorktreeRow`, `buildRail`), `src/ui/repository-rail.tsx` (readout branch, props), `src/ui/workspace-sidebar.tsx` (prop parity only), `src/ui/app.tsx` (wiring), `src/styles.css` (only if the default `.wsitem` hover/focus washes do not already apply — reuse before adding)
- Test: `src/repositories/repository-model.test.ts`, `src/ui/repository-rail.test.tsx`

**Interfaces:**

- Consumes: `sessionArchive` signal (Task 4), `resumeWorkspace` (Task 7).
- Produces:

```ts
// repository-model.ts
export interface RailInput {
  // …existing…
  /** Workspace paths with an archived session — their empty rows become pressable. */
  readonly archivedPaths: ReadonlySet<string>;
}
export interface WorktreeRow {
  // …existing…
  /** Empty row with an archived session: pressable "resume" row, not a readout. */
  readonly resumable: boolean;
}

// repository-rail.tsx / workspace-sidebar.tsx props (both, for the one-line revert parity)
/** A resumable row was clicked: rebuild that worktree's archived session. */
onResumeWorktree(path: string): void;
```

**Behavior:**

- `buildRail`: `resumable = tabs.length === 0 && archivedPaths.has(path)` (compute per worktree via `worktreeForPath(archivedKeys, …)`? No — archive keys ARE workspace paths; match with the same `worktreeForPath` longest-prefix helper used for tabs, so an archive entry recorded on a subdirectory still lights its worktree). State stays `"idle"`.
- Rail: in `worktreeRows`, a row with `worktree.resumable` renders a **pressable** row instead of `readoutRow`: same `.wsitem` genre as tab rows (border/hover/selection washes per DL-21.1/21.2 come from `.wsitem` itself; no `--readout` modifier), `tabIndex={0}`, `role="button"`, `aria-label={`Resume last session in ${worktree.name}`}`, `onClick={() => props.onResumeWorktree(worktree.path)}`, Enter/Space keydown doing the same, `WorktreeStateDot` state `"idle"`, no close button. Non-resumable empty rows keep today's readout treatment. Update the file-level doc comment (lines ~65–71): the "unapproved fork" paragraph is resolved by this plan — reference this plan file and the AGENTS.md fork-queue entry (Task 11).
- Rail reads `sessionArchive.value` and passes `archivedPaths` into `buildRail` (alongside the existing uncommitted `filterRailToWorkspaceHistory` history source, which stays as-is).
- `app.tsx`:

```tsx
onResumeWorktree={(path) => {
  const entry = sessionArchive.value[path] ??
    Object.entries(sessionArchive.value).find(([key]) => worktreeForPath([path], key) === path)?.[1];
  if (entry !== undefined) {
    void resumeWorkspace(railResumeDeps(), entry, path);
  }
}}
```

(`WorkspaceSidebar` gets the identical prop wired the same way; its flat list has no worktree rows today, so the prop is parity-only — document that in its doc comment, matching the existing parity note.)

- [ ] **Step 1: Failing model tests** — `resumable` true only for empty+archived rows; prefix matching; `resumable` false when the worktree has tabs even if archived.
- [ ] **Step 2: Failing rail tests** — resumable row is focusable and fires `onResumeWorktree` on click and Enter; a non-archived empty worktree still renders the readout (not focusable); archived-with-live-tabs renders normal tab rows.
- [ ] **Step 3: Implement model → rail → app wiring.** Run `npx vitest run src/repositories/repository-model.test.ts src/ui/repository-rail.test.tsx` → PASS.
- [ ] **Step 4: Commit** — `feat(rail): resumable worktree rows backed by the session archive`

---

### Task 10: Gallery specimen + native verification

**Files:**

- Modify: `src/gallery/seed-data.ts` (seed `sessionArchive` — "In-memory Deck history for rail specimens; never touches the real store" precedent), `src/gallery/main.tsx` (assign the seed), the section that renders `repositorySidebarSpecimen()` (`src/gallery/chrome-fixtures.tsx` + `sections/matrix-section.tsx`)

- [ ] **Step 1: Seed** `sessionArchive.value` in `main.tsx` with one archived-idle worktree among the existing seeded repositories so the rail specimen shows: an active row, a working row, a **resumable idle row**, and a plain readout row side by side.
- [ ] **Step 2: Run `npm run prototype:gallery`**, screenshot the chrome + matrix sections across the four theme columns (hover/selected/focus states); verify DL-21.1/21.2 washes and DL-18.7 recessed background by eye. Send screenshots to the owner — **owner eye review is a required gate (DL §9.6); automated checks do not establish it.**
- [ ] **Step 3: Native manual pass** (`npm run electron:dev`; use a wrapper/userData override per the dev-isolation trap in memory — headed runs write the owner's real `workspaces.json`):
  1. Open two tabs (claude + codex, different workspaces), one split pane, rename a tab, open a file tab. Quit via ⌘Q → relaunch → everything returns; both agents resume their conversations (verify by asking each "what were we talking about").
  2. Same setup → `kill -9` the Deck process (simulated power-off) → relaunch → same result (journal survives without the quit flush).
  3. Close a workspace's tabs → its rail row goes idle-resumable → click → tabs rebuild, agent resumes.
  4. Toggle "Restore sessions on launch" off → quit → relaunch → board opens, rail rows still resumable.
  5. Two claude panes in the SAME cwd → quit → relaunch → each resumes a different session id.
- [ ] **Step 4: Record evidence** (terminal output, screenshots) — W4: no completion claim without it. Windows behavior stays unverified (Gate C); say so.
- [ ] **Step 5: Commit** — `feat(gallery): resumable rail row specimen`

---

### Task 11: Docs + final gate

**Files:**

- Modify: `AGENTS.md` (Current direction bullet; Forks → Resolved entry; "Chưa khớp thực tế" row), `docs/CONTEXT.md` (new dated section: what shipped, evidence, the reversal of the old no-restore decision, the gemini/agy best-effort matrix, unverified Windows), `src/ui/repository-rail.tsx` doc-comment update if not done in Task 9

- [ ] **Step 1: AGENTS.md.** Fork queue entry (one line each): session restore reverses the recorded no-restore constraint; touched tab materialization (`MaterializeIntent.paneCommands`), `agent-launch.arm` signature, quit flush, and the rail's readout→pressable promotion — approved through brainstorming 2026-08-15 (this plan). "Chưa khớp thực tế": add `Session restore resumes agent conversations — building — unverified on Windows (Gate C); gemini/agy are best-effort by design`.
- [ ] **Step 2: docs/CONTEXT.md** section with anchors to the new modules (relative links + intent labels per D6).
- [ ] **Step 3: Final gate** — run and paste output:

```bash
npm test && npm run build && npm run generate:menu:check && npm run electron:build
```

- [ ] **Step 4: Commit** — `docs(session): record session-restore direction, fork resolution, and drift rows`

---

## Self-review notes (already applied)

- **Design coverage:** auto-restore (T7/T8), exact-id resume (T5/T6), all-agents best-effort matrix (T5/T6), continuous journal surviving power-off (T4), crash-loop marker (T7), empty-state persistence (T4 §3), suspend-during-restore (T4 §5 + T8 ordering), fold-in of secondary windows (T4 per-window keys + T7 §2/§8), file tabs at boot only (T7 §6, `resumeWorkspace` excludes them), sidebar normal-looking idle rows (T9), settings kill-switch (T8), Electron-only + docs (T11).
- **Known accepted risks:** per-CLI state-dir formats can change (resolvers degrade to bare launch); gemini/agy cannot be id-precise (user accepted); a secondary window destroyed without flush leaves a stale record until the next boot consumes it; scrollback, unsaved edits, and window placement are not restored.
- **Type consistency:** `ResumeRef`/`ResumeRequest` are declared in both processes (wire mirror, like `PtyInfo`/`PaneProcessInfo`); `SessionTab` flows Task 1 → 2 → 4 → 7 unchanged; `AgentLaunchEntry` is the only launcher input after Task 3.
