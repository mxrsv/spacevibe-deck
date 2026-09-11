/**
 * App-stage data — the mock of the real Deck window, shared by the landing
 * hero, the scroll tour and the marketing video.
 *
 * Everything here is intentionally English-only: the stage mirrors the
 * released app regardless of the landing locale (see the 2026-07-16 spec).
 */

import { BRAND } from "./brand.js";

export const deepFreeze = (value) => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
};

/**
 * Sidebar workspace list — names and truncated paths as in the app.
 *
 * Video-only since 2026-08-20; the landing composition no longer renders it.
 */
export const stageSidebar = deepFreeze([
  {
    id: BRAND.slug,
    label: BRAND.slug,
    path: `…evibe-workspace/${BRAND.slug}`,
    active: true,
    monogram: null,
    tint: null,
  },
  {
    id: "spacevibe-arena",
    label: "spacevibe-arena",
    path: "…rkspace/spacevibe-arena",
    active: false,
    monogram: "S",
    tint: "#bb9af7",
  },
  {
    id: "spacevibe-api",
    label: "spacevibe-api",
    path: "…rkspace/spacevibe-api",
    active: false,
    monogram: "A",
    tint: "#9ece6a",
  },
]);

/**
 * Status bar segments — mirrors src/ui/status-bar.tsx in sidebar mode.
 *
 * Video-only since 2026-08-20; the landing composition no longer renders it.
 */
export const stageStatus = deepFreeze({
  branch: "main",
  cwd: `~/Documents/Development/spacevibe-workspace/${BRAND.slug}`,
  paneCount: "3 panes",
  theme: "Tokyo Night",
  hints: [
    { label: "split", key: "⌘D" },
    { label: "new tab", key: "⌘T" },
  ],
});

/**
 * Agent rail — project → checkout card → agent pane, as Deck 1.1 draws it
 * (`src/ui/worktree-card.tsx`, `docs/internals/agent-rail.md`). A project
 * holds its checkouts; a checkout with panes is a CARD, one with none is a
 * bare row (mark, name, badge and nothing else).
 *
 * A card's `name` and `badge` follow the app's naming rule rather than the
 * folder: the primary checkout is named by its BRANCH and badged `Primary`,
 * every other checkout by its folder and badged with its branch — so no head
 * says the project name twice. `open` shows the agent rows, closed folds them
 * into the segmented strip. `active` is the checkout holding the window's
 * focus, and gets the green frame.
 *
 * A pane's `label` is what its row prints: the agent's latest sentence, or
 * its name when it has not said anything yet. `id` is the pane id the stream
 * engine writes through (`data-tail` on the label, `data-dot` on the status
 * cell); a null id is a static pane nothing animates. `remembered` is a
 * project with nothing open: a still header, and its checkouts as bare rows.
 *
 * The spacevibe-deck `main` card is OPEN on purpose: its three rows are where
 * the three streamed panes' sentences land. A closed card has no row to write
 * a sentence into. The resting sentences are the ones the pane scripts below
 * leave on screen: claude carries its first `tail` because it is still
 * working, codex and opencode their last.
 */
