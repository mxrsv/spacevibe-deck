export interface Choice {
  /** The number on the screen; it is also the key that selects the option. */
  readonly number: number;
  readonly label: string;
  readonly selected: boolean;
}

/** Longest label a button shows. */
const LABEL_MAX = 48;
/** Non-item lines allowed between two items of one list: wrapped text of a long option. */
const MAX_CONTINUATION = 3;
/** Trailing lines (outside borders and key hints) a list with a selection marker may have under it. */
const TRAILING_WITH_MARKER = 8;
/** The same for a list without one: it must be the last thing on the screen. */
const TRAILING_WITHOUT_MARKER = 3;

const BORDER = /^[\s│┃║|╭╮╰╯─━═┌┐└┘├┤]*$/;
const EDGES = /^[\s│┃║|]+|[\s│┃║|]+$/g;
const ITEM = /^(?<marker>[❯›▶►➤>]\s+)?(?<n>\d{1,2})[.)]\s+(?<text>\S.*)$/;
/** Key-hint footers agents print under a list; they say nothing about whether it is still live. */
const HINT =
  /\b(esc|enter|tab|ctrl|shift)\b.*\b(cancel|confirm|select|dismiss|interrupt|toggle|cycle)\b|\? for shortcuts|press enter|↑↓/i;
/** A spinner or "esc to interrupt" under the list: the agent is working, so the list is output. */
const WORKING = /esc to interrupt|\(\d+s\b|… \(/i;
/** An empty input box: the agent is idle and any list above it is just printed output. */
const IDLE_PROMPT = /^[>❯›]\s*$/;

interface Item {
  readonly line: number;
  readonly n: number;
  readonly text: string;
  readonly selected: boolean;
}

function clean(raw: string): string {
  return raw.replace(/\s+$/, "").replace(EDGES, "");
}

/**
 * The numbered option list a terminal agent ends its screen with (a permission prompt, an
 * approval, a question), or null. One parser for Claude Code, Codex and opencode: it reads the
 * shape (`1.`, `2.`, ... with an optional selection marker, possibly inside a box, long options
 * wrapped), not any one agent's wording. It takes the LAST list on the screen, requires numbers
 * counting up from 1, and requires the list to sit at the bottom, so output the agent printed and
 * kept working on is not mistaken for a prompt.
 */
export function parseChoices(screen: string): Choice[] | null {
  const lines = screen.split(/\r?\n/).map(clean);
  const items: Item[] = [];
  lines.forEach((line, index) => {
    const match = ITEM.exec(line);
    if (match?.groups === undefined) return;
    items.push({
      line: index,
      n: Number(match.groups.n),
      text: match.groups.text,
      selected: match.groups.marker !== undefined,
    });
  });
  if (items.length < 2) return null;

  // The last run: walk back from the final item while numbers count down one at a time and the
  // lines between two items are few and are not themselves empty or borders-only.
  let end = items.length - 1;
  let start = end;
  while (start > 0) {
    const previous = items[start - 1];
    const current = items[start];
    if (previous.n !== current.n - 1) break;
    if (!continuation(lines, previous.line, current.line)) break;
    start--;
  }
  if (items[start].n !== 1 || end - start + 1 < 2) {
    // A tail of the run that does not start at 1 is not a list; try nothing else (the last run wins).
    return null;
  }
  const run = items.slice(start, end + 1);
  end = run[run.length - 1].line;

  const hasMarker = run.some((item) => item.selected);
  const trailing: string[] = [];
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    if (WORKING.test(line)) return null;
    if (line === "" || BORDER.test(line) || HINT.test(line)) continue;
    trailing.push(line);
  }
  if (trailing.some((line) => IDLE_PROMPT.test(line)) && !hasMarker) return null;
  const allowed = hasMarker ? TRAILING_WITH_MARKER : TRAILING_WITHOUT_MARKER;
  if (trailing.length > allowed) return null;

  return run.map((item, index) => {
    const next = run[index + 1];
    const wrapped = lines
      .slice(item.line + 1, next === undefined ? item.line + 1 + MAX_CONTINUATION : next.line)
      .filter((line) => line !== "" && !BORDER.test(line) && !HINT.test(line) && !ITEM.test(line));
    const label = [item.text, ...(next === undefined ? [] : wrapped)]
      .join(" ")
      .replace(/\s+/g, " ");
    return {
      number: item.n,
      label: label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label,
      selected: item.selected,
    };
  });
}

function continuation(lines: readonly string[], from: number, to: number): boolean {
  if (to - from - 1 > MAX_CONTINUATION + 1) return false;
  for (let i = from + 1; i < to; i++) {
    if (lines[i] !== "" && BORDER.test(lines[i]) && lines[i].trim() !== "") return false;
  }
  return true;
}

/** What to send to select an option: its digit. Claude Code, Codex and opencode act on the digit alone. */
export function choiceInput(choice: Choice): string {
  return String(choice.number);
}

/** Opening words of a first-run or approval question that reads as idle (a trust dialog). */
const QUESTION_WORDS =
  /\b(do you (trust|want)|would you like|trust the files|press enter to continue|allow this)\b/i;
/** Non-empty content rows at the end of the screen, without borders or key hints. */
const TAIL_ROWS = 8;

/**
 * Whether the screen ends with something the agent is asking: a numbered list, a line ending in a
 * question mark, or a trust / "Do you ..." prompt. Used before a prompt is typed into a fresh
 * agent: a first-run trust question reads as idle, and the prompt would answer it.
 */
export function screenAsksQuestion(screen: string): boolean {
  if (parseChoices(screen) !== null) return true;
  const rows = screen
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line !== "" && !BORDER.test(line) && !HINT.test(line))
    .slice(-TAIL_ROWS);
  return rows.some((line) => /\?$/.test(line) || QUESTION_WORDS.test(line));
}
