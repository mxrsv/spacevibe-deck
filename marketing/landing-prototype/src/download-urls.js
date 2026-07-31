/**
 * Where the landing page sends people to get the app.
 *
 * macOS follows `releases/latest`, so a new tag ships without touching this
 * file. Windows deliberately does NOT: it is an unsigned engineering preview
 * pinned to its own prerelease tag, so `releases/latest` stays macOS and a
 * visitor is never handed an unverified Windows binary as the shipped product.
 *
 * That pin means WINDOWS_TAG has to be bumped by hand for each preview build.
 * It lives here, once, because the URL is referenced from both the hero and the
 * tour — two copies of a version-pinned string would drift on the first bump.
 */
export const REPO_URL = "https://github.com/mxrsv/spacevibe-deck";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

export const WINDOWS_TAG = "v0.9.0-windows-preview";
export const WINDOWS_SETUP = "SpaceVibe.Deck_0.9.0_x64-setup.exe";
export const WINDOWS_URL = `${REPO_URL}/releases/download/${WINDOWS_TAG}/${WINDOWS_SETUP}`;
