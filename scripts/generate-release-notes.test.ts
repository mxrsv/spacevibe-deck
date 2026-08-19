import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPreviousReleaseTag,
  formatReleaseNotesForChannel,
  generateReleaseNotes,
  markPreBaselineCommits,
  readReleaseCommits,
} from "./generate-release-notes.mjs";

const SCRIPT = fileURLToPath(new URL("./generate-release-notes.mjs", import.meta.url));
const temporaryRepositories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, subject: string, body?: string): string {
  const messageArgs = body === undefined ? ["-m", subject] : ["-m", subject, "-m", body];
  git(cwd, "commit", "--allow-empty", ...messageArgs);
  return git(cwd, "rev-parse", "HEAD");
}

function releaseCommit(sha: string, subject: string, releaseNote?: string, extraBody = "") {
  const note = releaseNote === undefined ? "" : `Release-Note: ${releaseNote}`;
  const footer =
    note !== "" && /^BREAKING(?: |-)CHANGE:/u.test(extraBody)
      ? `${note}\n${extraBody}`
      : [extraBody, note].filter(Boolean).join("\n\n");
  return {
    sha,
    subject,
    body: [subject, footer].filter(Boolean).join("\n\n"),
  };
}

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "deck-release-notes-"));
  temporaryRepositories.push(cwd);
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "release@example.com");
  return cwd;
}

afterEach(() => {
  for (const cwd of temporaryRepositories.splice(0)) {
    rmSync(cwd, { recursive: true, force: true });
  }
});

