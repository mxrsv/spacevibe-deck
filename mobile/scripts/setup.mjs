// Installs each package under mobile/ from its own lockfile (`npm run setup` runs this after the
// shared tooling's own install). `--ci` uses `npm ci`, as the CI job does.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const verb = process.argv.includes("--ci") ? "ci" : "install";
for (const name of ["relay", "app"]) {
  const dir = path.join(root, name);
  if (!existsSync(path.join(dir, "package.json"))) continue;
  console.log(`mobile:setup → npm ${verb} in mobile/${name}`);
  const result = spawnSync("npm", [verb], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
