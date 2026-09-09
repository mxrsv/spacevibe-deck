# Session-Start Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v1 session-start journey — layout preset store + Open board (workspace ∥ preset) + preset editor (mini mock) + one-shot agent picker — covering REQUIREMENTS FR-001…FR-006, FR-010…FR-016, FR-020…FR-026.

**Architecture:** Pure logic lives in `src/lib/` (schema validation, recents, CWD resolution, mock-layout model reusing `split-tree.ts`); persistence is `@tauri-apps/plugin-store` files (`presets.json`, `workspaces.json`) behind thin signal stores; UI is Preact chrome (Open board, preset editor, save dialog, Skip-all bar) plus one imperative per-pane overlay module for the agent picker (same idiom as `search-bar.ts`); Rust gains `detect_agents` (login-shell `command -v` allowlist lookup) and `dirs_exist`. `TabManager` gains `openFromPreset` / `captureActiveLayout` and stops auto-creating a fallback tab so `App` can show the Open board.

**Tech Stack:** Tauri 2 (Rust), Preact 10 + @preact/signals, xterm.js 6, @tauri-apps/plugin-store, @tauri-apps/plugin-dialog, vitest, cargo test.

## Global Constraints

- All strings, comments, and docs in English (project rule).
- macOS-only commitment; no telemetry; all persistence is local plugin-store files (NFR-001, NFR-002).
- Immutability: every data transform returns new objects — no in-place mutation (project rule; matches `split-tree.ts` style).
- Every new surface must have both mouse and keyboard paths (NFR-003).
- Design language: flat system, 1px hairlines (`--hair`), no drop shadows, existing CSS tokens (`--bg`, `--accent`, `--chrome-1/2`, `--text-*`), overlays 12–14px radius, motion ~0.2s ease-out (NFR-006).
- `session.json` is never touched by presets — presets persist only in `presets.json` (FR-010 AC-3, BF-Inv 2).
- Agent allowlist v1 is exactly `claude`, `codex`, `gemini` (FR-020 AC-1).
- No regression of shipped surfaces (NFR-008): split, drag-dock, zoom, session restore, closed-tab reopen, busy guards keep working.
- Commands: unit tests `npx vitest run <file>` (all: `npm test`); Rust tests `cd src-tauri && cargo test`; typecheck+bundle `npm run build`; manual run `npm run tauri dev`.
- Commit after every task; message style `feat:`/`refactor:` matching repo history.

## Decisions made at plan level (consistent with ARCHITECTURE, not load-bearing)

- **Workspace recents persist in a new `workspaces.json`** (plugin-store). ARCHITECTURE §8 does not name a home for recents; embedding them in `settings.json` was rejected for the same reason D4 rejected embedding presets there.
- **`lastUsedId` (Open-board preset preselect, UX §8 decision 1) lives in `presets.json`** — same artifact domain.
- **`detect_agents` shells out to `$SHELL -lc 'command -v …'`** instead of scanning the Rust process `PATH`: a macOS GUI app inherits a stripped PATH (`/usr/bin:/bin:…`), so agent CLIs in `/usr/local/bin` or `~/.local/bin` would never be found. The login shell resolves the same PATH the spawned panes actually use (matches the `git_branch` shell-out trust model).
- **Picking an agent spawns it by writing `<name>\r` into the pane's PTY** — the login shell resolves it on its own PATH (ARCH D6 "writes/spawns that command in the pane's shell").
- **Agent picker cards are imperative DOM appended to each pane's element** (idiom of `search-bar.ts`); pane elements survive `render()` re-slotting, so cards follow their panes. The global Skip-all bar is Preact.
- **Open board Cancel is disabled while the window has no tabs** (launch path — there is nothing behind the board yet). New Window entry arrives with the multi-window plan.

## File Structure

```
src/lib/
  layout-validation.ts        (new) shared SerializedNode validator — extracted from session-schema
  preset-schema.ts            (new) Preset types, validation, pure CRUD ops, BUILT_IN_PRESET, resolveCwds
  workspace-recents.ts        (new) recents list ops + relative-time formatting
src/presets/
  presets-store.ts            (new) presets.json glue: signal + init/save/rename/delete/markLastUsed
  mock-model.ts               (new) preset-editor model: TreeNode + cwd map (reuses split-tree ops)
  preset-thumb.tsx            (new) miniature split-tree card thumbnail
  preset-editor.tsx           (new) mini layout mock modal
  save-preset-dialog.tsx      (new) save-from-live dialog (name / overwrite / include-CWDs)
  ui-signals.ts               (new) editorRequest / saveDialogOpen signals (keymap+menu → App)
src/open-board/
  workspaces-store.ts         (new) workspaces.json glue: signal + init/recordWorkspaceOpen
  open-board.tsx              (new) Open board modal (workspace ∥ preset, footer, CRUD)
src/agent-picker/
  picker-store.ts             (new) pending pane ids + detected agents signals + transitions
  agent-picker.ts             (new) imperative per-pane overlay cards; beginAgentPick
  skip-all-bar.tsx            (new) global Skip-all bar (Preact)
src/terminal/
  tab-manager.ts              (mod) openFromPreset, captureActiveLayout, init→{hasTabs}, picker hooks
  terminal-manager.ts         (mod) expose paneElement(id)
  keymap.ts                   (mod) add "save-preset" (⌘⇧S)
src/ui/app.tsx                (mod) board/editor/dialog/skip-bar mounting + menu event wiring
src/main.tsx                  (mod) initPresets + initWorkspaces at startup
src/lib/session-schema.ts     (mod) import validateLayout from layout-validation
src/styles.css                (mod) styles per new surface (tokens only)
src-tauri/src/agents.rs       (new) detect_agents + dirs_exist commands
src-tauri/src/lib.rs          (mod) register new commands, mod agents
src-tauri/src/menu.rs         (mod) Window ▸ New Layout Preset… / Save Layout as Preset…
```

---

### Task 1: Extract shared layout validation

**Files:**
- Create: `src/lib/layout-validation.ts`
- Create: `src/lib/layout-validation.test.ts`
- Modify: `src/lib/session-schema.ts` (remove private `validateLayout`, import the shared one)

**Interfaces:**
- Consumes: `SerializedNode` from `src/lib/split-tree.ts`
- Produces: `validateLayout(raw: unknown, depth?: number): SerializedNode | null` and `MAX_LAYOUT_DEPTH = 8` — Task 2 (preset validation) and the existing session validation both import these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layout-validation.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateLayout } from "./layout-validation";

