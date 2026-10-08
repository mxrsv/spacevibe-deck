import { BODY_MAX, FEEDBACK_CATEGORIES, TITLE_MAX, TITLE_MIN } from "./feedback-api.js";
import { CATEGORY_ICONS, SEND_ICON, SENT_ICON } from "./feedback-icons.js";

export const CATEGORY_COPY = {
  bug: "feedbackCategoryBug",
  idea: "feedbackCategoryIdea",
  other: "feedbackCategoryOther",
};

const COUNTED_FIELDS = { title: TITLE_MAX, body: BODY_MAX };

function renderTypes(copy) {
  return FEEDBACK_CATEGORIES.map(
    (category, index) => `
      <label class="feedback-type" data-category="${category}">
        <input type="radio" name="category" value="${category}" ${index === 0 ? "checked" : ""} />
        <span class="feedback-type__body">
          ${CATEGORY_ICONS[category]}
          <span data-copy="${CATEGORY_COPY[category]}">${copy[CATEGORY_COPY[category]]}</span>
        </span>
      </label>
    `,
  ).join("");
}

function renderForm(copy) {
  return `
    <form class="feedback-form" novalidate aria-labelledby="feedback-form-title">
      <p class="feedback-closed" data-closed-notice hidden data-copy="feedbackClosedNotice">${copy.feedbackClosedNotice}</p>

      <div class="feedback-auth" data-feedback-auth hidden>
        <p class="feedback-notice" data-auth-status role="status"></p>
        <div data-google-signin></div>
        <button type="button" class="feedback-pill feedback-pill--ghost feedback-pill--small" data-auth-signout hidden>Sign out</button>
        <button type="button" class="feedback-pill feedback-pill--ghost feedback-pill--small" data-auth-retry hidden>Try sign-in again</button>
      </div>
      <fieldset class="feedback-field">
        <legend class="feedback-label" data-copy="feedbackCategoryLabel">${copy.feedbackCategoryLabel}</legend>
        <div class="feedback-types">${renderTypes(copy)}</div>
      </fieldset>

      <label class="feedback-field">
        <span class="feedback-label" data-copy="feedbackTitleLabel">${copy.feedbackTitleLabel}</span>
        <input
          class="feedback-input"
          name="title"
          type="text"
          required
          minlength="${TITLE_MIN}"
          maxlength="${TITLE_MAX}"
          autocomplete="off"
          placeholder="${copy.feedbackTitlePlaceholder}"
          data-copy-placeholder="feedbackTitlePlaceholder"
        />
        <span class="feedback-hint">
          <span data-title-hint data-copy="feedbackTitleHint">${copy.feedbackTitleHint}</span>
          <span class="feedback-count" data-count-for="title">0/${TITLE_MAX}</span>
        </span>
      </label>

      <label class="feedback-field">
        <span class="feedback-label" data-copy="feedbackBodyLabel">${copy.feedbackBodyLabel}</span>
        <textarea
          class="feedback-input feedback-input--area"
          name="body"
          rows="4"
          maxlength="${BODY_MAX}"
          placeholder="${copy.feedbackBodyPlaceholder}"
          data-copy-placeholder="feedbackBodyPlaceholder"
        ></textarea>
        <span class="feedback-hint feedback-hint--end">
          <span class="feedback-count" data-count-for="body">0/${BODY_MAX}</span>
        </span>
      </label>

      <div class="feedback-field">
        <label class="feedback-label" for="feedback-images">Screenshots <span class="feedback-notice">(optional)</span></label>
        <input id="feedback-images" class="feedback-input feedback-image-input" type="file" accept="image/png,image/jpeg,image/webp" multiple data-feedback-images aria-describedby="feedback-images-hint" />
        <p class="feedback-notice" id="feedback-images-hint">Up to 3 images, 5 MB each. Images are not saved with your draft. Remove personal information before uploading.</p>
        <div class="feedback-image-previews" data-image-previews></div>
        <p class="feedback-result" data-image-status role="status" aria-live="polite"></p>
      </div>

      <!-- Honeypot. display:none keeps it from people and from browser autofill,
           which skips fields it cannot focus; the odd name, the unknown
           autocomplete token and the ignore attributes keep password managers
           off it too. A bot that fills every input still writes into it. The
           Worker rejects a filled field; it never reports a discarded report as saved. -->
      <label class="feedback-trap" aria-hidden="true">
        Leave empty
        <input
          name="deck-hp-note"
          type="text"
          tabindex="-1"
          autocomplete="new-hp"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
        />
      </label>

      <p class="feedback-notice" data-copy="feedbackNotice">${copy.feedbackNotice}</p>
      <a class="feedback-notice" href="/privacy">Privacy notice</a>
      <p class="feedback-result" data-form-result role="status" aria-live="polite"></p>

      <button type="button" class="feedback-pill feedback-pill--ghost feedback-pill--small" data-new-draft hidden>Use these edits in a new report</button>
      <div class="feedback-actions">
        <button class="feedback-pill feedback-submit" type="submit">
          <span data-submit-label data-copy="feedbackSubmit">${copy.feedbackSubmit}</span>
          ${SEND_ICON}
        </button>
        <kbd class="feedback-kbd" data-shortcut aria-hidden="true"></kbd>
        <span class="feedback-draft" data-draft-status role="status" aria-live="polite"></span>
      </div>
    </form>
  `;
}

