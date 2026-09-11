import "../styles/tokens.css";
import "../styles/appwin.css";
import "../styles/frame.css";
import "../styles/direction-a.css";
import "../styles/install-command.css";
import "../styles/tour.css";
import "../styles/scenes.css";
import "../styles/hero-cursor.css";
import "../styles/hero-recolor.css";
import "../styles/release-modal.css";

import { messages } from "./copy.js";
import { renderDirectionA } from "./directions/a.js";
import { upgradeReleaseLinks } from "./download-links.js";
import { mountQuickInstall } from "./install-command.js";
import { announceRelease, isReleaseModalForced } from "./release-modal.js";
import { renderTour } from "./tour/index.js";

const specimenRoot = document.querySelector("#specimen-root");

if (!specimenRoot) {
  throw new Error("Landing page root is missing.");
}

let disposePage = () => {};

function render() {
  disposePage();

  const page = renderDirectionA(messages.en);
  const tour = renderTour(messages.en);
  specimenRoot.innerHTML = page.markup + tour.markup;
  const disposeRenderer = page.mount(specimenRoot);
  const disposeInstall = mountQuickInstall(specimenRoot);
  const disposeTour = tour.mount(specimenRoot);
  disposePage = () => {
    disposeTour();
    disposeInstall();
    disposeRenderer();
  };

  document.documentElement.lang = "en";
}

render();

function safeLocalStorage() {
  // Reading `localStorage` itself throws in a blocked third-party context, so
  // the guard has to wrap the property access, not just the later get/set.
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// One-shot: the public landing is English-only. The release notice rides this
// same request — see release-modal.js — so the page makes one GitHub call.
void upgradeReleaseLinks(specimenRoot).then((releases) => {
  announceRelease(document.body, messages.en, releases, {
    storage: safeLocalStorage(),
    forced: isReleaseModalForced(globalThis.location?.search),
  });
});
