import { signal } from '@preact/signals';

/**
 * Which settings category the rail shows. A bare module signal, same idiom
 * as `chrome/events.ts`'s `settingsOpen` (R5) — window-scoped, not persisted.
 * Reopening settings in the same session returns to the last category; a
 * relaunch always starts back at "appearance".
 */
export type CategoryId =
  | 'appearance'
  | 'terminal'
  | 'agents'
  | 'links-editor'
  | 'browser'
  | 'shortcuts'
  | 'notifications'
  | 'about';

export const activeCategory = signal<CategoryId>('appearance');
