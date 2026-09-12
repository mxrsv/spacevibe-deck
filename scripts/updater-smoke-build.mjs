import { createRequire } from "node:module";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { startOwnedProcess } from "./updater-smoke-process.mjs";
import ts from "typescript";
import builder from "electron-builder";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const ELECTRON_DIST = join(dirname(require.resolve("electron/package.json")), "dist");

async function compileLifecycle(stage) {
  for (const [source, output] of [
    ["electron/updater/updater.ts", "updater.cjs"],
    ["src/updater/update-attempt.ts", "update-attempt.cjs"],
  ]) {
    const { outputText, diagnostics } = ts.transpileModule(
      await readFile(join(REPO, source), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: source,
        reportDiagnostics: true,
      },
    );
    if (diagnostics?.length)
      throw new Error(
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (name) => name,
          getCurrentDirectory: () => REPO,
          getNewLine: () => "\n",
        }),
      );
    await writeFile(join(stage, output), outputText);
  }
}

/** Builds only a test identity, directly into the runner's temporary directory. */
async function packageSmokeApps(config, identity) {
  assert.match(config.appId, /^dev\.spacevibe\.deck\.updater-smoke\.[a-f0-9-]+$/);
  assert.equal(await readFile(join(config.root, "run-id"), "utf8"), config.runId);
  const stage = join(config.root, "source");
  await mkdir(stage);
  await compileLifecycle(stage);
  await cp(new URL("./updater-smoke-app.cjs", import.meta.url), join(stage, "main.cjs"));
  await cp(
    new URL("./updater-smoke-rejection.cjs", import.meta.url),
    join(stage, "updater-smoke-rejection.cjs"),
  );
  await writeFile(join(stage, "smoke-config.json"), JSON.stringify(config));
  // electron-builder collects only electron-updater's production dependency tree.
  await symlink(join(REPO, "node_modules"), join(stage, "node_modules"), "dir");
  const updaterVersion = require("electron-updater/package.json").version;
  const electronVersion = require("electron/package.json").version;
  for (const version of [config.fromVersion, config.toVersion]) {
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify({
        name: config.appId,
        productName: config.productName,
        version,
        main: "main.cjs",
        description: "Isolated Deck updater verification",
        author: "SpaceVibe",
        dependencies: { "electron-updater": updaterVersion },
      }),
    );
    await builder.build({
      projectDir: stage,
      publish: "never",
      targets: builder.Platform.MAC.createTarget(["dir", "zip"], builder.Arch[process.arch]),
      config: {
        appId: config.appId,
        productName: config.productName,
        electronVersion,
        electronDist: ELECTRON_DIST,
        directories: { app: stage, output: join(config.root, version) },
        files: ["*.cjs", "*.json"],
        npmRebuild: false,
        forceCodeSigning: true,
        mac: {
          identity,
          // Test-only signing: no release/notarization or timestamp-service dependency.
          timestamp: "none",
          hardenedRuntime: true,
          entitlements: join(REPO, "build/entitlements.mac.plist"),
          entitlementsInherit: join(REPO, "build/entitlements.mac.plist"),
          notarize: false,
          gatekeeperAssess: false,
          artifactName: "Deck-Updater-Smoke-${version}-${arch}.${ext}",
        },
        publish: [{ provider: "generic", url: config.feedURL }],
      },
    });
  }
}

export async function buildSmokeApps(config, identity, signal) {
  const configPath = join(config.root, "build-config.json");
  await writeFile(configPath, JSON.stringify(config));
  const build = startOwnedProcess(
    process.execPath,
    [fileURLToPath(import.meta.url), configPath, identity],
    { signal },
  );
  await build.completion;
  return {
    oldApp: join(
      config.root,
      config.fromVersion,
      `mac${process.arch === "arm64" ? "-arm64" : ""}`,
      `${config.productName}.app`,
    ),
    feedDirectory: join(config.root, config.toVersion),
  };
}

export function copySmokeInstallation(source, destination) {
  // fs.cp otherwise rewrites framework links to absolute paths in the source
  // build, breaking codesign's sealed bundle and the independence of this copy.
  return cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(async () => {
      const config = JSON.parse(await readFile(process.argv[2], "utf8"));
      await packageSmokeApps(config, process.argv[3]);
    })
    .catch((error) => {
      console.error(error);
      // temp-file's beforeExit hook otherwise replaces a failing exitCode with 0.
      process.exit(1);
    });
}
