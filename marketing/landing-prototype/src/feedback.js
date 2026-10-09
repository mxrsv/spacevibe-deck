import { appContextLine, withAppContext } from "./feedback-app-context.js";
import { createFeedbackAuth } from "./feedback-auth.js";
import { createFeedbackImages } from "./feedback-images.js";
import "../styles/tokens.css";
import "../styles/frame.css";
import "../styles/changelog.css";
import "../styles/feedback.css";
import "../styles/feedback-board.css";

import { messages } from "./copy.js";
import {
  BODY_MAX,
  FEEDBACK_BOARD_OPEN,
  FEEDBACK_STATUSES,
  fetchFeedbackConfig,
  FeedbackSubmitError,
  SUBMISSIONS_OPEN,
  TITLE_MAX,
  TITLE_MIN,
  fetchFeedbackBoard,
  submitFeedback,
} from "./feedback-api.js";
import {
  renderBoard,
  renderBoardClosed,
  renderBoardError,
  renderBoardLoading,
  selectBoardColumn,
} from "./feedback-board-view.js";
import { clearDraft, newDraftId, readDraft, writeDraft } from "./feedback-draft.js";
import {
  fillForm,
  renderDraftStatus,
  resetComposer,
  setComposerClosed,
  setComposerState,
  updateFormMeters,
} from "./feedback-form-view.js";
import { renderFeedbackShell, updateFeedbackLocale } from "./feedback-view.js";
import { LOCALES, readLocale, writeLocale } from "./locale-state.js";
import { safeLocalStorage } from "./safe-storage.js";

const SUBMIT_ERROR_COPY = {
  invalid: "feedbackErrorInvalid",
  rate: "feedbackErrorRate",
  server: "feedbackErrorServer",
  auth: "feedbackErrorAuth",
  conflict: "feedbackErrorConflict",
};

// Review-only switch, live under `npm run prototype:landing` alone: `?demo`
// swaps the Worker for fixtures (see feedback-demo.js).
const params = new URLSearchParams(window.location.search);
const demo = import.meta.env.DEV && params.has("demo");
let submissionsOpen = false;
let auth = null;
let authMode = "google";
let nextCursor = null;
let loadingBoard = false;
let loadedBoard = Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, []]));
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const storage = safeLocalStorage();

const root = document.querySelector("#feedback-root");

if (!root) {
  throw new Error("Feedback page root is missing.");
}

let api = { fetchBoard: fetchFeedbackBoard, submit: submitFeedback };
let locale = readLocale(window.location);
let requestId = 0;
let sending = false;
// One id per draft, kept across reloads and resends, replaced after success.
let draftId = newDraftId();

renderFeedbackShell(root, messages[locale], locale);
const images = createFeedbackImages(root);
document.documentElement.lang = locale;

const form = root.querySelector(".feedback-form");
const shortcut = root.querySelector("[data-shortcut]");

if (!form || !shortcut) {
  throw new Error("Feedback composer is missing.");
}

shortcut.textContent = IS_MAC ? "⌘ ↵" : "Ctrl ↵";

async function loadBoard(cursor = null, refresh = false) {
  if (loadingBoard && !refresh) return;
  loadingBoard = true;
  const currentRequest = ++requestId;
  const more = root.querySelector("[data-board-more]");
  const pageStatus = root.querySelector("[data-page-status]");
  more.disabled = true;
  pageStatus.textContent = "";
  if (!cursor) renderBoardLoading(root, messages[locale]);
  try {
    const page = await api.fetchBoard(cursor);
    if (currentRequest === requestId) {
      loadedBoard = Object.fromEntries(
        FEEDBACK_STATUSES.map((status) => {
          const existing = cursor ? loadedBoard[status] : [];
          const ids = new Set(existing.map((item) => item.id));
          return [status, [...existing, ...page.board[status].filter((item) => !ids.has(item.id))]];
        }),
      );
      nextCursor = page.nextCursor;
      renderBoard(root, loadedBoard, messages[locale], locale);
      more.hidden = !nextCursor;
    }
  } catch {
    if (currentRequest === requestId) {
      if (cursor) pageStatus.textContent = "Could not load older feedback. Try again.";
      else renderBoardError(root, messages[locale]);
    }
  } finally {
    if (currentRequest === requestId) {
      more.disabled = false;
      loadingBoard = false;
    }
  }
}

function readForm() {
  const data = new FormData(form);
  const text = (name) => String(data.get(name) ?? "").trim();

  return {
    title: text("title").replace(/\s+/g, " "),
    body: text("body"),
    category: text("category"),
    website: text("deck-hp-note"),
    id: draftId,
  };
}

/** Keep exactly what was typed, so the later confirm step sends it unchanged. */
function saveDraft() {
  const data = new FormData(form);
  const state = writeDraft(storage, {
    title: String(data.get("title") ?? ""),
    body: String(data.get("body") ?? ""),
    category: String(data.get("category") ?? ""),
    id: draftId,
  });
  renderDraftStatus(root, state, messages[locale]);
}

