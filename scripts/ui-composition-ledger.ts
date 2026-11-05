/**
 * The one debt ledger both composition suites count against (spec 2026-11-05-ui-recipes-ratchet,
 * RCP-24 and RCP-27). `scripts/ui-composition-gate.test.ts` audits the `.ts` and `.tsx` lines and
 * `src/styles/composition-rules.test.ts` the `.css` lines of the same file,
 * `scripts/ui-composition-debt.txt`. Nothing here touches the file system.
 */

/** The `.tsx` / `.ts` rules (CMP-5 to CMP-7, CMP-10, RCP-26). */
export const TSX_RULES = [
  "small-text",
  "chip-like",
  "arbitrary",
  "spacing-step",
  "weight",
  "shadow",
  "ring",
  "phosphor",
] as const;
/** The `.css` rules (RCP-25). The three checks of CMP-10, CMP-11 and CMP-14 stay at zero and have no line. */
export const CSS_RULES = [
  "radius",
  "height",
  "spacing",
  "focus",
  "state-bg",
  "shadow",
  "weight",
] as const;

export type TsxRule = (typeof TSX_RULES)[number];
export type CssRule = (typeof CSS_RULES)[number];
export type CompositionRule = TsxRule | CssRule;

const ALL_RULES: ReadonlySet<string> = new Set<string>([...TSX_RULES, ...CSS_RULES]);

export interface CompositionHit {
  rule: CompositionRule;
  line: number;
  /** What matched, for the failure message. */
  detail: string;
}

export interface DebtParse {
  /** Keyed `path rule`, so one file carries a count per rule. */
  debt: Map<string, number>;
  problems: string[];
}

export const debtKey = (path: string, rule: CompositionRule): string => `${path} ${rule}`;

/** `path rule count` per line; blank lines and `#` comments are skipped, anything else is a problem. */
export function parseDebt(text: string): DebtParse {
  const debt = new Map<string, number>();
  const problems: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const entry = /^(\S+) ([a-z-]+) (\d+)$/.exec(line);
    if (!entry || !ALL_RULES.has(entry[2]) || Number(entry[3]) === 0) {
      problems.push(`debt line ${index + 1} is not "path rule count" with a known rule: ${line}`);
      continue;
    }
    const key = debtKey(entry[1], entry[2] as CompositionRule);
    if (debt.has(key)) problems.push(`debt lists ${key} twice`);
    else debt.set(key, Number(entry[3]));
  }
  return { debt, problems };
}

/** Which slice of the ledger a suite owns: its rules, its file kind and how to fix each rule. */
export interface LedgerScope {
  readonly rules: readonly CompositionRule[];
  readonly owns: (path: string) => boolean;
  readonly how: Readonly<Partial<Record<CompositionRule, string>>>;
}

/**
 * Everything wrong with the tree against its debt: `scanned` maps each scanned path to its hits.
 * Debt may only fall, so a count under its entry fails as loudly as one over it. Lines of the
 * other suite's files are left to that suite.
 */
export function auditComposition(
  scanned: ReadonlyMap<string, readonly CompositionHit[]>,
  debt: ReadonlyMap<string, number>,
  scope: LedgerScope,
): string[] {
  const problems: string[] = [];
  for (const [path, hits] of scanned) {
    for (const rule of scope.rules) {
      const found = hits.filter((hit) => hit.rule === rule);
      const allowed = debt.get(debtKey(path, rule));
      const where = found.map(({ detail, line }) => `${detail} at line ${line}`).join(", ");
      const how = scope.how[rule] ?? "";
      if (allowed === undefined && found.length > 0) {
        problems.push(
          `${path} has ${found.length} ${rule} hit(s) and is not in the debt file (${where}): ${how}`,
        );
      } else if (allowed !== undefined && found.length > allowed) {
        problems.push(
          `${path} has ${found.length} ${rule} hits, over its debt of ${allowed} (${where}): ${how}`,
        );
      } else if (allowed !== undefined && found.length < allowed) {
        problems.push(
          found.length === 0
            ? `${path} ${rule} is clean now: remove its line from the debt file`
            : `${path} has ${found.length} ${rule} hits, under its debt of ${allowed}: lower the entry to ${found.length}`,
        );
      }
    }
  }
  for (const key of debt.keys()) {
    const [path, rule] = key.split(" ");
    if (!scope.owns(path)) continue;
    if (!scanned.has(path))
      problems.push(`${path} is in the debt file but is not a scanned file: remove the entry`);
    else if (!scope.rules.includes(rule as CompositionRule))
      problems.push(`${key}: ${rule} is not a rule for this kind of file`);
  }
  return problems;
}

/** `ui-scale: <reason>` with something after the colon; the reason is what makes it a decision. */
const EXCEPTION = /ui-scale:\s*([^\s*/}][^*/}]*)/;
/** `ui-scale:` with nothing after it but the comment's close. */
const EMPTY_EXCEPTION = /ui-scale:\s*(?:\*\/|\}|$)/;

/**
 * True when the line above `line` (1-based) carries a `ui-scale: <reason>` comment, the RCP-27
 * exception: `/* ui-scale: … *\/` in CSS, `// ui-scale: …` or `{/* ui-scale: … *\/}` in `.tsx`.
 */
export function excepted(lines: readonly string[], line: number): boolean {
  const above = lines[line - 2];
  return above !== undefined && EXCEPTION.test(above) && !EMPTY_EXCEPTION.test(above);
}

/** The 1-based lines that write `ui-scale:` with no reason, which fail both suites (RCP-27). */
export function emptyExceptions(text: string): number[] {
  return text.split(/\r?\n/).flatMap((source, index) => {
    const at = source.indexOf("ui-scale:");
    return at >= 0 && EMPTY_EXCEPTION.test(source.slice(at)) ? [index + 1] : [];
  });
}
