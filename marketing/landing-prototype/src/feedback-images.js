export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 3;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Files stay in memory. Draft storage contains text only. */
export function createFeedbackImages(root) {
  const input = root.querySelector("[data-feedback-images]");
  const list = root.querySelector("[data-image-previews]");
  const status = root.querySelector("[data-image-status]");
  let files = [];
  let urls = [];
  let locked = false;

  function render() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = files.map((file) => URL.createObjectURL(file));
    list.replaceChildren(
      ...files.map((file, index) => {
        const card = document.createElement("div");
        card.className = "feedback-image-preview";
        const image = document.createElement("img");
        image.src = urls[index];
        image.alt = file.name;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "feedback-pill feedback-pill--ghost feedback-pill--small";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.disabled = locked;
        remove.addEventListener("click", () => {
          if (locked) return;
          files = files.filter((_, position) => position !== index);
          status.textContent = "";
          render();
        });
        card.append(image, remove);
        return card;
      }),
    );
    input.disabled = locked || files.length >= IMAGE_MAX_COUNT;
  }

  function addImages(selected) {
    if (locked) return;
    if (
      files.length + selected.length > IMAGE_MAX_COUNT ||
      selected.some(
        (file) => !TYPES.includes(file.type) || !file.size || file.size > IMAGE_MAX_BYTES,
      )
    ) {
      status.textContent = "Choose up to 3 PNG, JPEG or WebP images, each no larger than 5 MB.";
      return;
    }
    files = [...files, ...selected];
    status.textContent = "";
    render();
  }

  input.addEventListener("change", () => {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    addImages(selected);
  });

  root.querySelector(".feedback-form").addEventListener("paste", (event) => {
    const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    // Leave ordinary text paste alone; images use the same validation and preview as files.
    if (!images.length) return;
    event.preventDefault();
    addImages(images);
  });

  return {
    files: () => [...files],
    lock(value) {
      locked = value;
      render();
    },
    clear() {
      files = [];
      status.textContent = "";
      render();
    },
  };
}
