import { describe, expect, it } from "vitest";
import { assertUpdateEvidence } from "./updater-smoke-evidence.mjs";

const expected = {
  runId: "isolated-run",
  fromVersion: "1.2.0",
  toVersion: "1.2.1",
  sentinel: "profile-survived",
  executable: "/temporary/Deck Updater Smoke.app/Contents/MacOS/Deck Updater Smoke",
};

const oldProcess = { runId: expected.runId, version: "1.2.0", pid: 100 };
const evidence = [
  { ...oldProcess, stage: "started", executable: expected.executable },
  { ...oldProcess, stage: "checked", targetVersion: "1.2.1" },
  { ...oldProcess, stage: "downloaded", targetVersion: "1.2.1" },
  { ...oldProcess, stage: "install-started", targetVersion: "1.2.1" },
  {
    runId: expected.runId,
    version: "1.2.1",
    pid: 200,
    stage: "restarted",
    executable: expected.executable,
    outcome: "succeeded",
    sentinel: expected.sentinel,
  },
];

describe("native updater evidence", () => {
  it("accepts a different process running the target from the replaced install", () => {
    expect(() => assertUpdateEvidence(evidence, expected)).not.toThrow();
  });

  it.each(["started", "checked", "downloaded", "install-started", "restarted"])(
    "rejects missing %s evidence",
    (stage) => {
      expect(() =>
        assertUpdateEvidence(
          evidence.filter((e) => e.stage !== stage),
          expected,
        ),
      ).toThrow(/Incomplete or reordered stages/);
    },
  );

  it.each([
    { version: "1.2.0" },
    { version: "1.2.2" },
    { pid: 100 },
    { sentinel: "lost" },
    { outcome: "incomplete" },
    { runId: "earlier-run" },
    { executable: "/temporary/new-build/Deck Updater Smoke" },
  ])("rejects an invalid relaunch: %j", (patch) => {
    const changed = evidence.map((event) =>
      event.stage === "restarted" ? { ...event, ...patch } : event,
    );
    expect(() => assertUpdateEvidence(changed, expected)).toThrow(
      /process|version|Profile|breadcrumb|another run|installation/,
    );
  });

  it("rejects a download of the wrong target", () => {
    const changed = evidence.map((event) =>
      event.stage === "downloaded" ? { ...event, targetVersion: "1.2.2" } : event,
    );
    expect(() => assertUpdateEvidence(changed, expected)).toThrow(/Wrong update target/);
  });

  it("rejects installation before download evidence", () => {
    expect(() =>
      assertUpdateEvidence(
        [evidence[0], evidence[1], evidence[3], evidence[2], evidence[4]],
        expected,
      ),
    ).toThrow(/Incomplete or reordered stages/);
  });

  it("rejects a reported failure even if a success record follows", () => {
    expect(() =>
      assertUpdateEvidence(
        [...evidence, { ...oldProcess, stage: "failed", message: "installer refused the update" }],
        expected,
      ),
    ).toThrow(/installer refused/);
  });

  it.each([null, {}, [null], [{ stage: "restarted" }]])(
    "rejects malformed evidence: %j",
    (value) => {
      expect(() => assertUpdateEvidence(value, expected)).toThrow(/array|record|another run/);
    },
  );
});
