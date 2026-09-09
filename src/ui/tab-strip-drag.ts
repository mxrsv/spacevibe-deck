/** Horizontal pointer drag, measured once per frame. Identity is read again
 * at release so a closing tab or changing workspace cannot redirect a drop. */
const CHIP = "[data-strip-key]";
const THRESHOLD = 5;
const EDGE = 28;
const SPEED = 12;
const GHOST_OFFSET = 12;

interface Deps {
  onStart(): void;
  onDrop(source: number, before: number | null): void;
}

export function createTabStripDrag(list: HTMLElement, deps: Deps): () => void {
  let press: { id: number; key: number; x: number; y: number; pinned: string } | null = null;
  let point = { x: 0, y: 0 };
  let dragging = false;
  let cancelled = false;
  let frame: number | null = null;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;

  function chips(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>(CHIP)].filter(
      (el) => el.dataset.pinned === press?.pinned,
    );
  }

  function measure(): { before: number | null; x: number; inside: boolean; velocity: number } {
    const rect = list.getBoundingClientRect();
    const entries = chips().filter((el) => Number(el.dataset.stripKey) !== press?.key);
    const next = entries.find((el) => {
      const box = el.getBoundingClientRect();
      return point.x < box.left + box.width / 2;
    });
    const last = entries[entries.length - 1]?.getBoundingClientRect();
    const x = next?.getBoundingClientRect().left ?? last?.right ?? rect.left;
    const velocity = point.x < rect.left + EDGE ? -SPEED : point.x > rect.right - EDGE ? SPEED : 0;
    return {
      before: next ? Number(next.dataset.stripKey) : null,
      x: Math.max(rect.left, Math.min(rect.right, x)),
      inside:
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom,
      velocity,
    };
  }

  function paint(): void {
    frame = null;
    if (!dragging || cancelled) return;
    const target = measure();
    const rect = list.getBoundingClientRect();
    if (ghost) {
      ghost.style.left = `${point.x + GHOST_OFFSET}px`;
      ghost.style.top = `${point.y + GHOST_OFFSET}px`;
    }
    if (line) {
      line.style.display = target.inside ? "block" : "none";
      line.style.left = `${target.x}px`;
      line.style.top = `${rect.top}px`;
      line.style.height = `${rect.height}px`;
    }
    if (target.inside && target.velocity !== 0) {
      const previous = list.scrollLeft;
      list.scrollLeft += target.velocity;
      if (previous !== list.scrollLeft) frame = requestAnimationFrame(paint);
    }
  }

  function clearVisuals(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    ghost?.remove();
    line?.remove();
    ghost = null;
    line = null;
    list.classList.remove("is-tab-dragging");
  }

  function cleanup(): void {
    const id = press?.id;
    press = null;
    if (id !== undefined && list.hasPointerCapture?.(id)) list.releasePointerCapture(id);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", keydown, true);
    window.removeEventListener("blur", cancel);
    clearVisuals();
    dragging = false;
    cancelled = false;
  }

  function swallowClick(): void {
    const swallow = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  }

  function cancel(): void {
    if (dragging) swallowClick();
    cleanup();
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !press) return;
    event.preventDefault();
    event.stopPropagation();
    cancelled = true;
    clearVisuals();
  }

  function move(event: PointerEvent): void {
    if (!press || event.pointerId !== press.id || cancelled) return;
    point = { x: event.clientX, y: event.clientY };
    if (!dragging) {
      if (Math.hypot(point.x - press.x, point.y - press.y) < THRESHOLD) return;
      const source = chips().find((el) => Number(el.dataset.stripKey) === press?.key);
      if (!source) {
        cleanup();
        return;
      }
      dragging = true;
      deps.onStart();
      list.classList.add("is-tab-dragging");
      list.setPointerCapture?.(press.id);
      ghost = document.createElement("div");
      ghost.className = "pane-drag-ghost tab-strip-ghost";
      ghost.textContent = source.querySelector(".tab__label")?.textContent ?? "Tab";
      line = document.createElement("div");
      line.className = "tab-strip-drop-line";
      document.body.append(ghost, line);
    }
    event.preventDefault();
    if (frame === null) frame = requestAnimationFrame(paint);
  }

  function up(event: PointerEvent): void {
    if (!press || event.pointerId !== press.id) return;
    point = { x: event.clientX, y: event.clientY };
    const source = press.key;
    const target = measure();
    const commit =
      dragging &&
      !cancelled &&
      target.inside &&
      chips().some((el) => Number(el.dataset.stripKey) === source);
    if (dragging) swallowClick();
    cleanup();
    if (commit) deps.onDrop(source, target.before);
  }

  function down(event: PointerEvent): void {
    if (
      event.button !== 0 ||
      press ||
      event.ctrlKey ||
      !(event.target instanceof Element) ||
      event.target.closest("button")
    )
      return;
    const chip = event.target.closest<HTMLElement>(CHIP);
    const key = Number(chip?.dataset.stripKey);
    if (!chip || !Number.isSafeInteger(key) || key <= 0) return;
    press = {
      id: event.pointerId,
      key,
      x: event.clientX,
      y: event.clientY,
      pinned: chip.dataset.pinned ?? "false",
    };
    point = { x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
  }

  list.addEventListener("pointerdown", down);
  return () => {
    list.removeEventListener("pointerdown", down);
    cleanup();
  };
}
