import assert from "node:assert/strict";

const STAGES = ["started", "checked", "downloaded", "install-started", "restarted"];

/** Fail closed: neither a download nor an install attempt proves a relaunch. */
export function assertUpdateEvidence(events, expected) {
  assert.ok(Array.isArray(events), "Evidence must be an array");
  for (const event of events) {
    assert.ok(event !== null && typeof event === "object", "Invalid evidence record");
    assert.equal(event.runId, expected.runId, "Evidence belongs to another run");
    assert.ok(Number.isSafeInteger(event.pid) && event.pid > 0, "Invalid process ID");
    assert.notEqual(event.stage, "failed", event.message ?? "Smoke app failed");
  }
  assert.deepEqual(
    events.map((event) => event.stage),
    STAGES,
    "Incomplete or reordered stages",
  );
  const [started, checked, downloaded, installing, restarted] = events;
  assert.equal(started.version, expected.fromVersion, "Wrong starting version");
  assert.equal(started.executable, expected.executable, "Wrong starting installation");
  for (const event of [checked, downloaded, installing]) {
    assert.equal(event.pid, started.pid, "Update ran in another process");
    assert.equal(event.version, expected.fromVersion, "Update ran from another version");
    assert.equal(event.targetVersion, expected.toVersion, "Wrong update target");
  }
  assert.notEqual(restarted.pid, started.pid, "No new process after installation");
  assert.equal(restarted.version, expected.toVersion, "Target version did not start");
  assert.equal(restarted.executable, expected.executable, "A different installation started");
  assert.equal(restarted.outcome, "succeeded", "Install breadcrumb did not resolve successfully");
  assert.equal(restarted.sentinel, expected.sentinel, "Profile data did not survive installation");
}
