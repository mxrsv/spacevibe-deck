import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const EXIT_TIMEOUT_MS = 5000;
const POLL_MS = 100;

export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function waitForExit(pid) {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (processExists(pid) && Date.now() < deadline) await delay(POLL_MS);
  if (processExists(pid)) throw new Error(`Smoke process ${pid} did not exit`);
}

/** A dedicated process group owns build/signing children even on interruption. */
export function startOwnedProcess(
  command,
  args,
  { signal, stdio = "inherit", stopChildrenOnExit = true } = {},
) {
  signal?.throwIfAborted();
  const child = spawn(command, args, { detached: true, stdio });
  const stop = () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, killedBy) => {
      signal?.removeEventListener("abort", stop);
      try {
        if (stopChildrenOnExit) stop();
      } catch (error) {
        reject(error);
        return;
      }
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error(`Process failed: code=${code}, signal=${killedBy}`));
    });
    signal?.addEventListener("abort", stop, { once: true });
  });
  return { child, completion, stop };
}

/** Squirrel can relaunch outside the original process group. Match its real path. */
export async function stopInstalledProcesses(appPath) {
  const list = () =>
    execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
      .filter((match) => match && match[2].startsWith(`${appPath}/`))
      .map((match) => Number(match[1]));
  // Repeat because ShipIt may have been starting the new process as it died.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pids = list();
    for (const pid of pids) {
      // Re-read before killing: a reused PID must never select another app.
      if (!list().includes(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await Promise.all(pids.map(waitForExit));
    await delay(POLL_MS);
  }
  if (list().length) throw new Error("Test installation still has running processes");
}
