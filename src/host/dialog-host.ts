/** Native dialogs — the replacement for `@tauri-apps/plugin-dialog`. */
import { invoke } from './bridge';

export interface AskOptions {
  readonly title?: string;
  readonly kind?: 'info' | 'warning' | 'error';
  readonly okLabel?: string;
  readonly cancelLabel?: string;
}

/** Confirm dialog; true when the user accepted. */
export function ask(text: string, options?: AskOptions): Promise<boolean> {
  return invoke<boolean>('dialog_ask', { message: text, ...options });
}

/** Message dialog with a single dismiss button. */
export function message(text: string, options?: AskOptions): Promise<void> {
  return invoke('dialog_message', { message: text, ...options });
}

export interface OpenFilter {
  readonly name: string;
  /** Extensions without the dot, e.g. `["png", "svg"]`. */
  readonly extensions: string[];
}

export interface OpenOptions {
  readonly directory?: boolean;
  readonly multiple?: boolean;
  readonly title?: string;
  readonly filters?: OpenFilter[];
}

/** Folder/file picker. Null when the user cancelled. */
export function open(options?: OpenOptions): Promise<string | null> {
  return invoke<string | null>('dialog_open', options ?? {});
}
