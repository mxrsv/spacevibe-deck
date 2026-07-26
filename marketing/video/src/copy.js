/**
 * Everything the video says, and the Open-board rows it shows.
 *
 * English-only, like every other surface rendered inside app chrome.
 */

import { BRAND } from "../../stage/brand.js";

export const AGENTS = Object.freeze({
  claude: { label: "claude", monogram: "C", tint: "#bb9af7" },
  codex: { label: "codex", monogram: "X", tint: "#9ece6a" },
  opencode: { label: "opencode", monogram: "O", tint: "#7dcfff" },
});

/** Open-board recents. The top row carries the remembered layout + agents. */
export const BOARD_ROWS = Object.freeze([
  {
    id: BRAND.slug,
    label: BRAND.slug,
    path: `…evibe-workspace/${BRAND.slug}`,
    preset: "trio",
    agents: ["claude", "codex", "opencode"],
    hot: true,
  },
  {
    id: "spacevibe-arena",
    label: "spacevibe-arena",
    path: "…rkspace/spacevibe-arena",
    preset: "duo",
    agents: ["claude"],
    hot: false,
  },
  {
    id: "spacevibe-api",
    label: "spacevibe-api",
    path: "…rkspace/spacevibe-api",
    preset: "quad",
    agents: ["codex"],
    hot: false,
  },
]);

/** Cells drawn inside each layout-preset thumbnail. */
export const PRESET_CELLS = Object.freeze({ duo: 2, trio: 3, quad: 4 });

/**
 * Agent start-up banners — what a pane already shows the moment the layout
 * opens, before the scripted work starts streaming.
 */
export const BOOT_LINES = Object.freeze({
  claude: [
    { text: "✻ Welcome to Claude Code", cls: "t-agent" },
    { text: `  ~/…/spacevibe-workspace/${BRAND.slug}`, cls: "t-dim" },
    { text: "  /help for commands · /status for session", cls: "t-dim" },
    { text: "› fix the divider drift on resize", cls: "t-user" },
  ],
  codex: [
    { text: "codex", cls: "t-agent" },
    { text: `  gpt-5-codex · ${BRAND.slug} git:(main*)`, cls: "t-dim" },
    { text: "  workdir trusted · sandbox on", cls: "t-dim" },
  ],
  opencode: [
    { text: "opencode", cls: "t-agent" },
    { text: `  claude-sonnet-5 · ${BRAND.slug}`, cls: "t-dim" },
    { text: "  /new · /model · /share", cls: "t-dim" },
  ],
});

/** Keyboard callouts, shown one at a time under the window. */
export const HUD = Object.freeze({
  jump: { keys: "⌘⇧A", text: "jump to whichever agent needs you" },
  expand: { keys: "⌘E", text: `focus expand — 65% to the active pane` },
});

/**
 * Captions for the 9:16 cut only. A phone viewer can't read pane transcripts,
 * so the vertical frame carries the story in type and uses the window as
 * evidence rather than as the text itself. `at` is when the caption takes
 * over; the last one runs until the end card.
 */
export const VERTICAL_CAPTIONS = Object.freeze([
  { at: 0.9, keys: null, text: "Open a workspace." },
  { at: 2.9, keys: "↵", text: "It remembers your layout and your agents." },
  { at: 4.6, keys: null, text: "Three agents. One screen." },
  { at: 9.1, keys: null, text: "Deck tells you which one needs you." },
  { at: 11.1, keys: "⌘⇧A", text: "Jump straight to it." },
  {
    at: 13.2,
    keys: "⌘E",
    text: "65% to the active pane. The rest stay in view.",
  },
]);

export const END_CARD = Object.freeze({
  name: BRAND.name,
  tagline: "Run many agents. Watch one screen.",
  sub: "A native macOS terminal for AI agent CLIs.",
  shortcuts: [
    { keys: "⌘D", label: "split" },
    { keys: "⌘E", label: "expand" },
    { keys: "⌘⇧A", label: "jump" },
  ],
});
