// Rename the compiled main process to `.cjs`.
//
// The repo is ESM ("type": "module" in package.json), so Node treats a `.js`
// file as an ES module regardless of what is inside it — and tsc emits
// CommonJS here on purpose, because `node-pty` and Electron's own patterns are
// CommonJS-first. Renaming is the smallest fix that keeps the module graph
// consistent; the alternative is an ESM main process that then has to
// interop-import every CJS dependency.
import { readdirSync, renameSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "dist-electron";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (entry.endsWith(".js")) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(ROOT);
for (const file of files) {
  // Rewrite require() targets to the new extension before renaming, or every
  // intra-bundle require resolves to a file that no longer exists.
  let source = readFileSync(file, "utf8");
  source = source.replace(
    /require\((["'])(\.[^"']*?)\1\)/g,
    (match, quote, target) =>
      target.endsWith(".cjs") || target.endsWith(".json")
        ? match
        : `require(${quote}${target}.cjs${quote})`,
  );
  writeFileSync(file, source);
  renameSync(file, file.replace(/\.js$/, ".cjs"));
}
console.log(`renamed ${files.length} files to .cjs`);
