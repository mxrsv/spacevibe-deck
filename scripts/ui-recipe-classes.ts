import ts from "typescript";
import { ringClasses, splitClass } from "../src/ui/controls/ring-classes";
import { excepted, type CompositionHit, type TsxRule } from "./ui-composition-ledger";

/**
 * The `.tsx` half of the recipe ratchet (spec 2026-11-05-ui-recipes-ratchet, RCP-26). Reads class
 * tokens out of every string literal and template text in a source, the way
 * `ui-composition-gate.ts` reads `small-text`, so a `cva` base, a `cn()` argument and an attribute
 * all count. It cannot read a class built at run time, and it does not know which branch of a
 * conditional is live (RCP-29). A hit on a line whose line above carries `ui-scale: <reason>`
 * does not count (RCP-27).
 *
 * - `arbitrary`: a bracketed value on a height, size, padding, margin, gap or radius utility
 *   (`h-[30px]`, `rounded-[5px]`). A token reference (`h-(--row-32)`, `h-[var(--row-32)]`)
 *   passes, and width, inset, translate, grid and max sizes stay free. A bracketed shadow or ring
 *   counts under its own rule.
 * - `spacing-step`: a named padding, margin, gap or space step off RCP-6's scale (`p-5`, `gap-7`,
 *   `px-px`); `3.5` (14px) passes in the Button control only, its 36 size's padding.
 * - `weight`: any weight utility but `font-normal` and `font-semibold`.
 * - `shadow`: any `shadow*` utility but `shadow-none` and an `--elev-*` reference.
 * - `ring`: a ring, ring-coloured border or outline under a focus or invalid variant
 *   (`ringClasses`), outside the Input control.
 * - `phosphor`: an import of `@phosphor-icons/react`, in `.ts` files too (RCP-14).
 */

/** Tailwind's spacing step is 4px; these steps land on RCP-6's 0/2/4/6/8/10/12/16/24. */
const SPACING_STEPS: ReadonlySet<string> = new Set([
  "0",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "4",
  "6",
]);
const SPACING = /^(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy])-(\d+(?:\.\d+)?|px)$/;
const ARBITRARY =
  /^(h|min-h|size|p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|rounded(-[a-z]{1,2})?)-\[(.+)\]$/;
/** A token reference, and `inherit` on a radius, which takes the parent's recipe. */
const TOKEN_VALUE = /^(var\(--[\w-]+\)|inherit)$/;
const WEIGHT = /^font-(thin|extralight|light|medium|bold|extrabold|black|\[.+\]|\(.+\))$/;
const SHADOW = /^(inset-)?shadow(-|$)/;
const ELEV_SHADOW = /^shadow-(none|\(--elev-[123]\)|\[var\(--elev-[123]\)\])$/;

/** The control files where a rule's own value is the definition: RCP-26's two carve-outs. */
const BUTTON_CONTROL = "src/ui/controls/button.tsx";
const INPUT_CONTROL = "src/ui/controls/input.tsx";

function tokenHits(token: string, path: string): { rule: TsxRule; detail: string } | undefined {
  const { utility: raw } = splitClass(token);
  const utility = raw.replace(/^!/, "").replace(/!$/, "");
  const bare = utility.replace(/^-/, "");
  if (ringClasses(token).length > 0)
    return path === INPUT_CONTROL ? undefined : { rule: "ring", detail: token };
  if (SHADOW.test(bare))
    return ELEV_SHADOW.test(bare) ? undefined : { rule: "shadow", detail: token };
  if (WEIGHT.test(bare)) return { rule: "weight", detail: token };
  const arbitrary = ARBITRARY.exec(bare);
  if (arbitrary)
    return TOKEN_VALUE.test(arbitrary[4]) ? undefined : { rule: "arbitrary", detail: token };
  const step = SPACING.exec(bare)?.[3];
  if (step === undefined || SPACING_STEPS.has(step)) return undefined;
  if (step === "3.5" && path === BUTTON_CONTROL) return undefined;
  return { rule: "spacing-step", detail: token };
}

const isText = (node: ts.Node): node is ts.StringLiteral | ts.TemplateLiteralLikeNode =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node);

/**
 * Every RCP-26 hit in a source. `path` is repo-relative: it decides the two control carve-outs,
 * and a `.ts` file is read for `phosphor` only, since a control built in `.ts` is review's.
 */
export function findRecipeHits(source: string, path: string): CompositionHit[] {
  const tsx = path.endsWith(".tsx");
  const sf = ts.createSourceFile(
    "recipe.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = source.split(/\r?\n/);
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const hits: CompositionHit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith("@phosphor-icons/react")
    ) {
      hits.push({ rule: "phosphor", line: lineOf(node), detail: node.moduleSpecifier.text });
    } else if (tsx && isText(node) && !ts.isImportDeclaration(node.parent)) {
      for (const token of node.text.split(/\s+/)) {
        const hit = token === "" ? undefined : tokenHits(token, path);
        if (hit) hits.push({ ...hit, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits.filter((hit) => !excepted(lines, hit.line));
}
