// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ submit: vi.fn(), board: vi.fn(), config: vi.fn() }));
vi.mock("./feedback-api.js", async (original) => ({
  ...(await original()),
  SUBMISSIONS_OPEN: true,
  submitFeedback: api.submit,
  fetchFeedbackBoard: api.board,
  fetchFeedbackConfig: api.config,
}));
vi.mock("./feedback-auth.js", () => ({
  createFeedbackAuth: (_root, _client, changed) => {
    queueMicrotask(() => changed(true));
    return { token: () => "credential", reset: () => changed(false) };
  },
}));

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function mount(config = { googleClientId: "client", submissionsOpen: true }) {
  document.body.innerHTML = '<div id="feedback-root"></div>';
  api.config.mockResolvedValue(config);
  api.board.mockResolvedValue({ board: { pending: [], review: [], done: [] }, nextCursor: null });
  await import("./feedback.js");
  await vi.waitFor(() =>
    expect(document.querySelector("#feedback-root").dataset.authReady).toBe("true"),
  );
  return document.querySelector(".feedback-form");
}

function paste(target, files = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  target.dispatchEvent(event);
  return event;
}

function imageUrls() {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test-image";
      }
      static revokeObjectURL() {}
    },
  );
}

it("pastes screenshots from the details field, preserves text paste, and submits the pasted file", async () => {
  imageUrls();
  const form = await mount({ googleClientId: null, authMode: "anonymous", submissionsOpen: true });
  const details = form.querySelector('[name="body"]');
  expect(paste(details).defaultPrevented).toBe(false);
  const image = new File(["clipboard image"], "image.png", { type: "image/png" });
  expect(paste(details, [image]).defaultPrevented).toBe(true);
  expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(1);
  form.querySelector('[name="title"]').value = "Pasted screenshot";
  api.submit.mockResolvedValueOnce(undefined);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  expect(api.submit.mock.calls[0][0].images).toEqual([image]);
});

it("applies the same image type, size and count limits to pasted files", async () => {
  imageUrls();
  const form = await mount({ googleClientId: null, authMode: "anonymous", submissionsOpen: true });
  const details = form.querySelector('[name="body"]');
  for (const file of [
    new File(["gif"], "image.gif", { type: "image/gif" }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ]) {
    expect(paste(details, [file]).defaultPrevented).toBe(true);
    expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(0);
    expect(form.querySelector("[data-image-status]").textContent).toContain("5 MB");
  }
  const file = new File(["png"], "image.png", { type: "image/png" });
  paste(details, [file, file, file]);
  expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(3);
  paste(details, [file]);
  expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(3);
  expect(form.querySelector("[data-image-status]").textContent).toContain("up to 3");
});

it("submits anonymously when the server explicitly enables anonymous intake", async () => {
  const form = await mount({ googleClientId: null, authMode: "anonymous", submissionsOpen: true });
  form.querySelector('[name="title"]').value = "No login needed";
  api.submit.mockResolvedValueOnce(undefined);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  expect(api.submit.mock.calls[0][0].credential).toBeUndefined();
  await vi.waitFor(() => expect(document.querySelector("[data-sent-panel]").hidden).toBe(false));
});

it("keeps selected images after failure, locks edits during send, and clears only after success", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test-image";
      }
      static revokeObjectURL() {}
    },
  );
  const form = await mount({ googleClientId: null, authMode: "anonymous", submissionsOpen: true });
  const picker = form.querySelector("[data-feedback-images]");
  const first = new File(["first"], "first.png", { type: "image/png" });
  const second = new File(["second"], "second.png", { type: "image/png" });
  Object.defineProperty(picker, "files", { configurable: true, value: [first, second] });
  picker.dispatchEvent(new Event("change"));
  form.querySelector('[aria-label="Remove first.png"]').click();
  expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(1);
  form.querySelector('[name="title"]').value = "Keep this screenshot";
  let reject;
  api.submit.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  expect(api.submit.mock.calls[0][0].images).toEqual([second]);
  expect(picker.disabled).toBe(true);
  expect(form.querySelector('[aria-label="Remove second.png"]').disabled).toBe(true);
  paste(form.querySelector('[name="body"]'), [first]);
  expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(1);
  reject(new Error("response lost"));
  await vi.waitFor(() => expect(picker.disabled).toBe(false));
  expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(1);
  api.submit.mockResolvedValueOnce(undefined);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
  expect(api.submit.mock.calls[1][0].images).toEqual([second]);
  await vi.waitFor(() =>
    expect(form.querySelectorAll("[data-image-previews] img")).toHaveLength(0),
  );
});

it("keeps category and id after a lost acknowledgment and reload, then clears only after success", async () => {
  let form = await mount();
  form.querySelector('[name="title"]').value = "Keep this idea";
  form.querySelector('[name="body"]').value = "Details";
  form.querySelector('[name="category"][value="idea"]').checked = true;
  api.submit.mockRejectedValueOnce(new Error("response lost"));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  const first = api.submit.mock.calls[0][0];
  const stored = JSON.parse(localStorage.getItem("deck.landing.feedbackDraft.v1"));
  expect(stored.category).toBe("idea");
  expect(stored.id).toBe(first.id);
  vi.resetModules();
  form = await mount();
  expect(form.querySelector('[name="category"]:checked').value).toBe("idea");
  api.submit.mockResolvedValueOnce(undefined);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
  expect(api.submit.mock.calls[1][0]).toEqual(first);
  await vi.waitFor(() => expect(localStorage.getItem("deck.landing.feedbackDraft.v1")).toBeNull());
});
