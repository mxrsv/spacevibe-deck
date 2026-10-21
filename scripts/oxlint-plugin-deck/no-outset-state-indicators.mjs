// A focus or selection ring painted outside its element is cut off by any ancestor that
// clips: Deck's `#root` is `overflow: clip`, and every list that scrolls clips its rows
// (docs/internals/traps.md, "Layout and CSS"). So under a state variant a ring needs
// `ring-inset` beside it, an outline wider than 2px needs a negative offset at least as
// wide, and a positive outline offset is never allowed.

const COMPOSERS = new Set(["cn", "clsx", "cva", "cx", "classNames", "twMerge"]);
const STATE = /(?:^|\W)(?:focus(?:-visible|-within)?|selected|checked|pressed)(?=$|\W)/;
// `ring-0` paints nothing; it is how a state removes a ring.
const RING = /^ring(?:-(?:[1-9]\d*|\[[^\]]+\]))?$/;
const OUTLINE = /^outline-(?:(\d+)|\[(\d+(?:\.\d+)?)px\])$/;
const INSET_OFFSET = /^-outline-offset-(\d+)$/;
const OUTSET_OFFSET = /^outline-offset-(?:[1-9]|\[)/;

/** `focus-visible:data-[a=b:c]:ring-2` → prefixes `focus-visible`, `data-[a=b:c]`; base `ring-2`. */
function splitVariants(token) {
  const parts = [];
  let nesting = 0;
  let from = 0;
  [...token].forEach((char, at) => {
    if ("[(".includes(char)) nesting += 1;
    if ("])".includes(char)) nesting -= 1;
    if (char === ":" && nesting === 0) {
      parts.push(token.slice(from, at));
      from = at + 1;
    }
  });
  return { prefixes: parts, base: token.slice(from).replace(/^!|!$/g, "") };
}

const classesOf = (text) => text.split(/\s+/).filter(Boolean).map(splitVariants);

/** True when `fix` applies in every state `indicator` does. */
const appliesWith = (fix, indicator) => fix.prefixes.every((p) => indicator.prefixes.includes(p));

function stringsIn(node, into) {
  if (Array.isArray(node)) {
    for (const child of node) stringsIn(child, into);
    return into;
  }
  if (!node || typeof node !== "object") return into;
  if (node.type === "Literal" && typeof node.value === "string") into.push(node.value);
  if (node.type === "TemplateElement") into.push(node.value.cooked ?? node.value.raw);
  for (const key of Object.keys(node)) {
    if (key !== "parent") stringsIn(node[key], into);
  }
  return into;
}

/** Classes passed alongside this string to the same `cn(...)` / `cva(...)` call. */
function neighbours(node) {
  let current = node.parent;
  while (current && !/Statement$|Declaration$|^JSXAttribute$/.test(current.type)) {
    const composer =
      current.type === "CallExpression" &&
      current.callee.type === "Identifier" &&
      COMPOSERS.has(current.callee.name);
    if (composer) return classesOf(stringsIn(current.arguments, []).join(" "));
    current = current.parent;
  }
  return [];
}

function clippedIndicators(text, node) {
  const own = classesOf(text);
  let context;
  const nearby = () => (context ??= own.concat(neighbours(node)));
  const flagged = [];
  for (const cls of own) {
    const name = [...cls.prefixes, cls.base].join(":");
    if (OUTSET_OFFSET.test(cls.base)) {
      flagged.push(name);
    } else if (STATE.test(cls.prefixes.join(":"))) {
      if (RING.test(cls.base)) {
        const inset = nearby().some((fix) => fix.base === "ring-inset" && appliesWith(fix, cls));
        if (!inset) flagged.push(name);
      } else {
        const outline = OUTLINE.exec(cls.base);
        const width = outline ? Number(outline[1] ?? outline[2]) : 0;
        if (width > 2) {
          const pulledIn = nearby().some((fix) => {
            const offset = INSET_OFFSET.exec(fix.base);
            return offset !== null && Number(offset[1]) >= width && appliesWith(fix, cls);
          });
          if (!pulledIn) flagged.push(name);
        }
      }
    }
  }
  return flagged;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Keep focus and selection indicators inside their element." },
  },
  create(context) {
    const check = (node, text) => {
      for (const name of clippedIndicators(text, node)) {
        context.report({
          node,
          message: `${name} paints a focus or selection indicator outside its element, where a clipping ancestor hides it. Add ring-inset under the same variants, drop the positive outline offset, or pull the outline in with a negative offset at least as wide.`,
        });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" "));
      },
    };
  },
};
