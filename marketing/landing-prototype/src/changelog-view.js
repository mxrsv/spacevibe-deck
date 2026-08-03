import { BRAND_ICON_SRC } from "./appwin.js";

const LANDING_URL = "/landing-prototype/";
const PARTNER_MARK_SRC = "/landing-prototype/assets/partner-mark.svg";

function localeButtons(copy, locale) {
  return `
    <div class="changelog-topbar__lang" role="group" aria-label="${copy.localeLabel}" data-active="${locale}">
      <span class="changelog-topbar__lang-thumb" aria-hidden="true"></span>
      <button type="button" data-locale="en" aria-pressed="${locale === "en"}">EN</button>
      <button type="button" data-locale="vi" aria-pressed="${locale === "vi"}">VI</button>
    </div>
  `;
}

export function renderChangelogShell(root, copy, locale) {
  root.className = "changelog-page";
  root.dataset.releaseState = "loading";
  root.innerHTML = `
    <header class="changelog-topbar">
      <a class="changelog-brand" href="${LANDING_URL}" aria-label="${copy.navProduct}">
        <span class="changelog-brand__marks" aria-hidden="true">
          <img src="${PARTNER_MARK_SRC}" alt="" width="22" height="22" />
          <span></span>
          <img src="${BRAND_ICON_SRC}" alt="" width="28" height="28" />
        </span>
        <strong data-copy="navProduct">${copy.navProduct}</strong>
      </a>
      ${localeButtons(copy, locale)}
      <a class="changelog-back" href="${LANDING_URL}">
        <span aria-hidden="true">←</span>
        <span data-copy="changelogBack">${copy.changelogBack}</span>
      </a>
    </header>

    <section class="changelog-intro" aria-labelledby="changelog-title">
      <p class="changelog-kicker" data-copy="changelogKicker">${copy.changelogKicker}</p>
      <h1 id="changelog-title" data-copy="changelogTitle">${copy.changelogTitle}</h1>
      <p class="changelog-intro__body" data-copy="changelogIntro">${copy.changelogIntro}</p>
    </section>

    <section class="changelog-ledger" aria-live="polite" aria-busy="true">
      <p class="changelog-status" data-release-status data-copy="changelogLoading">
        ${copy.changelogLoading}
      </p>
      <div class="changelog-list" data-release-list></div>
    </section>
  `;
}

function setStatus(root, copyKey, copy, retryable = false) {
  const status = root.querySelector("[data-release-status]");
  const list = root.querySelector("[data-release-list]");

  if (!status || !list) {
    throw new Error("Changelog release region is missing.");
  }

  list.replaceChildren();
  status.hidden = false;
  status.dataset.copy = copyKey;
  status.replaceChildren(document.createTextNode(copy[copyKey]));

  if (retryable) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.dataset.releaseRetry = "";
    retry.dataset.copy = "changelogRetry";
    retry.textContent = copy.changelogRetry;
    status.append(document.createTextNode(" "), retry);
  }
}

function formatReleaseDate(value, locale) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function appendInlineNotes(parent, text) {
  const pattern =
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https:\/\/[^)\s]+\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    let element;

    if (token.startsWith("[")) {
      const [, label, url] = token.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
      element = document.createElement("a");
      element.href = url;
      element.target = "_blank";
      element.rel = "noreferrer";
      element.textContent = label;
    } else {
      element = document.createElement(token.startsWith("**") ? "strong" : "code");
      element.textContent = token.startsWith("**")
        ? token.slice(2, -2)
        : token.slice(1, -1);
    }

    parent.append(element);
    cursor = match.index + token.length;
  }

  parent.append(document.createTextNode(text.slice(cursor)));
}

function createReleaseNotes(release, copy) {
  const notes = document.createElement("div");
  notes.className = "changelog-release__notes";

  if (!release.body) {
    notes.dataset.copy = "changelogNoNotes";
    notes.textContent = copy.changelogNoNotes;
    return notes;
  }

  let list = null;

  for (const rawLine of release.body.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      list = null;
      continue;
    }

    const heading = line.match(/^#{2,4}\s+(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);

    if (heading) {
      const element = document.createElement("h3");
      appendInlineNotes(element, heading[1]);
      notes.append(element);
      list = null;
    } else if (item) {
      if (!list) {
        list = document.createElement("ul");
        notes.append(list);
      }
      const element = document.createElement("li");
      appendInlineNotes(element, item[1]);
      list.append(element);
    } else {
      const element = document.createElement("p");
      appendInlineNotes(element, line);
      notes.append(element);
      list = null;
    }
  }

  return notes;
}