async function handleSubmit() {
  // Cmd/Ctrl+Enter calls requestSubmit(), which a disabled button cannot stop:
  // without this guard a double press sends the same report twice.
  if (!submissionsOpen || sending || (!demo && authMode === "google" && !auth?.token())) {
    return;
  }

  const input = readForm();

  if (
    !input.id ||
    input.title.length < TITLE_MIN ||
    input.title.length > TITLE_MAX ||
    input.body.length > BODY_MAX
  ) {
    setComposerState(root, "error", "feedbackErrorInvalid", messages[locale]);
    form.querySelector('[name="title"]')?.focus();
    return;
  }

  // FormData omits disabled radios, so save before locking the fields.
  saveDraft();
  sending = true;
  images.lock(true);
  setComposerState(root, "sending", null, messages[locale]);

  try {
    await api.submit({ ...input, credential: auth?.token(), images: images.files() });
    images.clear();
    form.reset();
    clearDraft(storage);
    draftId = newDraftId();
    renderDraftStatus(root, "empty", messages[locale]);
    updateFormMeters(form);
    setComposerState(root, "sent", null, messages[locale]);
    selectBoardColumn(root, "pending");
    void loadBoard(null, true);
    root.querySelector("[data-send-another]")?.focus();
  } catch (error) {
    const reason = error instanceof FeedbackSubmitError ? error.reason : "server";
    if (reason === "auth") auth?.reset();
    setComposerState(root, "error", SUBMIT_ERROR_COPY[reason], messages[locale]);
  } finally {
    sending = false;
    images.lock(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleSubmit();
});

form.addEventListener("input", () => {
  updateFormMeters(form);
  saveDraft();
});

form.addEventListener("keydown", (event) => {
  // isComposing: Enter also confirms a Vietnamese or CJK IME candidate.
  if (event.key !== "Enter" || event.isComposing || event.repeat) {
    return;
  }

  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    form.requestSubmit();
    return;
  }

  // A bare Enter in the one-line title would send before any details exist.
  if (event.target instanceof HTMLInputElement && event.target.name === "title") {
    event.preventDefault();
    form.querySelector('[name="body"]')?.focus();
  }
});

function switchLocale(nextLocale) {
  if (!LOCALES.includes(nextLocale) || nextLocale === locale) {
    return;
  }

  writeLocale(nextLocale);
  locale = readLocale(window.location);
  updateFeedbackLocale(root, messages[locale], locale);
  document.documentElement.lang = locale;
}

root.addEventListener("click", (event) => {
  const target = event.target;
  const localeButton = target.closest("button[data-locale]");
  const tab = target.closest("[data-tab]");

  if (localeButton) {
    switchLocale(localeButton.dataset.locale);
  } else if (target.closest("[data-new-draft]")) {
    draftId = newDraftId();
    saveDraft();
    setComposerState(root, "idle", null, messages[locale]);
    root.querySelector(".feedback-submit")?.focus();
  } else if (target.closest("[data-send-another]")) {
    resetComposer(root, messages[locale]);
    form.querySelector('[name="title"]')?.focus();
  } else if (tab) {
    selectBoardColumn(root, tab.dataset.tab);
  } else if (target.closest("button[data-board-more]")) {
    void loadBoard(nextCursor);
  } else if (target.closest("button[data-board-retry]")) {
    void loadBoard();
  }
});

async function start() {
  const draft = readDraft(storage);

  if (draft) {
    draftId = draft.id || draftId;
    fillForm(form, draft);
    renderDraftStatus(root, "saved", messages[locale]);
  }

  const contextLine = appContextLine(params);
  if (contextLine) {
    const body = form.querySelector('[name="body"]');
    body.value = withAppContext(body.value, contextLine);
    // Keep `lang`; drop only what was consumed, so a shared link carries no build.
    const url = new URL(window.location.href);
    url.searchParams.delete("v");
    url.searchParams.delete("os");
    window.history.replaceState(window.history.state, "", url);
  }

  updateFormMeters(form);

  // Before the first backend rollout, keep the existing local-only holding mode.
  if (!SUBMISSIONS_OPEN && !FEEDBACK_BOARD_OPEN && !demo) {
    setComposerClosed(root, messages[locale]);
    renderBoardClosed(root, messages[locale]);
    return;
  }
  if (demo) {
    const { createDemoFeedbackApi } = await import("./feedback-demo.js");
    api = createDemoFeedbackApi(params.get("demo"));
    submissionsOpen = true;
    root.dataset.authReady = "true";
  } else {
    root.dataset.authReady = "false";
    setComposerState(root, "idle", null, messages[locale]);
    try {
      const config = await fetchFeedbackConfig();
      authMode = config.authMode ?? "google";
      submissionsOpen = SUBMISSIONS_OPEN && config.submissionsOpen;
      if (submissionsOpen && authMode === "anonymous") {
        root.dataset.authReady = "true";
        setComposerState(root, "idle", null, messages[locale]);
      } else if (submissionsOpen && config.googleClientId) {
        auth = createFeedbackAuth(root, config.googleClientId, (ready) => {
          root.dataset.authReady = String(ready);
          if (!sending) setComposerState(root, "idle", null, messages[locale]);
        });
      } else setComposerClosed(root, messages[locale]);
    } catch {
      setComposerClosed(root, messages[locale]);
    }
  }
  // Public reads do not depend on Google sign-in or the intake switch.
  await loadBoard();
}

void start();
