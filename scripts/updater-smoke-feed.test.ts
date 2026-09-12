import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startSmokeFeed, verifyLocalManifest } from "./updater-smoke-feed.mjs";

const VERSION = "0.0.2";
const ZIP = "Deck-Updater-Smoke-0.0.2-arm64.zip";
const BYTES = Buffer.from("fixture download bytes");
const SHA512 = createHash("sha512").update(BYTES).digest("base64");

describe("isolated updater feed", () => {
  let root: string;
  let feed: Awaited<ReturnType<typeof startSmokeFeed>>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "deck-updater-feed-test-"));
    feed = await startSmokeFeed("test-run");
    await writeFile(join(root, ZIP), BYTES);
    await writeFile(join(root, `${ZIP}.blockmap`), "fixture blockmap");
    await writeFile(
      join(root, "latest-mac.yml"),
      JSON.stringify({
        version: VERSION,
        files: [{ url: ZIP, sha512: SHA512 }],
      }),
    );
    await feed.setDirectory(root);
  });

  afterEach(async () => {
    await feed?.close();
    await rm(root, { recursive: true, force: true });
  });

  it("serves exact bytes and verifies manifest ZIP/blockmap URLs", async () => {
    await expect(verifyLocalManifest(feed.url, VERSION)).resolves.toBeUndefined();
    const bytes = Buffer.from(await (await fetch(new URL(ZIP, feed.url))).arrayBuffer());
    expect(bytes).toEqual(BYTES);
  });

  it("rejects a renamed blockmap even when another blockmap exists", async () => {
    await rename(join(root, `${ZIP}.blockmap`), join(root, "other.zip.blockmap"));
    await feed.setDirectory(root);
    await expect(verifyLocalManifest(feed.url, VERSION)).rejects.toThrow(/blockmap/);
  });

  it("rejects a missing ZIP", async () => {
    feed.setMode("asset-missing");
    await expect(verifyLocalManifest(feed.url, VERSION)).rejects.toThrow(/artifact is missing/);
  });

  it("rejects a missing manifest", async () => {
    feed.setMode("manifest-missing");
    await expect(verifyLocalManifest(feed.url, VERSION)).rejects.toThrow(/Manifest is missing/);
  });

  it("rejects the wrong manifest version", async () => {
    await expect(verifyLocalManifest(feed.url, "0.0.3")).rejects.toThrow(/version/);
  });

  it("corrupts the payload without changing the advertised checksum or size", async () => {
    feed.setMode("checksum");
    const result = await fetch(new URL(ZIP, feed.url));
    const bytes = Buffer.from(await result.arrayBuffer());
    expect(bytes.length).toBe(BYTES.length);
    expect(createHash("sha512").update(bytes).digest("base64")).not.toBe(SHA512);
    const manifest = await (await fetch(new URL("latest-mac.yml", feed.url))).json();
    expect(manifest.files[0].sha512).toBe(SHA512);
  });

  it.each(["../package.json", "%2e%2e%2fpackage.json", "%ZZ", "subdir/file"])(
    "does not serve arbitrary paths: %s",
    async (path) => {
      const response = await fetch(new URL(path, feed.url));
      expect(response.status).toBeGreaterThanOrEqual(400);
    },
  );

  it("refuses a manifest that points outside the local feed", async () => {
    await writeFile(
      join(root, "latest-mac.yml"),
      JSON.stringify({
        version: VERSION,
        files: [{ url: "https://example.invalid/update.zip", sha512: SHA512 }],
      }),
    );
    await feed.setDirectory(root);
    await expect(verifyLocalManifest(feed.url, VERSION)).rejects.toThrow(/escaped/);
  });
});
