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

/** Sidebar workspace list — names and truncated paths as in the app. */
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

/** Status bar segments — mirrors src/ui/status-bar.tsx in sidebar mode. */
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
 * Pane scripts. Step shape: { kind: "line" | "chunk" | "think" | "rest",
 * text?, cls?, delay } — delay is ms since the previous step. "line" appends
 * a transcript row (and hides the spinner), "chunk" extends the last row,
 * "think" shows the spinner with the given text, "rest" is a pure pause.
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
      },
      { kind: "think", text: "• Working (2s · esc to interrupt)", delay: 600 },
      { kind: "line", text: "codex", cls: "t-agent", delay: 2400 },
      {
        kind: "line",
        text: "The old pane's canvas paints one frame after the",
        cls: "t-body",
        delay: 420,
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
    footer: [
      { text: "opencode · claude-sonnet-5 · 12.4k tokens", cls: "t-dim" },
    ],
    steps: [
      {
        kind: "line",
        text: "> why does the status bar lose the branch after cd?",
        cls: "t-user",
        delay: 1100,
      },
      { kind: "think", text: "◍ thinking…", delay: 600 },
      {
        kind: "line",
        text: "The watcher only re-reads HEAD on focus. A cwd",
        cls: "t-body",
        delay: 2300,
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
      },
      { kind: "rest", delay: 1200 },
    ],
  },
]);
