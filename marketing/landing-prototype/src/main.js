import "../styles/tokens.css";
import "../styles/frame.css";
import "../styles/direction-a.css";
import "../styles/aurora.css";
import "../styles/beams.css";
import "../styles/tour.css";

import { messages } from "./copy.js";
import { renderDirectionA, updateDirectionALocale } from "./directions/a.js";
import { LOCALES, readLocale, writeLocale } from "./locale-state.js";
import { mountDemoDialog } from "./product-stage.js";
import { renderTour, updateTourLocale } from "./tour/index.js";

const specimenRoot = document.querySelector("#specimen-root");
const demoRoot = document.querySelector("#demo-root");

if (!specimenRoot || !demoRoot) {
  throw new Error("Landing page roots are missing.");
}

let locale = readLocale(window.location);
let disposePage = () => {};

function render() {
  disposePage();

  const page = renderDirectionA(messages[locale], locale);
  const tour = renderTour(messages[locale]);
  specimenRoot.innerHTML = page.markup + tour.markup;
  const disposeRenderer = page.mount(specimenRoot);
  const disposeTour = tour.mount(specimenRoot);
  const disposeDialog = mountDemoDialog(demoRoot, specimenRoot);
  disposePage = () => {
    disposeDialog();
    disposeTour();
    disposeRenderer();
  };

  document.documentElement.lang = locale;
}

function handleLocaleClick(event) {
  const button = event.target.closest("button[data-locale]");

  if (!button || !specimenRoot.contains(button)) {
    return;
  }

  const nextLocale = button.dataset.locale;

  if (!LOCALES.includes(nextLocale) || nextLocale === locale) {
    return;
  }

  writeLocale(nextLocale);
  locale = readLocale(window.location);

  // Swap text in place instead of re-rendering: a full render tears down
  // the whole DOM plus both WebGL canvases (hero beams, tour aurora), which
  // flashes blank for a frame.
  updateDirectionALocale(specimenRoot, messages[locale], locale);
  updateTourLocale(specimenRoot, messages[locale]);
  document.documentElement.lang = locale;
}

specimenRoot.addEventListener("click", handleLocaleClick);
render();
