import ts from "typescript";

/**
 * The pure half of the raw-control policy (AGENTS.md R12): which JSX elements are raw controls,
 * and whether a file's count fits its debt entry. `ui-raw-controls.test.ts` runs it over the
 * tree; nothing here touches the file system.
 */

/** The elements `src/ui/controls` wraps. Compared with the JSX tag as written, so `<Button>` is not one. */
export const RAW_CONTROL_TAGS: ReadonlySet<string> = new Set([
  "button",
  "input",
  "select",
  "textarea",
]);

/** Debt under here is refused: the blocks are the shared tier, built from controls from day one. */
export const BLOCKS_DIR = "src/ui/blocks/";

export interface RawControlHit {
  tag: string;
  line: number;
  /** `counted` is debt; `exempt` carries a reason; `empty-reason` marks a bare `raw-control:`. */
  status: "counted" | "exempt" | "empty-reason";
}

const LINE_EXEMPTION = /^\/\/\s*raw-control:(.*)$/;
const JSX_EXEMPTION = /^\{\s*\/\*\s*raw-control:([\s\S]*?)\*\/\s*\}$/;

/**
 * Every `<button>`, `<input>`, `<select>` and `<textarea>` in a `.tsx` source, found in the
 * syntax tree so a tag inside a comment or a string is not one. An element is exempt only when
 * the line directly above it ends a `// raw-control: <reason>` comment, or a `{/* raw-control:
 * <reason> *\/}` child. A blank line in between breaks it.
 */
export function findRawControls(source: string): RawControlHit[] {
  const sf = ts.createSourceFile(
    "raw-controls.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line;
  const hits: RawControlHit[] = [];

  const reasonAbove = (anchor: ts.Node, startLine: number): string | undefined => {
    for (const range of ts.getLeadingCommentRanges(source, anchor.pos) ?? []) {
      if (lineOf(range.end) !== startLine - 1) continue;
      const match = LINE_EXEMPTION.exec(source.slice(range.pos, range.end));
      if (match) return match[1].trim();
    }
    const parent = anchor.parent;
    if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) return undefined;
    const siblings = parent.children;
    for (let i = siblings.indexOf(anchor as ts.JsxChild) - 1; i >= 0; i--) {
      const sibling = siblings[i];
      if (ts.isJsxText(sibling) && sibling.containsOnlyTriviaWhiteSpaces) continue;
      if (!ts.isJsxExpression(sibling) || lineOf(sibling.getEnd()) !== startLine - 1)
        return undefined;
      return JSX_EXEMPTION.exec(sibling.getText(sf))?.[1].trim();
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    const isElement = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
    if (isElement && ts.isIdentifier(node.tagName) && RAW_CONTROL_TAGS.has(node.tagName.text)) {
      // A paired element's leading comments sit on the JsxElement, not on its opening tag.
      const anchor = ts.isJsxOpeningElement(node) ? node.parent : node;
      const line = lineOf(node.getStart(sf));
      const reason = reasonAbove(anchor, line);
      const status = reason === undefined ? "counted" : reason === "" ? "empty-reason" : "exempt";
      hits.push({ tag: node.tagName.text, line: line + 1, status });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface DebtParse {
  debt: Map<string, number>;
  problems: string[];
}

/** `path count` per line; blank lines and `#` comments are skipped, anything else is a problem. */
export function parseDebt(text: string): DebtParse {
  const debt = new Map<string, number>();
  const problems: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const entry = /^(\S+) (\d+)$/.exec(line);
    if (!entry) problems.push(`debt line ${index + 1} is not "path count": ${line}`);
    else if (debt.has(entry[1])) problems.push(`debt lists ${entry[1]} twice`);
    else debt.set(entry[1], Number(entry[2]));
  }
  return { debt, problems };
}

/**
 * Everything wrong with the tree against its debt: `scanned` maps each shipping `.tsx` path to
 * its hits. Debt may only fall, so a count under its entry fails as loudly as one over it.
 */
export function auditRawControls(
  scanned: ReadonlyMap<string, readonly RawControlHit[]>,
  debt: ReadonlyMap<string, number>,
): string[] {
  const problems: string[] = [];
  const how =
    "use a control from src/ui/controls, or put `// raw-control: <reason>` directly above the element";

  for (const [path, hits] of scanned) {
    for (const hit of hits.filter(({ status }) => status === "empty-reason")) {
      problems.push(
        `${path}:${hit.line} <${hit.tag}> has \`raw-control:\` with no reason; write why a control cannot do it`,
      );
    }
    const counted = hits.filter(({ status }) => status === "counted");
    const allowed = debt.get(path);
    const where = counted.map(({ tag, line }) => `<${tag}> at line ${line}`).join(", ");
    if (path.startsWith(BLOCKS_DIR)) {
      if (counted.length > 0)
        problems.push(`${path} is a block and may hold no raw control (${where}): ${how}`);
    } else if (allowed === undefined && counted.length > 0) {
      problems.push(
        `${path} has ${counted.length} raw control(s) and is not in the debt file (${where}): ${how}`,
      );
    } else if (allowed !== undefined && counted.length > allowed) {
      problems.push(
        `${path} has ${counted.length} raw controls, over its debt of ${allowed} (${where}): ${how}`,
      );
    } else if (allowed !== undefined && counted.length < allowed) {
      problems.push(
        counted.length === 0
          ? `${path} is clean now: remove its line from the debt file`
          : `${path} has ${counted.length} raw controls, under its debt of ${allowed}: lower the entry to ${counted.length}`,
      );
    }
  }

  for (const path of debt.keys()) {
    if (path.startsWith(BLOCKS_DIR))
      problems.push(`${path} is a block: blocks take no debt, remove the entry`);
    else if (!scanned.has(path))
      problems.push(
        `${path} is in the debt file but is not a scanned shipping .tsx file: remove the entry`,
      );
  }
  return problems;
}
