import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline, Transform } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Read with the same YAML parser the installed updater uses.
const yaml = createRequire(require.resolve("electron-updater"))("js-yaml");

export async function startSmokeFeed(runId) {
  let files = new Map();
  let mode = "install";
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const file = files.get(pathname);
    const missing =
      mode === "manifest-missing" || (mode === "asset-missing" && pathname.endsWith(".zip"));
    if (!["GET", "HEAD"].includes(request.method) || !file || missing) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Length": file.size, "Cache-Control": "no-store" });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    let firstChunk = true;
    const corrupt = new Transform({
      transform(chunk, _encoding, callback) {
        if (mode === "checksum" && pathname.endsWith(".zip") && firstChunk) {
          firstChunk = false;
          callback(null, Buffer.concat([Buffer.from([chunk[0] ^ 0xff]), chunk.subarray(1)]));
        } else {
          callback(null, chunk);
        }
      },
    });
    pipeline(createReadStream(file.path), corrupt, response, (error) => {
      if (error) response.destroy(error);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/${runId}/`;
  return {
    url,
    async setDirectory(directory) {
      const entries = await Promise.all(
        (await readdir(directory)).map(async (name) => {
          const path = join(directory, name);
          const info = await stat(path);
          return info.isFile() ? [`/${runId}/${name}`, { path, size: info.size }] : null;
        }),
      );
      files = new Map(entries.filter(Boolean));
    },
    setMode(next) {
      mode = next;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/** First downloads can skip differential mode; check the exact blockmap URL explicitly. */
export async function verifyLocalManifest(baseURL, expectedVersion) {
  const base = new URL(baseURL);
  assert.equal(base.hostname, "127.0.0.1", "Smoke feeds must be local");
  const response = await fetch(new URL("latest-mac.yml", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, "Manifest is missing");
  const manifest = yaml.load(await response.text());
  assert.equal(manifest?.version, expectedVersion, "Wrong manifest version");
  assert.ok(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    "Manifest files are missing",
  );
  const zip = manifest.files.find(
    (file) => typeof file.url === "string" && file.url.endsWith(".zip"),
  );
  assert.ok(zip && typeof zip.sha512 === "string", "Manifest needs a ZIP with a checksum");
  for (const name of [zip.url, `${zip.url}.blockmap`]) {
    const target = new URL(name, base);
    assert.equal(target.origin, base.origin, "Artifact escaped the local feed");
    assert.ok(target.pathname.startsWith(base.pathname), "Artifact escaped the run directory");
    const result = await fetch(target, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    assert.equal(result.status, 200, `Manifest artifact is missing: ${name}`);
  }
}
