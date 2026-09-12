const assert = require("node:assert/strict");

/** A check failure cannot stand in for exercising the download failure path. */
async function expectRejectedUpdate(lifecycle, mode, targetVersion) {
  const operation = mode === "manifest-missing" ? "check" : "download";
  if (operation === "download") {
    const result = await lifecycle.check();
    assert.equal(result.status, "available");
    assert.equal(result.version, targetVersion);
  }
  try {
    if (operation === "check") await lifecycle.check();
    else await lifecycle.download();
  } catch (error) {
    const message = String(error);
    assert.match(
      message,
      mode === "checksum" ? /sha512|checksum/i : /404/,
      "Failed for an unexpected reason",
    );
    return { operation, message };
  }
  throw new Error(`Broken feed was accepted: ${mode}`);
}

module.exports = { expectRejectedUpdate };