describe("generateReleaseNotes", () => {
  const commits = [
    releaseCommit("1", "feat(prompt-board): add catalog", "Reuse saved prompts from the chrome"),
    releaseCommit("2", "fix: restore Windows text paste", "Paste text and folder paths on Windows"),
    releaseCommit(
      "3",
      "perf(terminal): reduce rendering",
      "Keep inactive panes responsive with less rendering work",
    ),
    releaseCommit("4", "docs: document the release process"),
    releaseCommit("5", "refactor(settings): split the settings store"),
    releaseCommit("6", "chore(release): bump version to 0.13.0"),
  ];

  it("groups explicit public release-note trailers and humanizes scopes", () => {
    expect(generateReleaseNotes(commits, { channel: "stable" })).toBe(
      [
        "## New features",
        "",
        "- **Prompt board:** Reuse saved prompts from the chrome",
        "",
        "## Fixes",
        "",
        "- Paste text and folder paths on Windows",
        "",
        "## Performance improvements",
        "",
        "- **Terminal:** Keep inactive panes responsive with less rendering work",
        "",
      ].join("\n"),
    );
  });

  it("uses the same change sections after the Windows distribution warning", () => {
    const stable = generateReleaseNotes(commits, { channel: "stable" });
    const preview = generateReleaseNotes(commits, {
      channel: "windows-preview",
    });

    expect(preview).toContain(
      "**Unsigned Windows Preview** — this is not the stable Windows channel.",
    );
    expect(preview).toContain("Windows may show SmartScreen or `Unknown publisher`");
    expect(preview).not.toContain("> [!WARNING]");
    expect(preview).toContain("before installation.\n\n## New features");
    expect(preview.endsWith(stable)).toBe(true);
  });

  it("publishes breaking markers and BREAKING CHANGE footers separately", () => {
    const notes = generateReleaseNotes(
      [
        releaseCommit("1", "feat(ui)!: replace the pane controls", "Replace the pane controls."),
        releaseCommit(
          "2",
          "refactor(settings): remove legacy storage",
          "Existing custom-agent settings must be saved again.",
          "BREAKING CHANGE: Internal storage migration detail.",
        ),
      ],
      { channel: "stable" },
    );

    expect(notes).toContain("## Breaking changes");
    expect(notes).toContain("- **UI:** Replace the pane controls");
    expect(notes).toContain("- **Settings:** Existing custom-agent settings must be saved again.");
    expect(notes).not.toContain("## New features");
  });

  it("uses the public Release-Note for breaking commits and lets skip win", () => {
    const notes = generateReleaseNotes(
      [
        releaseCommit(
          "1",
          "feat(ui)!: replace the pane controls",
          "Use the new pane controls.",
          "BREAKING CHANGE: Internal migration detail.",
        ),
        releaseCommit(
          "2",
          "fix(settings)!: remove internal fallback",
          "skip",
          "BREAKING CHANGE: Internal fallback detail.",
        ),
      ],
      { channel: "stable" },
    );

    expect(notes).toContain("- **UI:** Use the new pane controls.");
    expect(notes).not.toContain("Internal migration detail");
    expect(notes).not.toContain("Internal fallback detail");
  });

  it("still requires Release-Note on breaking feat, fix, and perf commits", () => {
    expect(() =>
      generateReleaseNotes([releaseCommit("1", "feat(ui)!: replace the pane controls")], {
        channel: "stable",
      }),
    ).toThrow("Missing Release-Note trailer for: feat(ui)!: replace the pane controls");
  });

  it("requires Release-Note on breaking commits of every conventional type", () => {
    expect(() =>
      generateReleaseNotes([releaseCommit("1", "refactor(settings)!: replace storage")], {
        channel: "stable",
      }),
    ).toThrow("Missing Release-Note trailer for: refactor(settings)!: replace storage");
  });

  it("does not treat BREAKINGCHANGE typos as release metadata", () => {
    expect(() =>
      generateReleaseNotes(
        [
          releaseCommit(
            "1",
            "docs: include a malformed footer example",
            undefined,
            "BREAKINGCHANGE: Internal typo.",
          ),
        ],
        { channel: "stable" },
      ),
    ).toThrow("No public Release-Note trailers or breaking changes found");
  });

  it("only accepts Release-Note from the final trailer block", () => {
    expect(() =>
      generateReleaseNotes(
        [
          releaseCommit(
            "1",
            "fix(release): reject prose examples",
            undefined,
            "For example:\nRelease-Note: skip\nThis is explanatory prose.",
          ),
        ],
        { channel: "stable" },
      ),
    ).toThrow("Missing Release-Note trailer for: fix(release): reject prose examples");
  });

  it("rejects an empty Release-Note followed by another trailer", () => {
    expect(() =>
      generateReleaseNotes(
        [
          releaseCommit(
            "1",
            "fix(release): reject empty notes",
            undefined,
            "Release-Note:\nSigned-off-by: Deck Maintainer <deck@example.com>",
          ),
        ],
        { channel: "stable" },
      ),
    ).toThrow("Missing Release-Note trailer for: fix(release): reject empty notes");
  });

  it("requires an explicit trailer instead of trusting generic or internal subjects", () => {
    expect(() =>
      generateReleaseNotes(
        [
          releaseCommit("1", "fix: improve reliability"),
          releaseCommit("2", "feat(prompts): add list_prompt_assets client and memory fake"),
          releaseCommit("3", "fix(test): serialize the Windows fixture", "skip"),
        ],
        { channel: "stable" },
      ),
    ).toThrow("Missing Release-Note trailer for: fix: improve reliability");
  });

  it("waives the trailer only for commits marked as predating the policy", () => {
    const notes = generateReleaseNotes(
      [
        {
          ...releaseCommit("1", "feat(window): detach a pane"),
          preBaseline: true,
        },
        releaseCommit(
          "2",
          "fix(terminal): keep text paste",
          "Paste text and folder paths reliably.",
        ),
      ],
      { channel: "stable" },
    );

    expect(notes).toContain("- **Terminal:** Paste text and folder paths reliably.");
    expect(notes).not.toContain("detach a pane");
  });

  it("refuses to publish boilerplate when no user-facing change exists", () => {
    expect(() =>
      generateReleaseNotes(
        [
          releaseCommit("1", "docs: update context"),
          releaseCommit("2", "test(release): cover notes"),
        ],
        { channel: "stable" },
      ),
    ).toThrow("No public Release-Note trailers or breaking changes found");
  });
});

