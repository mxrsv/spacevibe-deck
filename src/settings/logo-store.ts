import { signal } from "@preact/signals";
import { invoke } from "../host/bridge";
import { Store } from "../host/store-host";
import { reportPersistError } from "../chrome/events";

const STORE_FILE = "logo.json";
const STORE_KEY = "dataUrl";

/** Extensions the Settings logo picker + Rust reader accept (must match `images.rs`). */
const SUPPORTED_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp"] as const;

/**
 * The app logo as a data URL; empty string = not set → the default Deck
 * mark is shown. A data URL (not a path) so the logo survives its source file
 * being deleted or moved.
 */
export const logoDataUrl = signal<string>("");

let store: Store | null = null;

/** True when `path` has one of the supported image extensions (case-insensitive). */
export function isSupportedImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  const ext = path.slice(dot + 1).toLowerCase();
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/** First supported image in a drop list, or null when none qualify. */
export function pickImagePath(paths: readonly string[]): string | null {
  return paths.find(isSupportedImagePath) ?? null;
}

/** Only keep a value that actually looks like an image data URL. */
export function validateLogoDataUrl(raw: unknown): string {
  return typeof raw === "string" && raw.startsWith("data:image/") ? raw : "";
}

/** Load the persisted logo at startup — on failure fall back to the default. */
export async function initLogo(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    logoDataUrl.value = validateLogoDataUrl(raw);
  } catch (err) {
    console.warn("Failed to load logo, using the default mark:", err);
  }
}

function persist(dataUrl: string): void {
  if (!store) {
    reportPersistError("Logo wasn't saved (storage unavailable)");
    return;
  }
  store
    .set(STORE_KEY, dataUrl)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn("Failed to save logo:", err);
      reportPersistError("Logo wasn't saved to disk");
    });
}

/**
 * Swallow an image file into the app as a data URL and set it as the logo.
 * Throws a human-readable message (from Rust) on an unsupported / too-large /
 * unreadable file so the caller can show it inline; the logo is left unchanged.
 */
export async function setLogoFromPath(path: string): Promise<void> {
  let dataUrl: string;
  try {
    dataUrl = await invoke<string>("read_image_as_data_url", { path });
  } catch (err: unknown) {
    throw new Error(typeof err === "string" ? err : "Couldn't read the image");
  }
  logoDataUrl.value = dataUrl;
  persist(dataUrl);
}

/** Clear the custom logo, reverting to the default mark. */
export function clearLogo(): void {
  logoDataUrl.value = "";
  persist("");
}
