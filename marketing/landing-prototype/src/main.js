import "../styles/tokens.css";
import "../styles/appwin.css";
import "../styles/frame.css";
import "../styles/direction-a.css";
import "../styles/tour.css";
import "../styles/scenes.css";

import { messages } from "./copy.js";
import { renderDirectionA, updateDirectionALocale } from "./directions/a.js";
import { upgradeReleaseLinks } from "./download-links.js";
import { LOCALES, readLocale, writeLocale } from "./locale-state.js";
import { renderTour, updateTourLocale } from "./tour/index.js";

const specimenRoot = document.querySelector("#specimen-root");

if (!specimenRoot) {
  throw new Error("Landing page root is missing.");
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
  disposePage = () => {
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

  // Swap text in place instead of re-rendering: a full render tears down the
  // whole DOM, restarting every stage stream and re-decoding the plate, which
  // flashes blank for a frame.
  updateDirectionALocale(specimenRoot, messages[locale], locale);
  updateTourLocale(specimenRoot, messages[locale]);
  document.documentElement.lang = locale;
}

specimenRoot.addEventListener("click", handleLocaleClick);
render();
// One-shot: the page renders once, locale switches swap text in place.
void upgradeReleaseLinks(specimenRoot);