describe("release history", () => {
  it("selects the prior stable source tag and excludes preview/channel tags", () => {
    expect(
      findPreviousReleaseTag(
        [
          "windows-preview-channel",
          "v0.12.3",
          "v0.12.2-windows-preview",
          "v0.12.2",
          "v0.12.2-rc.1",
          "v0.12.1",
        ],
        "v0.12.3",
      ),
    ).toBe("v0.12.2");
  });

  it("uses the prior RC for an RC and falls back to the prior stable tag", () => {
    const tags = ["v0.13.0-rc.2", "v0.13.0-rc.1", "v0.12.3"];

    expect(findPreviousReleaseTag(tags, "v0.13.0-rc.2")).toBe("v0.13.0-rc.1");
    expect(
      findPreviousReleaseTag(
        ["v0.13.0-rc.1", "v0.12.3-windows-preview", "v0.12.3"],
        "v0.13.0-rc.1",
      ),
    ).toBe("v0.12.3");
  });

  it("orders numeric identifiers without JavaScript number rounding", () => {
    expect(
      findPreviousReleaseTag(
        ["v9007199254740993.0.0", "v9007199254740992.0.0"],
        "v9007199254740994.0.0",
      ),
    ).toBe("v9007199254740993.0.0");
  });

  it("reads non-merge commit metadata between the release tags", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    const boardSha = commit(
      cwd,
      "feat(board): add prompt board",
      "Release-Note: Open reusable prompts from the chrome.",
    );

    git(cwd, "switch", "-c", "release-side");
    const fixSha = commit(cwd, "fix: keep pane output");
    git(cwd, "switch", "main");
    const docsSha = commit(cwd, "docs: update context");
    git(cwd, "merge", "--no-ff", "release-side", "-m", "Merge release-side");
    git(cwd, "tag", "v1.1.0");

    const commits = readReleaseCommits(cwd, "v1.0.0", "v1.1.0");
    expect(commits).toHaveLength(3);
    expect(commits).toEqual(
      expect.arrayContaining([
        {
          sha: boardSha,
          subject: "feat(board): add prompt board",
          body: "feat(board): add prompt board\n\nRelease-Note: Open reusable prompts from the chrome.\n",
        },
        {
          sha: fixSha,
          subject: "fix: keep pane output",
          body: "fix: keep pane output\n",
        },
        {
          sha: docsSha,
          subject: "docs: update context",
          body: "docs: update context\n",
        },
      ]),
    );
  });

  it("removes a conventional feature that was reverted before the release", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    const featureSha = commit(
      cwd,
      "feat(ui): add detachable panes",
      "Release-Note: Detach panes into separate windows.",
    );
    commit(cwd, 'Revert "feat(ui): add detachable panes"', `This reverts commit ${featureSha}.`);
    commit(
      cwd,
      "fix(terminal): keep text paste",
      "Release-Note: Paste text and folder paths reliably.",
    );
    git(cwd, "tag", "v1.1.0");

    const commits = readReleaseCommits(cwd, "v1.0.0", "v1.1.0");
    const notes = generateReleaseNotes(commits, { channel: "stable" });

    expect(notes).not.toContain("Detach panes");
    expect(notes).toContain("Paste text and folder paths reliably");
  });

  it("resolves abbreviated revert hashes and restores nested reverts", () => {
    const feature = releaseCommit(
      "1234567890abcdef1234567890abcdef12345678",
      "feat(ui): add detachable panes",
      "Detach panes into separate windows.",
    );
    const firstRevert = {
      sha: "abcdef1234567890abcdef1234567890abcdef12",
      subject: 'Revert "feat(ui): add detachable panes"',
      body: "This reverts commit 1234567.",
    };
    const secondRevert = {
      sha: "fedcba0987654321fedcba0987654321fedcba09",
      subject: 'Revert "Revert feat(ui): add detachable panes"',
      body: "This reverts commit abcdef1.",
    };

    expect(
      generateReleaseNotes([feature, firstRevert, secondRevert], {
        channel: "stable",
      }),
    ).toContain("Detach panes into separate windows");
  });

  it("does not treat a revert sentence in a non-Revert body as an action", () => {
    const feature = releaseCommit(
      "1234567890abcdef1234567890abcdef12345678",
      "feat(ui): add detachable panes",
      "Detach panes into separate windows.",
    );
    const prose = {
      sha: "abcdef1234567890abcdef1234567890abcdef12",
      subject: "docs: explain standard revert messages",
      body: "docs: explain standard revert messages\n\nThis reverts commit 1234567.\n",
    };

    expect(generateReleaseNotes([feature, prose], { channel: "stable" })).toContain(
      "Detach panes into separate windows",
    );
  });

  it("removes commits introduced by a reverted merge", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    git(cwd, "switch", "-c", "feature");
    writeFileSync(join(cwd, "feature.txt"), "detachable panes\n");
    git(cwd, "add", "feature.txt");
    commit(
      cwd,
      "feat(ui): add detachable panes",
      "Release-Note: Detach panes into separate windows.",
    );
    git(cwd, "switch", "main");
    git(cwd, "merge", "--no-ff", "feature", "-m", "Merge feature");
    const mergeSha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "revert", "-m", "1", "--no-edit", mergeSha);
    commit(cwd, "fix(terminal): keep text paste", "Release-Note: Restore Windows text paste.");
    git(cwd, "tag", "v1.1.0");

    const commits = readReleaseCommits(cwd, "v1.0.0", "v1.1.0");
    const notes = generateReleaseNotes(commits, { channel: "stable" });

    expect(notes).not.toContain("Detach panes");
    expect(notes).toContain("Restore Windows text paste");
  });

  it("honors the selected mainline when reverting a merge", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    git(cwd, "switch", "-c", "feature");
    writeFileSync(join(cwd, "feature.txt"), "detachable panes\n");
    git(cwd, "add", "feature.txt");
    commit(
      cwd,
      "feat(ui): add detachable panes",
      "Release-Note: Detach panes into separate windows.",
    );
    git(cwd, "switch", "main");
    writeFileSync(join(cwd, "main.txt"), "main-side setting\n");
    git(cwd, "add", "main.txt");
    commit(
      cwd,
      "fix(settings): keep main-side setting",
      "Release-Note: Keep the main-side setting.",
    );
    git(cwd, "merge", "--no-ff", "feature", "-m", "Merge feature");
    const mergeSha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "revert", "-m", "2", "--no-edit", mergeSha);
    commit(cwd, "fix(terminal): keep text paste", "Release-Note: Restore Windows text paste.");
    git(cwd, "tag", "v1.1.0");

    const commits = readReleaseCommits(cwd, "v1.0.0", "v1.1.0");
    const notes = generateReleaseNotes(commits, { channel: "stable" });

    expect(notes).toContain("Detach panes into separate windows");
    expect(notes).not.toContain("Keep the main-side setting");
    expect(notes).toContain("Restore Windows text paste");
  });
});

