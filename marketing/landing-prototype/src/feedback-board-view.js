import { FEEDBACK_API_URL, FEEDBACK_STATUSES } from "./feedback-api.js";
import { CATEGORY_COPY } from "./feedback-form-view.js";
import { CATEGORY_ICONS, STATUS_ICONS } from "./feedback-icons.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RELATIVE_DAYS_MAX = 30;
const SKELETON_CARDS = 2;

const COLUMN_COPY = {
  pending: "feedbackColumnPending",
  review: "feedbackColumnReview",
  done: "feedbackColumnDone",
};

const EMPTY_COPY = {
  pending: "feedbackEmptyPending",
  review: "feedbackEmptyReview",
  done: "feedbackEmptyDone",
};

function renderTabs(copy) {
  return FEEDBACK_STATUSES.map(
    (status, index) => `
      <button type="button" class="feedback-tab" data-tab="${status}" aria-pressed="${index === 0}">
        <span data-copy="${COLUMN_COPY[status]}">${copy[COLUMN_COPY[status]]}</span>
        <span class="feedback-tab__count" data-tab-count></span>
      </button>
    `,
  ).join("");
}

function renderColumns(copy) {
  return FEEDBACK_STATUSES.map(
    (status) => `
      <section class="feedback-column" data-column="${status}" aria-labelledby="feedback-column-${status}">
        <header class="feedback-column__head">
          <span class="feedback-column__dot" aria-hidden="true"></span>
          <h3 id="feedback-column-${status}" data-copy="${COLUMN_COPY[status]}">${copy[COLUMN_COPY[status]]}</h3>
          <span class="feedback-column__count" data-column-count></span>
        </header>
        <ol class="feedback-column__list" data-column-list></ol>
      </section>
    `,
  ).join("");
}

export function renderBoardSection(copy) {
  return `
    <section class="feedback-board" data-active-column="pending" aria-labelledby="feedback-board-title" aria-busy="true">
      <header class="feedback-board__head">
        <h2 id="feedback-board-title" class="feedback-heading" data-copy="feedbackBoardTitle">${copy.feedbackBoardTitle}</h2>
      </header>
      <p class="feedback-board__status" data-board-status hidden></p>
      <div class="feedback-tabs" role="group" aria-label="${copy.feedbackBoardTitle}">${renderTabs(copy)}</div>
      <div class="feedback-columns">${renderColumns(copy)}</div>
      <p class="feedback-board__status" data-page-status role="status"></p>
      <button type="button" class="feedback-pill feedback-pill--ghost" data-board-more hidden>Load older feedback</button>
    </section>
  `;
}

/** "today", "3 days ago", then a plain date once relative stops helping. */
export function formatRelativeDay(value, locale, now = Date.now()) {
  const days = Math.round((Date.parse(value) - now) / DAY_MS);

  if (Math.abs(days) <= RELATIVE_DAYS_MAX) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
  }

  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
    new Date(value),
  );
}

function createCard(item, copy, locale, index) {
  const card = document.createElement("li");
  card.className = "feedback-card";
  card.style.setProperty("--card-index", String(Math.min(index, 8)));

  const top = document.createElement("div");
  top.className = "feedback-card__top";

  const tag = document.createElement("span");
  tag.className = "feedback-tag";
  tag.dataset.category = item.category;
  tag.innerHTML = CATEGORY_ICONS[item.category];
  const tagLabel = document.createElement("span");
  tagLabel.dataset.copy = CATEGORY_COPY[item.category];
  tagLabel.textContent = copy[CATEGORY_COPY[item.category]];
  tag.append(tagLabel);

  const id = document.createElement("span");
  id.className = "feedback-card__id";
  id.textContent = item.identifier || item.id;
  top.append(tag, id);

  // User-submitted text: always textContent, never markup.
  const title = document.createElement("p");
  title.className = "feedback-card__title";
  title.textContent = item.title;

  const time = document.createElement("time");
  time.className = "feedback-card__time";
  time.dateTime = item.updatedAt;
  time.dataset.feedbackDate = item.updatedAt;
  time.textContent = formatRelativeDay(item.updatedAt, locale);

  const description = document.createElement("p");
  description.className = "feedback-card__description";
  description.textContent = item.description;
  card.append(top, title, description, time);
  if (item.images?.length) {
    const attachments = document.createElement("div");
    attachments.className = "feedback-image-previews";
    item.images.forEach((path, imageIndex) => {
      const link = document.createElement("a");
      link.href = new URL(path, FEEDBACK_API_URL).href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "feedback-image-preview";
      const image = document.createElement("img");
      image.src = link.href;
      image.alt = `Screenshot ${imageIndex + 1} for ${item.title}`;
      image.loading = "lazy";
      link.append(image);
      attachments.append(link);
    });
    card.append(attachments);
  }
  return card;
}

