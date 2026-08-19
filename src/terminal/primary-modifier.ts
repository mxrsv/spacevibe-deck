import { hasPrimaryModifier } from "../lib/platform";

type ModifierEvent = Readonly<Pick<KeyboardEvent, "metaKey" | "ctrlKey">>;
type Listener = (held: boolean) => void;

const listeners = new Set<Listener>();
let held = false;
let installed = false;

function setHeld(next: boolean): void {
  if (held === next) {
    return;
  }
  held = next;
  for (const listener of [...listeners]) {
    listener(held);
  }
}

function install(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  window.addEventListener("keydown", (event) => setHeld(hasPrimaryModifier(event)), true);
  window.addEventListener("keyup", (event) => setHeld(hasPrimaryModifier(event)), true);
  window.addEventListener("blur", () => setHeld(false));
}

export function isPrimaryModifierHeld(): boolean {
  install();
  return held;
}

export function syncPrimaryModifierHeld(event: ModifierEvent): void {
  install();
  setHeld(hasPrimaryModifier(event));
}

export function onPrimaryModifierChange(listener: Listener): () => void {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
