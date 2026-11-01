// R11: text sizes come from the named scale in src/ui/type-scale.css, so a size written at a
// use site (`text-[11px]`) cannot erode it. Uses that predate the rule are debt, counted per
// file in DEBT_FILE: a file may hold at most its count, and a count that falls must be lowered.

import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const DEBT_FILE = "scripts/oxlint-plugin-deck/arbitrary-font-size-debt.txt";

const ARBITRARY_SIZE = /text-\[[0-9.]+(?:px|rem|em)\]/g;
const TEST_FILE = /\.(?:test|spec)\.tsx$/;
// Upstream-generated controls, and a fake web page whose sizes are page content, not Deck chrome.
const IGNORED = [
  /^src\/ui\/controls\//,
  /^src\/gallery\/layout-mocks\/surfaces\/browser\/browser-page\.tsx$/,
];
const SCALE =
  "a type-scale step from src/ui/type-scale.css (`text-3xs`, `text-2xs`, `text-xs`, ...)";

const debtByRoot = new Map();

/** `path count` per line; blank lines and `#` comments are skipped. A missing file is no debt. */
function readDebt(root) {
  if (!debtByRoot.has(root)) {
    const debt = new Map();
    let text = "";
    try {
      text = readFileSync(join(root, DEBT_FILE), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const line of text.split("\n")) {
      const entry = /^\s*([^#\s]\S*)\s+(\d+)\s*$/.exec(line);
      if (entry) debt.set(entry[1], Number(entry[2]));
    }
    debtByRoot.set(root, debt);
  }
  return debtByRoot.get(root);
}

const countSizes = (text) => text.match(ARBITRARY_SIZE)?.length ?? 0;

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid arbitrary font sizes such as `text-[11px]` in Deck's UI." },
  },
  create(context) {
    const path = relative(context.cwd, context.filename).split(sep).join("/");
    if (!path.startsWith("src/") || !path.endsWith(".tsx") || TEST_FILE.test(path)) return {};
    if (IGNORED.some((pattern) => pattern.test(path))) return {};

    const allowed = readDebt(context.cwd).get(path) ?? 0;
    const found = [];
    let total = 0;
    const collect = (node, text) => {
      const count = countSizes(text);
      if (count === 0) return;
      found.push(node);
      total += count;
    };

    return {
      Literal(node) {
        if (typeof node.value === "string") collect(node, node.value);
      },
      TemplateLiteral(node) {
        collect(node, node.quasis.map((quasi) => quasi.value.raw).join(" "));
      },
      "Program:exit"(program) {
        if (total > allowed) {
          const message =
            allowed === 0
              ? `Use ${SCALE}, not an arbitrary font size.`
              : `This file has ${total} arbitrary font sizes and ${DEBT_FILE} allows ${allowed}. Use ${SCALE}.`;
          for (const node of found) context.report({ node, message });
        } else if (total < allowed) {
          const update = total === 0 ? "remove its line" : `lower its count to ${total}`;
          context.report({
            node: program,
            message: `Arbitrary font sizes in this file fell to ${total}; ${update} in ${DEBT_FILE}.`,
          });
        }
      },
    };
  },
};
