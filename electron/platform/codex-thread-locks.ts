/** Codex 0.154's undocumented, open writer locks identify a process before its first prompt. */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { CODEX_RESTORE_SCAN, listCodexFiles, readCodexRecord } from "../resume/codex";
import { isCompressedRollout } from "../usage/compressed-rollout";

const LSOF_TIMEOUT_MS = 1_500;
const LSOF_MAX_BYTES = 4 * 1024 * 1024;
const THREAD_LOCK = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.lock$/i;

export function parseCodexLocks(output: string, home: string): Map<number, readonly string[]> {
  const prefix = `${path.join(home, ".codex", "thread-writer-locks")}/`;
  const locks = new Map<number, readonly string[]>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const value = Number(line.slice(1));
      pid = Number.isSafeInteger(value) && value > 0 ? value : null;
    } else if (pid !== null && line.startsWith(`n${prefix}`)) {
      const match = THREAD_LOCK.exec(line.slice(prefix.length + 1));
      if (match === null) continue;
      const previous = locks.get(pid) ?? [];
      if (!previous.includes(match[1])) locks.set(pid, [...previous, match[1]]);
    }
  }
  return locks;
}

export function selectCodexThread(
  locks: readonly string[],
  interactive: ReadonlySet<string>,
): string | null {
  if (locks.length === 1) return locks[0];
  const mains = locks.filter((id) => interactive.has(id));
  return mains.length === 1 ? mains[0] : null;
}

function readLocks(pids: readonly number[], home: string, platform: NodeJS.Platform) {
  return new Promise<Map<number, readonly string[]>>((resolve) => {
    execFile(
      platform === "darwin" ? "/usr/sbin/lsof" : "lsof",
      ["-nP", "-p", pids.join(","), "-Fpn"],
      { encoding: "utf8", timeout: LSOF_TIMEOUT_MS, maxBuffer: LSOF_MAX_BYTES },
      (error, stdout) => {
        // Partial output cannot prove there was only ONE lock. Fail closed.
        resolve(error ? new Map() : parseCodexLocks(stdout, home));
      },
    );
  });
}

/**
 * The thread each foreground Codex process is writing, keyed by that process's pid.
 * `lookups` maps each foreground pid to other pids whose locks count as its own: npm's `codex`
 * is a `node` launcher, and the lock belongs to the native child it spawned.
 */
export async function processCodexSessions(
  lookups: ReadonlyMap<number, readonly number[]>,
  home = os.homedir(),
  platform = process.platform,
): Promise<Map<number, string>> {
  const valid = (pid: number) => Number.isSafeInteger(pid) && pid > 0;
  const groups = [...lookups]
    .filter(([pid]) => valid(pid))
    .map(([pid, members]) => [pid, [...new Set([pid, ...members.filter(valid)])]] as const);
  if (platform === "win32" || groups.length === 0) return new Map();
  const locks = await readLocks([...new Set(groups.flatMap(([, pids]) => pids))], home, platform);
  const held = new Map(
    groups.map(([pid, pids]) => [
      pid,
      [...new Set(pids.flatMap((member) => locks.get(member) ?? []))],
    ]),
  );
  const ambiguous = new Set([...held.values()].filter((ids) => ids.length > 1).flat());
  const interactive = new Set<string>();
  if (ambiguous.size > 0) {
    const options = { ...CODEX_RESTORE_SCAN, requireInteractiveSource: true };
    // Compressed rollouts stay out, as they were before Deck could read them: Codex writes a
    // rollout back as plain `.jsonl` before it appends, and their heads cost this per-poll
    // path 37 → 146 ms on a 1,943-rollout home (2026-10-24).
    const plain = listCodexFiles(home, true).filter((file) => !isCompressedRollout(file.filePath));
    for (const file of plain.slice(0, options.maxFiles)) {
      const record = readCodexRecord(file, options);
      if (record !== null && ambiguous.has(record.id)) interactive.add(record.id);
    }
  }
  return new Map(
    groups.flatMap(([pid]) => {
      const id = selectCodexThread(held.get(pid) ?? [], interactive);
      return id === null ? [] : [[pid, id] as const];
    }),
  );
}
