import { signal } from '@preact/signals';
import type { UpdateController } from './update-controller';

/**
 * The window's live update controller, published so surfaces outside the app
 * tree's prop chain can reach it.
 *
 * `App` owns the controller in a ref because it needs the tab manager to
 * confirm an install. Settings sections, by contract, take no props — a
 * category is one registry entry plus one file (`settings-categories.ts`) —
 * so the About section reads the controller from here instead of forcing
 * every section to carry props it does not use.
 *
 * Window-scoped like every other module store (R5): a second window gets its
 * own module instance and therefore its own controller.
 */
export const activeUpdateController = signal<UpdateController | null>(null);
