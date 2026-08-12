#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_TAG_PATTERN =
  /^v(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-rc\.(?<rc>[1-9]\d*))?$/;
const CONVENTIONAL_SUBJECT_PATTERN =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^)\r\n]+)\))?(?<breaking>!)?:\s+(?<description>.+)$/;
const SAFE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const RELEASE_NOTE_TRAILER_PATTERN =
  /^Release-Note:[ \t]*(?<description>\S[^\r\n]*)$/iu;
const BREAKING_CHANGE_TRAILER_PATTERN =
  /^BREAKING(?: |-)CHANGE:[ \t]*(?<description>\S[^\r\n]*)$/u;
const REVERT_TARGET_PATTERN =
  /^This reverts commit (?<sha>[0-9a-f]{7,40})(?:, reversing\r?\nchanges made to (?<mainline>[0-9a-f]{7,40}))?\.$/mu;
const TRAILER_LINE_PATTERN =
  /^(?:[A-Za-z][A-Za-z0-9-]*|BREAKING(?: |-)CHANGE):[ \t]*.*$/u;

const SECTION_ORDER = ["feat", "fix", "perf", "breaking"];
const SECTION_HEADINGS = {
  feat: "New features",
  fix: "Fixes",
  perf: "Performance improvements",
  breaking: "Breaking changes",
};
const PUBLIC_RELEASE_TYPES = new Set(["feat", "fix", "perf"]);
// Baseline of the mandatory Release-Note rule. This is
// `feat(release): require a Release-Note trailer on every user-facing commit`,
// the commit that introduced the requirement. Every commit that is an ancestor
// of it was written before the rule existed and is exempt; every commit after it
// is bound by it, so no future change can ship unannounced.
//
// It is expressed as ancestry rather than a date or a list of shas because this
// repository rebases: dates and list positions go stale, `git rev-list` does not.
// The two alternatives were rejected on purpose — backfilling trailers onto the
// commits already published under the old rule means rewriting pushed history,
// and downgrading the rule to a warning deletes the guarantee the gate exists
// for. The baseline is deliberately not overridable from the CLI or the
// environment: a baseline pointing at a later commit would exempt everything
// after it, which is the failure this gate is built to prevent.
const RELEASE_NOTE_POLICY_BASELINE = "d7e99d884910f2c153efab23e8b5abfc2a6d3c6e";
const ACRONYMS = new Map([
  ["api", "API"],
  ["cli", "CLI"],
  ["macos", "macOS"],
  ["nsis", "NSIS"],
  ["osc", "OSC"],
  ["pty", "PTY"],
  ["ui", "UI"],
  ["url", "URL"],
]);
const WINDOWS_PREVIEW_WARNING = [
  "**Unsigned Windows Preview** — this is not the stable Windows channel.",
  "",
  "Windows may show SmartScreen or `Unknown publisher` because this preview has no paid Authenticode certificate. The updater payload still requires Deck's Tauri signature before installation.",
  "",
  "",
].join("\n");

function parseReleaseTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (match?.groups === undefined) {
    return null;
  }
  return {
    tag,
    major: BigInt(match.groups.major),
    minor: BigInt(match.groups.minor),
    patch: BigInt(match.groups.patch),
    rc: match.groups.rc === undefined ? null : BigInt(match.groups.rc),
  };
}

