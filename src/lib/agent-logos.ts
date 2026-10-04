/**
 * Brand marks for the built-in agents, keyed by agent id. Pure data — the URLs
 * are resolved by Vite at build time, so importing this module costs the asset
 * references and nothing else.
 *
 * This lived inside `open-board/open-board.tsx` until 2026-08-10, when the
 * token usage overview needed the same marks. One map, two call sites: a
 * second copy would drift the moment a sixth agent ships, and the failure mode
 * is silent (a chip with a logo beside a usage row without one).
 *
 * Keys are agent **ids**, which for a built-in equal the binary name — the
 * invariant `lib/agent-catalog.ts` documents. Declared agents are deliberately
 * absent: they ship no brand mark and wear a letter avatar instead.
 */

import claudeLogo from "../assets/agent-claude.svg";
import codexLogo from "../assets/agent-codex.svg";
import geminiLogo from "../assets/agent-gemini.svg";
import opencodeLogo from "../assets/agent-opencode.svg";
// The only raster mark here: Google ships the Antigravity icon as PNG. Stored
// at 96px — the chip renders it at 15px (styles.css `.achip__logo`), so this
// still has headroom at 3x while staying a fraction of the source file.
import agyLogo from "../assets/agent-agy.png";
// Amp, Kiro and Mistral (for `vibe` — the company mark, Vibe has none of its
// own) and the inline marks below come from LobeHub's MIT-licensed
// `@lobehub/icons-static-svg` (2026-10-03). The licence covers the files, not
// the trademarks; each mark stays its owner's. `crush` and `droid` ship no
// mark and wear the letter avatar, as a declared agent does.
import ampLogo from "../assets/agent-amp.svg";
import kiroLogo from "../assets/agent-kiro.svg";
import mistralLogo from "../assets/agent-mistral.svg";
import copilotLogo from "../assets/agent-copilot.svg";
import grokLogo from "../assets/agent-grok.svg";
import kimiLogo from "../assets/agent-kimi.svg";

export const AGENT_LOGOS: Readonly<Record<string, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  gemini: geminiLogo,
  opencode: opencodeLogo,
  agy: agyLogo,
  amp: ampLogo,
  "kiro-cli": kiroLogo,
  vibe: mistralLogo,
  copilot: copilotLogo,
  grok: grokLogo,
  kimi: kimiLogo,
};

/**
 * A monochrome mark drawn in the surrounding text colour rather than shipped
 * as a fixed-fill image. Added 2026-09-18 (design review F1): the Codex mark
 * is a single-colour shape whose asset is `fill="#fff"`, so as an `<img>` it
 * vanished on the light theme in every strip segment, chip and usage pill.
 * An inline `<svg fill="currentColor">` follows the theme like every other
 * chrome tone (DL-2.2) without a `filter` (DL-1.3). The coloured marks stay
 * images: they are not one colour and must not take the text tone.
 *
 * Keys match `AGENT_LOGOS`; the entry there is kept for the `<img>` call
 * sites that draw the mark where it is still legible (pickers, the
 * launcher) and for the registry test that walks every logo.
 */
export interface InkMark {
  readonly viewBox: string;
  /** Absent = `nonzero`; the lobe-icons marks with holes ask for `evenodd`. */
  readonly fillRule?: "evenodd";
  readonly path: string;
}

export const AGENT_INK_MARKS: Readonly<Record<string, InkMark>> = {
  codex: {
    viewBox: "0 0 256 260",
    path: "M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z",
  },
  // Copilot, Grok and Kimi: single-colour marks, so ink like Codex. Their
  // `AGENT_LOGOS` assets are a mid grey (`#8c8c8c`) rather than white, which
  // stays legible on both themes in the surfaces that still draw an `<img>`.
  copilot: {
    viewBox: "0 0 24 24",
    fillRule: "evenodd",
    path: "M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864zm-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 00-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 00.51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zm5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zM7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394zm6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394zM12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 01-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 00-.84-.044z",
  },
  grok: {
    viewBox: "0 0 24 24",
    fillRule: "evenodd",
    path: "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815",
  },
  kimi: {
    viewBox: "0 0 24 24",
    fillRule: "evenodd",
    path: "M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z",
  },
};
