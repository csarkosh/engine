import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existingFrames, frameTimes, missing, runs, writeAtomic } from "../lib/frames.mjs";

describe("frameTimes", () => {
  it("covers the film and its loop blend at i/fps", () => {
    const times = frameTimes({ fps: 24, seconds: 30, loop: { blend: 2 }, recordSeconds: 32 });
    expect(times).toHaveLength(768);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(767 / 24);
  });
  it("falls back to seconds plus the blend without recordSeconds", () => {
    expect(frameTimes({ fps: 24, seconds: 30, loop: { blend: 2 } })).toHaveLength(768);
    expect(frameTimes({ fps: 10, seconds: 2 })).toHaveLength(20);
  });
});

describe("missing", () => {
  it("lists the frames not yet written", () => {
    const times = frameTimes({ fps: 24, seconds: 30, loop: { blend: 2 } });
    const got = missing(times, new Set(Array.from({ length: 100 }, (_, i) => i)));
    expect(got).toHaveLength(668);
    expect(got[0]).toEqual({ index: 100, t: 100 / 24 });
  });
});

describe("runs", () => {
  it("splits at every gap, each run starting with a seek", () => {
    const list = [...Array.from({ length: 100 }, (_, i) => 100 + i), ...Array.from({ length: 11 }, (_, i) => 300 + i)].map((index) => ({ index, t: index / 24 }));
    const got = runs(list);
    expect(got).toHaveLength(2);
    expect(got[0][0].index).toBe(100);
    expect(got[0]).toHaveLength(100);
    expect(got[1][0].index).toBe(300);
    expect(got[1]).toHaveLength(11);
  });
  it("is empty for nothing", () => expect(runs([])).toEqual([]));
});

describe("resume scan", () => {
  it("counts finished frames, deletes leftover .tmp files and leaves no .tmp after an atomic write", () => {
    const dir = mkdtempSync(join(tmpdir(), "film-frames-"));
    writeFileSync(join(dir, "frame-000000.png"), "x");
    writeFileSync(join(dir, "frame-000001.png.tmp"), "half");
    writeAtomic(join(dir, "frame-000002.png"), "y");
    expect(existingFrames(dir)).toEqual(new Set([0, 2]));
    expect(readdirSync(dir).sort()).toEqual(["frame-000000.png", "frame-000002.png"]);
    expect(existsSync(join(dir, "frame-000001.png.tmp"))).toBe(false);
  });
});
