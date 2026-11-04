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

/**
 * The user guides, rendered from `docs/user/`, per locale. The locale leads
 * the path (`/vi/docs`) so each language is its own crawlable page.
 */
export const DOCS_URLS = {
  en: PROD ? "/docs" : "/landing-prototype/docs/",
  vi: PROD ? "/vi/docs" : "/landing-prototype/vi/docs/",
};

/** The feedback form and its public status board. */
export const FEEDBACK_URL = PROD ? "/feedback" : "/landing-prototype/feedback/";

/**
 * The public privacy notice. Production serves the current version at
 * `/privacy` (a `vercel.json` rewrite); dev has no rewrites, so it names the
 * dated file that rewrite points at. Bump the date here when `vercel.json` does.
 */
export const PRIVACY_URL = PROD ? "/privacy" : "/privacy/2026-11-05/index.html";