describe("Release-Note policy baseline", () => {
  const ABSENT_BASELINE = "0".repeat(40);

  function createBaselineRepository(): { cwd: string; baseline: string } {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    commit(cwd, "feat(window): detach a pane into its own window");
    const baseline = commit(
      cwd,
      "feat(release): require a Release-Note trailer on every user-facing commit",
      "Release-Note: skip",
    );
    return { cwd, baseline };
  }

  it("accepts an untrailered commit that predates the baseline", () => {
    const { cwd, baseline } = createBaselineRepository();
    commit(
      cwd,
      "fix(terminal): keep text paste",
      "Release-Note: Paste text and folder paths reliably.",
    );
    git(cwd, "tag", "v1.1.0");

    const commits = markPreBaselineCommits(
      cwd,
      readReleaseCommits(cwd, "v1.0.0", "v1.1.0"),
      "v1.1.0",
      baseline,
    );

    expect(generateReleaseNotes(commits, { channel: "stable" })).toBe(
      ["## Fixes", "", "- **Terminal:** Paste text and folder paths reliably.", ""].join("\n"),
    );
  });

  it("still rejects an untrailered commit written after the baseline", () => {
    const { cwd, baseline } = createBaselineRepository();
    commit(
      cwd,
      "fix(terminal): keep text paste",
      "Release-Note: Paste text and folder paths reliably.",
    );
    commit(cwd, "feat(toolbar): add the overflow menu");
    git(cwd, "tag", "v1.1.0");

    const commits = markPreBaselineCommits(
      cwd,
      readReleaseCommits(cwd, "v1.0.0", "v1.1.0"),
      "v1.1.0",
      baseline,
    );

    // Exact message: the pre-baseline `feat(window)` commit must not be listed,
    // and the post-baseline one must be.
    expect(() => generateReleaseNotes(commits, { channel: "stable" })).toThrow(
      new Error("Missing Release-Note trailer for: feat(toolbar): add the overflow menu"),
    );
  });

  it("errors instead of exempting when the baseline is outside the history", () => {
    const { cwd } = createBaselineRepository();
    commit(cwd, "feat(toolbar): add the overflow menu");
    git(cwd, "tag", "v1.1.0");
    const commits = readReleaseCommits(cwd, "v1.0.0", "v1.1.0");

    expect(() => markPreBaselineCommits(cwd, commits, "v1.1.0", ABSENT_BASELINE)).toThrow(
      `Release-Note policy baseline ${ABSENT_BASELINE} is not reachable from v1.1.0`,
    );
  });

  it("does not consult the baseline when every commit declares a trailer", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    commit(
      cwd,
      "fix(terminal): keep text paste",
      "Release-Note: Paste text and folder paths reliably.",
    );
    commit(cwd, "docs: update context");
    git(cwd, "tag", "v1.1.0");
    const commits = readReleaseCommits(cwd, "v1.0.0", "v1.1.0");

    // Nothing needs the exemption, so an unreachable baseline is not an error
    // here — this laziness is what keeps the baseline hardcoded with no CLI or
    // environment override to bypass it.
    expect(markPreBaselineCommits(cwd, commits, "v1.1.0", ABSENT_BASELINE)).toBe(commits);
  });
});

