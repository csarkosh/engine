import { afterEach, describe, expect, it } from "vitest";
import { filmDigest, installFilmApi, pathCoverage, recordSeconds, type EngineFilm } from "../../../src/game/film/filmApi.js";
import { checkPath, COMFORT, type CameraPath } from "../../../src/game/film/cameraPath.js";
import type { FilmDefinition } from "../../../src/game/film/filmMode.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";

// Too fast (10 m/s) and, over flat ground at 1 m, too low: two problems.
const path: CameraPath = {
  keys: [
    { t: 0, at: [0, 1, 0], look: [0, 1, 50] },
    { t: 3, at: [30, 1, 0], look: [30, 1, 50] },
  ],
};
const def = (loop: FilmDefinition["loop"]): FilmDefinition => ({
  name: "harbour",
  token: "tok",
  fps: 24,
  width: 1280,
  height: 640,
  seconds: 30,
  loop,
  hour: 8,
  weather: WEATHER_PRESETS.clear,
  path,
});
const ground = (): number => 0;

function fakeHandle() {
  let t = 0;
  let frames = 0;
  return {
    frames: () => frames,
    handle: {
      ready: Promise.resolve(),
      film: {
        seek: (to: number) => void (t = to),
        frame: async () => {
          frames += 1;
          return { settled: frames !== 2, draws: 10 + frames };
        },
        time: () => t,
      },
    },
  };
}

const engineFilm = (): EngineFilm | undefined => (globalThis as { engineFilm?: EngineFilm }).engineFilm;

afterEach(() => {
  delete (globalThis as { engineFilm?: EngineFilm }).engineFilm;
});

describe("window.engineFilm", () => {
  it("seeks and reads the film's time through the handle", () => {
    const fake = fakeHandle();
    installFilmApi(fake.handle, def({ blend: 2 }), ground);
    engineFilm()!.seek(3);
    expect(engineFilm()!.time()).toBe(3);
  });

  it("draws one frame of the handle's per frame()", async () => {
    const fake = fakeHandle();
    installFilmApi(fake.handle, def(null), ground);
    expect(await engineFilm()!.frame()).toEqual({ settled: true, draws: 11 });
    expect(fake.frames()).toBe(1);
    // An unsettled frame says so: the recorder counts it.
    expect(await engineFilm()!.frame()).toEqual({ settled: false, draws: 12 });
  });

  it("names the length the path must cover: the film and its loop's blend", () => {
    expect(recordSeconds(def({ blend: 2 }))).toBe(32);
    expect(recordSeconds(def(null))).toBe(30);
    installFilmApi(fakeHandle().handle, def({ blend: 2 }), ground);
    expect(engineFilm()!.def).toEqual({ name: "harbour", fps: 24, width: 1280, height: 640, seconds: 30, loop: { blend: 2 }, recordSeconds: 32, digest: filmDigest(def({ blend: 2 })) });
  });

  it("lists checkPath's problems with the path, and that it does not cover the recording", async () => {
    installFilmApi(fakeHandle().handle, def(null), ground);
    const expected = checkPath(path, 24, COMFORT, ground);
    expect(expected.length).toBe(2);
    expect(engineFilm()!.problems).toEqual([...expected, ...pathCoverage(def(null))]);
    expect(pathCoverage(def(null))).toEqual(["the path ends at t=3 s, before the recording's end at 30 s"]);
    await expect(engineFilm()!.ready).resolves.toBeUndefined();
  });

  it("names a path that starts late or ends before the loop's blend is recorded, and none that covers it", () => {
    const covering = { ...def({ blend: 2 }), path: { keys: [{ t: 0, at: [0, 5, 0], look: [0, 5, 9] }, { t: 32, at: [1, 5, 0], look: [1, 5, 9] }] } } as FilmDefinition;
    expect(pathCoverage(covering)).toEqual([]);
    const short = { ...covering, path: { keys: [{ t: 1, at: [0, 5, 0], look: [0, 5, 9] }, { t: 31, at: [1, 5, 0], look: [1, 5, 9] }] } } as FilmDefinition;
    expect(pathCoverage(short)).toEqual([
      "the path starts at t=1 s, after the recording's start at 0 s",
      "the path ends at t=31 s, before the recording's end at 32 s",
    ]);
  });

  it("digests what the frames are made from, the same for an equal definition in any key order, and not the name", () => {
    const a = def({ blend: 2 });
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as FilmDefinition;
    expect(filmDigest(reordered)).toBe(filmDigest(a));
    expect(filmDigest(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(filmDigest({ ...a, name: "another" })).toBe(filmDigest(a));
    const changes: Partial<FilmDefinition>[] = [
      { token: "tok2" }, { fps: 30 }, { width: 1920 }, { height: 720 }, { seconds: 31 }, { loop: { blend: 1 } }, { loop: null }, { hour: 9 },
      { weather: WEATHER_PRESETS.rain },
      { path: { keys: [path.keys[0]!, { ...path.keys[1]!, t: 4 }] } }, { lookDigest: "warm-v2" },
    ];
    for (const change of changes) expect(filmDigest({ ...a, ...change })).not.toBe(filmDigest(a));
  });
});
