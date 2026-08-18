/**
 * Refuse to start a signed release build that cannot possibly finish.
 *
 * Modelled on `verify-macos-release-signing.mjs`, which does the same job for
 * the Tauri path. The variable names differ on purpose, and that difference is
 * the whole reason this script exists: app-builder-lib reads
 * APPLE_APP_SPECIFIC_PASSWORD (MacTargetHelper.getNotarizeOptions), while
 * Tauri's workflow reads APPLE_PASSWORD. A run that forgets the mapping builds
 * and signs for ten minutes and only then fails, at notarization.
 *
 * It also reads the keychain, because a missing identity does NOT fail a
 * build: electron-builder logs `skipped macOS application code signing` and
 * produces an unsigned app that looks like a successful release.
 *
 * The config is matched as text — `yaml` is not a declared dependency of this
 * repo, and adding one is a Forks decision in AGENTS.md.
 *
 * Plan: docs/plans/2026-08-18-gate-a-electron-signing.md (Task 4)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const CONFIG_PATH = new URL("../electron-builder.release.yml", import.meta.url);
const REQUIRED_ENV = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];
const SIGNING_IDENTITY_PREFIX = "Developer ID Application";

/** The config's own lines, without comments — those describe the very keys
 *  this script looks for, so matching the raw file would read the prose. */
function directives(source) {
  return source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

const problems = [];

const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  problems.push(`missing ${missing.join(", ")}`);
}

let config = "";
try {
  config = readFileSync(CONFIG_PATH, "utf8");
} catch (error) {
  problems.push(`cannot read electron-builder.release.yml: ${error.message}`);
}

if (config) {
  const lines = directives(config);
  if (lines.some((line) => line.trim() === "identity: null")) {
    problems.push("electron-builder.release.yml selects ad-hoc signing");
  }
  if (lines.some((line) => line.trim() === "notarize: false")) {
    problems.push("electron-builder.release.yml disables notarization");
  }
  const entitlements = lines
    .map((line) => /^\s*entitlements:\s*(\S+)\s*$/.exec(line)?.[1])
    .find(Boolean);
  if (!entitlements) {
    problems.push("electron-builder.release.yml declares no entitlements file");
  } else if (!existsSync(new URL(`../${entitlements}`, import.meta.url))) {
    problems.push(`entitlements file is missing: ${entitlements}`);
  }
}

// `security` exits non-zero when no keychain is readable at all, which is a
// different failure from an empty identity list and is worth saying out loud.
let identities = "";
try {
  identities = execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
} catch (error) {
  problems.push(`could not read the keychain: ${error.message}`);
}
if (identities && !identities.includes(SIGNING_IDENTITY_PREFIX)) {
  problems.push(
    `no "${SIGNING_IDENTITY_PREFIX}" identity is in the keychain — ` +
      "electron-builder would skip signing and produce an unsigned app",
  );
}

if (problems.length > 0) {
  console.error(
    `Electron release signing is not configured: ${problems.join("; ")}`,
  );
  process.exit(1);
}
console.log("Electron release signing is configured.");
