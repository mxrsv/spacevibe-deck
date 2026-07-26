/**
 * The film — one end-to-end journey through Deck, expressed as tracks.
 *
 * Beat sheet:
 *   00.0  the window arrives, Open board on screen
 *   01.5  the remembered workspace row lights up (trio layout + 3 agents)
 *   02.5  ↵ opens it — board hands over to the pane grid
 *   03.2  three agents work in parallel, transcripts streaming
 *   09.0  codex finishes            → green mark
 *   10.2  opencode needs you        → magenta mark
 *   11.0  ⌘⇧A jumps focus to the pane that asked
 *   13.1  ⌘E expands it to 65% while the others stay in view
 *   16.6  pull back to the end card
 */

import { VERTICAL_CAPTIONS } from "./copy.js";
import { samplePalette } from "./palette.js";
import { createSampler, window01 } from "./timeline.js";

/** Total length in seconds. */
export const DURATION = 20;

/** EXPAND_RATIO from src/terminal/terminal-manager.ts. */
export const EXPAND_RATIO = 0.65;

/**
 * Transcript playback rate. The shared pane scripts were paced for a hero
 * that loops for minutes; a 20-second film needs them a touch brisker so each
 * pane reaches a full screen of work before the camera moves on.
 */
const TRANSCRIPT_RATE = 1.45;

const T = Object.freeze({
  windowIn: 0,
  boardIn: 0.25,
  settled: 1.4,
  rowHot: 1.5,
  enterKey: 2.42,
  boardOut: 2.55,
  gridIn: 2.8,
  stream: 3.2,
  codexDone: 9,
  needsYou: 10.2,
  hudJump: 11,
  jump: 11.7,
  hudExpand: 12.8,
  expand: 13.1,
  hudOut: 15.6,
  pullBack: 16.6,
  endCard: 17,
});

const EXPAND_LEFT = (1 - EXPAND_RATIO) * 100;
const EXPAND_TOP = (1 - EXPAND_RATIO) * 100;

const PALETTE_KEYS = Object.freeze([
  // Calm app-accent blue while the board waits.
  { t: 0, palette: ["#2a3f7e", "#3d59a1", "#1b2547"] },
  // The three agent brand colours as the layout opens.
  { t: T.stream, palette: ["#bb9af7", "#7dcfff", "#9ece6a"] },
  // Warmer as an agent starts asking for attention.
  { t: T.needsYou, palette: ["#f7768e", "#bb9af7", "#7aa2f7"] },
  // Settle back to the product's own violet for the end card.
  { t: T.pullBack, palette: ["#7aa2f7", "#bb9af7", "#2a3f7e"] },
]);

