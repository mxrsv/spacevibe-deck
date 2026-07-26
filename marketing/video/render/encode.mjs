/**
 * ffmpeg wrappers — PNG sequence to the shipped formats.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Could not run ffmpeg (${error.message}). Install it with "brew install ffmpeg".`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

const pattern = (framesDir) => join(framesDir, "frame-%05d.png");

/**
 * Fade filters for the looping cuts. Both ends land on black, so the loop
 * seam is black-to-black instead of a hard jump back to frame zero.
 *
 * @param {{ in: number, out: number } | null | undefined} fade
 * @param {number} frameCount
 * @param {number} fps
 * @returns {string[]} filter expressions, empty when no fade is asked for
 */
function fadeFilters(fade, frameCount, fps) {
  if (!fade) {
    return [];
  }

  const duration = frameCount / fps;
  const outStart = Math.max(0, duration - fade.out);

  return [
    `fade=t=in:st=0:d=${fade.in}`,
    `fade=t=out:st=${outStart.toFixed(3)}:d=${fade.out}`,
  ];
}

function videoFilterArgs(filters) {
  return filters.length > 0 ? ["-vf", filters.join(",")] : [];
}

/** H.264 — the widest-support landing/social file. */
export async function encodeMp4({ framesDir, fps, outPath, fade, frameCount }) {
  await run([
    "-y",
    "-framerate",
    String(fps),
    "-i",
    pattern(framesDir),
    ...videoFilterArgs(fadeFilters(fade, frameCount, fps)),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}

/** VP9 — listed first in <video> so modern browsers prefer it. */
export async function encodeWebm({
  framesDir,
  fps,
  outPath,
  fade,
  frameCount,
}) {
  await run([
    "-y",
    "-framerate",
    String(fps),
    "-i",
    pattern(framesDir),
    ...videoFilterArgs(fadeFilters(fade, frameCount, fps)),
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

/**
 * GIF via a per-clip palette. `bayer` dithering keeps flat terminal panels
 * from turning into noise while still holding the aurora gradient.
 */
export async function encodeGif({
  framesDir,
  fps,
  outPath,
  fade,
  frameCount,
  colors = 128,
}) {
  const filters = [
    `fps=${fps}`,
    ...fadeFilters(fade, frameCount, fps),
    "split[a][b]",
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p]`,
    "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
  ].join(",");

  await run([
    "-y",
    "-framerate",
    String(fps),
    "-i",
    pattern(framesDir),
    "-filter_complex",
    filters,
    "-loop",
    "0",
    outPath,
  ]);
}

export const ENCODERS = Object.freeze({
  mp4: encodeMp4,
  webm: encodeWebm,
  gif: encodeGif,
});