export const stageRail = deepFreeze([
  {
    project: "spacevibe-deck",
    checkouts: [
      {
        name: "main",
        badge: { kind: "role", text: "Primary" },
        age: "now",
        open: true,
        active: true,
        panes: [
          {
            id: "claude",
            agent: "claude",
            label: "I'll trace why the pane divider drifts on resize.",
            state: "working",
            focused: true,
          },
          {
            id: "codex",
            agent: "codex",
            label: "96 passed · 0 failed",
            state: "done",
          },
          {
            id: "opencode",
            agent: "opencode",
            label: "typecheck clean · the branch follows cwd now",
            state: "done",
          },
        ],
      },
      {
        name: "detach",
        badge: { kind: "branch", text: "feat/detach" },
        age: "12m",
        panes: [
          {
            id: null,
            agent: "codex",
            label: "npm test failed — 3 assertions in vote-panel.",
            state: "failed",
          },
          { id: null, agent: "claude", label: "Claude", state: "working" },
        ],
      },
    ],
  },
  {
    project: "spacevibe-api",
    checkouts: [
      {
        name: "main",
        badge: { kind: "role", text: "Primary" },
        age: "3h",
        panes: [
          {
            id: null,
            agent: "gemini",
            label: "Should I apply the pending migration?",
            state: "asked",
          },
          {
            id: null,
            agent: "agy",
            label: "Batching the artifact uploads into one R2 write.",
            state: "working",
          },
        ],
      },
      {
        name: "billing",
        badge: { kind: "branch", text: "feat/billing" },
        panes: [],
      },
    ],
  },
  {
    project: "spacevibe-hub",
    remembered: true,
    checkouts: [{ name: "main", badge: { kind: "role", text: "Primary" }, panes: [] }],
  },
]);

/**
 * Tab strip — one chip shape per surface, in open order rather than by
 * recency. The mark comes from `kind` alone: a terminal chip draws its
 * agent's brand glyph, a file chip a file-type icon, the browser chip a
 * globe, the Agent Board's chip four squares (`tab-strip.tsx`). The active
 * terminal chip's label is the focused pane's sentence, which the stream
 * engine keeps in step through the same `data-tail` hook the rail row uses.
 *
 * No `+` closes the strip: 1.1 took it off, and ⌘T raises the New Agent
 * list instead.
 */
export const stageStrip = deepFreeze([
  {
    kind: "terminal",
    agent: "claude",
    paneId: "claude",
    label: "I'll trace why the pane divider drifts on resize.",
    active: true,
  },
  { kind: "file", label: "layout-engine.ts", active: false },
  { kind: "browser", label: "localhost:5173", active: false },
  { kind: "board", label: "Agents", active: false },
]);

/**
 * Pane scripts. Step shape: { kind: "line" | "chunk" | "think" | "rest",
 * text?, cls?, delay, tail?, state? } — delay is ms since the previous step.
 * "line" appends a transcript row (and hides the spinner), "chunk" extends
 * the last row, "think" shows the spinner with the given text, "rest" is a
 * pure pause.
 *
 * `tail` and `state` are the rail's half of a step: the sentence and the
 * status dot it leaves on every `[data-tail]` / `[data-dot]` hook the pane
 * owns — its rail row and, for the focused pane, the active tab chip. A step
 * carrying neither leaves the rail as it stands. Tails are sentences, never
 * transcript rows: no glyph prefix.
 */
