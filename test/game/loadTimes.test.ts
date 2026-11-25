import { describe, expect, it } from "vitest";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { loadNet, timedProgress } from "../../src/game/loadTimes.js";

function rig() {
  let now = 0;
  const inner = createLoadProgress();
  const timed = timedProgress(inner, () => now);
  return { inner, timed, at: (ms: number) => { now = ms; } };
}

describe("a session's loads, timed", () => {
  it("says nothing of a part that never reported", () => {
    expect(rig().timed.read(0)).toEqual({});
  });

  it("times the ground's last file, the terrain's first ring, and the models from the first asked to the last in", () => {
    const { timed, at } = rig();
    const p = timed.progress;
    // Launched at 1000. The trail and the check are no ring.
    at(1000);
    p.done("world", "trail");
    p.done("world", "check");
    p.start("ground", "grass");
    p.start("ground", "rock");
    at(1400);
    p.done("ground", "grass");
    at(1900);
    p.done("ground", "rock");
    at(3400);
    p.done("world", "ring0");
    p.start("models", "tree", 3 * 1048576);
    at(3500);
    p.done("world", "ring1");
    p.start("models", "fern");
    p.bytes("models", "fern", 100, 1048576);
    at(9000);
    p.done("models", "tree");
    at(9500);
    p.done("models", "fern");
    at(9900);
    p.done("world", "bakes");
    expect(timed.read(1000)).toEqual({ groundMs: 900, terrainMs: 2400, modelsAskedMs: 2400, modelsMs: 8500, modelsMB: 4 });
  });

  it("reads a time before the launch as none", () => {
    const { timed, at } = rig();
    at(500);
    timed.progress.start("ground", "grass");
    timed.progress.done("ground", "grass");
    expect(timed.read(1000)).toEqual({ groundMs: 0 });
  });

  it("passes everything on to the progress it times", () => {
    const { inner, timed } = rig();
    const p = timed.progress;
    p.total("ground", 2);
    p.start("ground", "grass");
    p.done("ground", "grass");
    expect(p.view()).toEqual(inner.view());
    expect(inner.view().lines).toEqual(["ground and sound 1 of 2"]);
    p.gate();
    expect(inner.view().ready).toBe(true);
  });
});

describe("what a load asked the network for", () => {
  const file = (startTime: number, transferSize: number, encodedBodySize: number) => ({ startTime, transferSize, encodedBodySize });

  it("counts the megabytes transferred, the files, and those the cache answered, from a time on", () => {
    const entries = [
      file(100, 5 * 1048576, 5 * 1048576), // before: the landing page's
      file(2000, 3 * 1048576 + 300, 3 * 1048576),
      file(2100, 0, 2 * 1048576), // the cache's
      file(2200, 524288, 524288),
      file(2300, 0, 0), // another origin's, its sizes not told
    ];
    expect(loadNet(entries, 1000)).toEqual({ netMB: 3.5, files: 3, cached: 1 });
  });

  it("reads nothing asked as nothing", () => {
    expect(loadNet([], 0)).toEqual({ netMB: 0, files: 0, cached: 0 });
  });
});
