import { afterEach, describe, expect, it } from "vitest";
import { installFilmApi, recordSeconds, type EngineFilm } from "../../../src/game/film/filmApi.js";
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
        frame: async () => void (frames += 1),
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
    await engineFilm()!.frame();
    expect(fake.frames()).toBe(1);
  });

  it("names the length the path must cover: the film and its loop's blend", () => {
    expect(recordSeconds(def({ blend: 2 }))).toBe(32);
    expect(recordSeconds(def(null))).toBe(30);
    installFilmApi(fakeHandle().handle, def({ blend: 2 }), ground);
    expect(engineFilm()!.def).toEqual({ name: "harbour", fps: 24, width: 1280, height: 640, seconds: 30, loop: { blend: 2 }, recordSeconds: 32 });
  });

  it("lists checkPath's problems with the path", async () => {
    installFilmApi(fakeHandle().handle, def(null), ground);
    const expected = checkPath(path, 24, COMFORT, ground);
    expect(expected.length).toBe(2);
    expect(engineFilm()!.problems).toEqual(expected);
    await expect(engineFilm()!.ready).resolves.toBeUndefined();
  });
});
