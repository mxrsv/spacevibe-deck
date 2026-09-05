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
 * The release run this preflight guards is described in
 * docs/operations/release.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const CONFIG_PATH = new URL("../electron-builder.release.yml", import.meta.url);

/**
 * The three credential sets `MacTargetHelper.getNotarizeOptions` accepts, in the
 * order it tries them. Any ONE complete set is enough, so this must not demand
 * the first: a local run authenticates through a `notarytool store-credentials`
 * keychain profile precisely so the password never reaches a command line,
 * while CI passes the app-specific password as environment variables.
 */
const CREDENTIAL_SETS = [
  {
    label: "app-specific password",
    names: ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
  },
  {
    label: "App Store Connect API key",
    names: ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
  },
  { label: "keychain profile", names: ["APPLE_KEYCHAIN_PROFILE"] },
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

const isSet = (name) => Boolean(process.env[name]?.trim());
// A set counts as chosen once ANY of its names is present, so a half-filled set
// is reported as the specific gap it is rather than as "no credentials at all".
const started = CREDENTIAL_SETS.filter((set) => set.names.some(isSet));
if (started.length === 0) {
  problems.push(
    `no notarization credentials: set one of ${CREDENTIAL_SETS.map(
      (set) => `${set.names.join(" + ")} (${set.label})`,
    ).join(", or ")}`,
  );
} else if (!started.some((set) => set.names.every(isSet))) {
  for (const set of started) {
    const missing = set.names.filter((name) => !isSet(name));
    problems.push(`${set.label} is incomplete: missing ${missing.join(", ")}`);
  }
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
  identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
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
  console.error(`Electron release signing is not configured: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("Electron release signing is configured.");