function compareNumericIdentifier(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCore(left, right) {
  return (
    compareNumericIdentifier(left.major, right.major) ||
    compareNumericIdentifier(left.minor, right.minor) ||
    compareNumericIdentifier(left.patch, right.patch)
  );
}

function compareReleaseTags(left, right) {
  const core = compareCore(left, right);
  if (core !== 0) {
    return core;
  }
  if (left.rc === right.rc) {
    return 0;
  }
  if (left.rc === null) {
    return 1;
  }
  if (right.rc === null) {
    return -1;
  }
  return compareNumericIdentifier(left.rc, right.rc);
}

function isPriorRelease(candidate, current) {
  const core = compareCore(candidate, current);
  if (current.rc === null) {
    return candidate.rc === null && core < 0;
  }
  if (core < 0) {
    return candidate.rc === null;
  }
  return core === 0 && candidate.rc !== null && candidate.rc < current.rc;
}

export function findPreviousReleaseTag(tags, currentTag) {
  const current = parseReleaseTag(currentTag);
  if (current === null) {
    throw new Error(`Invalid source release tag: ${currentTag}`);
  }

  const candidates = [...new Set(tags)]
    .map(parseReleaseTag)
    .filter((candidate) => candidate !== null)
    .filter((candidate) => isPriorRelease(candidate, current))
    .sort(compareReleaseTags);
  const previous = candidates.at(-1);

  if (previous === undefined) {
    throw new Error(`No prior release tag found before ${currentTag}`);
  }
  return previous.tag;
}

function humanizeScope(scope) {
  const words = scope
    .trim()
    .split(/[-_/.\s]+/u)
    .filter(Boolean)
    .map((word) => ACRONYMS.get(word.toLowerCase()) ?? word.toLowerCase());
  const phrase = words.join(" ");
  return capitalize(phrase);
}

function capitalize(value) {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function finalTrailerLines(body) {
  const lines = body.trimEnd().split(/\r?\n/u);
  let start = lines.length;
  while (start > 0 && TRAILER_LINE_PATTERN.test(lines[start - 1])) {
    start -= 1;
  }
  if (start === lines.length || start === 0 || lines[start - 1].trim() !== "") {
    return [];
  }
  return lines.slice(start);
}

function trailerDescriptions(body, pattern) {
  return finalTrailerLines(body).flatMap((line) => {
    const match = pattern.exec(line);
    return match?.groups === undefined ? [] : [match.groups.description.trim()];
  });
}

function parseConventionalSubject(subject) {
  const match = CONVENTIONAL_SUBJECT_PATTERN.exec(subject.trim());
  return match?.groups === undefined ? null : match.groups;
}

function parsePublicEntries(commit) {
  const subject = parseConventionalSubject(commit.subject);
  if (subject === null) {
    return [];
  }
  const rawScope = subject.scope?.trim();
  const scope = rawScope === undefined ? null : humanizeScope(rawScope);
  const declaredReleaseNotes = trailerDescriptions(
    commit.body,
    RELEASE_NOTE_TRAILER_PATTERN,
  );
  if (
    declaredReleaseNotes.some(
      (description) => description.toLowerCase() === "skip",
    )
  ) {
    return [];
  }
  const releaseNotes = declaredReleaseNotes;
  const footerBreakingNotes = trailerDescriptions(
    commit.body,
    BREAKING_CHANGE_TRAILER_PATTERN,
  );
  const isBreaking = subject.breaking !== undefined;
  const breakingNotes =
    isBreaking || footerBreakingNotes.length > 0
      ? releaseNotes.length > 0
        ? releaseNotes
        : footerBreakingNotes
      : [];

  if (breakingNotes.length > 0) {
    return breakingNotes.map((description) => ({
      type: "breaking",
      scope,
      description: capitalize(description),
    }));
  }
  if (!PUBLIC_RELEASE_TYPES.has(subject.type)) {
    return [];
  }
  return releaseNotes.map((description) => ({
    type: subject.type,
    scope,
    description: capitalize(description),
  }));
}

function requiresReleaseNote(commit) {
  const subject = parseConventionalSubject(commit.subject);
  if (subject === null) {
    return false;
  }
  const hasBreakingMetadata =
    subject.breaking !== undefined ||
    trailerDescriptions(commit.body, BREAKING_CHANGE_TRAILER_PATTERN).length >
      0;
  return PUBLIC_RELEASE_TYPES.has(subject.type) || hasBreakingMetadata;
}

function declaresReleaseNote(commit) {
  return (
    trailerDescriptions(commit.body, RELEASE_NOTE_TRAILER_PATTERN).length > 0
  );
}

function isUndeclaredPublicCommit(commit) {
  return requiresReleaseNote(commit) && !declaresReleaseNote(commit);
}

function assertPublicCommitTrailers(commits) {
  // `preBaseline` is attached by markPreBaselineCommits to commits that are
  // ancestors of RELEASE_NOTE_POLICY_BASELINE. Anything without the flag — every
  // fabricated commit and every commit written since the rule — stays bound.
  const missing = commits.filter(
    (commit) => commit.preBaseline !== true && isUndeclaredPublicCommit(commit),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing Release-Note trailer for: ${missing.map((commit) => commit.subject).join("; ")}`,
    );
  }
}

function formatEntry(entry) {
  const prefix = entry.scope === null ? "" : `**${entry.scope}:** `;
  return `- ${prefix}${entry.description}`;
}

function revertMetadata(commit) {
  if (!commit.subject.startsWith('Revert "')) {
    return null;
  }
  const match = REVERT_TARGET_PATTERN.exec(commit.body);
  return match?.groups === undefined
    ? null
    : {
        target: match.groups.sha,
        mainline: match.groups.mainline ?? null,
      };
}

function revertTarget(commit) {
  return revertMetadata(commit)?.target ?? null;
}

function resolveCommitSha(commitsBySha, sha) {
  if (commitsBySha.has(sha)) {
    return sha;
  }
  const matches = [...commitsBySha.keys()].filter((candidate) =>
    candidate.startsWith(sha),
  );
  if (matches.length > 1) {
    throw new Error(`Ambiguous reverted commit prefix: ${sha}`);
  }
  return matches[0] ?? null;
}

function setCommitActive(activeShas, commitsBySha, sha, isActive) {
  const resolvedSha = resolveCommitSha(commitsBySha, sha);
  if (resolvedSha === null) {
    return activeShas;
  }
  const nextActiveShas = isActive
    ? [...new Set([...activeShas, resolvedSha])]
    : activeShas.filter((activeSha) => activeSha !== resolvedSha);
  const nestedTargets = commitsBySha.get(resolvedSha)?.revertTargets ?? [];
  return nestedTargets.reduce(
    (current, target) =>
      setCommitActive(current, commitsBySha, target, !isActive),
    nextActiveShas,
  );
}

function activeCommits(commits) {
  const state = commits.reduce(
    (current, commit) => {
      const directTarget = revertTarget(commit);
      const record = {
        ...commit,
        revertTargets:
          commit.revertTargets ?? (directTarget === null ? [] : [directTarget]),
      };
      const commitsBySha = new Map([
        ...current.commitsBySha.entries(),
        [record.sha, record],
      ]);
      const withCurrent = [...current.activeShas, record.sha];
      const activeShas =
        record.revertTargets.length === 0
          ? withCurrent
          : record.revertTargets.reduce(
              (next, target) =>
                setCommitActive(next, commitsBySha, target, false),
              withCurrent,
            );
      return { commitsBySha, activeShas };
    },
    { commitsBySha: new Map(), activeShas: [] },
  );
  const activeSet = new Set(state.activeShas);
  return commits.filter((commit) => activeSet.has(commit.sha));
}

function assertSupportedChannel(channel) {
  if (channel !== "stable" && channel !== "windows-preview") {
    throw new Error(`Unsupported release-note channel: ${channel}`);
  }
}

export function formatReleaseNotesForChannel(stableNotes, channel) {
  assertSupportedChannel(channel);
  const normalized = stableNotes.trim();
  if (normalized.length === 0) {
    throw new Error("Approved release notes are empty");
  }
  if (!/^##\s+\S/mu.test(normalized)) {
    throw new Error("Approved release notes are missing change sections");
  }
  const sections = `${normalized}\n`;
  return channel === "windows-preview"
    ? `${WINDOWS_PREVIEW_WARNING}${sections}`
    : sections;
}

export function generateReleaseNotes(commits, options = {}) {
  const { channel = "stable" } = options;
  assertSupportedChannel(channel);

  const active = activeCommits(commits);
  assertPublicCommitTrailers(active);
  const entries = active.flatMap(parsePublicEntries);
  if (entries.length === 0) {
    throw new Error(
      "No public Release-Note trailers or breaking changes found",
    );
  }

  const sections = SECTION_ORDER.flatMap((type) => {
    const matching = entries.filter((entry) => entry.type === type);
    if (matching.length === 0) {
      return [];
    }
    return [
      `## ${SECTION_HEADINGS[type]}`,
      "",
      ...matching.map(formatEntry),
      "",
    ];
  }).join("\n");

  return formatReleaseNotesForChannel(sections, channel);
}

