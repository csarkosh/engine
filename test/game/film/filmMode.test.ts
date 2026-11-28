import { describe, expect, it } from "vitest";
import { createFilmClock } from "../../../src/game/film/filmClock.js";
import { FILM_TAA_DRAWS, SETTLE_MAX_FRAMES, createFilmDriver, filmOnlyCss, type FilmDriverDeps } from "../../../src/game/film/filmDriver.js";
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
  let turns = 0;
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
      restartAntialiasing: () => void calls.push(`restart@${draws}`),
    },
    draw: () => {
      draws += 1;
      calls.push("draw");
    },
    nextFrame: () => {
      turns += 1;
      return Promise.resolve();
    },
  };
  return { calls, views, clock, deps, draws: () => draws, turns: () => turns };
}

describe("film driver", () => {
  it("draws the frame after a seek at the seek's time, then steps the clock and the ticks before each later frame", async () => {
    const r = rig();
    const film = createFilmDriver(r.deps);
    film.seek(2);
    await film.frame();
    expect(film.time()).toBe(2);
    // No step: the view, the camera at 2, then the draw.
    expect(r.calls.slice(0, 3)).toEqual(["setView 7.5 def", "setFreecam", "draw"]);
    expect(r.views[0]).toEqual(samplePath(path, 2));
    r.calls.length = 0;
    await film.frame();
    const t = 2 + 1 / 24;
    expect(film.time()).toBe(t);
    expect(r.calls.slice(0, 4)).toEqual([`step@${t.toFixed(4)}`, "setView 7.5 def", "setFreecam", "draw"]);
    expect(r.views[1]).toEqual(samplePath(path, t));
  });

  it("draws SETTLE_FRAMES warm frames on the first frame after a seek only, then settles", async () => {
    const r = rig();
    const film = createFilmDriver(r.deps);
    film.seek(1);
    // The frame, its warm frames, a settle that is quiet from its first draw, and the anti-aliasing's fixed run.
    expect(await film.frame()).toEqual({ settled: true, draws: 1 + SETTLE_FRAMES + SETTLE_FRAMES + FILM_TAA_DRAWS });
    expect(r.draws()).toBe(1 + SETTLE_FRAMES + SETTLE_FRAMES + FILM_TAA_DRAWS);
    const before = r.draws();
    expect(await film.frame()).toEqual({ settled: true, draws: 1 + SETTLE_FRAMES + FILM_TAA_DRAWS });
    expect(r.draws() - before).toBe(1 + SETTLE_FRAMES + FILM_TAA_DRAWS);
    // One camera per frame, however many draws settle it; a step only for the frame that is not the seek's.
    expect(r.calls.filter((c) => c.startsWith("step")).length).toBe(1);
    expect(r.calls.filter((c) => c === "setFreecam").length).toBe(2);
  });

  it("settles a world still streaming before the frame resolves", async () => {
    const r = rig(40);
    const film = createFilmDriver(r.deps);
    film.seek(0);
    await film.frame();
    // Busy through draw 40; then SETTLE_FRAMES quiet draws, and the anti-aliasing's fixed run.
    expect(r.draws()).toBe(40 + SETTLE_FRAMES + FILM_TAA_DRAWS);
  });

  it("treats its first frame as one after a seek", async () => {
    const r = rig();
    const film = createFilmDriver(r.deps);
    await film.frame();
    expect(r.draws()).toBe(1 + 2 * SETTLE_FRAMES + FILM_TAA_DRAWS);
  });

  it("resolves on the animation frame after its last draw", async () => {
    const r = rig();
    const film = createFilmDriver({ ...r.deps, nextFrame: () => Promise.resolve(void r.calls.push("turn")) });
    await film.frame();
    expect(r.calls.at(-1)).toBe("turn");
    expect(r.calls.lastIndexOf("turn")).toBeGreaterThan(r.calls.lastIndexOf("draw"));
  });

  it("gives the page a turn after every settling draw while a job or an upload is still to come", async () => {
    const r = rig(40);
    const film = createFilmDriver(r.deps);
    await film.frame();
    // The first draw and the warm ones are busy too, but only the settle's draws are given turns: draws 1 + SETTLE_FRAMES
    // + 1 to 40 are each followed by one, every quiet stretch of SETTLE_STRETCH by another, and the frame ends on one.
    const settleBusy = 40 - (1 + SETTLE_FRAMES);
    expect(r.turns()).toBeGreaterThanOrEqual(settleBusy + 1);
  });

  it("restarts the anti-aliasing once settled, then draws a fixed run: the same however long it settled", async () => {
    for (const busy of [0, 25, 90]) {
      const r = rig(busy);
      const film = createFilmDriver(r.deps);
      await film.frame();
      const restart = r.calls.findIndex((c) => c.startsWith("restart@"));
      expect(r.calls.slice(restart + 1).filter((c) => c === "draw").length).toBe(FILM_TAA_DRAWS);
      expect(r.calls.filter((c) => c.startsWith("restart@")).length).toBe(1);
    }
  });

  it("says when a frame never settled", async () => {
    const r = rig(Number.POSITIVE_INFINITY);
    const film = createFilmDriver(r.deps);
    const result = await film.frame();
    expect(result.settled).toBe(false);
    expect(result.draws).toBe(1 + SETTLE_FRAMES + SETTLE_MAX_FRAMES + FILM_TAA_DRAWS);
  });
});

describe("the page under a film", () => {
  it("shows the canvas alone, at the corner at the film's size, with no margin round it", () => {
    const css = filmOnlyCss(1280, 640);
    expect(css).toContain("body.film { margin: 0 !important; padding: 0 !important;");
    expect(css).toContain("position: fixed !important; left: 0 !important; top: 0 !important;");
    expect(css).toContain("width: 1280px !important; height: 640px !important;");
    expect(css).toContain("display: none !important;");
  });
});
