/**
 * A text's lines as Monaco's colorizer marks them up, for the dock's diff cards (DOCK-10): one
 * HTML string per line, its tokens `mtk` spans the Deck theme paints. The colorizer creates no
 * editor and no model, so a card costs one tokenizer pass per side, and Monaco loads only once a
 * card near the viewport has text to colour. The markup is Monaco's own and escapes the text,
 * which is why a card may set it as HTML (the Markdown view's fences do the same).
 */
import { settings } from "../../settings/settings-store";
import { applyMonacoTheme, loadMonaco } from "../editor-host";

export type ColorizeLines = (text: string, language: string) => Promise<readonly string[]>;

/** Past this many characters a side stays plain: one tokenizer pass would stall the frame. */
export const MAX_COLORIZED_CHARS = 200_000;

/**
 * Colour `text` as `language`. The theme is applied first, as the file editor does, because the
 * `mtk` classes mean a colour only once a theme is set. The colorizer ends every line with
 * `<br/>`, so splitting on it gives the lines in order (and one empty string after the last).
 */
export const colorizeLines: ColorizeLines = async (text, language) => {
  const monaco = await loadMonaco();
  applyMonacoTheme(monaco, settings.value);
  const html = await monaco.editor.colorize(text, language, { tabSize: 2 });
  return html.split("<br/>");
};
