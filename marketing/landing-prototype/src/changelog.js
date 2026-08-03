import "../styles/tokens.css";
import "../styles/frame.css";
import "../styles/changelog.css";

import {
  renderChangelogShell,
  renderReleaseError,
  renderReleaseList,
  renderReleaseLoading,
  updateChangelogLocale,
} from "./changelog-view.js";
import { messages } from "./copy.js";
import { LOCALES, readLocale, writeLocale } from "./locale-state.js";
import { fetchPublishedReleases } from "./release-data.js";

const root = document.querySelector("#changelog-root");

if (!root) {
  throw new Error("Changelog page root is missing.");
}

let locale = readLocale(window.location);
let requestId = 0;

renderChangelogShell(root, messages[locale], locale);
document.documentElement.lang = locale;

async function loadReleases() {
  const currentRequest = ++requestId;
  renderReleaseLoading(root, messages[locale]);

  try {
    const releases = await fetchPublishedReleases();

    if (currentRequest !== requestId) {
      return;
    }

    renderReleaseList(root, releases, messages[locale], locale);
  } catch {
    if (currentRequest === requestId) {
      renderReleaseError(root, messages[locale]);
    }
  }
}

root.addEventListener("click", (event) => {
  const localeButton = event.target.closest("button[data-locale]");

  if (localeButton) {
    const nextLocale = localeButton.dataset.locale;

    if (LOCALES.includes(nextLocale) && nextLocale !== locale) {
      writeLocale(nextLocale);
      locale = readLocale(window.location);
      updateChangelogLocale(root, messages[locale], locale);
      document.documentElement.lang = locale;
    }

    return;
  }

  if (event.target.closest("button[data-release-retry]")) {
    void loadReleases();
  }
});

void loadReleases();
