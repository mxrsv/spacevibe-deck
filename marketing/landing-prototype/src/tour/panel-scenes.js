/**
 * The scene registry — which drawing each feature panel stands on.
 *
 * The bodies live one per module in `./scenes/`, and the window chrome they
 * all share lives in `./scenes/chrome.js`. Six panels in one file was the
 * largest single point of contention in this tree; a module per scene is what
 * lets each one be rewritten without reading the other five.
 *
 * The tour reaches every scene through this map alone — no panel imports a
 * scene module directly.
 */

import { catalog } from "./scenes/catalog.js";
import { picker } from "./scenes/picker.js";
import { rail } from "./scenes/rail.js";
import { restore } from "./scenes/restore.js";
import { surfaces } from "./scenes/surfaces.js";
import { usage } from "./scenes/usage.js";

export const SCENES = { rail, picker, restore, surfaces, usage, catalog };