function createReleaseArticle(release, copy, locale, index) {
  const article = document.createElement("article");
  article.className = "changelog-release";
  article.dataset.releaseTag = release.tag;
  article.style.setProperty("--release-index", String(index));

  const rail = document.createElement("span");
  rail.className = "changelog-release__rail";
  rail.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "changelog-release__content";

  const meta = document.createElement("div");
  meta.className = "changelog-release__meta";
  const formattedDate = formatReleaseDate(release.publishedAt, locale);

  if (formattedDate) {
    const time = document.createElement("time");
    time.dateTime = release.publishedAt;
    time.dataset.releaseDate = release.publishedAt;
    time.lang = locale;
    time.textContent = formattedDate;
    meta.append(time);
  }

  if (release.prerelease) {
    const preview = createTextElement(
      "span",
      "changelog-release__preview",
      copy.changelogPreview,
    );
    preview.dataset.copy = "changelogPreview";
    meta.append(preview);
  }

  const tag = createTextElement("p", "changelog-release__tag", release.tag);
  const title = createTextElement("h2", "changelog-release__title", release.title);
  const notes = createReleaseNotes(release, copy);

  const releaseLink = createTextElement(
    "a",
    "changelog-release__link",
    copy.changelogViewRelease,
  );
  releaseLink.href = release.url;
  releaseLink.target = "_blank";
  releaseLink.rel = "noreferrer";
  releaseLink.dataset.copy = "changelogViewRelease";
  releaseLink.insertAdjacentText("beforeend", " ↗");

  content.append(meta, tag, title, notes, releaseLink);
  article.append(rail, content);
  return article;
}

export function renderReleaseList(root, releases, copy, locale) {
  const region = root.querySelector(".changelog-ledger");
  const status = root.querySelector("[data-release-status]");
  const list = root.querySelector("[data-release-list]");

  if (!region || !status || !list) {
    throw new Error("Changelog release region is missing.");
  }

  if (releases.length === 0) {
    root.dataset.releaseState = "empty";
    region.setAttribute("aria-busy", "false");
    setStatus(root, "changelogEmpty", copy);
    return;
  }

  const fragment = document.createDocumentFragment();
  releases.forEach((release, index) => {
    fragment.append(createReleaseArticle(release, copy, locale, index));
  });

  root.dataset.releaseState = "ready";
  region.setAttribute("aria-busy", "false");
  status.hidden = true;
  list.replaceChildren(fragment);
}

export function renderReleaseLoading(root, copy) {
  root.dataset.releaseState = "loading";
  root.querySelector(".changelog-ledger")?.setAttribute("aria-busy", "true");
  setStatus(root, "changelogLoading", copy);
}

export function renderReleaseError(root, copy) {
  root.dataset.releaseState = "error";
  root.querySelector(".changelog-ledger")?.setAttribute("aria-busy", "false");
  setStatus(root, "changelogError", copy, true);
}

export function updateChangelogLocale(root, copy, locale) {
  for (const node of root.querySelectorAll("[data-copy]")) {
    const text = copy[node.dataset.copy];

    if (typeof text === "string") {
      node.firstChild?.remove();
      node.prepend(document.createTextNode(text));
    }
  }

  root.querySelector(".changelog-brand")?.setAttribute("aria-label", copy.navProduct);

  const langGroup = root.querySelector(".changelog-topbar__lang");

  if (langGroup) {
    langGroup.setAttribute("aria-label", copy.localeLabel);
    langGroup.dataset.active = locale;

    for (const button of langGroup.querySelectorAll("button[data-locale]")) {
      button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
    }
  }

  for (const time of root.querySelectorAll("time[data-release-date]")) {
    time.lang = locale;
    time.textContent = formatReleaseDate(time.dataset.releaseDate, locale);
  }
}
