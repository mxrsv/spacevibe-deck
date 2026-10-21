// R10: a test that does not run names the issue that tracks it, so a red test is fixed
// rather than switched off to make a run green. `skipIf` / `runIf` are platform gates,
// not skips, and stay allowed.

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_FUNCTIONS = new Set(["it", "test", "describe", "suite", "bench"]);
const MODIFIERS = new Set(["skip", "only", "todo"]);
const PREFIXED = new Set(["xit", "xtest", "xdescribe", "fit", "fdescribe"]);
const ISSUE = /#\d+|https?:\/\//;

const propertyName = (node) => {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }
  return undefined;
};

// `it.concurrent.skip.each(...)` and `describe.each(rows).skip` both start at `it`/`describe`.
const chainRoot = (node) => {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "CallExpression") {
    current = current.type === "MemberExpression" ? current.object : current.callee;
  }
  return current.type === "Identifier" ? current.name : undefined;
};

const enclosingStatement = (node) => {
  let current = node;
  while (current.parent && !/(?:Statement|Declaration)$/.test(current.type)) {
    current = current.parent;
  }
  return current;
};

const enabledModifier = (argument) =>
  argument?.type === "ObjectExpression" &&
  argument.properties.some(
    (property) =>
      property.type === "Property" &&
      property.key.type === "Identifier" &&
      MODIFIERS.has(property.key.name) &&
      property.value.type === "Literal" &&
      property.value.value === true,
  );

export default {
  meta: {
    type: "problem",
    docs: { description: "Require a tracking issue above a skipped, focused or todo test." },
  },
  create(context) {
    if (!TEST_FILE.test(context.filename)) return {};

    const reportUnlessTracked = (node) => {
      const comments = context.sourceCode.getCommentsBefore(enclosingStatement(node));
      if (comments.some((comment) => ISSUE.test(comment.value))) return;
      context.report({
        node,
        message: "Name the issue that tracks this on the line above: `// skip: #123 <why>`.",
      });
    };

    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === undefined || !MODIFIERS.has(name)) return;
        if (!TEST_FUNCTIONS.has(chainRoot(node.object))) return;
        reportUnlessTracked(node);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && PREFIXED.has(node.callee.name)) {
          reportUnlessTracked(node);
          return;
        }
        // `it(name, { skip: true }, fn)` is the options spelling of `it.skip`.
        if (!TEST_FUNCTIONS.has(chainRoot(node.callee))) return;
        if (node.arguments.some(enabledModifier)) reportUnlessTracked(node);
      },
    };
  },
};