describe("validateLayout", () => {
  it("accepts a leaf", () => {
    expect(validateLayout({ type: "leaf" })).toEqual({ type: "leaf" });
  });

  it("accepts a nested split and strips unknown fields", () => {
    const raw = {
      type: "split",
      direction: "row",
      ratio: 0.4,
      first: { type: "leaf", junk: 1 },
      second: { type: "leaf" },
      extra: true,
    };
    expect(validateLayout(raw)).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.4,
      first: { type: "leaf" },
      second: { type: "leaf" },
    });
  });

  it("rejects out-of-range ratios", () => {
    const raw = {
      type: "split",
      direction: "row",
      ratio: 1,
      first: { type: "leaf" },
      second: { type: "leaf" },
    };
    expect(validateLayout(raw)).toBeNull();
  });

  it("rejects trees deeper than MAX_LAYOUT_DEPTH", () => {
    let node: unknown = { type: "leaf" };
    for (let i = 0; i < 10; i += 1) {
      node = {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: node,
        second: { type: "leaf" },
      };
    }
    expect(validateLayout(node)).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(validateLayout("leaf")).toBeNull();
    expect(validateLayout(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layout-validation.test.ts`
Expected: FAIL — `Cannot find module './layout-validation'`

- [ ] **Step 3: Create the module (move the code, do not rewrite it)**

Create `src/lib/layout-validation.ts` — the body is the existing `validateLayout` from `session-schema.ts` with `MAX_LAYOUT_DEPTH` and a default depth:

```typescript
import type { SerializedNode } from "./split-tree";

/** Depth bound so a corrupt file cannot describe a pathological tree. */
export const MAX_LAYOUT_DEPTH = 8;

/** null = corrupt/foreign shape — callers decide the fallback. */
export function validateLayout(
  raw: unknown,
  depth = 0,
): SerializedNode | null {
  if (typeof raw !== "object" || raw === null || depth > MAX_LAYOUT_DEPTH) {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (node.type === "leaf") {
    return { type: "leaf" };
  }
  if (node.type !== "split") {
    return null;
  }
  if (node.direction !== "row" && node.direction !== "column") {
    return null;
  }
  if (
    typeof node.ratio !== "number" ||
    !Number.isFinite(node.ratio) ||
    node.ratio <= 0 ||
    node.ratio >= 1
  ) {
    return null;
  }
  const first = validateLayout(node.first, depth + 1);
  const second = validateLayout(node.second, depth + 1);
  if (first === null || second === null) {
    return null;
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    first,
    second,
  };
}
```

In `src/lib/session-schema.ts`: delete the local `validateLayout` function and the `MAX_LAYOUT_DEPTH` constant, and add the import at the top:

```typescript
import { validateLayout } from "./layout-validation";
```

Update the one call site — `validateLayout((rawTab as Record<string, unknown>).layout, 0)` stays valid as-is (the second argument is now optional).

- [ ] **Step 4: Run tests to verify everything passes**

Run: `npm test`
Expected: PASS — new file green, `session-schema.test.ts` untouched and still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout-validation.ts src/lib/layout-validation.test.ts src/lib/session-schema.ts
git commit -m "refactor: extract shared layout validation from session schema"
```

---

### Task 2: Preset schema, pure CRUD ops, built-in preset

**Files:**
- Create: `src/lib/preset-schema.ts`
- Create: `src/lib/preset-schema.test.ts`

**Interfaces:**
- Consumes: `validateLayout` (Task 1), `SerializedNode`, `countLeaves` from `split-tree.ts`
- Produces (used by Tasks 5, 7, 9, 10, 12, 14):
  - `interface Preset { id: string; name: string; layout: SerializedNode; cwds?: readonly (string | null)[] }`
  - `interface PresetsData { version: number; presets: readonly Preset[]; lastUsedId?: string }`
  - `PRESETS_VERSION = 1`, `BUILT_IN_PRESET: Preset` (id `"built-in"`, name `"Single pane"`, leaf layout, no cwds), `isBuiltIn(preset: Preset): boolean`
  - `validatePresets(raw: unknown): PresetsData`
  - `upsertPreset(list: readonly Preset[], preset: Preset): readonly Preset[]`
  - `renamePresetIn(list: readonly Preset[], id: string, name: string): readonly Preset[]`
  - `removePreset(list: readonly Preset[], id: string): readonly Preset[]`
  - `resolveCwds(preset: Preset, workspace: string): readonly (string | null)[]` — FR-005 AC-2

- [ ] **Step 1: Write the failing test**

Create `src/lib/preset-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { SerializedNode } from "./split-tree";
import {
  BUILT_IN_PRESET,
  isBuiltIn,
  removePreset,
  renamePresetIn,
  resolveCwds,
  upsertPreset,
  validatePresets,
  type Preset,
} from "./preset-schema";

const SPLIT: SerializedNode = {
  type: "split",
  direction: "row",
  ratio: 0.5,
  first: { type: "leaf" },
  second: { type: "leaf" },
};

const QUAD: Preset = {
  id: "p1",
  name: "quad",
  layout: SPLIT,
  cwds: ["/work", null],
};

describe("validatePresets", () => {
  it("returns an empty store for corrupt envelopes", () => {
    expect(validatePresets(undefined)).toEqual({ version: 1, presets: [] });
    expect(validatePresets({ version: 2, presets: [] })).toEqual({
      version: 1,
      presets: [],
    });
  });

  it("keeps valid presets and drops invalid entries", () => {
    const raw = {
      version: 1,
      presets: [
        { id: "a", name: "ok", layout: { type: "leaf" } },
        { id: "b", name: "", layout: { type: "leaf" } },
        { id: "c", name: "bad-layout", layout: { type: "grid" } },
        "junk",
      ],
      lastUsedId: "a",
    };
    const data = validatePresets(raw);
    expect(data.presets.map((preset) => preset.id)).toEqual(["a"]);
    expect(data.lastUsedId).toBe("a");
  });

  it("drops a cwds array whose length does not match the leaf count", () => {
    const raw = {
      version: 1,
      presets: [{ id: "a", name: "two", layout: SPLIT, cwds: ["/only-one"] }],
    };
    expect(validatePresets(raw).presets[0].cwds).toBeUndefined();
  });

  it("drops lastUsedId that points at no preset", () => {
    const raw = { version: 1, presets: [], lastUsedId: "ghost" };
    expect(validatePresets(raw).lastUsedId).toBeUndefined();
  });
});

describe("pure CRUD ops", () => {
  it("upsert appends new and replaces by id without mutating", () => {
    const one = upsertPreset([], QUAD);
    expect(one).toHaveLength(1);
    const renamedQuad = { ...QUAD, name: "quad-2" };
    const two = upsertPreset(one, renamedQuad);
    expect(two).toHaveLength(1);
    expect(two[0].name).toBe("quad-2");
    expect(one[0].name).toBe("quad");
  });

  it("rename and remove target by id and ignore unknown ids", () => {
    const list = [QUAD];
    expect(renamePresetIn(list, "p1", "grid")[0].name).toBe("grid");
    expect(renamePresetIn(list, "nope", "x")).toEqual(list);
    expect(removePreset(list, "p1")).toEqual([]);
    expect(removePreset(list, "nope")).toEqual(list);
  });
});

describe("resolveCwds (FR-005 AC-2)", () => {
  it("uses the preset cwd when set, else the workspace folder", () => {
    expect(resolveCwds(QUAD, "/ws")).toEqual(["/work", "/ws"]);
  });

  it("fills every leaf with the workspace when the preset has no cwds", () => {
    expect(resolveCwds(BUILT_IN_PRESET, "/ws")).toEqual(["/ws"]);
  });
});

describe("built-in preset (FR-011)", () => {
  it("is a single leaf with no cwds and is recognizable", () => {
    expect(BUILT_IN_PRESET.layout).toEqual({ type: "leaf" });
    expect(BUILT_IN_PRESET.cwds).toBeUndefined();
    expect(isBuiltIn(BUILT_IN_PRESET)).toBe(true);
    expect(isBuiltIn(QUAD)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/preset-schema.test.ts`
Expected: FAIL — `Cannot find module './preset-schema'`

- [ ] **Step 3: Implement**

Create `src/lib/preset-schema.ts`:

```typescript
import { countLeaves, type SerializedNode } from "./split-tree";
import { validateLayout } from "./layout-validation";

export const PRESETS_VERSION = 1;
export const BUILT_IN_PRESET_ID = "built-in";

// Sanity bounds so a corrupt file cannot flood the Open board
const MAX_PRESETS = 32;
const MAX_PRESET_NAME_LENGTH = 64;

/** One named layout template: split tree + optional per-leaf CWDs (ARCH D4). */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly layout: SerializedNode;
  /** Zips leaves left-to-right; null = inherit the workspace folder. */
  readonly cwds?: readonly (string | null)[];
}

export interface PresetsData {
  readonly version: number;
  readonly presets: readonly Preset[];
  /** Open-board preselect (UX §8 decision 1); undefined = built-in. */
  readonly lastUsedId?: string;
}

/** Code-defined default so Open can never soft-lock (BF-Rule 4, FR-011). */
export const BUILT_IN_PRESET: Preset = {
  id: BUILT_IN_PRESET_ID,
  name: "Single pane",
  layout: { type: "leaf" },
};

export function isBuiltIn(preset: Preset): boolean {
  return preset.id === BUILT_IN_PRESET_ID;
}

function validatePresetName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_PRESET_NAME_LENGTH) {
    return null;
  }
  return trimmed;
}

function validateCwds(
  raw: unknown,
  layout: SerializedNode,
): readonly (string | null)[] | undefined {
  if (!Array.isArray(raw) || raw.length !== countLeaves(layout)) {
    return undefined;
  }
  const cwds = raw.map((entry) => (typeof entry === "string" ? entry : null));
  return cwds.every((entry) => entry === null) ? undefined : cwds;
}

function validatePreset(raw: unknown): Preset | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id === "") {
    return null;
  }
  const name = validatePresetName(source.name);
  if (name === null) {
    return null;
  }
  const layout = validateLayout(source.layout);
  if (layout === null) {
    return null;
  }
  const cwds = validateCwds(source.cwds, layout);
  return { id: source.id, name, layout, ...(cwds ? { cwds } : {}) };
}

/** Invalid envelope → empty store; invalid entries are dropped one by one. */
export function validatePresets(raw: unknown): PresetsData {
  const empty: PresetsData = { version: PRESETS_VERSION, presets: [] };
  if (typeof raw !== "object" || raw === null) {
    return empty;
  }
  const source = raw as Record<string, unknown>;
  if (source.version !== PRESETS_VERSION || !Array.isArray(source.presets)) {
    return empty;
  }
  const presets: Preset[] = [];
  for (const entry of source.presets.slice(0, MAX_PRESETS)) {
    const preset = validatePreset(entry);
    if (preset !== null && !presets.some((p) => p.id === preset.id)) {
      presets.push(preset);
    }
  }
  const lastUsedId =
    typeof source.lastUsedId === "string" &&
    presets.some((preset) => preset.id === source.lastUsedId)
      ? source.lastUsedId
      : undefined;
  return {
    version: PRESETS_VERSION,
    presets,
    ...(lastUsedId !== undefined ? { lastUsedId } : {}),
  };
}

/** Replace by id when present, else append. */
export function upsertPreset(
  list: readonly Preset[],
  preset: Preset,
): readonly Preset[] {
  return list.some((entry) => entry.id === preset.id)
    ? list.map((entry) => (entry.id === preset.id ? preset : entry))
    : [...list, preset];
}

export function renamePresetIn(
  list: readonly Preset[],
  id: string,
  name: string,
): readonly Preset[] {
  return list.map((entry) => (entry.id === id ? { ...entry, name } : entry));
}

export function removePreset(
  list: readonly Preset[],
  id: string,
): readonly Preset[] {
  return list.filter((entry) => entry.id !== id);
}

/** Pane CWD = preset cwd when set, else the workspace folder (BF-Rule 6). */
export function resolveCwds(
  preset: Preset,
  workspace: string,
): readonly (string | null)[] {
  const total = countLeaves(preset.layout);
  return Array.from(
    { length: total },
    (_, index) => preset.cwds?.[index] ?? workspace,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/preset-schema.test.ts`
Expected: PASS (all describe blocks)

- [ ] **Step 5: Commit**

```bash
git add src/lib/preset-schema.ts src/lib/preset-schema.test.ts
git commit -m "feat: preset schema with validation, pure CRUD ops and built-in preset"
```

---

### Task 3: Workspace recents library

**Files:**
- Create: `src/lib/workspace-recents.ts`
- Create: `src/lib/workspace-recents.test.ts`

**Interfaces:**
- Produces (used by Tasks 5, 7):
  - `interface RecentWorkspace { path: string; lastOpenedAt: number }`
  - `interface WorkspacesData { version: number; recents: readonly RecentWorkspace[] }`
  - `WORKSPACES_VERSION = 1`, `MAX_RECENTS = 8`
  - `validateWorkspaces(raw: unknown): WorkspacesData`
  - `pushRecent(recents: readonly RecentWorkspace[], path: string, now: number): readonly RecentWorkspace[]` — most-recent first, dedupes by path (FR-003 AC-3), caps at 8
  - `folderName(path: string): string` — last path segment for row titles
  - `formatRelativeTime(then: number, now: number): string` — "just now" / "5m ago" / "2h ago" / "3d ago" / "2w ago"

- [ ] **Step 1: Write the failing test**

Create `src/lib/workspace-recents.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  folderName,
  formatRelativeTime,
  MAX_RECENTS,
  pushRecent,
  validateWorkspaces,
} from "./workspace-recents";

const NOW = 1_800_000_000_000;

describe("pushRecent", () => {
  it("puts the newest entry first", () => {
    const one = pushRecent([], "/a", NOW);
    const two = pushRecent(one, "/b", NOW + 1);
    expect(two.map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("dedupes by path, moving it to the front with a fresh timestamp", () => {
    const list = pushRecent(pushRecent([], "/a", NOW), "/b", NOW + 1);
    const again = pushRecent(list, "/a", NOW + 2);
    expect(again.map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(again[0].lastOpenedAt).toBe(NOW + 2);
  });

  it("caps the list at MAX_RECENTS, dropping the oldest", () => {
    let list = pushRecent([], "/0", NOW);
    for (let i = 1; i <= MAX_RECENTS; i += 1) {
      list = pushRecent(list, `/${i}`, NOW + i);
    }
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list.some((r) => r.path === "/0")).toBe(false);
  });
});

describe("validateWorkspaces", () => {
  it("returns empty data for corrupt input", () => {
    expect(validateWorkspaces(undefined)).toEqual({ version: 1, recents: [] });
    expect(validateWorkspaces({ version: 9 })).toEqual({
      version: 1,
      recents: [],
    });
  });

  it("keeps valid entries and drops junk", () => {
    const raw = {
      version: 1,
      recents: [
        { path: "/a", lastOpenedAt: NOW },
        { path: "", lastOpenedAt: NOW },
        { path: "/b", lastOpenedAt: "yesterday" },
        42,
      ],
    };
    expect(validateWorkspaces(raw).recents).toEqual([
      { path: "/a", lastOpenedAt: NOW },
    ]);
  });
});

describe("display helpers", () => {
  it("folderName returns the last segment", () => {
    expect(folderName("/Users/dev/work/monorepo")).toBe("monorepo");
    expect(folderName("/")).toBe("/");
  });

  it("formatRelativeTime buckets by age", () => {
    const MIN = 60_000;
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 2 * 60 * MIN, NOW)).toBe("2h ago");
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * MIN, NOW)).toBe("3d ago");
    expect(formatRelativeTime(NOW - 14 * 24 * 60 * MIN, NOW)).toBe("2w ago");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/workspace-recents.test.ts`
Expected: FAIL — `Cannot find module './workspace-recents'`

- [ ] **Step 3: Implement**

Create `src/lib/workspace-recents.ts`:

```typescript
export const WORKSPACES_VERSION = 1;
export const MAX_RECENTS = 8;

export interface RecentWorkspace {
  readonly path: string;
  readonly lastOpenedAt: number;
}

export interface WorkspacesData {
  readonly version: number;
  readonly recents: readonly RecentWorkspace[];
}

/** Invalid envelope → empty list; invalid entries are dropped one by one. */
export function validateWorkspaces(raw: unknown): WorkspacesData {
  const empty: WorkspacesData = { version: WORKSPACES_VERSION, recents: [] };
  if (typeof raw !== "object" || raw === null) {
    return empty;
  }
  const source = raw as Record<string, unknown>;
  if (source.version !== WORKSPACES_VERSION || !Array.isArray(source.recents)) {
    return empty;
  }
  const recents: RecentWorkspace[] = [];
  for (const entry of source.recents.slice(0, MAX_RECENTS)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.path === "string" &&
      record.path !== "" &&
      typeof record.lastOpenedAt === "number" &&
      Number.isFinite(record.lastOpenedAt) &&
      !recents.some((r) => r.path === record.path)
    ) {
      recents.push({ path: record.path, lastOpenedAt: record.lastOpenedAt });
    }
  }
  return { version: WORKSPACES_VERSION, recents };
}

/** Newest first; same path moves to the front (no duplicate rows — FR-003 AC-3). */
export function pushRecent(
  recents: readonly RecentWorkspace[],
  path: string,
  now: number,
): readonly RecentWorkspace[] {
  const rest = recents.filter((entry) => entry.path !== path);
  return [{ path, lastOpenedAt: now }, ...rest].slice(0, MAX_RECENTS);
}

export function folderName(path: string): string {
  const trimmed = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return segment === "" ? trimmed : segment;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatRelativeTime(then: number, now: number): string {
  const age = Math.max(0, now - then);
  if (age < MINUTE) {
    return "just now";
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m ago`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h ago`;
  }
  if (age < WEEK) {
    return `${Math.floor(age / DAY)}d ago`;
  }
  return `${Math.floor(age / WEEK)}w ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/workspace-recents.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace-recents.ts src/lib/workspace-recents.test.ts
git commit -m "feat: workspace recents list ops and relative-time formatting"
```

---

### Task 4: Rust `detect_agents` + `dirs_exist` commands

**Files:**
- Create: `src-tauri/src/agents.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod agents;`, register both commands)

**Interfaces:**
- Produces (used by Tasks 7, 11):
  - Command `detect_agents() -> Vec<AgentInfo>` where `AgentInfo { name: String, path: String }` — allowlist order (`claude`, `codex`, `gemini`), only binaries the **login shell** resolves (FR-020)
  - Command `dirs_exist(paths: Vec<String>) -> Vec<bool>` — same order as input; used by the Open board to flag missing recents (FR-003 AC-2)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/agents.rs` with tests first (module skeleton so the crate compiles enough to fail on assertions is unnecessary — write tests + stubs together is NOT allowed; write the test module referencing the real functions and let the build fail):

```rust
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AgentInfo {
    pub name: String,
    pub path: String,
}

/// Allowlist aligned with the chrome recognition names (ARCH D6).
pub const AGENT_ALLOWLIST: [&str; 3] = ["claude", "codex", "gemini"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_absolute_paths_in_allowlist_order() {
        let out = "/usr/local/bin/claude\n/Users/dev/.local/bin/gemini\n";
        assert_eq!(
            parse_command_v_output(out),
            vec![
                AgentInfo {
                    name: "claude".into(),
                    path: "/usr/local/bin/claude".into()
                },
                AgentInfo {
                    name: "gemini".into(),
                    path: "/Users/dev/.local/bin/gemini".into()
                },
            ]
        );
    }

    #[test]
    fn ignores_non_paths_and_unknown_binaries() {
        // `command -v` may echo aliases/functions or nothing; keep only
        // absolute paths whose basename is on the allowlist.
        let out = "alias claude='claude --tips'\n/usr/local/bin/ripgrep\n\n/opt/bin/codex\n";
        assert_eq!(
            parse_command_v_output(out),
            vec![AgentInfo {
                name: "codex".into(),
                path: "/opt/bin/codex".into()
            }]
        );
    }

    #[test]
    fn dedupes_repeated_names() {
        let out = "/a/claude\n/b/claude\n";
        assert_eq!(parse_command_v_output(out).len(), 1);
    }

    #[test]
    fn dirs_exist_checks_each_path() {
        let tmp = std::env::temp_dir();
        let missing = tmp.join("stackgrid-definitely-missing-dir");
        let results = tauri::async_runtime::block_on(dirs_exist(vec![
            tmp.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]));
        assert_eq!(results, vec![true, false]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test agents`
Expected: COMPILE ERROR — `parse_command_v_output` and `dirs_exist` not found.

- [ ] **Step 3: Implement**

Add above the `#[cfg(test)]` module in `src-tauri/src/agents.rs`:

```rust
/// Keep only absolute paths whose basename is allowlisted, first hit per
/// name wins, result ordered by first appearance (script emits allowlist
/// order, so numbering in the picker is stable).
fn parse_command_v_output(output: &str) -> Vec<AgentInfo> {
    let mut found: Vec<AgentInfo> = Vec::new();
    for line in output.lines() {
        let path = line.trim();
        if !path.starts_with('/') {
            continue;
        }
        let Some(name) = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
        else {
            continue;
        };
        if AGENT_ALLOWLIST.contains(&name) && !found.iter().any(|a| a.name == name) {
            found.push(AgentInfo {
                name: name.to_string(),
                path: path.to_string(),
            });
        }
    }
    found
}

/// Resolve the allowlist through the user's LOGIN shell — the GUI process
/// PATH is stripped on macOS, but `$SHELL -lc` sees the same PATH the
/// spawned panes use. Any failure degrades to an empty list (picker then
/// shows Shell only — FR-025).
#[tauri::command]
pub async fn detect_agents() -> Vec<AgentInfo> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let script = AGENT_ALLOWLIST
        .iter()
        .map(|name| format!("command -v {name}"))
        .collect::<Vec<_>>()
        .join("; ");
    let output = match std::process::Command::new(&shell)
        .args(["-lc", &script])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    parse_command_v_output(&String::from_utf8_lossy(&output.stdout))
}

/// Existence check for workspace recents (FR-003 AC-2); order mirrors input.
#[tauri::command]
pub async fn dirs_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|path| std::path::Path::new(path).is_dir())
        .collect()
}
```

In `src-tauri/src/lib.rs`: add `mod agents;` next to the other mods, and extend the handler list:

```rust
        .invoke_handler(tauri::generate_handler![
            pty::spawn_shell,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            info::pty_info,
            info::git_branch,
            agents::detect_agents,
            agents::dirs_exist,
            confirm_quit
        ])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test agents`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agents.rs src-tauri/src/lib.rs
git commit -m "feat: detect_agents via login shell and dirs_exist command"
```

---

### Task 5: Persistence stores (presets.json, workspaces.json)

Thin glue over the tested pure ops (same pattern as `settings-store.ts`, which also has no unit test of its own). Verification is typecheck + build; behavior is exercised end-to-end in Task 14.

**Files:**
- Create: `src/presets/presets-store.ts`
- Create: `src/open-board/workspaces-store.ts`
- Modify: `src/main.tsx` (init both stores at startup)

**Interfaces:**
- Consumes: Task 2 (`validatePresets`, CRUD ops), Task 3 (`validateWorkspaces`, `pushRecent`)
- Produces (used by Tasks 7, 9, 10, 14):
  - `presetsData: Signal<PresetsData>`, `initPresets(): Promise<void>`, `savePreset(preset: Preset): void`, `renamePreset(id: string, name: string): void`, `deletePreset(id: string): void`, `markLastUsed(id: string): void`, `boardPresets(): readonly Preset[]` (built-in first, then saved)
  - `workspacesData: Signal<WorkspacesData>`, `initWorkspaces(): Promise<void>`, `recordWorkspaceOpen(path: string): void`

- [ ] **Step 1: Implement the presets store**

Create `src/presets/presets-store.ts`:

```typescript
import { signal } from "@preact/signals";
import { Store } from "@tauri-apps/plugin-store";
import {
  BUILT_IN_PRESET,
  PRESETS_VERSION,
  removePreset,
  renamePresetIn,
  upsertPreset,
  validatePresets,
  type Preset,
  type PresetsData,
} from "../lib/preset-schema";

const STORE_FILE = "presets.json";
const STORE_KEY = "presets";

export const presetsData = signal<PresetsData>({
  version: PRESETS_VERSION,
  presets: [],
});

let store: Store | null = null;

/** Load presets at startup — on failure fall back to empty, app keeps running. */
export async function initPresets(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    presetsData.value = validatePresets(raw);
  } catch (err) {
    console.warn("Failed to load presets, starting empty:", err);
  }
}

function persist(next: PresetsData): void {
  presetsData.value = next;
  store
    ?.set(STORE_KEY, next)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn("Failed to save presets:", err);
    });
}

export function savePreset(preset: Preset): void {
  persist({
    ...presetsData.value,
    presets: upsertPreset(presetsData.value.presets, preset),
  });
}

export function renamePreset(id: string, name: string): void {
  persist({
    ...presetsData.value,
    presets: renamePresetIn(presetsData.value.presets, id, name),
  });
}

export function deletePreset(id: string): void {
  const { lastUsedId, ...rest } = presetsData.value;
  persist({
    ...rest,
    ...(lastUsedId !== undefined && lastUsedId !== id ? { lastUsedId } : {}),
    presets: removePreset(presetsData.value.presets, id),
  });
}

export function markLastUsed(id: string): void {
  persist({ ...presetsData.value, lastUsedId: id });
}

/** Cards for the Open board: built-in always present and first (FR-011). */
export function boardPresets(): readonly Preset[] {
  return [BUILT_IN_PRESET, ...presetsData.value.presets];
}
```

- [ ] **Step 2: Implement the workspaces store**

Create `src/open-board/workspaces-store.ts`:

```typescript
import { signal } from "@preact/signals";
import { Store } from "@tauri-apps/plugin-store";
import {
  pushRecent,
  validateWorkspaces,
  WORKSPACES_VERSION,
  type WorkspacesData,
} from "../lib/workspace-recents";

const STORE_FILE = "workspaces.json";
const STORE_KEY = "workspaces";

export const workspacesData = signal<WorkspacesData>({
  version: WORKSPACES_VERSION,
  recents: [],
});

let store: Store | null = null;

/** Load recents at startup — on failure fall back to empty, app keeps running. */
export async function initWorkspaces(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    workspacesData.value = validateWorkspaces(raw);
  } catch (err) {
    console.warn("Failed to load workspace recents, starting empty:", err);
  }
}

/** Record a folder opened from the board (also called for Open Folder picks). */
export function recordWorkspaceOpen(path: string): void {
  const next: WorkspacesData = {
    version: WORKSPACES_VERSION,
    recents: pushRecent(workspacesData.value.recents, path, Date.now()),
  };
  workspacesData.value = next;
  store
    ?.set(STORE_KEY, next)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn("Failed to save workspace recents:", err);
    });
}
```

- [ ] **Step 3: Init both at startup**

In `src/main.tsx`, extend `main()`:

```typescript
import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { initSettings } from "./settings/settings-store";
import { initPresets } from "./presets/presets-store";
import { initWorkspaces } from "./open-board/workspaces-store";
import { App } from "./ui/app";

