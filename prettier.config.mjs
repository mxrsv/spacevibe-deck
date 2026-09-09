/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [
    {
      // Wrangler reads `.jsonc` with a tolerant parser, but `backend/wrangler.jsonc`
      // is also read by `backend/src/contract.test.mjs` through plain `JSON.parse`,
      // which a trailing comma makes a SyntaxError. Formatting the file at the
      // repo-wide `trailingComma: "all"` therefore turns a green suite red — measured,
      // not assumed. Keeping the deploy config strict JSON keeps both readers working.
      files: "*.jsonc",
      options: { trailingComma: "none" },
    },
  ],
};
