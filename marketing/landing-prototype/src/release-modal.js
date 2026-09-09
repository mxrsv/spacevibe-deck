/**
 * The release notice — a modal the landing raises once per published version.
 *
 * It rides the ONE releases request the page already makes: `main.js` hands
 * the normalized list straight from `upgradeReleaseLinks`, so announcing a
 * version costs no extra GitHub call (the unauthenticated API allows 60/hour
 * per IP, and the changelog page spends its own budget).
 *
 * Decided 2026-09-10 with the owner: the notice fires once per TAG per
 * browser. `localStorage` holds the last tag acknowledged; both `Later` and
 * the close button write it, so a dismissal is final until a newer stable tag
 * is published. Prereleases never announce — `latestStableRelease` filters
 * them — and the copy stays platform-neutral, because Deck ships a macOS .dmg
 * and a Windows installer from the same release page.
 *
 * `?release-modal=1` forces it open past storage. That is the review surface:
 * the notice is unreachable by eye otherwise, since the acknowledged tag would
 * suppress it on every reload.
 *
 * Failure contract: storage that throws (Safari private browsing, a blocked
 * third-party context) degrades to "never announce" rather than announcing on
 * every page view — a modal that cannot be dismissed is worse than a missing one.
 */

import { latestStableRelease } from "./release-data.js";

export const RELEASE_SEEN_KEY = "deck.landing.releaseSeen";
const FORCE_PARAM = "release-modal";

/**
 * A storage that THROWS on read is not the same as an empty one: we would
 * announce, fail to record the dismissal, and announce again on the next load.
 * `null` here means "unusable", which the selector reads as "stay quiet".
 */
function readSeenTag(storage) {
  if (!storage) {
    return null;
  }

  try {
    return { tag: storage.getItem(RELEASE_SEEN_KEY) };
  } catch {
    return null;
  }
}

function writeSeenTag(storage, tag) {
  try {
    storage?.setItem(RELEASE_SEEN_KEY, tag);
  } catch {
    // A browser that refuses to remember the dismissal still gets to close
    // the dialog; it simply sees the notice again next visit.
  }
}

export function isReleaseModalForced(search) {
  return new URLSearchParams(search ?? "").get(FORCE_PARAM) === "1";
}

/**
 * The whole show/skip decision, kept pure so it is testable without a DOM.
 *
 * @param {ReadonlyArray<{ tag: string, url: string, prerelease: boolean }>} releases
 * @param {Storage | null} storage
 * @param {{ forced?: boolean }} [options]
 * @returns {{ tag: string, url: string } | null}
 */
export function selectReleaseAnnouncement(releases, storage, options = {}) {
  const release = latestStableRelease(Array.isArray(releases) ? releases : []);

  if (!release) {
    return null;
  }

  if (options.forced === true) {
    return release;
  }

  const seen = readSeenTag(storage);

  // No storage at all, or one that throws: the dismissal cannot be recorded,
  // so the notice would return on every load. Stay quiet instead.
  if (!seen) {
    return null;
  }

  return seen.tag === release.tag ? null : release;
}

/** `v1.1.0` → `1.1.0`. The eyebrow keeps the tag; the headline sets the number. */
export function displayVersion(tag) {
  return tag.replace(/^v/i, "");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCloseIcon() {
  return `
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M3.4 3.4 12.6 12.6M12.6 3.4 3.4 12.6"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="square"
      />
    </svg>
  `;
}

export function renderReleaseModal(copy, release) {
  const tag = escapeHtml(release.tag);
  const version = escapeHtml(displayVersion(release.tag));
  const url = escapeHtml(release.url);

  return `
    <dialog class="release-modal" data-release-modal aria-labelledby="release-modal-title">
      <div class="release-modal__panel">
        <span class="release-modal__spine" aria-hidden="true">
          <span class="release-modal__marker"></span>
        </span>

        <div class="release-modal__head">
          <p class="release-modal__eyebrow" data-copy="releaseModalEyebrow">
            ${escapeHtml(copy.releaseModalEyebrow)}
          </p>
          <p class="release-modal__tag">${tag}</p>
        </div>

        <button
          class="release-modal__close"
          type="button"
          data-release-dismiss
          aria-label="${escapeHtml(copy.releaseModalClose)}"
        >
          ${renderCloseIcon()}
        </button>

        <h2 class="release-modal__title" id="release-modal-title">
          <span data-copy="releaseModalTitleLead">${escapeHtml(copy.releaseModalTitleLead)}</span>
          <em class="release-modal__numeral">${version}</em>
          <span data-copy="releaseModalTitleTail">${escapeHtml(copy.releaseModalTitleTail)}</span>
        </h2>

        <p class="release-modal__body" data-copy="releaseModalBody">
          ${escapeHtml(copy.releaseModalBody)}
        </p>

        <div class="release-modal__actions">
          <a
            class="release-modal__cta"
            href="${url}"
            target="_blank"
            rel="noreferrer"
            data-release-open
          >
            <span class="release-modal__cta-label" data-copy="releaseModalPrimary"
              >${escapeHtml(copy.releaseModalPrimary)}</span
            >
            <span class="release-modal__cta-arrow" aria-hidden="true">
              <svg viewBox="0 0 14 14" width="13" height="13" fill="none">
                <path
                  d="M4 10 10 4M4.6 4H10v5.4"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="square"
                />
              </svg>
            </span>
          </a>
          <button
            class="release-modal__later"
            type="button"
            data-release-dismiss
            data-copy="releaseModalDismiss"
          >
            ${escapeHtml(copy.releaseModalDismiss)}
          </button>
        </div>
      </div>
    </dialog>
  `;
}

/**
 * Renders the notice into `root`, opens it, and resolves the dismissal.
 *
 * Native `<dialog>.showModal()` is what carries the focus trap, Esc-to-close
 * and the inert background — hand-rolling those is how a marketing modal ends
 * up unreachable by keyboard.
 *
 * @returns {() => void} disposer
 */
export function mountReleaseModal(root, copy, release, storage) {
  const host = document.createElement("div");
  host.className = "release-modal-host";
  host.innerHTML = renderReleaseModal(copy, release);
  root.appendChild(host);

  const dialog = host.querySelector("[data-release-modal]");

  if (!dialog) {
    host.remove();
    return () => {};
  }

  let disposed = false;

  const acknowledge = () => {
    writeSeenTag(storage, release.tag);
  };

  const close = () => {
    acknowledge();

    if (dialog.open) {
      dialog.close();
    }
  };

  const onDialogClose = () => {
    // Covers Esc, which closes the dialog without routing through a button.
    acknowledge();
    host.remove();
  };

  const onClick = (event) => {
    if (event.target.closest("[data-release-dismiss]")) {
      close();
      return;
    }

    // Following the link is an acknowledgement too; the tab opens beside us.
    if (event.target.closest("[data-release-open]")) {
      close();
    }
  };

  dialog.addEventListener("click", onClick);
  dialog.addEventListener("close", onDialogClose);

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    dialog.removeEventListener("click", onClick);
    dialog.removeEventListener("close", onDialogClose);
    host.remove();
  };
}

/** The one call `main.js` makes once the releases list has resolved. */
export function announceRelease(root, copy, releases, options = {}) {
  const storage = options.storage ?? null;
  const release = selectReleaseAnnouncement(releases, storage, {
    forced: options.forced === true,
  });

  if (!release) {
    return () => {};
  }

  return mountReleaseModal(root, copy, release, storage);
}
