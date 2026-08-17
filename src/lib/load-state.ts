/** Shared contract for data that can be refreshed without discarding last-good content. */
export type LoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

export const LOAD_IDLE: LoadState = Object.freeze({ status: "idle" });
export const LOAD_LOADING: LoadState = Object.freeze({ status: "loading" });
export const LOAD_READY: LoadState = Object.freeze({ status: "ready" });

export function loadError(message: string): LoadState {
  return Object.freeze({ status: "error", message });
}
