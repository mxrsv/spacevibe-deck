import { describe, expect, it } from "vitest";
import { parseWorkerEnvelope, WORKER_BLOCKED_HEADER, WORKER_DONE_HEADER } from "./envelope";
import { ORCHESTRATE_SKILL } from "./orchestrate-skill";

/** Every fenced block of the guide, fences excluded, in order. */
function fencedBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let open: string[] | null = null;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (open) blocks.push(open.join("\n"));
      open = open ? null : [];
    } else if (open) {
      open.push(line);
    }
  }
  return blocks;
}

/** The body of numbered section `n`, from its `## n.` heading to the next heading. */
function section(n: number): string {
  const lines = ORCHESTRATE_SKILL.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${n}. `));
  expect(start, `section ${n} exists`).toBeGreaterThanOrEqual(0);
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  return lines.slice(start, length < 0 ? undefined : start + 1 + length).join("\n");
}

const DONE_KEYS = ["task", "summary", "files", "checks", "handoff"];
const BLOCKED_KEYS = ["task", "reason", "needs"];

describe("ORCHESTRATE_SKILL", () => {
  it("has the nine numbered sections, in order", () => {
    const numbers = [...ORCHESTRATE_SKILL.matchAll(/^## (\d+)\. \S/gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("puts each command in the section that uses it", () => {
    expect(section(1)).toContain("deck status");
    expect(section(4)).toContain("deck worktree create --repo");
    expect(section(4)).toContain("deck pane open --cwd");
    expect(section(6)).toContain("deck pane wait <id> --for turn");
    expect(section(6)).toContain("deck pane read");
    expect(section(6)).toContain("--envelope");
    expect(section(6)).toContain("deck pane send");
    expect(section(9)).toContain("deck pane close");
  });

  it("names every command a coordinator needs", () => {
    for (const command of [
      "deck status",
      "deck worktree create",
      "deck pane open",
      "deck pane send",
      "deck pane read",
      "deck pane wait",
      "deck pane close",
      "deck skill orchestrate",
    ]) {
      expect(ORCHESTRATE_SKILL, command).toContain(command);
    }
  });

  it("prints a task table with the specified columns and statuses", () => {
    const table = section(2);
    for (const column of ["task id", "dependencies", "worktree", "pane", "status", "result"]) {
      expect(table, column).toContain(column);
    }
    for (const status of ["pending", "ready", "running", "completed", "blocked", "failed"]) {
      expect(table, status).toContain(`\`${status}\``);
    }
  });

  it("makes the user's go a stop before anything is opened", () => {
    expect(section(3)).toMatch(/Stop\./);
    expect(section(3)).toMatch(/go in your own pane/);
    expect(section(3)).toMatch(/Never nest/);
  });

  it("gives the worker brief every field and pastes the repository rules", () => {
    const brief = fencedBlocks(section(5)).find((block) => block.startsWith("Task:"));
    expect(brief).toBeDefined();
    for (const field of [
      /^Task: <task id>/m,
      /^Objective:/m,
      /^You may change only:/m,
      /^Acceptance criteria.*command that verifies/m,
      /^Prior findings/m,
      /^Repository rules:/m,
      /do not touch any file outside/,
      /sees only your final output/,
      /exactly one of the two blocks/,
    ]) {
      expect(brief, String(field)).toMatch(field);
    }
    expect(section(5)).toMatch(/paste the rules/);
  });

  it("carries both envelope formats in fenced blocks with every required key", () => {
    const blocks = fencedBlocks(ORCHESTRATE_SKILL);
    const done = blocks.find((block) => block.startsWith(WORKER_DONE_HEADER));
    const blocked = blocks.find((block) => block.startsWith(WORKER_BLOCKED_HEADER));
    expect(done).toBeDefined();
    expect(blocked).toBeDefined();
    for (const key of DONE_KEYS) expect(done, key).toMatch(new RegExp(`^${key}: `, "m"));
    for (const key of BLOCKED_KEYS) expect(blocked, key).toMatch(new RegExp(`^${key}: `, "m"));
  });

  it("keeps the envelope formats readable by the parser", () => {
    const blocks = fencedBlocks(ORCHESTRATE_SKILL);
    const done = blocks.find((block) => block.startsWith(WORKER_DONE_HEADER)) ?? "";
    const blocked = blocks.find((block) => block.startsWith(WORKER_BLOCKED_HEADER)) ?? "";
    // The verbatim template is the brief's own placeholder text, so the parser skips it ...
    expect(parseWorkerEnvelope(done)).toBeNull();
    expect(parseWorkerEnvelope(blocked)).toBeNull();
    // ... and the same block with its placeholders filled in is a result.
    const fill = (block: string) => block.replace(/<[^>]*>/g, "T1");
    expect(parseWorkerEnvelope(fill(done))).toMatchObject({ kind: "done", task: "T1" });
    expect(parseWorkerEnvelope(fill(blocked))).toMatchObject({ kind: "blocked", task: "T1" });
  });

  it("waits for the worker's turn to end and checks the task id it gets back", () => {
    expect(section(6)).toMatch(/--for turn` returns once the worker's turn has ended/);
    expect(section(6)).toMatch(/envelope's `task` is the id you sent/);
    expect(section(6)).not.toMatch(/--for (idle|needs-you)/);
  });

  it("opens a worker without a prompt, waits for idle and hands a first-run question to the user", () => {
    const opening = section(4);
    const open = opening.match(/^deck pane open .*$/m)?.[0] ?? "";
    expect(open).toContain("--cwd");
    expect(open).not.toContain("--prompt");
    expect(opening).toContain("deck pane wait <pane id> --for idle");
    expect(opening).toMatch(/deck pane read <pane id>/);
    expect(opening).toMatch(/first-run question/);
    expect(opening).toMatch(/do not answer it with `send`: it may be a menu/);
    expect(opening).toMatch(/ask them to answer it there themselves/);
    expect(opening).toMatch(/send nothing until they have/);
    expect(opening).toMatch(/repeat `wait --for idle` and `read`/);
    // The brief goes in only afterwards, through the here-document path.
    expect(opening).toContain("deck pane send <pane id> --stdin <<'BRIEF'");
    expect(opening.indexOf("--for idle")).toBeLessThan(opening.indexOf("deck pane send"));
    expect(opening).toMatch(
      /`open --prompt` types the brief as soon as the agent first reads idle/,
    );
    expect(opening).toMatch(/only for an agent you know asks nothing on first run/);
  });

  it("explains pasted and stale, and never resends the same text", () => {
    const loop = section(6);
    expect(loop).toMatch(/`pasted` means the text sits in the input/);
    expect(loop).toMatch(/`stale`.*exit 1.*unsubmitted/);
    // A stale send may never have typed anything, so "do not resend" holds only for text in the input.
    expect(loop).toMatch(/was never typed if it came before/);
    expect(loop).toMatch(
      /read the pane\. If the text is in the input, ask the user to answer any question there themselves/,
    );
    expect(loop).toMatch(/never send the same text again/);
    expect(loop).toMatch(/If the input is empty after a `stale`, .*treat the task as `failed`/);
    expect(loop).toContain("no turn started after the send");
  });

  it("sends blocked work to the user and never answers for a worker", () => {
    expect(section(7)).toContain("DECK_WORKER_BLOCKED");
    expect(section(7)).toContain("`requested`");
    expect(section(7)).toMatch(/Never answer for a worker/);
  });

  it("keeps worker claims apart from the checks the coordinator ran", () => {
    expect(section(8)).toMatch(/run every acceptance command/);
    expect(section(8)).toMatch(/worker's claims/);
    expect(section(8)).toMatch(/checks you ran/);
  });

  it("leaves merging to the user and closes workers only when asked", () => {
    expect(section(9)).toMatch(/Deck does not merge/);
    expect(section(9)).toMatch(/only when the user asks/);
  });

  it("says a close without --force asks the user, and when --force skips it", () => {
    const finish = section(9);
    expect(finish).toMatch(/refused without `--force`/);
    expect(finish).toMatch(/normal close dialog/);
    expect(finish).toMatch(/waits for their answer/);
    expect(finish).toMatch(/`--force` closes without asking/);
    expect(finish).toMatch(/only when the user says so/);
  });

  it("mentions the repository's AGENTS.md", () => {
    expect(ORCHESTRATE_SKILL).toContain("AGENTS.md");
  });

  it.each(["superset", "paradev", "orca", "warp", "cursor", "conductor"])(
    "does not name the product %s",
    (name) => {
      expect(ORCHESTRATE_SKILL.toLowerCase()).not.toContain(name);
    },
  );

  it("stays under 16 KiB", () => {
    expect(new TextEncoder().encode(ORCHESTRATE_SKILL).length).toBeLessThan(16 * 1024);
  });
});
