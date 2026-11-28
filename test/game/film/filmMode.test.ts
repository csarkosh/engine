import { describe, expect, it } from "vitest";
import { createFilmClock } from "../../../src/game/film/filmClock.js";
import { createFilmDriver, type FilmDriverDeps } from "../../../src/game/film/filmDriver.js";
import { samplePath, type CameraPath } from "../../../src/game/film/cameraPath.js";
import { SETTLE_FRAMES } from "../../../src/game/film/settle.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";
import type { FreecamView } from "../../../src/game/rendererTypes.js";

const path: CameraPath = {
  keys: [
    { t: 0, at: [0, 10, 0], look: [0, 10, 50] },
    { t: 10, at: [10, 12, 0], look: [10, 12, 50] },
  ],
};
const weather = WEATHER_PRESETS.clear;

/** A fake renderer and session that write down what the driver asks of them, in order. */
function rig(busyDraws = 0) {
  const calls: string[] = [];
  const views: FreecamView[] = [];
  let draws = 0;
  const clock = createFilmClock(24);
  const deps: FilmDriverDeps = {
    clock,
    def: { hour: 7.5, weather, path },
    step: () => void calls.push(`step@${clock.time().toFixed(4)}`),
    view: {
      setView: (hour, w) => void calls.push(`setView ${hour} ${w === weather ? "def" : "other"}`),
      setFreecam: (view) => {
        calls.push("setFreecam");
        if (view !== null) views.push(view);
      },
      waitingItems: () => 0,
      streaming: () => draws <= busyDraws,
    },
    draw: () => {
      draws += 1;
      calls.push("draw");
    },
    nextFrame: () => Promise.resolve(),
  };
  return { calls, views, clock, deps, draws: () => draws };
}

describe("film driver", () => {
  it("steps the clock and the ticks, then sets the view and the camera from the def, before the draw", async () => {
    const r = rig();
    const film = createFilmDriver(r.deps);
    film.seek(2);
    await film.frame();
    const t = 2 + 1 / 24;
    expect(r.calls.slice(0, 4)).toEqual([`step@${t.toFixed(4)}`, "setView 7.5 def", "setFreecam", "draw"]);
    expect(r.views[0]).toEqual(samplePath(path, t));
    expect(film.time()).toBeCloseTo(t, 12);
  });

  it("draws SETTLE_FRAMES warm frames on the first frame after a seek only, then settles", async () => {
    const r = rig();
    const film = createFilmDriver(r.deps);
    film.seek(1);
    await film.frame();
    // The frame, its warm frames, and a settle that is quiet from its first draw.
    expect(r.draws()).toBe(1 + SETTLE_FRAMES + SETTLE_FRAMES);
    const before = r.draws();
    await film.frame();
    expect(r.draws() - before).toBe(1 + SETTLE_FRAMES);
    // One step and one camera per frame, however many draws settle it.
    expect(r.calls.filter((c) => c.startsWith("step")).length).toBe(2);
    expect(r.calls.filter((c) => c === "setFreecam").length).toBe(2);
  });

  it("settles a world still streaming before the frame resolves", async () => {
    const r = rig(40);
    const film = createFilmDriver(r.deps);
    film.seek(0);
    await film.frame();
    // Busy through draw 40; then SETTLE_FRAMES quiet draws.
    expect(r.draws()).toBe(40 + SETTLE_FRAMES);
  });

  it("treats its first frame as one after a seek", async () => {
    const r = rig();
    const film = createFilmDriver(r.deps);
    await film.frame();
    expect(r.draws()).toBe(1 + 2 * SETTLE_FRAMES);
  });

  it("resolves on the animation frame after its last draw", async () => {
    const r = rig();
    const film = createFilmDriver({ ...r.deps, nextFrame: () => Promise.resolve(void r.calls.push("turn")) });
    await film.frame();
    expect(r.calls.at(-1)).toBe("turn");
    expect(r.calls.lastIndexOf("turn")).toBeGreaterThan(r.calls.lastIndexOf("draw"));
  });
});
