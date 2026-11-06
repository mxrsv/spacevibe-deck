import { useEffect, useState } from "react";

/** The current time, refreshed so "seen 5 min ago" does not go stale on a screen left open. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