function createEmpty(status, copy) {
  const empty = document.createElement("li");
  empty.className = "feedback-column__empty";
  empty.innerHTML = STATUS_ICONS[status];
  const text = document.createElement("span");
  text.dataset.copy = EMPTY_COPY[status];
  text.textContent = copy[EMPTY_COPY[status]];
  empty.append(text);
  return empty;
}

function createSkeleton() {
  const card = document.createElement("li");
  card.className = "feedback-card feedback-card--skeleton";
  card.setAttribute("aria-hidden", "true");
  card.append(...[1, 2, 3].map(() => document.createElement("span")));
  return card;
}

function columnParts(root, status) {
  const column = root.querySelector(`[data-column="${status}"]`);
  const list = column?.querySelector("[data-column-list]");
  const count = column?.querySelector("[data-column-count]");
  const tabCount = root.querySelector(`[data-tab="${status}"] [data-tab-count]`);

  if (!list || !count || !tabCount) {
    throw new Error(`Feedback column "${status}" is missing.`);
  }

  return { list, count, tabCount };
}

function setBoardStatus(root, state, copyKey, copy, retryable = false) {
  const board = root.querySelector(".feedback-board");
  const status = root.querySelector("[data-board-status]");

  if (!board || !status) {
    throw new Error("Feedback board is missing.");
  }

  root.dataset.boardState = state;
  board.setAttribute("aria-busy", String(state === "loading"));
  status.hidden = copyKey === null;

  if (copyKey === null) {
    status.replaceChildren();
    return;
  }

  status.dataset.copy = copyKey;
  status.replaceChildren(document.createTextNode(copy[copyKey]));

  if (!retryable) {
    return;
  }

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "feedback-pill feedback-pill--ghost feedback-pill--small";
  retry.dataset.boardRetry = "";
  retry.dataset.copy = "changelogRetry";
  retry.textContent = copy.changelogRetry;
  status.append(retry);
}

export function renderBoardLoading(root, copy) {
  for (const status of FEEDBACK_STATUSES) {
    const { list, count, tabCount } = columnParts(root, status);
    count.textContent = "";
    tabCount.textContent = "";
    list.replaceChildren(...Array.from({ length: SKELETON_CARDS }, createSkeleton));
  }

  setBoardStatus(root, "loading", null, copy);
}

export function renderBoardError(root, copy) {
  for (const status of FEEDBACK_STATUSES) {
    columnParts(root, status).list.replaceChildren();
  }

  setBoardStatus(root, "error", "feedbackError", copy, true);
}

/** Sending is closed, so there is no board to fetch yet: say when it comes. */
export function renderBoardClosed(root, copy) {
  for (const status of FEEDBACK_STATUSES) {
    const { list, count, tabCount } = columnParts(root, status);
    count.textContent = "";
    tabCount.textContent = "";
    list.replaceChildren(createEmpty(status, copy));
  }

  setBoardStatus(root, "closed", "feedbackBoardSoon", copy);
}

export function renderBoard(root, board, copy, locale) {
  for (const status of FEEDBACK_STATUSES) {
    const { list, count, tabCount } = columnParts(root, status);
    const items = board[status];
    count.textContent = String(items.length);
    tabCount.textContent = String(items.length);
    list.replaceChildren(
      ...(items.length === 0
        ? [createEmpty(status, copy)]
        : items.map((item, index) => createCard(item, copy, locale, index))),
    );
  }

  setBoardStatus(root, "ready", null, copy);
}

/** Small screens show one column at a time, chosen by the tabs. */
export function selectBoardColumn(root, status) {
  if (!FEEDBACK_STATUSES.includes(status)) {
    return;
  }

  root.querySelector(".feedback-board")?.setAttribute("data-active-column", status);

  for (const tab of root.querySelectorAll("[data-tab]")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.tab === status));
  }
}

export function refreshBoardTimes(root, locale) {
  for (const time of root.querySelectorAll("time[data-feedback-date]")) {
    time.textContent = formatRelativeDay(time.dataset.feedbackDate, locale);
  }
}