const tracks = {
  cameraScale: {
    keys: [
      { t: 0, v: 1.075 },
      { t: T.settled, v: 1, ease: "easeOutCubic" },
      { t: T.needsYou, v: 1.005, ease: "linear" },
      { t: T.jump, v: 1.045, ease: "easeInOutCubic" },
      { t: T.expand, v: 1.05, ease: "linear" },
      { t: T.hudOut, v: 1.02, ease: "easeInOutCubic" },
      { t: T.pullBack + 1.2, v: 0.93, ease: "easeInOutCubic" },
    ],
  },
  cameraX: {
    keys: [
      { t: 0, v: 0 },
      { t: T.settled, v: 0, ease: "linear" },
      { t: T.jump, v: -2.4, ease: "easeInOutCubic" },
      { t: T.hudOut, v: -1.1, ease: "easeInOutCubic" },
      { t: T.pullBack + 1.2, v: 0, ease: "easeInOutCubic" },
    ],
  },
  cameraY: {
    keys: [
      { t: 0, v: 2.6 },
      { t: T.settled, v: 0, ease: "easeOutCubic" },
      { t: T.jump, v: -1.7, ease: "easeInOutCubic" },
      { t: T.hudOut, v: -0.8, ease: "easeInOutCubic" },
      { t: T.pullBack + 1.2, v: -1.5, ease: "easeInOutCubic" },
    ],
  },
  cameraRotY: {
    keys: [
      { t: 0, v: 3.4 },
      { t: T.settled, v: 0.7, ease: "easeOutCubic" },
      { t: T.needsYou, v: 0.7, ease: "linear" },
      { t: T.jump, v: -1.5, ease: "easeInOutCubic" },
      { t: T.pullBack + 1.2, v: 0.4, ease: "easeInOutCubic" },
    ],
  },
  cameraRotX: {
    keys: [
      { t: 0, v: 2.2 },
      { t: T.settled, v: 0.5, ease: "easeOutCubic" },
      { t: T.jump, v: 1.1, ease: "easeInOutCubic" },
      { t: T.pullBack + 1.2, v: 0.2, ease: "easeInOutCubic" },
    ],
  },
  windowOpacity: {
    keys: [
      { t: 0, v: 0 },
      { t: 0.85, v: 1, ease: "easeOutCubic" },
      { t: DURATION - 0.35, v: 1, ease: "linear" },
      { t: DURATION, v: 0.82, ease: "easeInCubic" },
    ],
  },
  boardOpacity: {
    keys: [
      { t: T.boardIn, v: 0 },
      { t: 1, v: 1, ease: "easeOutCubic" },
      { t: T.boardOut, v: 1, ease: "linear" },
      { t: T.boardOut + 0.4, v: 0, ease: "easeInCubic" },
    ],
  },
  boardScale: {
    keys: [
      { t: T.boardIn, v: 0.97 },
      { t: 1, v: 1, ease: "easeOutCubic" },
      { t: T.boardOut, v: 1, ease: "linear" },
      { t: T.boardOut + 0.4, v: 1.04, ease: "easeInCubic" },
    ],
  },
  gridOpacity: {
    keys: [
      { t: T.gridIn, v: 0 },
      { t: T.gridIn + 0.45, v: 1, ease: "easeOutCubic" },
    ],
  },
  gridScale: {
    keys: [
      { t: T.gridIn, v: 0.985 },
      { t: T.gridIn + 0.55, v: 1, ease: "easeOutCubic" },
    ],
  },
  rowHot: {
    keys: [
      { t: T.rowHot - 0.35, v: 0 },
      { t: T.rowHot + 0.2, v: 1, ease: "easeOutCubic" },
      { t: T.boardOut, v: 1, ease: "linear" },
    ],
  },
  // Grid columns, in percent of the content width.
  splitLeft: {
    keys: [
      { t: T.expand, v: 50 },
      { t: T.expand + 0.85, v: EXPAND_LEFT, ease: "easeOutSpring" },
    ],
  },
  // Right column: the top pane's share, in percent.
  splitTop: {
    keys: [
      { t: T.expand, v: 50 },
      { t: T.expand + 0.85, v: EXPAND_TOP, ease: "easeOutSpring" },
    ],
  },
  hudJump: {
    keys: [
      { t: T.hudJump - 0.25, v: 0 },
      { t: T.hudJump + 0.25, v: 1, ease: "easeOutCubic" },
      { t: T.hudExpand - 0.35, v: 1, ease: "linear" },
      { t: T.hudExpand - 0.05, v: 0, ease: "easeInCubic" },
    ],
  },
  hudExpand: {
    keys: [
      { t: T.hudExpand, v: 0 },
      { t: T.hudExpand + 0.3, v: 1, ease: "easeOutCubic" },
      { t: T.hudOut, v: 1, ease: "linear" },
      { t: T.hudOut + 0.4, v: 0, ease: "easeInCubic" },
    ],
  },
  endCard: {
    keys: [
      { t: T.endCard - 0.4, v: 0 },
      { t: T.endCard + 0.6, v: 1, ease: "easeOutCubic" },
    ],
  },
  scrim: {
    keys: [
      { t: T.pullBack, v: 0 },
      { t: T.endCard + 0.6, v: 0.88, ease: "easeInOutCubic" },
    ],
  },
  // Rack focus: the window softens into a bokeh plate so the card reads as
  // the subject without the window disappearing entirely.
  defocus: {
    keys: [
      { t: T.pullBack, v: 0 },
      { t: T.endCard + 0.6, v: 1, ease: "easeInOutCubic" },
    ],
  },
  glow: {
    keys: [
      { t: 0, v: 0.35 },
      { t: T.stream, v: 0.55, ease: "easeInOutCubic" },
      { t: T.needsYou, v: 0.8, ease: "easeInOutCubic" },
      { t: T.expand + 1, v: 0.7, ease: "easeInOutCubic" },
      { t: T.pullBack + 1.2, v: 0.45, ease: "easeInOutCubic" },
    ],
  },
  focusRing: {
    keys: [
      { t: T.jump - 0.1, v: 0 },
      { t: T.jump + 0.25, v: 1, ease: "easeOutCubic" },
      { t: T.jump + 1.1, v: 0, ease: "easeInOutCubic" },
    ],
  },
};