async function main(): Promise<void> {
  await initSettings();
  await Promise.all([initPresets(), initWorkspaces()]);
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("#root element not found");
  }
  render(<App />, root);
}

void main();
```

- [ ] **Step 4: Verify typecheck + full suite**

Run: `npm run build && npm test`
Expected: build PASS, tests PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/presets/presets-store.ts src/open-board/workspaces-store.ts src/main.tsx
git commit -m "feat: presets.json and workspaces.json persistence stores"
```

---

### Task 6: Agent picker store (pending state machine)

**Files:**
- Create: `src/agent-picker/picker-store.ts`
- Create: `src/agent-picker/picker-store.test.ts`

**Interfaces:**
- Produces (used by Tasks 11, 12, 14):
  - `interface DetectedAgent { name: string; path: string }` (mirror of Rust `AgentInfo`)
  - `pendingPaneIds: Signal<readonly number[]>`, `detectedAgents: Signal<readonly DetectedAgent[]>`
  - `beginPick(paneIds: readonly number[]): void` — adds panes to the pending set (one-shot cycle start, FR-021)
  - `resolvePane(id: number): void` — pick/Shell resolved one pane (FR-022/023)
  - `skipAll(): void` — clears every pending pane (FR-024)
  - `prunePending(alive: readonly number[]): void` — drops panes that no longer exist (closed while pending)

- [ ] **Step 1: Write the failing test**

Create `src/agent-picker/picker-store.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import {
  beginPick,
  pendingPaneIds,
  prunePending,
  resolvePane,
  skipAll,
} from "./picker-store";

beforeEach(() => {
  skipAll();
});

describe("picker store", () => {
  it("beginPick adds panes without duplicating", () => {
    beginPick([1, 2]);
    beginPick([2, 3]);
    expect(pendingPaneIds.value).toEqual([1, 2, 3]);
  });

  it("resolvePane removes exactly one pane (one-shot per pane, FR-021)", () => {
    beginPick([1, 2]);
    resolvePane(1);
    expect(pendingPaneIds.value).toEqual([2]);
    resolvePane(1); // already resolved — no-op
    expect(pendingPaneIds.value).toEqual([2]);
  });

  it("skipAll clears every pending pane (FR-024)", () => {
    beginPick([1, 2, 3]);
    resolvePane(2);
    skipAll();
    expect(pendingPaneIds.value).toEqual([]);
  });

  it("prunePending drops panes that no longer exist", () => {
    beginPick([1, 2, 3]);
    prunePending([1, 3, 99]);
    expect(pendingPaneIds.value).toEqual([1, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent-picker/picker-store.test.ts`
Expected: FAIL — `Cannot find module './picker-store'`

- [ ] **Step 3: Implement**

Create `src/agent-picker/picker-store.ts`:

```typescript
import { signal } from "@preact/signals";

/** Mirror of the Rust `AgentInfo` payload from `detect_agents`. */
export interface DetectedAgent {
  readonly name: string;
  readonly path: string;
}

/** Panes awaiting their one-shot agent pick for this materialization. */
export const pendingPaneIds = signal<readonly number[]>([]);

/** Result of the last `detect_agents` call (allowlist order). */
export const detectedAgents = signal<readonly DetectedAgent[]>([]);

export function beginPick(paneIds: readonly number[]): void {
  const merged = new Set([...pendingPaneIds.value, ...paneIds]);
  pendingPaneIds.value = [...merged];
}

export function resolvePane(id: number): void {
  if (!pendingPaneIds.value.includes(id)) {
    return;
  }
  pendingPaneIds.value = pendingPaneIds.value.filter(
    (paneId) => paneId !== id,
  );
}

export function skipAll(): void {
  pendingPaneIds.value = [];
}

/** Panes can close while pending (exit, tab close) — drop the dead ids. */
export function prunePending(alive: readonly number[]): void {
  const aliveSet = new Set(alive);
  const next = pendingPaneIds.value.filter((id) => aliveSet.has(id));
  if (next.length !== pendingPaneIds.value.length) {
    pendingPaneIds.value = next;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/agent-picker/picker-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-picker/picker-store.ts src/agent-picker/picker-store.test.ts
git commit -m "feat: agent picker pending-state store"
```

---

### Task 7: Open board UI (workspace ∥ preset)

Preact modal per UX §2. No component-test infra in this repo — verification is `npm run build` plus the manual checks below; all decision logic already lives in tested libs.

**Files:**
- Create: `src/presets/preset-thumb.tsx`
- Create: `src/open-board/open-board.tsx`
- Modify: `src/styles.css` (append board + thumb styles)

**Interfaces:**
- Consumes: `boardPresets`, `presetsData`, `renamePreset`, `deletePreset` (Task 5); `workspacesData` (Task 5); `folderName`, `formatRelativeTime` (Task 3); `isBuiltIn`, `type Preset` (Task 2); Rust `dirs_exist` (Task 4); `open` from `@tauri-apps/plugin-dialog`
- Produces (used by Task 14):
  - `OpenBoard` component with props `interface OpenBoardProps { canCancel: boolean; onCancel(): void; onOpen(workspace: string, preset: Preset): void; onNewPreset(workspace: string | null): void }`
  - `PresetThumb` component with props `{ layout: SerializedNode }`

- [ ] **Step 1: Implement the thumbnail**

Create `src/presets/preset-thumb.tsx`:

```tsx
import type { SerializedNode } from "../lib/split-tree";

interface PresetThumbProps {
  layout: SerializedNode;
}

function ThumbNode({ node }: { node: SerializedNode }) {
  if (node.type === "leaf") {
    return <div class="preset-thumb__leaf" />;
  }
  return (
    <div
      class={`preset-thumb__split ${
        node.direction === "row" ? "is-row" : "is-column"
      }`}
    >
      <div class="preset-thumb__branch" style={{ flex: node.ratio }}>
        <ThumbNode node={node.first} />
      </div>
      <div class="preset-thumb__branch" style={{ flex: 1 - node.ratio }}>
        <ThumbNode node={node.second} />
      </div>
    </div>
  );
}

/** Miniature of a preset's split tree for board cards (UX §2). */
export function PresetThumb({ layout }: PresetThumbProps) {
  return (
    <div class="preset-thumb" aria-hidden="true">
      <ThumbNode node={layout} />
    </div>
  );
}
```

- [ ] **Step 2: Implement the board**

