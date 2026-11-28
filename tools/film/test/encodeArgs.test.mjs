import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeArgs } from "../lib/encodeArgs.mjs";

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
});