const stepTracks = {
  view: {
    step: true,
    keys: [
      { t: 0, v: "board" },
      { t: T.gridIn, v: "grid" },
    ],
  },
  focusedPane: {
    step: true,
    keys: [
      { t: 0, v: "claude" },
      { t: T.jump, v: "opencode" },
    ],
  },
  attentionCodex: {
    step: true,
    keys: [
      { t: 0, v: "none" },
      { t: T.codexDone, v: "completed" },
      { t: T.expand + 1.6, v: "none" },
    ],
  },
  attentionOpencode: {
    step: true,
    keys: [
      { t: 0, v: "none" },
      { t: T.needsYou, v: "requested" },
      { t: T.jump, v: "none" },
    ],
  },
  sidebarStatus: {
    step: true,
    keys: [
      { t: 0, v: "none" },
      { t: T.stream, v: "busy" },
      { t: T.codexDone, v: "completed" },
      { t: T.needsYou, v: "requested" },
      { t: T.jump, v: "completed" },
      { t: T.expand + 1.6, v: "busy" },
    ],
  },
};

const sampler = createSampler({ ...tracks, ...stepTracks });

const CAPTION_FADE = 0.3;

/**
 * Which caption the 9:16 cut is on, and how faded in it is. Each caption
 * fades up over `CAPTION_FADE`, holds, then fades out as the next one is due,
 * so the type never hard-cuts.
 *
 * @param {number} t
 * @returns {{ index: number, keys: string | null, text: string, opacity: number }}
 */
function captionAt(t) {
  let index = -1;

  for (let i = 0; i < VERTICAL_CAPTIONS.length; i += 1) {
    if (VERTICAL_CAPTIONS[i].at <= t) {
      index = i;
    }
  }

  if (index < 0) {
    return { index, keys: null, text: "", opacity: 0 };
  }

  const current = VERTICAL_CAPTIONS[index];
  const next = VERTICAL_CAPTIONS[index + 1];
  const endsAt = next ? next.at : T.pullBack;
  const fadeIn = window01(t, current.at, CAPTION_FADE, "easeOutCubic");
  const fadeOut =
    1 - window01(t, endsAt - CAPTION_FADE, CAPTION_FADE, "easeInCubic");

  return {
    index,
    keys: current.keys,
    text: current.text,
    opacity: Math.min(fadeIn, fadeOut),
  };
}

/**
 * Full scene state at time `t` (seconds). Pure — this is the only thing the
 * renderer and the live preview share.
 *
 * @param {number} time
 */
export function sceneStateAt(time) {
  const t = Math.min(DURATION, Math.max(0, time));
  const focused = sampler.step("focusedPane", t);
  const splitLeft = sampler.num("splitLeft", t);
  const splitTop = sampler.num("splitTop", t);

  return {
    t,
    camera: {
      scale: sampler.num("cameraScale", t),
      x: sampler.num("cameraX", t),
      y: sampler.num("cameraY", t),
      rotX: sampler.num("cameraRotX", t),
      rotY: sampler.num("cameraRotY", t),
    },
    backdrop: {
      palette: samplePalette(PALETTE_KEYS, t),
      glow: sampler.num("glow", t),
    },
    window: { opacity: sampler.num("windowOpacity", t) },
    board: {
      opacity: sampler.num("boardOpacity", t),
      scale: sampler.num("boardScale", t),
      hot: sampler.num("rowHot", t),
      enterPulse: window01(t, T.enterKey, 0.42, "pulse"),
    },
    grid: {
      opacity: sampler.num("gridOpacity", t),
      scale: sampler.num("gridScale", t),
      splitLeft,
      splitRight: 100 - splitLeft,
      splitTop,
      splitBottom: 100 - splitTop,
    },
    view: sampler.step("view", t),
    focusedPane: focused,
    focusRing: sampler.num("focusRing", t),
    attention: {
      claude: "none",
      codex: sampler.step("attentionCodex", t),
      opencode: sampler.step("attentionOpencode", t),
    },
    sidebarStatus: sampler.step("sidebarStatus", t),
    transcriptMs: Math.max(0, (t - T.stream) * 1000 * TRANSCRIPT_RATE),
    hud: {
      jump: sampler.num("hudJump", t),
      expand: sampler.num("hudExpand", t),
    },
    endCard: sampler.num("endCard", t),
    scrim: sampler.num("scrim", t),
    defocus: sampler.num("defocus", t),
    caption: captionAt(t),
  };
}

export const BEATS = T;
