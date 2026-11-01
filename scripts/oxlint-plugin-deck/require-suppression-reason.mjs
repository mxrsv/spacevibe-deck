// R9: a suppressed lint or type error says why, so the next reader can tell a
// deliberate exception from a silenced bug. The reason is the directive's own
// `-- reason`, or a comment on its own line directly above it.

const LINT = /^\s*\*?\s*(?:oxlint|eslint)-(disable(?:-next-line|-line)?|enable)\b/;
const TYPES = /^\s*\*?\s*@ts-(?:expect-error|ignore|nocheck)\b(.*)$/s;
const DASH_REASON = /\s--\s*\S/;

/** Text after a `@ts-*` directive, without the separator people put before it. */
const typeReason = (rest) => rest.replace(/^[\s:\-–—]+/, "").trim();

function needsReason(comment) {
  const lint = LINT.exec(comment.value);
  if (lint) return lint[1] !== "enable" && !DASH_REASON.test(comment.value);
  const types = TYPES.exec(comment.value);
  return types !== null && typeReason(types[1]) === "";
}

const isSuppression = (comment) => LINT.test(comment.value) || TYPES.test(comment.value);
const isEmpty = (comment) => comment.value.replace(/[\s*]/g, "") === "";

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Require every lint or type-checker suppression to say why." },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const all = sourceCode.getAllComments();
        // Comments that start their line, keyed by the line they end on.
        const standalone = new Map();
        for (const comment of all) {
          const lead = (sourceCode.lines[comment.loc.start.line - 1] ?? "").slice(
            0,
            comment.loc.start.column,
          );
          if (lead.trim() === "") standalone.set(comment.loc.end.line, comment);
        }
        // Stacked directives share the explanation above the first of them.
        const hasCommentAbove = (comment) => {
          let line = comment.loc.start.line - 1;
          while (standalone.has(line)) {
            const above = standalone.get(line);
            if (!isSuppression(above) && !isEmpty(above)) return true;
            line = above.loc.start.line - 1;
          }
          return false;
        };
        for (const comment of all) {
          if (!needsReason(comment) || hasCommentAbove(comment)) continue;
          context.report({
            loc: comment.loc,
            message:
              "Say why: end the directive with `-- reason`, or put a comment on the line above.",
          });
        }
      },
    };
  },
};
