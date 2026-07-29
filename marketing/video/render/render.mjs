#!/usr/bin/env node
/**
 * Render the Deck marketing film.
 *
 *   node marketing/video/render/render.mjs                 # every preset
 *   node marketing/video/render/render.mjs --preset gif    # one preset
 *   node marketing/video/render/render.mjs --still 13.4    # a single frame
 *
 * Boots a Vite server on the marketing root, captures frames through the
 * page's virtual clock, encodes with ffmpeg, then drops the frames.
 */

import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { captureFrames, captureStill } from "./capture.mjs";
import { ENCODERS, resizeImage } from "./encode.mjs";
import { PRESET_NAMES, resolvePreset } from "./presets.js";

const here = dirname(fileURLToPath(import.meta.url));
const videoDir = resolve(here, "..");
const marketingDir = resolve(videoDir, "..");
const outDir = join(videoDir, "out");
const workDir = join(videoDir, ".frames");
const PORT = 5199;

function parseArgs(argv) {
  const args = { presets: PRESET_NAMES, still: null };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];

    if (flag === "--preset") {
      const value = argv[i + 1];

      if (!value) {
        throw new Error("--preset needs a value.");
      }

      args.presets = value.split(",").map((name) => name.trim());
      i += 1;
      continue;
    }

    if (flag === "--still") {
      const value = Number.parseFloat(argv[i + 1] ?? "");

      if (!Number.isFinite(value)) {
        throw new Error("--still needs a time in seconds.");
      }

      args.still = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown flag "${flag}".`);
  }

  return args;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function sizeOf(path) {
  const info = await stat(path);

  return `${(info.size / 1024 / 1024).toFixed(2)} MB`;
}

async function renderPreset(name, url) {
  const preset = resolvePreset(name);
  const framesDir = join(workDir, name);
  let lastPercent = -1;

  const delivered = preset.output ?? {
    width: preset.width,
    height: preset.height,
  };

  log(
    `\n▶ ${name} — captured ${preset.width * preset.scale}×${preset.height * preset.scale}` +
      `, delivered ${delivered.width}×${delivered.height} @ ${preset.fps}fps`,
  );

  const { frameCount } = await captureFrames({
    url,
    preset,
    framesDir,
    onProgress: (done, total) => {
      const percent = Math.floor((done / total) * 100);

      if (percent !== lastPercent && percent % 10 === 0) {
        lastPercent = percent;
        process.stdout.write(`  frames ${percent}%\r`);
      }
    },
  });

  log(`  captured ${frameCount} frames`);

  for (const format of preset.formats) {
    const encode = ENCODERS[format];

    if (!encode) {
      throw new Error(`No encoder for format "${format}".`);
    }

    const outPath = join(outDir, `deck-tour-${name}.${format}`);

    await encode({
      framesDir,
      fps: preset.fps,
      outPath,
      fade: preset.fade ?? null,
      frameCount,
      colors: preset.gifColors,
      output: preset.output ?? null,
    });
    log(
      `  ✓ ${outPath.replace(`${marketingDir}/`, "")} (${await sizeOf(outPath)})`,
    );
  }

  if (preset.poster !== null) {
    const posterPath = join(outDir, `deck-tour-${name}-poster.png`);
    const posterOutput = preset.posterOutput ?? null;
    // The still comes off the page at capture scale; when the poster ships
    // smaller, grab it beside the final path and resample into place.
    const stillPath = posterOutput
      ? join(outDir, `deck-tour-${name}-poster.capture.png`)
      : posterPath;

    await captureStill({
      url,
      preset,
      time: preset.poster,
      outPath: stillPath,
    });

    if (posterOutput) {
      await resizeImage({
        inPath: stillPath,
        outPath: posterPath,
        output: posterOutput,
      });
      await rm(stillPath, { force: true });
    }

    log(`  ✓ ${posterPath.replace(`${marketingDir}/`, "")}`);
  }

  await rm(framesDir, { recursive: true, force: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await mkdir(outDir, { recursive: true });

  const server = await createServer({
    root: marketingDir,
    configFile: false,
    logLevel: "warn",
    server: { port: PORT, strictPort: true, host: "127.0.0.1" },
  });

  await server.listen();

  const url = `http://127.0.0.1:${PORT}/video/`;

  try {
    if (args.still !== null) {
      const preset = resolvePreset(args.presets[0] ?? "master");
      const outPath = join(outDir, `still-${args.still.toFixed(2)}s.png`);

      await captureStill({ url, preset, time: args.still, outPath });
      log(`✓ ${outPath}`);
      return;
    }

    for (const name of args.presets) {
      await renderPreset(name, url);
    }

    log("\nDone.");
  } finally {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
