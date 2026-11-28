// Encodes a recorded film's frames into its MP4 and still, then checks the loop's seam.
//
//   node tools/recording/encode.mjs --frames <dir> --out <file.mp4> --still <file.webp> [--crf 18]
//
// Reads <dir>/film.json (written by record.mjs). H.264, yuv420p, faststart, no audio, a key frame every 2 s. The still
// is the video's first frame as WebP, quality lowered until it is under 200 KB. A film with a loop is checked: the
// jump from its last frame to its first must be no bigger than its biggest frame-to-frame step; otherwise exit 1.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { encodeArgs } from "./lib/encodeArgs.mjs";
import { writeAtomic } from "./lib/frames.mjs";
import { seamReport } from "./lib/seam.mjs";

const STILL_LIMIT = 200 * 1024;
const CHECK_WIDTH = 320;

function parseArgs(argv) {
  const o = { frames: undefined, out: undefined, still: undefined, crf: 18 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--frames") o.frames = value();
    else if (a === "--out") o.out = value();
    else if (a === "--still") o.still = value();
    else if (a === "--crf") o.crf = Number(value());
    else throw new Error(`unknown argument ${a}`);
  }
  for (const k of ["frames", "out", "still"]) if (o[k] === undefined) throw new Error(`--${k} is required`);
  if (!Number.isFinite(o.crf)) throw new Error("--crf needs a number");
  return o;
}

function ffmpeg(args, what) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${what} failed: ${r.error?.message ?? r.stderr.toString()}`);
  return r.stdout;
}

/** The first frame of `video` as WebP bytes under STILL_LIMIT, lowering the quality in steps (this ffmpeg has no libwebp, so sharp encodes). */
async function still(video) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new Error("encode.mjs needs `sharp` for the WebP still: add it to the game as a devDependency (npm install -D sharp@0.34.5)");
  }
  const png = ffmpeg(["-i", video, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], "still");
  for (let q = 90; q >= 10; q -= 10) {
    const bytes = await sharp(png).webp({ quality: q }).toBuffer();
    if (bytes.length < STILL_LIMIT) return { bytes, quality: q };
  }
  throw new Error("the still stays over 200 KB at quality 10");
}

/** Every frame of `video`, as grayscale bytes at CHECK_WIDTH wide; `[frames, width, height]`. */
function grayFrames(video, def) {
  const width = CHECK_WIDTH;
  const height = Math.round((def.height * CHECK_WIDTH) / def.width);
  const raw = ffmpeg(["-i", video, "-vf", `scale=${width}:${height},format=gray`, "-f", "rawvideo", "pipe:1"], "decode");
  const size = width * height;
  const frames = [];
  for (let at = 0; at + size <= raw.length; at += size) frames.push(new Uint8Array(raw.subarray(at, at + size)));
  return [frames, width, height];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const frames = resolve(options.frames);
  const out = resolve(options.out);
  const { def } = JSON.parse(readFileSync(`${frames}/film.json`, "utf8"));
  ffmpeg(encodeArgs(def, { frames, out }, options.crf), "encode");
  const { bytes, quality } = await still(out);
  writeAtomic(resolve(options.still), bytes);
  console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(2)} MB; still ${(bytes.length / 1024).toFixed(0)} KB at quality ${quality}`);
  if (!def.loop) return;
  const [gray, width, height] = grayFrames(out, def);
  const report = seamReport(gray, width, height);
  console.log(`seam ${report.seam.toFixed(2)}, median step ${report.medianStep.toFixed(2)}, max step ${report.maxStep.toFixed(2)}: ${report.ok ? "ok" : "the loop jumps"}`);
  if (!report.ok) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
