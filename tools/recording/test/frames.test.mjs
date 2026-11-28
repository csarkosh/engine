import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearFrames, existingFrames, filmRecord, frameTimes, framesProblems, indexRanges, missing, pngSize, resumeDecision, runs, withTimeout, writeAtomic,
} from "../lib/frames.mjs";
import { greyPng } from "./png.mjs";

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

describe("what keeps frames from being encoded", () => {
  const def = { fps: 4, seconds: 2, loop: { blend: 1 }, recordSeconds: 3, width: 8, height: 4 };
  const dirWith = (indexes, size = [8, 4]) => {
    const dir = mkdtempSync(join(tmpdir(), "film-check-"));
    for (const i of indexes) writeFileSync(join(dir, `frame-${String(i).padStart(6, "0")}.png`), greyPng(size[0], size[1], 10));
    return dir;
  };

  it("reads a PNG's size from its header, and nothing from another file", () => {
    expect(pngSize(greyPng(1280, 640, 0))).toEqual({ width: 1280, height: 640 });
    expect(pngSize(Buffer.from("not a png at all, not at all"))).toBeNull();
  });

  it("passes every frame of the recording at the film's size", () => {
    const dir = dirWith(Array.from({ length: 12 }, (_, i) => i));
    try {
      expect(framesProblems(dir, def)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the missing frames as ranges, and a first frame of another size", () => {
    const dir = dirWith([0, 1, 2, 5, 9, 10], [16, 8]);
    try {
      expect(framesProblems(dir, def)).toEqual([
        `6 of 12 frames are missing from ${dir}: 3-4, 6-8, 11`,
        "frame-000000.png is 16 x 8, the film is 8 x 4",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes ranges", () => {
    expect(indexRanges([0, 1, 2, 7, 9, 10, 11])).toBe("0-2, 7, 9-11");
    expect(indexRanges([])).toBe("");
  });
});

describe("resuming a recording", () => {
  const def = { name: "harbour", digest: "aaaa", fps: 24 };
  const previous = { def: { ...def }, url: "http://x/film", build: "b1", started: "2026-11-27T00:00:00.000Z" };

  it("starts afresh in an empty directory, and resumes the same film by its digest", () => {
    expect(resumeDecision(null, def)).toEqual({ kind: "new" });
    expect(resumeDecision(previous, def, { framesPresent: 30 })).toEqual({ kind: "resume" });
  });

  it("refuses frames of another film, or of one it cannot name, unless --fresh", () => {
    const other = resumeDecision(previous, { ...def, digest: "bbbb" }, { framesPresent: 30 });
    expect(other.kind).toBe("refuse");
    expect(other.reason).toContain("digest aaaa, this one's bbbb");
    expect(other.reason).toContain("--fresh");
    expect(resumeDecision({ def: { name: "harbour" } }, def).kind).toBe("refuse");
    expect(resumeDecision(null, def, { framesPresent: 3 }).kind).toBe("refuse");
    expect(resumeDecision(previous, { ...def, digest: "bbbb" }, { fresh: true })).toEqual({ kind: "fresh" });
  });

  it("keeps the first run's start and adds each resume's time", () => {
    const once = filmRecord(previous, { kind: "resume" }, { def, url: "http://x/film", build: "b1", now: "2026-11-28T01:00:00.000Z" });
    expect(once.started).toBe(previous.started);
    expect(once.resumed).toEqual(["2026-11-28T01:00:00.000Z"]);
    const twice = filmRecord(once, { kind: "resume" }, { def, url: "http://x/film", build: "b1", now: "2026-11-28T02:00:00.000Z" });
    expect(twice.resumed).toEqual(["2026-11-28T01:00:00.000Z", "2026-11-28T02:00:00.000Z"]);
    expect(filmRecord(previous, { kind: "fresh" }, { def, url: "u", build: null, now: "N" })).toEqual({ def, url: "u", build: null, started: "N" });
  });

  it("--fresh clears the frames and leaves the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "film-fresh-"));
    try {
      writeFileSync(join(dir, "frame-000000.png"), "x");
      writeFileSync(join(dir, "frame-000001.png"), "x");
      writeFileSync(join(dir, "frame-000002.png.tmp"), "x");
      writeFileSync(join(dir, "still-3.png"), "x");
      writeFileSync(join(dir, "film.json"), "{}");
      expect(clearFrames(dir)).toBe(2);
      expect(readdirSync(dir).sort()).toEqual(["film.json", "still-3.png"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a frame's timeout", () => {
  it("passes a frame that answers in time, and fails one that does not with the message given", async () => {
    await expect(withTimeout(Promise.resolve({ settled: true, draws: 9 }), 1000, "late")).resolves.toEqual({ settled: true, draws: 9 });
    await expect(withTimeout(new Promise(() => undefined), 5, "frame 3 took longer than 0.005 s")).rejects.toThrow("frame 3 took longer than 0.005 s");
  });
});
