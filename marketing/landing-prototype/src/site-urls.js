/**
 * The landing's own two pages, spelled the way the current environment serves
 * them.
 *
 * The built output puts both HTML files under `/landing-prototype/` — the Vite
 * root is `marketing/`, so that path is what `npm run prototype:landing`
 * serves and what Rollup emits. In production `vercel.json` rewrites `/` and
 * `/changelog` onto those files and 301s the long spellings away, so the short
 * URLs are the canonical ones and the `<link rel=canonical>` tags name them.
 *
 * Internal links therefore have to differ by environment: shipping the long
 * spelling would send every visitor and every crawler through a redirect hop
 * to reach a page the sitemap lists under its short name, and shipping the
 * short one would 404 in dev, where nothing rewrites.
 *
 * `import.meta.env.PROD` is Vite's own flag; under Vitest it is false, so the
 * tests read the dev spellings. The build's prerender pass loads this module
 * through an SSR server in production mode, so the static HTML it injects
 * carries the short URLs too.
 */

const PROD = import.meta.env.PROD === true;

/** The home page. */
export const LANDING_URL = PROD ? "/" : "/landing-prototype/";

/** The release list. */
export const CHANGELOG_URL = PROD ? "/changelog" : "/landing-prototype/changelog/";
