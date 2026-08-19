/**
 * Video entry point.
 *
 * Exposes `window.__deckVideo.seek(t)` — the single door both the browser
 * preview and the headless frame grabber go through, which is what keeps
 * "what I watched" and "what got encoded" the same thing.
 */

import "../../landing-prototype/styles/tokens.css";
import "../../landing-prototype/styles/direction-a.css";
import "../../landing-prototype/styles/appwin.css";
import "../styles/video.css";

import { createBackdrop } from "./backdrop.js";
import { applyCamera } from "./camera.js";
import { createOverlay } from "./overlay.js";
import { DURATION, sceneStateAt } from "./script.js";
import { createStage } from "./stage-driver.js";

const backdropHost = document.querySelector("#backdrop");
const rigHost = document.querySelector("#rig");
const stageHost = document.querySelector("#stage");
const overlayHost = document.querySelector("#overlay");

if (!backdropHost || !rigHost || !stageHost || !overlayHost) {
  throw new Error("Video roots are missing.");
}

const backdrop = createBackdrop(backdropHost);
const stage = createStage(stageHost);
const overlay = createOverlay(overlayHost);

/** @param {number} t seconds */
function seek(t) {
  const state = sceneStateAt(t);

  backdrop.apply(state);
  applyCamera(rigHost, state.camera, state.defocus);
  stage.apply(state);
  overlay.apply(state);
}

const params = new URLSearchParams(window.location.search);
const startAt = Number.parseFloat(params.get("t") ?? "0");

seek(Number.isFinite(startAt) ? startAt : 0);

window.__deckVideo = { seek, duration: DURATION };
document.documentElement.dataset.videoReady = "true";

// Live preview: loop in real time. The frame grabber loads with ?render=1 and
// drives seek() itself, so no clock ever runs during a capture.
if (params.get("render") !== "1") {
  const started = performance.now();

  const tick = (now) => {
    seek(((now - started) / 1000) % DURATION);
    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
}
