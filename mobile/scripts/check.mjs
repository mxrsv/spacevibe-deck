// `npm run mobile:check` (from the root) or `npm run check` (from mobile/): everything the root's
// lint, typecheck and test steps do, for the phone companion's packages, which the root tooling
// deliberately skips (.oxlintrc.json, .prettierignore, the `test` script). Each package under
// mobile/ that has a `check` script runs it after the shared protocol's own steps.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGES = ["relay", "app"];

function run(label, command, args, cwd = root) {
  console.log(`\nmobile:check → ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`mobile:check: ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(path.join(root, "node_modules"))) {
  console.error(
    "mobile:check: mobile/ is not installed; run `npm --prefix mobile run setup` first",
  );
  process.exit(1);
}

run("prettier", "npx", ["prettier", "--check", "."]);
run("oxlint", "npx", ["oxlint", "-c", ".oxlintrc.json", "--deny-warnings", "protocol", "scripts"]);
run("tsc protocol", "npx", ["tsc", "-p", "protocol/tsconfig.json"]);
run("tsc protocol core (no Node types)", "npx", ["tsc", "-p", "protocol/tsconfig.core.json"]);
run("vitest protocol", "npx", ["vitest", "run"]);

for (const name of PACKAGES) {
  const dir = path.join(root, name);
  const manifest = path.join(dir, "package.json");
  if (!existsSync(manifest)) continue;
  const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
  if (scripts.check === undefined) continue;
  if (!existsSync(path.join(dir, "node_modules"))) {
    console.error(
      `mobile:check: mobile/${name} is not installed; run \`npm --prefix mobile run setup\``,
    );
    process.exit(1);
  }
  run(`${name} check`, "npm", ["run", "check"], dir);
}
console.log("\nmobile:check: all green");