function renderSent(copy) {
  return `
    <div class="feedback-sent" data-sent-panel hidden>
      ${SENT_ICON}
      <h3 data-copy="feedbackSent">${copy.feedbackSent}</h3>
      <p data-copy="feedbackSentBody">${copy.feedbackSentBody}</p>
      <button class="feedback-pill feedback-pill--ghost" type="button" data-send-another>
        <span data-copy="feedbackSendAnother">${copy.feedbackSendAnother}</span>
      </button>
    </div>
  `;
}

export function renderComposer(copy) {
  return `
    <section class="feedback-composer" data-state="idle" aria-labelledby="feedback-form-title">
      <div class="feedback-composer__card">
        <header class="feedback-composer__head">
          <h2 id="feedback-form-title" class="feedback-heading" data-copy="feedbackFormTitle">${copy.feedbackFormTitle}</h2>
        </header>
        ${renderForm(copy)}
        ${renderSent(copy)}
      </div>
    </section>
  `;
}

/** Counters, the title's readiness dot and the textarea's height. */
export function updateFormMeters(form) {
  for (const [name, limit] of Object.entries(COUNTED_FIELDS)) {
    const field = form.querySelector(`[name="${name}"]`);
    const count = form.querySelector(`[data-count-for="${name}"]`);

    if (field && count) {
      count.textContent = `${field.value.length}/${limit}`;
    }
  }

  const title = form.querySelector('[name="title"]');
  form.dataset.titleValid = String((title?.value.trim().length ?? 0) >= TITLE_MIN);

  const body = form.querySelector('[name="body"]');

  if (body) {
    body.style.height = "auto";
    body.style.height = `${body.scrollHeight + 2}px`;
  }
}

/** @param {"idle" | "sending" | "sent" | "error"} state */
export function setComposerState(root, state, copyKey, copy) {
  const composer = root.querySelector(".feedback-composer");
  const form = composer?.querySelector(".feedback-form");
  const sent = composer?.querySelector("[data-sent-panel]");
  const result = composer?.querySelector("[data-form-result]");
  const submit = composer?.querySelector(".feedback-submit");
  const label = submit?.querySelector("[data-submit-label]");

  if (!composer || !form || !sent || !result || !submit || !label) {
    throw new Error("Feedback composer is missing.");
  }

  composer.dataset.state = state;
  root.querySelector("[data-new-draft]").hidden = copyKey !== "feedbackErrorConflict";
  form.hidden = state === "sent";
  sent.hidden = state !== "sent";
  submit.disabled =
    state === "sending" ||
    root.dataset.authReady !== "true" ||
    composer.hasAttribute("data-closed");

  // Text typed while a send is in flight would be wiped by the reset that
  // follows success, so the fields hold still until the answer arrives.
  for (const field of form.querySelectorAll('[name="category"]'))
    field.disabled = state === "sending";
  for (const field of form.querySelectorAll("[data-auth-signout]"))
    field.disabled = state === "sending";
  for (const field of form.querySelectorAll('[name="title"], [name="body"]')) {
    field.readOnly = state === "sending";
  }
  label.dataset.copy = state === "sending" ? "feedbackSending" : "feedbackSubmit";
  label.textContent = copy[label.dataset.copy];

  if (copyKey === null) {
    delete result.dataset.copy;
    result.textContent = "";
    return;
  }

  result.dataset.copy = copyKey;
  result.textContent = copy[copyKey];
}

const DRAFT_COPY = { saved: "feedbackDraftSaved", refused: "feedbackDraftRefused" };

/** Put a saved draft back into the fields. */
export function fillForm(form, draft) {
  const title = form.querySelector('[name="title"]');
  const body = form.querySelector('[name="body"]');
  const category = form.querySelector(`[name="category"][value="${draft.category}"]`);

  if (title) {
    title.value = draft.title;
  }

  if (body) {
    body.value = draft.body;
  }

  if (category) {
    category.checked = true;
  }

  updateFormMeters(form);
}

/** @param {"saved" | "empty" | "refused"} state */
export function renderDraftStatus(root, state, copy) {
  const status = root.querySelector("[data-draft-status]");

  if (!status) {
    throw new Error("Feedback draft status is missing.");
  }

  status.dataset.state = state;

  if (state === "empty") {
    delete status.dataset.copy;
    status.textContent = "";
    return;
  }

  status.dataset.copy = DRAFT_COPY[state];
  status.textContent = copy[DRAFT_COPY[state]];
}

/** Sending is closed: say so, and keep the button visibly off. */
export function setComposerClosed(root, copy) {
  const composer = root.querySelector(".feedback-composer");
  const notice = composer?.querySelector("[data-closed-notice]");
  const submit = composer?.querySelector(".feedback-submit");
  const label = submit?.querySelector("[data-submit-label]");

  if (!composer || !notice || !submit || !label) {
    throw new Error("Feedback composer is missing.");
  }

  composer.dataset.closed = "";
  notice.hidden = false;
  submit.disabled = true;
  label.dataset.copy = "feedbackSubmitClosed";
  label.textContent = copy.feedbackSubmitClosed;
}

export function resetComposer(root, copy) {
  const form = root.querySelector(".feedback-form");

  if (!form) {
    throw new Error("Feedback form is missing.");
  }

  form.reset();
  updateFormMeters(form);
  setComposerState(root, "idle", null, copy);
}