describe("formatReleaseNotesForChannel", () => {
  it("reuses approved stable notes for a Windows preview retry", () => {
    const stable = "## Fixes\n\n- Restore Windows text paste.\n";

    expect(formatReleaseNotesForChannel(stable, "windows-preview")).toContain(
      "before installation.\n\n## Fixes\n\n- Restore Windows text paste.",
    );
  });

  it("rejects an empty approved release body", () => {
    expect(() => formatReleaseNotesForChannel("  \n", "stable")).toThrow(
      "Approved release notes are empty",
    );
  });
});

describe("CLI", () => {
  it("derives history from a current tag and writes stable notes to stdout", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    commit(
      cwd,
      "feat(settings): add custom agents",
      "Release-Note: Add custom agent commands from Settings.",
    );
    commit(cwd, "chore(release): bump version");
    git(cwd, "tag", "v1.1.0");
    const sha = git(cwd, "rev-parse", "v1.1.0");

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--sha", sha, "--tag", "v1.1.0", "--channel", "stable"],
      { cwd, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("## New features");
    expect(result.stdout).toContain("- **Settings:** Add custom agent commands from Settings.");
    expect(result.stdout).not.toContain("Bump version");
  });

  it("formats an approved stable body for a legacy Windows retry", () => {
    const cwd = createRepository();
    const notesPath = join(cwd, "stable-release-notes.md");
    writeFileSync(notesPath, "## Fixes\n\n- Restore Windows text paste.\n");

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--body-file", notesPath, "--channel", "windows-preview"],
      { cwd, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("**Unsigned Windows Preview**");
    expect(result.stdout).toContain("Restore Windows text paste");
  });

  it("fails the release when the real policy baseline is outside the checkout", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    commit(cwd, "feat(toolbar): add the overflow menu");
    const sha = git(cwd, "rev-parse", "HEAD");

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--sha", sha, "--tag", "v1.1.0", "--channel", "stable"],
      { cwd, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Release-Note policy baseline d7e99d884910f2c153efab23e8b5abfc2a6d3c6e is not reachable",
    );
  });

  it("accepts a SHA plus its source tag and fails nonzero for empty notes", () => {
    const cwd = createRepository();
    commit(cwd, "feat: initial release");
    git(cwd, "tag", "v1.0.0");
    commit(cwd, "docs: update context");
    const sha = git(cwd, "rev-parse", "HEAD");

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--sha", sha, "--tag", "v1.1.0", "--channel", "windows-preview"],
      { cwd, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No public Release-Note trailers or breaking changes found");
  });
});