export const stagePanes = deepFreeze([
  {
    id: "claude",
    focused: true,
    startOffset: 0,
    restGap: 4200,
    maxLines: 12,
    prompt: "❯",
    footer: [
      {
        text: `[Opus 5 (1M context)] ▮▮▮▯▯▯▯▯ 32% | ${BRAND.slug} git:(main*)`,
        cls: "t-dim",
      },
      { text: "▶▶ auto mode on (shift+tab to cycle)", cls: "t-dim" },
    ],
    steps: [
      {
        kind: "line",
        text: "● I'll trace why the pane divider drifts on resize.",
        cls: "t-body",
        delay: 600,
        tail: "I'll trace why the pane divider drifts on resize.",
        state: "working",
      },
      { kind: "think", text: "✳ Pondering… (esc to interrupt)", delay: 500 },
      {
        kind: "line",
        text: "● Read(src/terminal/layout-engine.ts)",
        cls: "t-tool",
        delay: 2200,
      },
      { kind: "line", text: "  ⎿ 312 lines", cls: "t-dim", delay: 450 },
      { kind: "think", text: "✳ Refining… (2s · ↓ 1.4k tokens)", delay: 700 },
      {
        kind: "line",
        text: "● The ratio rounds to integer cells before the flex",
        cls: "t-body",
        delay: 2600,
        tail: "The ratio rounds to integer cells before the flex pass.",
      },
      {
        kind: "chunk",
        text: " pass — resize twice and the drift compounds.",
        delay: 520,
      },
      {
        kind: "line",
        text: "● Update(src/terminal/layout-engine.ts)",
        cls: "t-tool",
        delay: 900,
      },
      {
        kind: "line",
        text: "  ⎿ +14 -6 · keep the fractional ratio in the tree",
        cls: "t-dim",
        delay: 500,
      },
      { kind: "think", text: "✳ Testing… (npm test)", delay: 800 },
      {
        kind: "line",
        text: "● 214 tests passed — the divider stays put now.",
        cls: "t-ok",
        delay: 2800,
        tail: "214 tests passed — the divider stays put now.",
        state: "done",
      },
      { kind: "rest", delay: 1200 },
    ],
  },
  {
    id: "codex",
    focused: false,
    startOffset: 1300,
    restGap: 5200,
    maxLines: 10,
    prompt: "▌",
    footer: [{ text: "tokens used 4.2k · model gpt-5-codex", cls: "t-dim" }],
    steps: [
      {
        kind: "line",
        text: "› trace the flicker when a pane closes",
        cls: "t-user",
        delay: 900,
        state: "working",
      },
      { kind: "think", text: "• Working (2s · esc to interrupt)", delay: 600 },
      { kind: "line", text: "codex", cls: "t-agent", delay: 2400 },
      {
        kind: "line",
        text: "The old pane's canvas paints one frame after the",
        cls: "t-body",
        delay: 420,
        tail: "The old pane's canvas paints one frame after the grid reflows.",
      },
      {
        kind: "chunk",
        text: " grid reflows. I'll defer the removal by a frame.",
        delay: 480,
      },
      {
        kind: "line",
        text: "✓ Applied patch src/terminal/pane-lifecycle.ts",
        cls: "t-ok",
        delay: 1200,
      },
      {
        kind: "line",
        text: "  └ requestAnimationFrame before detach",
        cls: "t-dim",
        delay: 460,
      },
      { kind: "think", text: "• Verifying (vitest run)", delay: 700 },
      {
        kind: "line",
        text: "✓ 96 passed · 0 failed",
        cls: "t-ok",
        delay: 2400,
        tail: "96 passed · 0 failed",
        state: "done",
      },
      { kind: "rest", delay: 1000 },
    ],
  },
  {
    id: "opencode",
    focused: false,
    startOffset: 2600,
    restGap: 4800,
    maxLines: 18,
    prompt: ">",
    footer: [{ text: "opencode · claude-sonnet-5 · 12.4k tokens", cls: "t-dim" }],
    steps: [
      {
        kind: "line",
        text: "> why does the status bar lose the branch after cd?",
        cls: "t-user",
        delay: 1100,
        state: "working",
      },
      { kind: "think", text: "◍ thinking…", delay: 600 },
      {
        kind: "line",
        text: "The watcher only re-reads HEAD on focus. A cwd",
        cls: "t-body",
        delay: 2300,
        tail: "The watcher only re-reads HEAD on focus.",
      },
      {
        kind: "chunk",
        text: " change from OSC 7 should also trigger it.",
        delay: 500,
      },
      {
        kind: "line",
        text: "edit src/lib/git-status.ts",
        cls: "t-tool",
        delay: 1100,
      },
      {
        kind: "line",
        text: "  + watch cwd from osc-7 events",
        cls: "t-dim",
        delay: 450,
      },
      { kind: "think", text: "◍ running checks…", delay: 700 },
      {
        kind: "line",
        text: "✓ typecheck clean · the branch follows cwd now",
        cls: "t-ok",
        delay: 2500,
        tail: "typecheck clean · the branch follows cwd now",
        state: "done",
      },
      { kind: "rest", delay: 1200 },
    ],
  },
]);
