import { signal } from '@preact/signals';
import { reportPersistError } from '../chrome/events';
import { invoke } from '../host/bridge';
import { Store } from '../host/store-host';
import { validateLogoDataUrl } from './logo-store';
import {
  DEFAULT_SIDEBAR_BANNER_PRESET,
  isSidebarBannerPresetId,
  type SidebarBannerPresetId,
} from './sidebar-banner-presets';

const STORE_FILE = 'sidebar-banner.json';
const STORE_KEY = 'banner';

export type SidebarBannerSelection = SidebarBannerPresetId | 'custom';

export interface SidebarBannerState {
  readonly enabled: boolean;
  readonly selection: SidebarBannerSelection;
  readonly customImage: string;
}

export const DEFAULT_SIDEBAR_BANNER: SidebarBannerState = {
  enabled: false,
  selection: DEFAULT_SIDEBAR_BANNER_PRESET,
  customImage: '',
};

export const sidebarBanner = signal<SidebarBannerState>(DEFAULT_SIDEBAR_BANNER);

let store: Store | null = null;

export function validateSidebarBannerState(raw: unknown): SidebarBannerState {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SIDEBAR_BANNER;
  }
  const source = raw as Record<string, unknown>;
  const customImage = validateLogoDataUrl(source.customImage);
  const selectedPreset = isSidebarBannerPresetId(source.selection)
    ? source.selection
    : DEFAULT_SIDEBAR_BANNER_PRESET;
  const selection = source.selection === 'custom' && customImage !== '' ? 'custom' : selectedPreset;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SIDEBAR_BANNER.enabled,
    selection,
    customImage,
  };
}

export function resolveSidebarBannerCustomImage(state: SidebarBannerState): string {
  if (state.selection === 'custom') {
    return validateLogoDataUrl(state.customImage);
  }
  return '';
}

export async function initSidebarBanner(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    sidebarBanner.value = validateSidebarBannerState(raw);
  } catch (err) {
    console.warn('Failed to load the sidebar banner, using defaults:', err);
  }
}

function persist(next: SidebarBannerState): void {
  const current = store;
  if (current === null) {
    reportPersistError("Sidebar banner wasn't saved (storage unavailable)");
    return;
  }
  current
    .set(STORE_KEY, next)
    .then(() => current.save())
    .catch((err: unknown) => {
      console.warn('Failed to save the sidebar banner:', err);
      reportPersistError("Sidebar banner wasn't saved to disk");
    });
}

function commit(next: SidebarBannerState): void {
  sidebarBanner.value = next;
  persist(next);
}

export function setSidebarBannerEnabled(enabled: boolean): void {
  commit({ ...sidebarBanner.value, enabled });
}

export function selectSidebarBanner(selection: unknown): void {
  if (selection !== 'custom' && !isSidebarBannerPresetId(selection)) {
    return;
  }
  if (selection === 'custom' && sidebarBanner.value.customImage === '') {
    return;
  }
  commit({ ...sidebarBanner.value, enabled: true, selection });
}

/**
 * Swallow one image into Deck's existing 1 MB data-URL path. Importing means
 * "use this image", so it selects the custom slot and turns the banner on;
 * replacing it later updates the same slot rather than growing an asset list.
 */
export async function setSidebarBannerFromPath(path: string): Promise<void> {
  let dataUrl: string;
  try {
    dataUrl = await invoke<string>('read_image_as_data_url', { path });
  } catch (err: unknown) {
    throw new Error(typeof err === 'string' ? err : "Couldn't read the image", { cause: err });
  }
  const customImage = validateLogoDataUrl(dataUrl);
  if (customImage === '') {
    throw new Error('The selected file did not contain a supported image');
  }
  commit({ enabled: true, selection: 'custom', customImage });
}
