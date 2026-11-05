import ts from "typescript";
import type { CompositionHit } from "./ui-composition-ledger";

/**
 * The pure half of the small-UI policy (spec 2026-11-03-ui-composition, CMP-5 to CMP-7, CMP-10,
 * acceptance criterion 4). `ui-composition-gate.test.ts` runs it over the tree; nothing here
 * touches the file system. It reads class names out of string literals, so its limits are the
 * limits of a text match:
 *
 * - `small-text` finds a size under 12px written as a class: the named steps `text-2xs` (11px)
 *   and `text-3xs` (10px) of `src/ui/type-scale.css`, and `text-[Npx|rem|em]` under 12px. The
 *   oxlint rule `deck/no-arbitrary-font-size` counts every arbitrary size already; this one adds
 *   the named steps it cannot see and catches a size that falls under 12 inside an old count.
 *   It misses a size written in CSS, in `style={{ fontSize }}` and any class built at run time.
 * - `chip-like` finds a lowercase JSX element (never a component, so `<Chip>`, `<Badge>` and
 *   `<Button>` pass) whose class strings together hold a fixed height of h-3 to h-7, a
 *   horizontal padding, and a `bg-*` or `rounded*` class. It cannot tell one branch of a
 *   ternary from another, so a conditional class that never co-occurs still counts; it does
 *   not read a class from a `.css` file, and a fixed-height row or tab that is not a chip but
 *   has padding and a hover background is a false positive. An element that is not a chip but
 *   has to look like one carries no exemption: take it to review, then count it as debt.
 *   A `<div>` is skipped unless it sets an `inline-*` display: measured on 2026-11-03, the one
 *   hit in the tree was a full-width `<div>` row (`project-rail-parked.tsx`), and a block
 *   `<div>` is a row far more often than a chip. A chip drawn as a block `<div>` is missed.
 */

const REM_PX = 16;
const MIN_TEXT_PX = 12;
/** h-3 to h-7 on Tailwind's 4px step: the heights a chip-like element may not draw by hand. */
const CHIP_HEIGHT_PX = { min: 12, max: 28 } as const;
/** Named steps of `src/ui/type-scale.css` that sit under 12px. */
const SMALL_STEPS: ReadonlySet<string> = new Set(["2xs", "3xs"]);

/** A class token without its variants (`md:hover:bg-muted` → `bg-muted`) and `!` or `-` prefix. */
const utility = (token: string): string =>
  token.slice(token.lastIndexOf(":") + 1).replace(/^[!-]/, "");

const toPx = (value: number, unit: string): number => (unit === "px" ? value : value * REM_PX);

/** The size in px a `text-…` utility sets when it is a font size under 12, else undefined. */
function smallTextPx(name: string): number | undefined {
  const step = /^text-(\w+)$/.exec(name)?.[1];
  if (step !== undefined && SMALL_STEPS.has(step)) return step === "2xs" ? 11 : 10;
  const arbitrary = /^text-\[(\d*\.?\d+)(px|rem|em)\]$/.exec(name);
  if (!arbitrary) return undefined;
  const px = toPx(Number(arbitrary[1]), arbitrary[2]);
  return px < MIN_TEXT_PX ? px : undefined;
}

function isChipHeight(name: string): boolean {
  const scale = /^h-(\d+(?:\.\d+)?)$/.exec(name);
  if (scale) {
    const px = Number(scale[1]) * 4;
    return px >= CHIP_HEIGHT_PX.min && px <= CHIP_HEIGHT_PX.max;
  }
  const arbitrary = /^h-\[(\d*\.?\d+)(px|rem)\]$/.exec(name);
  if (!arbitrary) return false;
  const px = toPx(Number(arbitrary[1]), arbitrary[2]);
  return px >= CHIP_HEIGHT_PX.min && px <= CHIP_HEIGHT_PX.max;
}

const isHorizontalPadding = (name: string): boolean => /^p[xlrse]-/.test(name);
const isFillOrRound = (name: string): boolean => /^bg-/.test(name) || /^rounded(-|$)/.test(name);

/** Every static piece of text under a node: string literals and the text parts of templates. */
function stringsUnder(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
    out.push(node.text);
  // A callback that returns a value ends forEachChild early, so the braces matter.
  ts.forEachChild(node, (child) => {
    stringsUnder(child, out);
  });
  return out;
}

const tokensOf = (strings: readonly string[]): string[] =>
  strings.flatMap((text) => text.split(/\s+/)).filter((token) => token !== "");

const CLASS_ATTRIBUTES: ReadonlySet<string> = new Set(["class", "className"]);

/** The element's tag when it is an intrinsic element other than a form control, else undefined. */
function plainTag(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string | undefined {
  const name = node.tagName;
  if (!ts.isIdentifier(name) || !/^[a-z]/.test(name.text)) return undefined;
  return ["button", "input", "select", "textarea"].includes(name.text) ? undefined : name.text;
}

/** Every `small-text` and `chip-like` hit in a `.tsx` source, in the syntax tree. */
export function findCompositionHits(source: string): CompositionHit[] {
  const sf = ts.createSourceFile(
    "composition.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const hits: CompositionHit[] = [];

  const visit = (node: ts.Node): void => {
    // A literal that is the class text, anywhere: a `cva` base, a const, an attribute.
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (literal) {
      for (const token of tokensOf([node.text])) {
        const px = smallTextPx(utility(token));
        if (px !== undefined)
          hits.push({ rule: "small-text", line: lineOf(node), detail: `${token} (${px}px)` });
      }
    }

    const element = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
    const tag = element ? plainTag(node) : undefined;
    if (element && tag !== undefined) {
      const attribute = node.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          ts.isIdentifier(property.name) &&
          CLASS_ATTRIBUTES.has(property.name.text),
      );
      const names = attribute?.initializer
        ? tokensOf(stringsUnder(attribute.initializer)).map(utility)
        : [];
      const height = names.find(isChipHeight);
      const blockDiv = tag === "div" && !names.some((name) => name.startsWith("inline"));
      if (height && !blockDiv && names.some(isHorizontalPadding) && names.some(isFillOrRound))
        hits.push({ rule: "chip-like", line: lineOf(node), detail: `<${tag}> ${height}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}
