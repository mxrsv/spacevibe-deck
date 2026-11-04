/**
 * Where the mobile companion's relay lives. Deck's single place the URL comes from (mobile
 * design §7), shaped like `electron/account/config.ts`: a packaged app ignores the variable, so
 * nothing in a user's environment can redirect where pairing secrets and sealed frames go.
 */
export const DEFAULT_RELAY_URL = "https://api.deck.spacevibe.dev/relay";

/** The relay base URL, or null when an unpackaged override is not a plain http(s) URL. */
export function resolveRelayUrl(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = isPackaged ? "" : (env.DECK_RELAY_URL ?? "").trim();
  const url = override === "" ? DEFAULT_RELAY_URL : override;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.search !== "" || parsed.hash !== "") return null;
  } catch {
    return null;
  }
  return url.replace(/\/+$/, "");
}