Create `src/open-board/open-board.tsx`:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { open } from "@tauri-apps/plugin-dialog";
import { countLeaves } from "../lib/split-tree";
import { isBuiltIn, type Preset } from "../lib/preset-schema";
import { folderName, formatRelativeTime } from "../lib/workspace-recents";
import {
  boardPresets,
  deletePreset,
  presetsData,
  renamePreset,
} from "../presets/presets-store";
import { workspacesData } from "./workspaces-store";
import { PresetThumb } from "../presets/preset-thumb";

export interface OpenBoardProps {
  canCancel: boolean;
  onCancel(): void;
  onOpen(workspace: string, preset: Preset): void;
  onNewPreset(workspace: string | null): void;
}

type BoardColumn = "workspace" | "preset";

export function OpenBoard({
  canCancel,
  onCancel,
  onOpen,
  onNewPreset,
}: OpenBoardProps) {
  const recents = workspacesData.value.recents;
  const presets = boardPresets();
  const selectedPath = useSignal<string | null>(recents[0]?.path ?? null);
  const selectedPresetId = useSignal<string>(
    presetsData.value.lastUsedId ?? presets[0].id,
  );
  const column = useSignal<BoardColumn>("workspace");
  const missing = useSignal<ReadonlySet<string>>(new Set());
  const renamingId = useSignal<string | null>(null);
  const renameValue = useSignal("");
  const confirmDeleteId = useSignal<string | null>(null);

  useEffect(() => {
    const paths = recents.map((recent) => recent.path);
    if (paths.length === 0) {
      return;
    }
    invoke<boolean[]>("dirs_exist", { paths })
      .then((flags) => {
        missing.value = new Set(paths.filter((_, index) => !flags[index]));
      })
      .catch((err: unknown) => {
        console.warn("dirs_exist failed:", err);
      });
  }, [recents]);

  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId.value) ??
    presets[0];
  const workspaceValid =
    selectedPath.value !== null && !missing.value.has(selectedPath.value);

  async function pickFolder(): Promise<void> {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        selectedPath.value = picked;
      }
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
    }
  }

  function confirmOpen(): void {
    if (workspaceValid && selectedPath.value !== null) {
      onOpen(selectedPath.value, selectedPreset);
    }
  }

  function moveSelection(step: 1 | -1): void {
    if (column.value === "workspace") {
      const selectable = recents.filter((r) => !missing.value.has(r.path));
      if (selectable.length === 0) {
        return;
      }
      const index = selectable.findIndex(
        (r) => r.path === selectedPath.value,
      );
      const next =
        selectable[
          (index + step + selectable.length) % selectable.length
        ];
      selectedPath.value = next.path;
      return;
    }
    const index = presets.findIndex((p) => p.id === selectedPresetId.value);
    const next = presets[(index + step + presets.length) % presets.length];
    selectedPresetId.value = next.id;
  }

  function startRename(preset: Preset): void {
    if (isBuiltIn(preset)) {
      return;
    }
    renamingId.value = preset.id;
    renameValue.value = preset.name;
    confirmDeleteId.value = null;
  }

  function commitRename(): void {
    const id = renamingId.value;
    const name = renameValue.value.trim();
    if (id !== null && name !== "") {
      renamePreset(id, name);
    }
    renamingId.value = null;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      return; // rename input owns its keys (Enter/Esc handled inline)
    }
    switch (event.key) {
      case "ArrowUp":
        moveSelection(-1);
        break;
      case "ArrowDown":
        moveSelection(1);
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "Tab":
        column.value =
          column.value === "workspace" ? "preset" : "workspace";
        break;
      case "Enter":
        confirmOpen();
        break;
      case "Escape":
        if (confirmDeleteId.value !== null) {
          confirmDeleteId.value = null;
        } else if (canCancel) {
          onCancel();
        }
        break;
      case "o":
        if (event.metaKey) {
          void pickFolder();
        } else {
          return;
        }
        break;
      case "r":
        if (column.value === "preset") {
          startRename(selectedPreset);
        }
        break;
      case "Backspace":
        if (column.value === "preset" && !isBuiltIn(selectedPreset)) {
          confirmDeleteId.value = selectedPreset.id;
        }
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      class="open-board"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={(el) => el?.focus()}
    >
      <header class="open-board__header">
        <h1>New window</h1>
        <p>Pick a workspace folder and a layout — then open a tab.</p>
      </header>
      <div class="open-board__columns">
        <section
          class={`open-board__col ${column.value === "workspace" ? "is-focused" : ""}`}
        >
          <h2 class="open-board__col-title">
            Workspace <span>recent folders</span>
          </h2>
          <ul class="workspace-list">
            {recents.map((recent) => {
              const gone = missing.value.has(recent.path);
              return (
                <li key={recent.path}>
                  <button
                    class={`workspace-row ${recent.path === selectedPath.value ? "is-selected" : ""} ${gone ? "is-missing" : ""}`}
                    disabled={gone}
                    onClick={() => {
                      selectedPath.value = recent.path;
                      column.value = "workspace";
                    }}
                  >
                    <span class="workspace-row__name">
                      {folderName(recent.path)}
                      {gone ? <em> — missing</em> : null}
                    </span>
                    <span class="workspace-row__path">{recent.path}</span>
                    <span class="workspace-row__time">
                      {formatRelativeTime(recent.lastOpenedAt, Date.now())}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button class="workspace-open-folder" onClick={() => void pickFolder()}>
            ＋ Open Folder…
          </button>
          {selectedPath.value !== null &&
          !recents.some((r) => r.path === selectedPath.value) ? (
            <p class="workspace-picked">{selectedPath.value}</p>
          ) : null}
        </section>
        <section
          class={`open-board__col ${column.value === "preset" ? "is-focused" : ""}`}
        >
          <h2 class="open-board__col-title">
            Layout preset <span>split + CWD</span>
          </h2>
          <div class="preset-grid">
            {presets.map((preset) => (
              <div
                key={preset.id}
                class={`preset-card ${preset.id === selectedPresetId.value ? "is-selected" : ""}`}
                onClick={() => {
                  selectedPresetId.value = preset.id;
                  column.value = "preset";
                }}
                onDblClick={confirmOpen}
                onContextMenu={(event) => {
                  event.preventDefault();
                  startRename(preset);
                }}
              >
                <PresetThumb layout={preset.layout} />
                {renamingId.value === preset.id ? (
                  <input
                    class="preset-card__rename"
                    value={renameValue.value}
                    ref={(el) => el?.focus()}
                    onInput={(event) => {
                      renameValue.value = (
                        event.target as HTMLInputElement
                      ).value;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitRename();
                      }
                      if (event.key === "Escape") {
                        renamingId.value = null;
                      }
                      event.stopPropagation();
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <span class="preset-card__name">{preset.name}</span>
                )}
                <span class="preset-card__meta">
                  {countLeaves(preset.layout)}{" "}
                  {countLeaves(preset.layout) === 1 ? "pane" : "panes"}
                  {preset.cwds ? " · CWDs" : ""}
                  {isBuiltIn(preset) ? " · BUILT-IN" : ""}
                </span>
                {confirmDeleteId.value === preset.id ? (
                  <span class="preset-card__confirm">
                    Delete?
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        deletePreset(preset.id);
                        confirmDeleteId.value = null;
                        if (selectedPresetId.value === preset.id) {
                          selectedPresetId.value = presets[0].id;
                        }
                      }}
                    >
                      Delete
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        confirmDeleteId.value = null;
                      }}
                    >
                      Keep
                    </button>
                  </span>
                ) : null}
              </div>
            ))}
            <button
              class="preset-card preset-card--new"
              onClick={() => onNewPreset(selectedPath.value)}
            >
              ＋ New preset…
            </button>
          </div>
        </section>
      </div>
      <footer class="open-board__footer">
        <span
          class={`open-board__summary ${workspaceValid ? "" : "is-warning"}`}
        >
          {workspaceValid && selectedPath.value !== null ? (
            <>
              Open <strong>{folderName(selectedPath.value)}</strong> as{" "}
              <strong>{selectedPreset.name}</strong>
            </>
          ) : (
            "Select a workspace folder"
          )}
        </span>
        <div class="open-board__actions">
          <button onClick={onCancel} disabled={!canCancel}>
            Cancel
          </button>
          <button
            class="is-primary"
            onClick={confirmOpen}
            disabled={!workspaceValid}
          >
            Open
          </button>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Append styles**

Append to `src/styles.css`:

```css
/* ---------- Open board (UX §2) ---------- */
.open-board {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text-primary);
  outline: none;
  animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes rise-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.open-board__header { padding: 24px 28px 12px; border-bottom: 1px solid var(--hair); }
.open-board__header h1 { font-size: 16px; margin: 0 0 4px; }
.open-board__header p { margin: 0; color: var(--text-muted); font-size: 12px; }
.open-board__columns { flex: 1; display: flex; min-height: 0; }
.open-board__col { flex: 1; padding: 16px 24px; overflow-y: auto; }
.open-board__col + .open-board__col { border-left: 1px solid var(--hair); }
.open-board__col.is-focused .open-board__col-title { color: var(--accent); }
.open-board__col-title {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); margin: 0 0 12px; display: flex; justify-content: space-between;
}
.open-board__col-title span { color: var(--text-faint); text-transform: none; letter-spacing: 0; }
.workspace-list { list-style: none; margin: 0; padding: 0; }
.workspace-row {
  display: grid; grid-template-columns: 1fr auto; gap: 0 8px; width: 100%;
  text-align: left; padding: 8px 10px; min-height: 40px; border: 0; border-radius: 8px;
  background: none; color: inherit; cursor: pointer; font: inherit;
}
.workspace-row:hover { background: var(--chrome-1); }
.workspace-row.is-selected { background: var(--chrome-2); box-shadow: inset 0 0 0 1px var(--accent); }
.workspace-row.is-missing { opacity: 0.45; cursor: default; }
.workspace-row__name { font-size: 13px; }
.workspace-row__name em { color: var(--yellow); font-style: normal; font-size: 11px; }
.workspace-row__path { grid-column: 1; font-family: var(--font-mono, "SF Mono", monospace); font-size: 11px; color: var(--text-faint); }
.workspace-row__time { grid-row: 1; grid-column: 2; font-size: 11px; color: var(--text-faint); }
.workspace-open-folder {
  margin-top: 10px; width: 100%; padding: 10px; border-radius: 8px;
  border: 1px dashed var(--hair-strong); background: none; color: var(--text-muted);
  cursor: pointer; font: inherit; font-size: 12px;
}
.workspace-open-folder:hover { border-color: var(--accent); color: var(--text-primary); }
.workspace-picked { font-family: var(--font-mono, "SF Mono", monospace); font-size: 11px; color: var(--text-muted); margin: 8px 2px 0; }
.preset-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.preset-card {
  display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 10px;
  background: var(--chrome-1); cursor: pointer; border: 0; color: inherit; font: inherit;
  text-align: left; position: relative;
}
.preset-card:hover { background: var(--chrome-2); }
.preset-card.is-selected { box-shadow: inset 0 0 0 1px var(--accent); }
.preset-card--new {
  align-items: center; justify-content: center; background: none;
  border: 1px dashed var(--hair-strong); color: var(--text-muted); min-height: 96px;
}
.preset-card--new:hover { border-color: var(--accent); color: var(--text-primary); }
.preset-card__name { font-size: 13px; }
.preset-card__meta { font-size: 11px; color: var(--text-faint); }
.preset-card__rename {
  font: inherit; font-size: 13px; background: var(--input-bg); color: inherit;
  border: 1px solid var(--accent); border-radius: 4px; padding: 2px 6px;
}
.preset-card__confirm { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--yellow); }
.preset-card__confirm button {
  font: inherit; font-size: 11px; background: var(--chrome-2); color: inherit;
  border: 1px solid var(--hair-strong); border-radius: 4px; padding: 1px 8px; cursor: pointer;
}
.preset-thumb { height: 56px; border-radius: 4px; overflow: hidden; background: var(--hair); }
.preset-thumb__split { display: flex; gap: 1px; width: 100%; height: 100%; }
.preset-thumb__split.is-column { flex-direction: column; }
.preset-thumb__branch { display: flex; min-width: 0; min-height: 0; }
.preset-thumb__branch > * { flex: 1; }
.preset-thumb__leaf { flex: 1; background: var(--chrome-2); }
.open-board__footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px; border-top: 1px solid var(--hair);
}
.open-board__summary { font-size: 12px; color: var(--text-muted); }
.open-board__summary strong { color: var(--text-primary); }
.open-board__summary.is-warning { color: var(--yellow); }
.open-board__actions { display: flex; gap: 8px; }
.open-board__actions button {
  font: inherit; font-size: 12px; padding: 6px 16px; border-radius: 6px;
  border: 1px solid var(--hair-strong); background: none; color: var(--text-primary); cursor: pointer;
}
.open-board__actions button:disabled { opacity: 0.4; cursor: default; }
.open-board__actions button.is-primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: PASS (component compiles; nothing mounts it yet — App wiring is Task 14).

- [ ] **Step 5: Commit**

```bash
git add src/presets/preset-thumb.tsx src/open-board/open-board.tsx src/styles.css
git commit -m "feat: open board UI with workspace recents and preset cards"
```

---

### Task 8: Mock layout model (preset editor core)

Reuses the immutable ops from `split-tree.ts` — mock pane ids are synthetic counters, never PTY ids.

**Files:**
- Create: `src/presets/mock-model.ts`
- Create: `src/presets/mock-model.test.ts`

**Interfaces:**
- Consumes: `leaf`, `splitLeaf`, `removeLeaf`, `setRatio`, `leafIds`, `serializeTree`, types from `split-tree.ts`
- Produces (used by Task 9):
  - `interface MockModel { tree: TreeNode; cwds: ReadonlyMap<number, string>; selectedId: number; nextId: number }`
  - `interface PresetArtifact { layout: SerializedNode; cwds?: readonly (string | null)[] }`
  - `createMockModel()`, `splitSelected(m, dir)`, `removeSelected(m)`, `canRemove(m)`, `selectPane(m, id)`, `moveSelection(m, step)`, `setSelectedCwd(m, cwd)`, `setMockRatio(m, path, ratio)`, `nudgeSelected(m, delta)`, `toPresetArtifact(m)`
  - `RATIO_MIN = 0.15`, `RATIO_MAX = 0.85` (UX §3 clamp)

- [ ] **Step 1: Write the failing test**

Create `src/presets/mock-model.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { leafIds } from "../lib/split-tree";
import {
  canRemove,
  createMockModel,
  moveSelection,
  nudgeSelected,
  removeSelected,
  selectPane,
  setMockRatio,
  setSelectedCwd,
  splitSelected,
  toPresetArtifact,
} from "./mock-model";

describe("mock model", () => {
  it("starts as a single selected pane and cannot remove it", () => {
    const model = createMockModel();
    expect(leafIds(model.tree)).toEqual([1]);
    expect(model.selectedId).toBe(1);
    expect(canRemove(model)).toBe(false);
    expect(removeSelected(model)).toBe(model);
  });

  it("split selects the new pane; remove collapses back", () => {
    const two = splitSelected(createMockModel(), "row");
    expect(leafIds(two.tree)).toEqual([1, 2]);
    expect(two.selectedId).toBe(2);
    const one = removeSelected(two);
    expect(leafIds(one.tree)).toEqual([1]);
    expect(one.selectedId).toBe(1);
  });

  it("selection moves by step and by explicit pick, ignoring unknown ids", () => {
    const model = splitSelected(createMockModel(), "row");
    expect(moveSelection(model, -1).selectedId).toBe(1);
    expect(selectPane(model, 1).selectedId).toBe(1);
    expect(selectPane(model, 99)).toBe(model);
  });

  it("cwd set/clear is per selected pane and dropped on remove", () => {
    let model = splitSelected(createMockModel(), "row");
    model = setSelectedCwd(model, "/work");
    expect(model.cwds.get(2)).toBe("/work");
    model = setSelectedCwd(model, null);
    expect(model.cwds.has(2)).toBe(false);
  });

  it("ratio set and nudge are clamped to 0.15–0.85", () => {
    let model = splitSelected(createMockModel(), "row");
    model = setMockRatio(model, [], 0.95);
    expect(model.tree.kind === "split" && model.tree.ratio).toBe(0.85);
    model = nudgeSelected(model, 0.05); // selected pane 2 = branch b → shrink a
    expect(model.tree.kind === "split" && model.tree.ratio).toBe(0.8);
  });

  it("artifact zips cwds left-to-right and omits an all-inherit map", () => {
    let model = splitSelected(createMockModel(), "row");
    expect(toPresetArtifact(model).cwds).toBeUndefined();
    model = selectPane(model, 1);
    model = setSelectedCwd(model, "/a");
    expect(toPresetArtifact(model)).toEqual({
      layout: {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      cwds: ["/a", null],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presets/mock-model.test.ts`
Expected: FAIL — `Cannot find module './mock-model'`

- [ ] **Step 3: Implement**

Create `src/presets/mock-model.ts`:

```typescript
import {
  leaf,
  leafIds,
  removeLeaf,
  serializeTree,
  setRatio,
  splitLeaf,
  type Branch,
  type Direction,
  type Path,
  type SerializedNode,
  type TreeNode,
} from "../lib/split-tree";

export const RATIO_MIN = 0.15;
export const RATIO_MAX = 0.85;

/** Editor model: synthetic ids on a real split tree — no PTY is ever spawned. */
export interface MockModel {
  readonly tree: TreeNode;
  readonly cwds: ReadonlyMap<number, string>;
  readonly selectedId: number;
  readonly nextId: number;
}

export interface PresetArtifact {
  readonly layout: SerializedNode;
  readonly cwds?: readonly (string | null)[];
}

export function createMockModel(): MockModel {
  return { tree: leaf(1), cwds: new Map(), selectedId: 1, nextId: 2 };
}

export function splitSelected(model: MockModel, dir: Direction): MockModel {
  const newId = model.nextId;
  return {
    ...model,
    tree: splitLeaf(model.tree, model.selectedId, newId, dir),
    selectedId: newId,
    nextId: newId + 1,
  };
}

export function canRemove(model: MockModel): boolean {
  return leafIds(model.tree).length > 1;
}

export function removeSelected(model: MockModel): MockModel {
  const rest = removeLeaf(model.tree, model.selectedId);
  if (rest === null) {
    return model; // last pane — Remove is disabled (UX §3)
  }
  const cwds = new Map(model.cwds);
  cwds.delete(model.selectedId);
  return { ...model, tree: rest, cwds, selectedId: leafIds(rest)[0] };
}

export function selectPane(model: MockModel, id: number): MockModel {
  return leafIds(model.tree).includes(id)
    ? { ...model, selectedId: id }
    : model;
}

export function moveSelection(model: MockModel, step: 1 | -1): MockModel {
  const ids = leafIds(model.tree);
  const index = ids.indexOf(model.selectedId);
  return { ...model, selectedId: ids[(index + step + ids.length) % ids.length] };
}

/** cwd = null clears back to inherit. */
export function setSelectedCwd(
  model: MockModel,
  cwd: string | null,
): MockModel {
  const cwds = new Map(model.cwds);
  if (cwd === null) {
    cwds.delete(model.selectedId);
  } else {
    cwds.set(model.selectedId, cwd);
  }
  return { ...model, cwds };
}

function clampRatio(ratio: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
}

export function setMockRatio(
  model: MockModel,
  path: Path,
  ratio: number,
): MockModel {
  return { ...model, tree: setRatio(model.tree, path, clampRatio(ratio)) };
}

/** Path of a/b branches from the root to the leaf; null when absent. */
function pathToLeaf(node: TreeNode, id: number, prefix: Path = []): Path | null {
  if (node.kind === "leaf") {
    return node.paneId === id ? prefix : null;
  }
  return (
    pathToLeaf(node.a, id, [...prefix, "a"]) ??
    pathToLeaf(node.b, id, [...prefix, "b"])
  );
}

function splitAt(node: TreeNode, path: Path): TreeNode {
  return path.length === 0 || node.kind === "leaf"
    ? node
    : splitAt(path[0] === "a" ? node.a : node.b, path.slice(1));
}

/** Grow (+) or shrink (−) the selected pane's share of its parent split. */
export function nudgeSelected(model: MockModel, delta: number): MockModel {
  const path = pathToLeaf(model.tree, model.selectedId);
  if (path === null || path.length === 0) {
    return model; // single pane — nothing to nudge
  }
  const parentPath = path.slice(0, -1);
  const branch: Branch = path[path.length - 1];
  const parent = splitAt(model.tree, parentPath);
  if (parent.kind !== "split") {
    return model;
  }
  const ratio = branch === "a" ? parent.ratio + delta : parent.ratio - delta;
  return setMockRatio(model, parentPath, ratio);
}

export function toPresetArtifact(model: MockModel): PresetArtifact {
  const cwds = leafIds(model.tree).map((id) => model.cwds.get(id) ?? null);
  return {
    layout: serializeTree(model.tree),
    ...(cwds.some((cwd) => cwd !== null) ? { cwds } : {}),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/presets/mock-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/presets/mock-model.ts src/presets/mock-model.test.ts
git commit -m "feat: immutable mock layout model for the preset editor"
```

---

### Task 9: Preset editor UI (mini layout mock)

Modal per UX §3. All tree logic is Task 8 (tested); this task is rendering + input wiring. Verification: `npm run build` + manual checks in Task 14.

**Files:**
- Create: `src/presets/preset-editor.tsx`
- Modify: `src/styles.css` (append editor styles)

**Interfaces:**
- Consumes: Task 8 model ops; `open` from `@tauri-apps/plugin-dialog`; `tildify` from `src/lib/process-info.ts`
- Produces (used by Task 14): `PresetEditor` with props `interface PresetEditorProps { onCancel(): void; onCreate(name: string, artifact: PresetArtifact): void }` — the CALLER resolves `↑ inherit` panes (board → workspace, live window → focused pane CWD; FR-015).

- [ ] **Step 1: Implement**

Create `src/presets/preset-editor.tsx`:

```tsx
import { useSignal, type Signal } from "@preact/signals";
import { open } from "@tauri-apps/plugin-dialog";
import { leafIds, type Path, type TreeNode } from "../lib/split-tree";
import {
  canRemove,
  createMockModel,
  moveSelection,
  nudgeSelected,
  removeSelected,
  selectPane,
  setMockRatio,
  setSelectedCwd,
  splitSelected,
  toPresetArtifact,
  type MockModel,
  type PresetArtifact,
} from "./mock-model";

export interface PresetEditorProps {
  onCancel(): void;
  onCreate(name: string, artifact: PresetArtifact): void;
}

const NUDGE_STEP = 0.05;

interface MockNodeProps {
  node: TreeNode;
  path: Path;
  model: Signal<MockModel>;
}

function MockNode({ node, path, model }: MockNodeProps) {
  if (node.kind === "leaf") {
    const index = leafIds(model.value.tree).indexOf(node.paneId);
    const cwd = model.value.cwds.get(node.paneId);
    return (
      <div
        class={`mock-pane ${node.paneId === model.value.selectedId ? "is-selected" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          model.value = selectPane(model.value, node.paneId);
        }}
      >
        <span class="mock-pane__cwd">
          ● {cwd ?? "↑ inherit"}
        </span>
        <span class="mock-pane__label">pane {index + 1}</span>
      </div>
    );
  }
  const row = node.dir === "row";
  function startDrag(event: PointerEvent): void {
    event.preventDefault();
    const box = (
      event.currentTarget as HTMLElement
    ).parentElement?.getBoundingClientRect();
    if (!box) {
      return;
    }
    function onMove(move: PointerEvent): void {
      const ratio = row
        ? (move.clientX - box.left) / box.width
        : (move.clientY - box.top) / box.height;
      model.value = setMockRatio(model.value, path, ratio);
    }
    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  return (
    <div class={`mock-split ${row ? "is-row" : "is-column"}`}>
      <div class="mock-branch" style={{ flex: node.ratio }}>
        <MockNode node={node.a} path={[...path, "a"]} model={model} />
      </div>
      <div
        class={`mock-divider ${row ? "is-row" : "is-column"}`}
        onPointerDown={startDrag}
      />
      <div class="mock-branch" style={{ flex: 1 - node.ratio }}>
        <MockNode node={node.b} path={[...path, "b"]} model={model} />
      </div>
    </div>
  );
}

export function PresetEditor({ onCancel, onCreate }: PresetEditorProps) {
  const model = useSignal<MockModel>(createMockModel());
  const name = useSignal("");
  const paneCount = leafIds(model.value.tree).length;
  const selectedCwd = model.value.cwds.get(model.value.selectedId);

  async function pickCwd(): Promise<void> {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        model.value = setSelectedCwd(model.value, picked);
      }
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
    }
  }

  function confirmCreate(): void {
    const trimmed = name.value.trim();
    if (trimmed !== "") {
      onCreate(trimmed, toPresetArtifact(model.value));
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "Enter") {
        confirmCreate();
      }
      if (event.key === "Escape") {
        onCancel();
      }
      return;
    }
    switch (event.key) {
      case "ArrowRight":
        if (event.metaKey) {
          model.value = splitSelected(model.value, "row");
        } else {
          model.value = moveSelection(model.value, 1);
        }
        break;
      case "ArrowDown":
        if (event.metaKey) {
          model.value = splitSelected(model.value, "column");
        } else {
          model.value = moveSelection(model.value, 1);
        }
        break;
      case "ArrowLeft":
      case "ArrowUp":
        model.value = moveSelection(model.value, -1);
        break;
      case "Backspace":
        model.value = removeSelected(model.value);
        break;
      case "[":
        model.value = nudgeSelected(model.value, -NUDGE_STEP);
        break;
      case "]":
        model.value = nudgeSelected(model.value, NUDGE_STEP);
        break;
      case "Enter":
        confirmCreate();
        break;
      case "Escape":
        onCancel();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="modal-scrim">
      <div
        class="preset-editor"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={(el) => el?.focus()}
      >
        <header class="preset-editor__toolbar">
          <h1>▦ New layout preset</h1>
          <div class="preset-editor__tools">
            <button
              onClick={() => {
                model.value = splitSelected(model.value, "row");
              }}
            >
              Split right
            </button>
            <button
              onClick={() => {
                model.value = splitSelected(model.value, "column");
              }}
            >
              Split down
            </button>
            <button
              disabled={!canRemove(model.value)}
              onClick={() => {
                model.value = removeSelected(model.value);
              }}
            >
              Remove
            </button>
            <button onClick={() => void pickCwd()}>Set CWD</button>
            {selectedCwd !== undefined ? (
              <button
                onClick={() => {
                  model.value = setSelectedCwd(model.value, null);
                }}
              >
                Clear CWD
              </button>
            ) : null}
          </div>
        </header>
        <div class="preset-editor__stage">
          <MockNode node={model.value.tree} path={[]} model={model} />
        </div>
        <footer class="preset-editor__footer">
          <input
            class="preset-editor__name"
            placeholder="Preset name"
            value={name.value}
            onInput={(event) => {
              name.value = (event.target as HTMLInputElement).value;
            }}
          />
          <span class="preset-editor__meta">
            {paneCount} {paneCount === 1 ? "pane" : "panes"} · drag dividers
          </span>
          <div class="preset-editor__actions">
            <button onClick={onCancel}>Cancel</button>
            <button
              class="is-primary"
              disabled={name.value.trim() === ""}
              onClick={confirmCreate}
            >
              Create tab
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append styles**

Append to `src/styles.css`:

```css
/* ---------- Preset editor (UX §3) ---------- */
.modal-scrim {
  position: absolute; inset: 0; z-index: 40; display: flex;
  align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--bg) 65%, transparent);
}
.preset-editor {
  display: flex; flex-direction: column; width: min(720px, 86vw); height: min(520px, 82vh);
  background: var(--chrome-1); border: 1px solid var(--hair-strong); border-radius: 12px;
  outline: none; animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1); overflow: hidden;
}
.preset-editor__toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--hair);
}
.preset-editor__toolbar h1 { font-size: 13px; margin: 0; }
.preset-editor__tools { display: flex; gap: 6px; }
.preset-editor__tools button {
  font: inherit; font-size: 11px; padding: 4px 10px; border-radius: 6px;
  border: 1px solid var(--hair-strong); background: none; color: var(--text-primary); cursor: pointer;
}
.preset-editor__tools button:disabled { opacity: 0.4; cursor: default; }
.preset-editor__stage { flex: 1; margin: 12px; border-radius: 8px; overflow: hidden; background: var(--bg); }
.preset-editor__stage > .mock-split, .preset-editor__stage > .mock-pane { width: 100%; height: 100%; }
.mock-split { display: flex; width: 100%; height: 100%; }
.mock-split.is-column { flex-direction: column; }
.mock-branch { display: flex; min-width: 0; min-height: 0; }
.mock-branch > * { flex: 1; }
.mock-divider { position: relative; flex: 0 0 1px; background: var(--hair); z-index: 1; }
.mock-divider.is-row { cursor: col-resize; }
.mock-divider.is-column { cursor: row-resize; }
.mock-divider::after { content: ""; position: absolute; inset: -3px; }
.mock-divider:hover { background: var(--accent); }
.mock-pane {
  display: flex; flex-direction: column; gap: 2px; padding: 8px;
  background: var(--bg); cursor: pointer; min-width: 0; min-height: 0;
}
.mock-pane.is-selected { box-shadow: inset 0 0 0 1px var(--accent); }
.mock-pane__cwd { font-family: var(--font-mono, "SF Mono", monospace); font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mock-pane__label { font-size: 10px; color: var(--text-faint); }
.preset-editor__footer {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-top: 1px solid var(--hair);
}
.preset-editor__name {
  flex: 0 0 220px; font: inherit; font-size: 12px; padding: 6px 8px;
  background: var(--input-bg); color: var(--text-primary);
  border: 1px solid var(--hair-strong); border-radius: 6px;
}
.preset-editor__meta { flex: 1; font-size: 11px; color: var(--text-faint); }
.preset-editor__actions { display: flex; gap: 8px; }
.preset-editor__actions button {
  font: inherit; font-size: 12px; padding: 6px 14px; border-radius: 6px;
  border: 1px solid var(--hair-strong); background: none; color: var(--text-primary); cursor: pointer;
}
.preset-editor__actions button:disabled { opacity: 0.4; cursor: default; }
.preset-editor__actions button.is-primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/presets/preset-editor.tsx src/styles.css
git commit -m "feat: preset editor modal with mock split tree"
```

---

### Task 10: Save-from-live dialog

**Files:**
- Create: `src/presets/save-preset-dialog.tsx`
- Modify: `src/styles.css` (append dialog styles)

**Interfaces:**
- Consumes: `type Preset` (Task 2)
- Produces (used by Task 14):
  - `type SaveTarget = { kind: "new"; name: string } | { kind: "overwrite"; id: string }`
  - `SavePresetDialog` with props `interface SavePresetDialogProps { existing: readonly Preset[]; onCancel(): void; onSave(target: SaveTarget, includeCwds: boolean): void }` — `existing` is saved presets only (never the built-in; FR-011 AC-2)

- [ ] **Step 1: Implement**

Create `src/presets/save-preset-dialog.tsx`:

```tsx
import { useSignal } from "@preact/signals";
import type { Preset } from "../lib/preset-schema";

export type SaveTarget =
  | { kind: "new"; name: string }
  | { kind: "overwrite"; id: string };

export interface SavePresetDialogProps {
  existing: readonly Preset[];
  onCancel(): void;
  onSave(target: SaveTarget, includeCwds: boolean): void;
}

export function SavePresetDialog({
  existing,
  onCancel,
  onSave,
}: SavePresetDialogProps) {
  const name = useSignal("");
  const overwriteId = useSignal<string | null>(null);
  const includeCwds = useSignal(true); // default on (UX §3)

  const target: SaveTarget | null =
    overwriteId.value !== null
      ? { kind: "overwrite", id: overwriteId.value }
      : name.value.trim() !== ""
        ? { kind: "new", name: name.value.trim() }
        : null;

  function confirm(): void {
    if (target !== null) {
      onSave(target, includeCwds.value);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      confirm();
    } else if (event.key === "Escape") {
      onCancel();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="modal-scrim">
      <div
        class="save-preset"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={(el) => el?.querySelector("input")?.focus()}
      >
        <h1>Save layout as preset</h1>
        <label class="save-preset__row">
          <span>Save as new</span>
          <input
            placeholder="Preset name"
            value={name.value}
            onInput={(event) => {
              name.value = (event.target as HTMLInputElement).value;
              overwriteId.value = null;
            }}
          />
        </label>
        {existing.length > 0 ? (
          <label class="save-preset__row">
            <span>Or overwrite</span>
            <select
              value={overwriteId.value ?? ""}
              onChange={(event) => {
                const value = (event.target as HTMLSelectElement).value;
                overwriteId.value = value === "" ? null : value;
              }}
            >
              <option value="">—</option>
              {existing.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label class="save-preset__toggle">
          <input
            type="checkbox"
            checked={includeCwds.value}
            onChange={(event) => {
              includeCwds.value = (event.target as HTMLInputElement).checked;
            }}
          />
          Include per-pane folders
        </label>
        <div class="save-preset__actions">
          <button onClick={onCancel}>Cancel</button>
          <button class="is-primary" disabled={target === null} onClick={confirm}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append styles**

Append to `src/styles.css`:

```css
/* ---------- Save preset dialog (UX §3) ---------- */
.save-preset {
  display: flex; flex-direction: column; gap: 12px; width: 360px; padding: 16px;
  background: var(--chrome-1); border: 1px solid var(--hair-strong); border-radius: 12px;
  outline: none; animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.save-preset h1 { font-size: 13px; margin: 0; }
.save-preset__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.save-preset__row span { flex: 0 0 96px; color: var(--text-muted); }
.save-preset__row input, .save-preset__row select {
  flex: 1; font: inherit; font-size: 12px; padding: 6px 8px;
  background: var(--input-bg); color: var(--text-primary);
  border: 1px solid var(--hair-strong); border-radius: 6px;
}
.save-preset__toggle { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
.save-preset__actions { display: flex; justify-content: flex-end; gap: 8px; }
.save-preset__actions button {
  font: inherit; font-size: 12px; padding: 6px 14px; border-radius: 6px;
  border: 1px solid var(--hair-strong); background: none; color: var(--text-primary); cursor: pointer;
}
.save-preset__actions button:disabled { opacity: 0.4; cursor: default; }
.save-preset__actions button.is-primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/presets/save-preset-dialog.tsx src/styles.css
git commit -m "feat: save-layout-as-preset dialog"
```

---

### Task 11: Agent picker overlay (per-pane cards + Skip-all bar)

Per-pane cards are imperative DOM appended to pane elements (idiom of `search-bar.ts`); they follow their panes through layout re-renders. The global bar is Preact. Store transitions are tested (Task 6); this task is DOM + IPC wiring.

**Files:**
- Create: `src/agent-picker/agent-picker.ts`
- Create: `src/agent-picker/skip-all-bar.tsx`
- Modify: `src/styles.css` (append picker styles)

**Interfaces:**
- Consumes: Task 6 store; Rust `detect_agents` (Task 4); `write_pty` (shipped); `paneOverlayHost` (Task 12)
- Produces (used by Tasks 12, 14):
  - `beginAgentPick(paneIds: readonly number[]): Promise<void>` — fetches `detect_agents` then marks panes pending (FR-020, FR-021)
  - `installAgentPicker(getHost: () => PickerHost | null): () => void` where `interface PickerHost { paneOverlayHost(id: number): HTMLElement | null }`
  - `SkipAllBar` Preact component (renders only while panes are pending; FR-024)

- [ ] **Step 1: Implement the imperative card module**

Create `src/agent-picker/agent-picker.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { effect } from "@preact/signals";
import {
  beginPick,
  detectedAgents,
  pendingPaneIds,
  resolvePane,
  type DetectedAgent,
} from "./picker-store";

export interface PickerHost {
  paneOverlayHost(id: number): HTMLElement | null;
}

/** Human names for allowlisted binaries (icon column uses the first letter). */
const AGENT_LABELS: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/** Detect agents through the login shell, then mark the panes pending. */
export async function beginAgentPick(
  paneIds: readonly number[],
): Promise<void> {
  if (paneIds.length === 0) {
    return;
  }
  try {
    detectedAgents.value = await invoke<DetectedAgent[]>("detect_agents");
  } catch (err: unknown) {
    console.warn("detect_agents failed:", err);
    detectedAgents.value = []; // card degrades to Shell only (FR-025)
  }
  beginPick(paneIds);
}

/** Pick = spawn the command immediately in the pane's shell (FR-022). */
function pickAgent(id: number, agent: DetectedAgent): void {
  invoke("write_pty", { id, data: `${agent.name}\r` }).catch(
    (err: unknown) => {
      console.error("write_pty failed:", err);
    },
  );
  resolvePane(id);
}

interface CardOption {
  readonly hint: string;
  readonly label: string;
  readonly command: string;
  readonly onPick: () => void;
}

function buildCard(
  id: number,
  agents: readonly DetectedAgent[],
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "agent-picker";
  const card = document.createElement("div");
  card.className = "agent-picker__card";
  card.tabIndex = 0;

  const title = document.createElement("h1");
  title.textContent = "Run an agent";
  const subtitle = document.createElement("p");
  subtitle.textContent =
    agents.length > 0
      ? "Detected on $PATH · pick spawns immediately"
      : "No agent CLIs found on $PATH";
  card.append(title, subtitle);

  const options: CardOption[] = [
    ...agents.map((agent, index) => ({
      hint: String(index + 1),
      label: AGENT_LABELS[agent.name] ?? agent.name,
      command: agent.name,
      onPick: () => pickAgent(id, agent),
    })),
    {
      hint: "0",
      label: "Shell only",
      command: "$SHELL",
      onPick: () => resolvePane(id), // idle login shell stays (FR-023)
    },
  ];

  let focused = 0;
  const rows = options.map((option, index) => {
    const row = document.createElement("button");
    row.className = "agent-picker__option";
    if (index === options.length - 1) {
      row.classList.add("is-shell");
    }
    const hint = document.createElement("kbd");
    hint.textContent = option.hint;
    const label = document.createElement("span");
    label.textContent = option.label;
    const command = document.createElement("code");
    command.textContent = option.command;
    row.append(hint, label, command);
    row.addEventListener("click", option.onPick);
    return row;
  });
  card.append(...rows);

  function paintFocus(): void {
    rows.forEach((row, index) => {
      row.classList.toggle("is-focused", index === focused);
    });
  }
  paintFocus();

  card.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      focused = (focused + 1) % options.length;
      paintFocus();
    } else if (event.key === "ArrowUp") {
      focused = (focused - 1 + options.length) % options.length;
      paintFocus();
    } else if (event.key === "Enter" && !event.metaKey) {
      options[focused].onPick();
    } else if (event.key === "0") {
      options[options.length - 1].onPick();
    } else if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < agents.length) {
        options[index].onPick();
      }
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  overlay.addEventListener("mousedown", () => card.focus());
  overlay.appendChild(card);
  return overlay;
}

/**
 * Keep one overlay card per pending pane. Effect re-runs on store changes;
 * cards attach to pane elements so they survive layout re-renders. Returns
 * a disposer.
 */
export function installAgentPicker(
  getHost: () => PickerHost | null,
): () => void {
  const cards = new Map<number, HTMLElement>();
  const disposeEffect = effect(() => {
    const pending = new Set(pendingPaneIds.value);
    const agents = detectedAgents.value;
    for (const [id, overlay] of [...cards]) {
      if (!pending.has(id)) {
        overlay.remove();
        cards.delete(id);
      }
    }
    let firstNew: HTMLElement | null = null;
    for (const id of pending) {
      if (cards.has(id)) {
        continue;
      }
      const host = getHost()?.paneOverlayHost(id);
      if (host === null || host === undefined) {
        continue; // pane vanished — prune comes from the layout callback
      }
      const overlay = buildCard(id, agents);
      host.appendChild(overlay);
      cards.set(id, overlay);
      firstNew ??= overlay;
    }
    firstNew
      ?.querySelector<HTMLElement>(".agent-picker__card")
      ?.focus();
  });
  return () => {
    disposeEffect();
    for (const overlay of cards.values()) {
      overlay.remove();
    }
    cards.clear();
  };
}
```

- [ ] **Step 2: Implement the Skip-all bar**

Create `src/agent-picker/skip-all-bar.tsx`:

```tsx
import { useEffect } from "preact/hooks";
import { pendingPaneIds, skipAll } from "./picker-store";

/** Global one-shot bar: Skip all → every still-pending pane stays a shell. */
export function SkipAllBar() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (pendingPaneIds.value.length === 0) {
        return;
      }
      // ⌘Return or ⌥S (event.code — Alt+S composes "ß" in event.key)
      const isSkip =
        (event.metaKey && event.key === "Enter") ||
        (event.altKey && event.code === "KeyS");
      if (isSkip) {
        event.preventDefault();
        event.stopPropagation();
        skipAll();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  if (pendingPaneIds.value.length === 0) {
    return null;
  }
  return (
    <div class="skip-all-bar">
      <span>Agent picker · one-shot</span>
      <button onClick={skipAll}>Skip all →</button>
    </div>
  );
}
```

- [ ] **Step 3: Append styles**

Append to `src/styles.css`:

```css
/* ---------- Agent picker (UX §4) ---------- */
.agent-picker {
  position: absolute; inset: 0; z-index: 20; display: flex;
  align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.agent-picker__card {
  display: flex; flex-direction: column; gap: 4px; min-width: 240px; max-width: 85%;
  padding: 12px; background: var(--chrome-1); border: 1px solid var(--hair-strong);
  border-radius: 12px; outline: none;
}
.agent-picker__card h1 { font-size: 12px; margin: 0; color: var(--text-primary); }
.agent-picker__card p { font-size: 10px; margin: 0 0 6px; color: var(--text-faint); }
.agent-picker__option {
  display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 8px;
  padding: 6px 8px; border: 0; border-radius: 6px; background: none;
  color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer; text-align: left;
}
.agent-picker__option:hover, .agent-picker__option.is-focused { background: var(--chrome-2); }
.agent-picker__option.is-shell { border-top: 1px solid var(--hair); border-radius: 0 0 6px 6px; margin-top: 4px; padding-top: 8px; }
.agent-picker__option kbd {
  font-family: var(--font-mono, "SF Mono", monospace); font-size: 10px;
  color: var(--text-faint); border: 1px solid var(--hair-strong); border-radius: 4px;
  padding: 0 4px; text-align: center;
}
.agent-picker__option code { font-family: var(--font-mono, "SF Mono", monospace); font-size: 10px; color: var(--text-faint); }
.skip-all-bar {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 25;
  display: flex; align-items: center; gap: 12px; padding: 6px 12px;
  background: var(--chrome-1); border: 1px solid var(--hair-strong); border-radius: 8px;
  font-size: 11px; color: var(--text-muted);
  animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.skip-all-bar button {
  font: inherit; font-size: 11px; padding: 3px 10px; border-radius: 6px;
  border: 1px solid var(--hair-strong); background: none; color: var(--text-primary); cursor: pointer;
}
.skip-all-bar button:hover { border-color: var(--accent); }
```

Note: pane elements must anchor absolute overlays — check `src/styles.css` for the `.pane` rule; if it does not already set `position: relative`, add it there in this step.

- [ ] **Step 4: Verify**

Run: `npm run build && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-picker/agent-picker.ts src/agent-picker/skip-all-bar.tsx src/styles.css
git commit -m "feat: one-shot agent picker cards and skip-all bar"
```

---

### Task 12: TabManager integration (openFromPreset, capture, picker hooks, ⌘⇧S)

**Files:**
- Create: `src/presets/ui-signals.ts`
- Modify: `src/terminal/terminal-manager.ts` (expose `paneElement`)
- Modify: `src/terminal/keymap.ts` + `src/terminal/keymap.test.ts` (add `"save-preset"`)
- Modify: `src/terminal/tab-manager.ts`

**Interfaces:**
- Consumes: `beginAgentPick` (Task 11), `prunePending` (Task 6), `freshPaneInfo` (shipped `pane-info.ts`)
- Produces (used by Task 14):
  - `ui-signals.ts`: `boardOpen: Signal<boolean>`, `saveDialogOpen: Signal<boolean>`, `editorRequest: Signal<{ source: "board"; workspace: string | null } | { source: "live" } | null>`
  - `TerminalManager.paneElement(id: number): HTMLElement | null`
  - `TabManager.init(): Promise<{ hasTabs: boolean }>` — no fallback tab is auto-created anymore (FR-001)
  - `TabManager.openFromPreset(layout: SerializedNode, cwds: readonly (string | null)[]): Promise<boolean>` — materialize one tab + begin agent pick (FR-005)
  - `TabManager.captureActiveLayout(): Promise<{ layout: SerializedNode; cwds: readonly (string | null)[] } | null>` (FR-012)
  - `TabManager.paneOverlayHost(id: number): HTMLElement | null`
  - keymap action `"save-preset"` bound to ⌘⇧S (FR-012 AC-1)

- [ ] **Step 1: Write the failing keymap test**

Add to the existing `describe` coverage in `src/terminal/keymap.test.ts`:

```typescript
it("matches Cmd+Shift+S as save-preset", () => {
  const event = new KeyboardEvent("keydown", {
    key: "s",
    metaKey: true,
    shiftKey: true,
  });
  expect(matchBinding(event)).toBe("save-preset");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/terminal/keymap.test.ts`
Expected: FAIL — `matchBinding` returns `null` (no binding yet).

- [ ] **Step 3: Implement keymap + signals + paneElement**

In `src/terminal/keymap.ts`: add `| "save-preset"` to `ShortcutAction`, and to `DEFAULT_KEYMAP`:

```typescript
  // Capture the live layout as a preset (UX §3) — also in the Window menu
  { key: "s", meta: true, shift: true, action: "save-preset" },
```

Create `src/presets/ui-signals.ts`:

```typescript
import { signal } from "@preact/signals";

/** Cross-module UI intents: keymap / menu / board raise them, App renders. */
export type EditorRequest =
  | { readonly source: "board"; readonly workspace: string | null }
  | { readonly source: "live" };

export const boardOpen = signal(false);
export const saveDialogOpen = signal(false);
export const editorRequest = signal<EditorRequest | null>(null);
```

In `src/terminal/terminal-manager.ts`: add to the `TerminalManager` interface:

```typescript
  /** Root element of a pane (overlay anchor for the agent picker). */
  paneElement(id: number): HTMLElement | null;
```

and to the returned object:

```typescript
    paneElement(id) {
      return panes.get(id)?.element ?? null;
    },
```

- [ ] **Step 4: Rework TabManager**

In `src/terminal/tab-manager.ts`:

Add imports:

```typescript
import { beginAgentPick } from "../agent-picker/agent-picker";
import { prunePending } from "../agent-picker/picker-store";
import { saveDialogOpen } from "../presets/ui-signals";
import { freshPaneInfo } from "./pane-info";
```

Update the `TabManager` interface:

```typescript
export interface TabManager {
  /** Init listeners + optional session restore; hasTabs=false → show the Open board. */
  init(): Promise<{ hasTabs: boolean }>;
  /** Materialize one tab from a preset layout + resolved CWDs; begins agent pick. */
  openFromPreset(
    layout: SerializedNode,
    cwds: readonly (string | null)[],
  ): Promise<boolean>;
  /** Live layout + fresh per-pane CWDs for save-as-preset; null when no tab. */
  captureActiveLayout(): Promise<{
    layout: SerializedNode;
    cwds: readonly (string | null)[];
  } | null>;
  /** Overlay anchor for a pane in any tab (agent picker cards). */
  paneOverlayHost(id: number): HTMLElement | null;
  newTab(): Promise<void>;
  closeTab(index: number): Promise<void>;
  selectTab(index: number): void;
  renameTab(index: number, name: string | null): void;
  setTabDotColor(index: number, color: TabDotColor | null): void;
  cycleTab(step: 1 | -1): void;
  splitActive(dir: Direction): Promise<void>;
  closePane(): Promise<void>;
  applySettings(next: Settings): void;
  focusActive(): void;
  dispose(): void;
}
```

Add a helper next to `pollTargets()`:

```typescript
  function allPaneIds(): number[] {
    return tabs.flatMap((tab) => tab.manager.paneIds());
  }
```

Extend the layout callback so closed panes leave the pending set:

```typescript
  const callbacks = {
    onLayoutChange(): void {
      syncViews();
      persist();
      prunePending(allPaneIds());
    },
  };
```

In `closeTab(...)`, after `tabs.splice(index, 1); overrides.delete(entry.key);` add:

```typescript
    prunePending(allPaneIds());
```

Add the new methods (place near `newTab`):

```typescript
  /** FR-005: one tab per Open; CWDs already resolved by the caller. */
  async function openFromPreset(
    layout: SerializedNode,
    cwds: readonly (string | null)[],
  ): Promise<boolean> {
    if (!(await addTab(layout, cwds))) {
      return false;
    }
    selectTab(tabs.length - 1);
    void poll();
    void beginAgentPick(tabs[tabs.length - 1].manager.paneIds());
    return true;
  }

  /** FR-012: fresh (non-polled) CWDs so a just-cd'd pane saves correctly. */
  async function captureActiveLayout(): Promise<{
    layout: SerializedNode;
    cwds: readonly (string | null)[];
  } | null> {
    const manager = activeManager();
    const layout = manager?.serializeLayout() ?? null;
    if (!manager || layout === null) {
      return null;
    }
    const ids = manager.paneIds();
    const infos = await freshPaneInfo(ids);
    const byId = new Map(infos.map((info) => [info.id, info] as const));
    return { layout, cwds: ids.map((id) => byId.get(id)?.cwd ?? null) };
  }

  function paneOverlayHost(id: number): HTMLElement | null {
    for (const tab of tabs) {
      const element = tab.manager.paneElement(id);
      if (element !== null) {
        return element;
      }
    }
    return null;
  }
```

Rework the tail of `init()` — replace everything from `const session = ...` to the end of the function with:

```typescript
    const session = settings.value.restoreTabs ? await loadSession() : null;
    if (session !== null) {
      for (const sessionTab of session.tabs) {
        if (!(await addTab(sessionTab.layout))) {
          continue; // spawn failed — skip its overrides too
        }
        const key = tabs[tabs.length - 1].key;
        const override: TabOverride = {
          ...(sessionTab.name !== undefined ? { name: sessionTab.name } : {}),
          ...(sessionTab.dotColor !== undefined
            ? { dotColor: sessionTab.dotColor }
            : {}),
        };
        if (override.name !== undefined || override.dotColor !== undefined) {
          overrides.set(key, override);
        }
      }
    }
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    if (tabs.length === 0) {
      // No restorable session — the App shows the Open board (FR-001)
      syncViews();
      return { hasTabs: false };
    }
    selectTab(Math.min(session?.activeTab ?? 0, tabs.length - 1));
    void poll();
    // Restore never skips the one-shot picker (FR-021 AC-3)
    void beginAgentPick(allPaneIds());
    return { hasTabs: true };
```

Add the shortcut case in `handleShortcut`:

```typescript
      case "save-preset":
        if (tabs.length > 0) {
          saveDialogOpen.value = true;
        }
        break;
```

Extend the returned object with the new methods:

```typescript
    openFromPreset,
    captureActiveLayout,
    paneOverlayHost,
```

In `src/ui/app.tsx`, the existing call `manager.init().catch(...)` still typechecks (the resolved value is unused until Task 14) — leave it for now.

- [ ] **Step 5: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS — keymap test green; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/presets/ui-signals.ts src/terminal/terminal-manager.ts src/terminal/keymap.ts src/terminal/keymap.test.ts src/terminal/tab-manager.ts
git commit -m "feat: tab manager preset materialization, capture and picker hooks"
```

---

### Task 13: Native menu entries (Window ▸ presets)

**Files:**
- Modify: `src-tauri/src/menu.rs`

**Interfaces:**
- Produces (used by Task 14): app events `menu:new-preset` and `menu:save-preset` (no payload). The `CmdOrCtrl+Shift+S` accelerator lives on the menu item; the webview keymap binding (Task 12) is the fallback path.

- [ ] **Step 1: Implement**

In `src-tauri/src/menu.rs`, add id constants next to `QUIT_MENU_ID`:

```rust
#[cfg(target_os = "macos")]
const NEW_PRESET_MENU_ID: &str = "new-preset";
#[cfg(target_os = "macos")]
const SAVE_PRESET_MENU_ID: &str = "save-preset";
```

Inside `install`, before the `window_menu` is built, create the items and extend the submenu:

```rust
    let new_preset = MenuItem::with_id(
        handle,
        NEW_PRESET_MENU_ID,
        "New Layout Preset…",
        true,
        None::<&str>,
    )?;
    let save_preset = MenuItem::with_id(
        handle,
        SAVE_PRESET_MENU_ID,
        "Save Layout as Preset…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .separator()
        .item(&new_preset)
        .item(&save_preset)
        .build()?;
```

Extend the menu-event handler:

```rust
    app.on_menu_event(|handle, event| {
        if event.id() == QUIT_MENU_ID {
            let _ = handle.emit("quit-requested", ());
        } else if event.id() == NEW_PRESET_MENU_ID {
            let _ = handle.emit("menu:new-preset", ());
        } else if event.id() == SAVE_PRESET_MENU_ID {
            let _ = handle.emit("menu:save-preset", ());
        }
    });
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo build`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/menu.rs
git commit -m "feat: Window menu entries for preset editor and save-as-preset"
```

---

### Task 14: App integration + end-to-end verification

Wires every surface into `App`, adds the one missing `TabManager` accessor, and closes with the manual acceptance pass.

**Files:**
- Modify: `src/terminal/tab-manager.ts` (add `activePaneCwd`)
- Modify: `src/ui/app.tsx` (full replacement below)

**Interfaces:**
- Consumes: everything produced by Tasks 2–13.
- Produces: the complete session-start flow.

- [ ] **Step 1: Add `activePaneCwd` to TabManager**

In `src/terminal/tab-manager.ts` interface:

```typescript
  /** Fresh CWD of the focused pane (editor "↑ inherit" from a live window). */
  activePaneCwd(): Promise<string | null>;
```

Implementation (next to `captureActiveLayout`; `freshCwd` is already imported):

```typescript
  function activePaneCwd(): Promise<string | null> {
    return freshCwd(activeManager()?.activePaneId() ?? null);
  }
```

Add `activePaneCwd,` to the returned object.

- [ ] **Step 2: Replace `src/ui/app.tsx`**

```tsx
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installQuitGuard } from "../lib/quit-guard";
import { deriveChromeColors } from "../lib/derive-colors";
import { countLeaves } from "../lib/split-tree";
import { resolveCwds, type Preset } from "../lib/preset-schema";
import { settings, updateSettings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import { createTabManager, type TabManager } from "../terminal/tab-manager";
import {
  markLastUsed,
  presetsData,
  savePreset,
} from "../presets/presets-store";
import { recordWorkspaceOpen } from "../open-board/workspaces-store";
import {
  boardOpen,
  editorRequest,
  saveDialogOpen,
} from "../presets/ui-signals";
import { OpenBoard } from "../open-board/open-board";
import { PresetEditor } from "../presets/preset-editor";
import {
  SavePresetDialog,
  type SaveTarget,
} from "../presets/save-preset-dialog";
import type { PresetArtifact } from "../presets/mock-model";
import { installAgentPicker } from "../agent-picker/agent-picker";
import { SkipAllBar } from "../agent-picker/skip-all-bar";
import { TabBar } from "./tab-bar";
import { StatusBar } from "./status-bar";
import { SettingsPanel } from "./settings-panel";

export function App() {
  const panelOpen = useSignal(false);
  const stagesRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<TabManager | null>(null);

  useEffect(() => {
    const host = stagesRef.current;
    if (!host) {
      return;
    }
    const manager = createTabManager(host);
    tabsRef.current = manager;
    manager
      .init()
      .then(({ hasTabs }) => {
        // No restorable session / restore off → Open board (FR-001)
        boardOpen.value = !hasTabs;
      })
      .catch((err: unknown) => {
        console.error("Failed to initialize terminals:", err);
        boardOpen.value = true;
      });
    const disposePicker = installAgentPicker(() => tabsRef.current);
    return () => {
      disposePicker();
      manager.dispose();
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    installQuitGuard()
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to install quit guard:", err);
      });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const unsubs: UnlistenFn[] = [];
    void listen("menu:save-preset", () => {
      if (!boardOpen.value) {
        saveDialogOpen.value = true;
      }
    }).then((fn) => unsubs.push(fn));
    void listen("menu:new-preset", () => {
      editorRequest.value = { source: "live" };
    }).then((fn) => unsubs.push(fn));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  // Push theme colors into terminals and the chrome CSS vars
  useSignalEffect(() => {
    const current = settings.value;
    tabsRef.current?.applySettings(current);
    const theme = resolveTheme(current);
    const bg = theme.background ?? "#16161e";
    const fg = theme.foreground ?? "#c0caf5";
    const chrome = deriveChromeColors(bg, fg);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--bg", bg);
    rootStyle.setProperty("--fg", fg);
    rootStyle.setProperty("--accent", theme.blue ?? "#7aa2f7");
    rootStyle.setProperty("--red", theme.red ?? "#f7768e");
    rootStyle.setProperty("--green", theme.green ?? "#9ece6a");
    rootStyle.setProperty("--yellow", theme.yellow ?? "#e0af68");
    rootStyle.setProperty("--magenta", theme.magenta ?? "#bb9af7");
    rootStyle.setProperty("--cyan", theme.cyan ?? "#7dcfff");
    rootStyle.setProperty("--tone", chrome.tone);
    rootStyle.setProperty("--chrome-1", chrome.chrome1);
    rootStyle.setProperty("--chrome-2", chrome.chrome2);
    rootStyle.setProperty("--tab-active-bg", chrome.tabActiveBg);
    rootStyle.setProperty("--input-bg", chrome.inputBg);
    rootStyle.setProperty("--hair", chrome.hair);
    rootStyle.setProperty("--hair-strong", chrome.hairStrong);
    rootStyle.setProperty("--text-primary", chrome.textPrimary);
    rootStyle.setProperty("--text-muted", chrome.textMuted);
    rootStyle.setProperty("--text-faint", chrome.textFaint);
  });

  const closePanel = (): void => {
    panelOpen.value = false;
    tabsRef.current?.focusActive();
  };

  /** Open board confirm: materialize + record recents + preselect memory. */
  async function handleOpen(workspace: string, preset: Preset): Promise<void> {
    const ok = await tabsRef.current?.openFromPreset(
      preset.layout,
      resolveCwds(preset, workspace),
    );
    if (ok) {
      recordWorkspaceOpen(workspace);
      markLastUsed(preset.id);
      boardOpen.value = false;
    }
  }

  /** Editor confirm (FR-015): save the preset, then materialize a new tab. */
  async function handleEditorCreate(
    name: string,
    artifact: PresetArtifact,
  ): Promise<void> {
    const preset: Preset = {
      id: crypto.randomUUID(),
      name,
      layout: artifact.layout,
      ...(artifact.cwds ? { cwds: artifact.cwds } : {}),
    };
    savePreset(preset);
    const request = editorRequest.value;
    editorRequest.value = null;
    if (request === null) {
      return;
    }
    if (request.source === "board") {
      if (request.workspace === null) {
        return; // gated like Open — board stays up showing the new card
      }
      await handleOpen(request.workspace, preset);
      return;
    }
    // Live window: inherit panes resolve to the focused pane's CWD (BF-Rule 8)
    const inherit = (await tabsRef.current?.activePaneCwd()) ?? null;
    const cwds = Array.from(
      { length: countLeaves(preset.layout) },
      (_, index) => preset.cwds?.[index] ?? inherit,
    );
    await tabsRef.current?.openFromPreset(preset.layout, cwds);
  }

  /** ⌘⇧S / menu: capture live layout into a new or existing preset (FR-012). */
  async function handleSavePreset(
    target: SaveTarget,
    includeCwds: boolean,
  ): Promise<void> {
    const captured = await tabsRef.current?.captureActiveLayout();
    saveDialogOpen.value = false;
    if (!captured) {
      return;
    }
    const cwds =
      includeCwds && captured.cwds.some((cwd) => cwd !== null)
        ? captured.cwds
        : undefined;
    if (target.kind === "new") {
      savePreset({
        id: crypto.randomUUID(),
        name: target.name,
        layout: captured.layout,
        ...(cwds ? { cwds } : {}),
      });
      return;
    }
    const existing = presetsData.value.presets.find(
      (preset) => preset.id === target.id,
    );
    if (existing) {
      savePreset({
        id: existing.id,
        name: existing.name,
        layout: captured.layout,
        ...(cwds ? { cwds } : {}),
      });
    }
  }

  return (
    <div class="window">
      <div
        class="titlebar"
        data-tauri-drag-region
        onDblClick={() => {
          getCurrentWindow()
            .toggleMaximize()
            .catch((err: unknown) => {
              console.warn("toggleMaximize failed:", err);
            });
        }}
      />
      <TabBar
        settingsOpen={panelOpen.value}
        onSelectTab={(index) => tabsRef.current?.selectTab(index)}
        onCloseTab={(index) => void tabsRef.current?.closeTab(index)}
        onNewTab={() => void tabsRef.current?.newTab()}
        onSplitRow={() => void tabsRef.current?.splitActive("row")}
        onSplitColumn={() => void tabsRef.current?.splitActive("column")}
        onClosePane={() => void tabsRef.current?.closePane()}
        onRenameTab={(index, name) => tabsRef.current?.renameTab(index, name)}
        onSetTabColor={(index, color) =>
          tabsRef.current?.setTabDotColor(index, color)
        }
        expandActive={settings.value.focusExpand}
        onToggleExpand={() =>
          updateSettings({ focusExpand: !settings.value.focusExpand })
        }
        onToggleSettings={() => {
          if (panelOpen.value) {
            closePanel();
          } else {
            panelOpen.value = true;
          }
        }}
      />
      <main class="stage">
        <div class="stage__tabs" ref={stagesRef} />
        {boardOpen.value ? (
          <OpenBoard
            canCancel={false}
            onCancel={() => {
              // Unreachable while canCancel is false; multi-window plan enables it
            }}
            onOpen={(workspace, preset) => void handleOpen(workspace, preset)}
            onNewPreset={(workspace) => {
              editorRequest.value = { source: "board", workspace };
            }}
          />
        ) : null}
        {editorRequest.value !== null ? (
          <PresetEditor
            onCancel={() => {
              editorRequest.value = null;
            }}
            onCreate={(name, artifact) =>
              void handleEditorCreate(name, artifact)
            }
          />
        ) : null}
        {saveDialogOpen.value ? (
          <SavePresetDialog
            existing={presetsData.value.presets}
            onCancel={() => {
              saveDialogOpen.value = false;
            }}
            onSave={(target, includeCwds) =>
              void handleSavePreset(target, includeCwds)
            }
          />
        ) : null}
        <SkipAllBar />
        <SettingsPanel open={panelOpen.value} onClose={closePanel} />
      </main>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 3: Full automated pass**

Run: `npm test && npm run build && cd src-tauri && cargo test && cargo build`
Expected: all PASS.

- [ ] **Step 4: Manual acceptance pass (`npm run tauri dev`)**

Walk the FR acceptance criteria:

1. **Board trigger (FR-001):** quit the app; turn restore OFF in settings (or clear `session.json` in the app data dir); relaunch → Open board appears, no auto tab. Relaunch with restore ON and a saved session → tabs restore, board does NOT appear, every restored pane shows a picker card.
2. **Board content + defaults (FR-002/003/004):** built-in "Single pane" card tagged BUILT-IN is present and preselected on first run; Open disabled + amber summary until a folder is chosen; Open Folder… opens the native picker; re-picking an existing recent selects it without duplicating; a deleted folder's recent row shows "missing" and is not selectable.
3. **Open (FR-005/006):** pick a workspace + preset → Open: one tab materializes, pane CWDs follow preset-else-workspace (check pane header CWDs), picker cards appear. Keyboard-only run: arrows/Tab to choose, Return to open, ⌘O for the picker.
4. **Picker (FR-020…FR-026):** cards list detected agents (with `claude`/`codex`/`gemini` on your login-shell PATH) + Shell only; pressing `1` spawns the first agent immediately (badge updates); Shell leaves the prompt; Skip all (click, ⌘Return, ⌥S) resolves the rest and keeps earlier picks; no card ever re-appears for the same materialization; with agents temporarily renamed off PATH the card shows only Shell.
5. **Editor (FR-014/015/016):** board ＋ New preset… → design a quad via toolbar and via keyboard (⌘→/⌘↓/⌫/[ ]), drag a divider, Set CWD on one pane, name it, Create tab → new tab opens with that layout, preset card appears on future boards; Window ▸ New Layout Preset… from a live tab creates a NEW tab (current tab untouched), inherit panes at the focused pane's CWD.
6. **Save/CRUD (FR-010/012/013):** ⌘⇧S (and the menu item) saves the live layout with CWDs (toggle off → bare tree); overwrite an existing preset; on the board rename (R / right-click) and delete (⌫ with inline confirm) a card; built-in card refuses both; restart the app → presets and recents persisted.
7. **No regressions (NFR-008):** split, drag-dock, zoom, Cmd+F, closed-tab reopen (⌘⇧T), busy-close guard, session save/restore all behave as before; `session.json` contains no `cwds` key.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/terminal/tab-manager.ts
git commit -m "feat: wire open board, preset editor and agent picker into the app"
```

---

## Self-Review Notes

- **Spec coverage:** FR-001–006 → Tasks 5/7/12/14; FR-010–016 → Tasks 1/2/5/8/9/10/13/14; FR-020–026 → Tasks 4/6/11/12/14. FR-001 AC-1 (New Window) and board Cancel are explicitly deferred to the multi-window plan (single-window app today).
- **Type consistency spot-checks:** `Preset`/`PresetsData` (Task 2) are the only preset types used everywhere; `PresetArtifact` produced by Task 8 = consumed by Task 14; `openFromPreset(layout, cwds)` signature identical in Tasks 12 and 14; `paneOverlayHost` name identical in Tasks 11 and 12; picker store function names identical across Tasks 6/11/12.
- **Known seams:** `.pane` must be `position: relative` for picker overlays (checked in Task 11 Step 3); the ⌘⇧S menu accelerator normally consumes the key before the webview keymap — both paths set the same signal, so double-fire is idempotent.
