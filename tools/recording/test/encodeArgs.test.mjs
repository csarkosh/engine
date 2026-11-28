import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeArgs } from "../lib/encodeArgs.mjs";
import { greyPng } from "./png.mjs";

const paths = { frames: "/f", out: "/o.mp4" };
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe("encodeArgs", () => {
  it("dissolves the end into the start when the film loops", () => {
    const a = encodeArgs({ fps: 24, seconds: 30, loop: { blend: 2 } }, paths, 18);
    expect(a.join(" ")).toContain("xfade=transition=fade:duration=2:offset=28");
    expect(a[a.indexOf("-g") + 1]).toBe("48");
    expect(a).toContain("+faststart");
    expect(a).toContain("-an");
    expect(a.filter((x) => x === "-i")).toHaveLength(2);
    expect(a[a.indexOf("-start_number") + 1]).toBe("48");
  });

  it("puts a key frame every 2 s and only there", () => {
    const a = encodeArgs({ fps: 24, seconds: 30, loop: null }, paths, 18);
    expect(a[a.indexOf("-g") + 1]).toBe("48");
    expect(a[a.indexOf("-keyint_min") + 1]).toBe("48");
    expect(a[a.indexOf("-sc_threshold") + 1]).toBe("0");
  });

  it("refuses a loop with no blend", () => {
    expect(() => encodeArgs({ fps: 24, seconds: 30, loop: { blend: 0 } }, paths)).toThrow("loop blend must be over 0");
    expect(() => encodeArgs({ fps: 24, seconds: 30, loop: { blend: -1 } }, paths)).toThrow("loop blend must be over 0");
  });

  it("uses the frames as they are without a loop", () => {
    const a = encodeArgs({ fps: 24, seconds: 30, loop: null }, paths, 18);
    expect(a.filter((x) => x === "-i")).toHaveLength(1);
    expect(a.join(" ")).not.toContain("xfade");
  });

  it.skipIf(!ffmpeg)("is accepted by ffmpeg and gives exactly `seconds` of video", () => {
    const dir = mkdtempSync(join(tmpdir(), "film-encode-"));
    try {
      const def = { fps: 8, seconds: 4, loop: { blend: 1 } };
      const frames = join(dir, "frames");
      mkdirSync(frames);
      const make = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x32:rate=8", "-frames:v", "40", "-start_number", "0", join(frames, "frame-%06d.png")]);
      expect(make.status).toBe(0);
      expect(existsSync(join(frames, "frame-000000.png"))).toBe(true);
      const out = join(dir, "out.mp4");
      const run = spawnSync("ffmpeg", encodeArgs(def, { frames, out }, 28));
      expect(run.stderr.toString()).toBe("");
      expect(run.status).toBe(0);
      const count = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out]);
      expect(Number(count.stdout.toString().trim())).toBe(32);
      expect(statSync(out).size).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!ffmpeg)("lines the dissolve up frame for frame: the film is recorded frames 8 on, and its last second fades into frames 0 on", () => {
    // Each recorded frame's grey is 6 x its index, so a frame off by one is 6 levels out, past the tolerance.
    const LEVEL = 6;
    const TOLERANCE = 2;
    const def = { fps: 8, seconds: 4, loop: { blend: 1 } };
    const dir = mkdtempSync(join(tmpdir(), "film-xfade-"));
    try {
      const frames = join(dir, "frames");
      mkdirSync(frames);
      for (let i = 0; i < 40; i++) writeFileSync(join(frames, `frame-${String(i).padStart(6, "0")}.png`), greyPng(64, 32, i * LEVEL));
      const out = join(dir, "out.mp4");
      const run = spawnSync("ffmpeg", encodeArgs(def, { frames, out }, 1));
      expect(run.stderr.toString()).toBe("");
      expect(run.status).toBe(0);
      const raw = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", out, "-vf", "format=gray", "-f", "rawvideo", "pipe:1"], { maxBuffer: 1 << 26 }).stdout;
      const size = 64 * 32;
      expect(raw.length).toBe(32 * size);
      /** The mean grey of the output's frame `k`. */
      const grey = (k) => {
        let sum = 0;
        for (let i = k * size; i < (k + 1) * size; i++) sum += raw[i];
        return sum / size;
      };
      for (let k = 0; k < 24; k++) expect(Math.abs(grey(k) - (8 + k) * LEVEL), `frame ${k}`).toBeLessThanOrEqual(TOLERANCE);
      for (let j = 0; j < 8; j++) {
        const p = j / 8;
        const want = (1 - p) * (32 + j) * LEVEL + p * j * LEVEL;
        expect(Math.abs(grey(24 + j) - want), `frame ${24 + j}`).toBeLessThanOrEqual(TOLERANCE);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
