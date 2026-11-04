import { useCallback, useEffect, useState } from "react";

export type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly message: string };

/**
 * Loads once per `key` and again on `refresh()` (pull to refresh). A result for another key is
 * treated as still loading, so switching path or desktop never shows the previous one's data.
 */
export function useLoad<T>(
  load: () => Promise<T>,
  describe: (error: unknown) => string,
  key: string,
): { readonly state: LoadState<T>; readonly refresh: () => Promise<void> } {
  const [stored, setStored] = useState<{
    readonly key: string;
    readonly state: LoadState<T>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setStored({ key, state: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!cancelled) setStored({ key, state: { status: "error", message: describe(error) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, describe, key]);

  const refresh = useCallback(async () => {
    try {
      setStored({ key, state: { status: "ready", data: await load() } });
    } catch (error) {
      setStored({ key, state: { status: "error", message: describe(error) } });
    }
  }, [load, describe, key]);

  const state: LoadState<T> =
    stored !== null && stored.key === key ? stored.state : { status: "loading" };
  return { state, refresh };
}
