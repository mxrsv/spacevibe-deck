import "../styles/tokens.css";
import "../styles/appwin.css";
import "../styles/frame.css";
import "../styles/direction-a.css";
import "../styles/tour.css";
import "../styles/scenes.css";

import { messages } from "./copy.js";
import { renderDirectionA } from "./directions/a.js";
import { upgradeReleaseLinks } from "./download-links.js";
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
  const disposeTour = tour.mount(specimenRoot);
  disposePage = () => {
    disposeTour();
    disposeRenderer();
  };

  document.documentElement.lang = "en";
}

render();
// One-shot: the public landing is English-only.
void upgradeReleaseLinks(specimenRoot);