function assertSafeRevision(revision, label) {
  if (
    !SAFE_REVISION_PATTERN.test(revision) ||
    revision.includes("..") ||
    revision.includes("@{")
  ) {
    throw new Error(`Invalid ${label}: ${revision}`);
  }
}

function runGitRaw(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run git ${args[0]}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit status ${result.status}`;
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
  return result.stdout;
}

function runGit(cwd, args) {
  return runGitRaw(cwd, args).trim();
}

function listMergedTags(cwd, currentRef) {
  assertSafeRevision(currentRef, "release ref");
  const output = runGit(cwd, ["tag", `--merged=${currentRef}`, "--list"]);
  return output === "" ? [] : output.split(/\r?\n/u);
}

function resolveCurrentTag(cwd, currentRef, explicitTag) {
  if (explicitTag !== undefined) {
    if (parseReleaseTag(explicitTag) === null) {
      throw new Error(`Invalid source release tag: ${explicitTag}`);
    }
    return explicitTag;
  }
  if (parseReleaseTag(currentRef) !== null) {
    return currentRef;
  }

  assertSafeRevision(currentRef, "release ref");
  const output = runGit(cwd, ["tag", "--points-at", currentRef, "--list"]);
  const sourceTags = (output === "" ? [] : output.split(/\r?\n/u))
    .map(parseReleaseTag)
    .filter((tag) => tag !== null)
    .sort(compareReleaseTags);
  const resolved = sourceTags.at(-1);
  if (resolved === undefined) {
    throw new Error(
      `No source release tag points at ${currentRef}; pass --tag vX.Y.Z`,
    );
  }
  return resolved.tag;
}

export function readReleaseCommits(cwd, previousTag, currentRef) {
  if (parseReleaseTag(previousTag) === null) {
    throw new Error(`Invalid prior release tag: ${previousTag}`);
  }
  assertSafeRevision(currentRef, "release ref");
  const output = runGitRaw(cwd, [
    "log",
    "--no-merges",
    "--topo-order",
    "--reverse",
    "-z",
    "--format=%H%x00%s%x00%B",
    `${previousTag}..${currentRef}`,
    "--",
  ]);
  if (output === "") {
    return [];
  }
  const fields = output.split("\0").slice(0, -1);
  if (fields.length % 3 !== 0) {
    throw new Error("git log returned malformed release commit metadata");
  }
  const commits = Array.from({ length: fields.length / 3 }, (_, index) => ({
    sha: fields[index * 3],
    subject: fields[index * 3 + 1],
    body: fields[index * 3 + 2],
  }));
  return commits.map((commit) => {
    const metadata = revertMetadata(commit);
    if (metadata === null) {
      return commit;
    }
    const resolved = runGit(cwd, [
      "rev-parse",
      "--verify",
      `${metadata.target}^{commit}`,
    ]);
    const parents = runGit(cwd, ["rev-list", "--parents", "-n", "1", resolved])
      .split(/\s+/u)
      .slice(1);
    if (parents.length < 2) {
      return { ...commit, revertTargets: [resolved] };
    }
    const mainline =
      metadata.mainline === null
        ? parents[0]
        : runGit(cwd, [
            "rev-parse",
            "--verify",
            `${metadata.mainline}^{commit}`,
          ]);
    if (!parents.includes(mainline)) {
      throw new Error(
        `Merge revert ${commit.sha} names a non-parent mainline ${mainline}`,
      );
    }
    const introduced = runGit(cwd, [
      "rev-list",
      "--no-merges",
      `${mainline}..${resolved}`,
    ]);
    return {
      ...commit,
      revertTargets: [
        resolved,
        ...(introduced === "" ? [] : introduced.split(/\r?\n/u)),
      ],
    };
  });
}

function readShaList(cwd, revision) {
  const output = runGit(cwd, ["rev-list", revision]);
  return output === "" ? [] : output.split(/\r?\n/u);
}

function preBaselineShas(cwd, currentRef, baseline) {
  assertSafeRevision(currentRef, "release ref");
  assertSafeRevision(baseline, "Release-Note policy baseline");
  const examined = new Set(readShaList(cwd, currentRef));
  if (!examined.has(baseline)) {
    throw new Error(
      `Release-Note policy baseline ${baseline} is not reachable from ${currentRef}: this history cannot show which commits predate the trailer rule. Check out the full history (fetch-depth: 0) — an unreachable baseline is never treated as an exemption.`,
    );
  }
  return new Set(readShaList(cwd, baseline));
}

export function markPreBaselineCommits(
  cwd,
  commits,
  currentRef,
  baseline = RELEASE_NOTE_POLICY_BASELINE,
) {
  // Only a commit that would otherwise fail the gate needs the exemption, so a
  // release whose user-facing commits all declare a trailer never depends on the
  // baseline being fetched. As soon as one does need it, an unresolvable
  // baseline is a loud error rather than a blanket exemption.
  if (!commits.some(isUndeclaredPublicCommit)) {
    return commits;
  }
  const exempt = preBaselineShas(cwd, currentRef, baseline);
  return commits.map((commit) =>
    exempt.has(commit.sha) ? { ...commit, preBaseline: true } : commit,
  );
}

function parseArguments(argv) {
  let options = {
    channel: "stable",
    currentRef:
      process.env.RELEASE_SOURCE_SHA ?? process.env.GITHUB_SHA ?? "HEAD",
    currentTag: process.env.RELEASE_SOURCE_TAG,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      !["--body-file", "--channel", "--ref", "--sha", "--tag"].includes(
        argument,
      )
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;
    if (argument === "--body-file") {
      options = { ...options, bodyFile: value };
    } else if (argument === "--channel") {
      options = { ...options, channel: value };
    } else if (argument === "--ref" || argument === "--sha") {
      options = { ...options, currentRef: value };
    } else {
      options = { ...options, currentTag: value };
    }
  }
  return options;
}

export function runCli(argv, cwd = process.cwd()) {
  const options = parseArguments(argv);
  if (options.bodyFile !== undefined) {
    const approvedBody = readFileSync(options.bodyFile, "utf8");
    return formatReleaseNotesForChannel(approvedBody, options.channel);
  }
  const currentTag = resolveCurrentTag(
    cwd,
    options.currentRef,
    options.currentTag,
  );
  const previousTag = findPreviousReleaseTag(
    listMergedTags(cwd, options.currentRef),
    currentTag,
  );
  const commits = markPreBaselineCommits(
    cwd,
    readReleaseCommits(cwd, previousTag, options.currentRef),
    options.currentRef,
  );
  return generateReleaseNotes(commits, { channel: options.channel });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.stdout.write(runCli(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`generate-release-notes: ${message}\n`);
    process.exitCode = 1;
  }
}
