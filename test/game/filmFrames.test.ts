import { describe, expect, it } from "vitest";
import { FILM_FED_S, FILM_STANDS_S, watchFilmFrames, type WatchedFilm } from "../../src/game/filmFrames.js";

/** A film whose frame callbacks the test calls: `present(mediaTime, presentedFrames)`. */
function film(over: Partial<WatchedFilm> = {}) {
  let callback: ((now: number, frame: { mediaTime: number; presentedFrames: number }) => void) | null = null;
  let cancelled = 0;
  const state = { paused: false, ended: false, error: null as unknown, currentTime: 0, ranges: [[0, 72]] as [number, number][] };
  const it: WatchedFilm = {
    get paused() { return state.paused; },
    get ended() { return state.ended; },
    get error() { return state.error; },
    get currentTime() { return state.currentTime; },
    get buffered() {
      return { length: state.ranges.length, start: (i: number) => state.ranges[i]![0], end: (i: number) => state.ranges[i]![1] };
    },
    requestVideoFrameCallback(next) {
      callback = next;
      return 7;
    },
    cancelVideoFrameCallback() {
      cancelled++;
    },
    ...over,
  };
  return {
    it,
    state,
    cancelled: () => cancelled,
    asked: () => callback !== null,
    present(mediaTime: number, presentedFrames: number) {
      const call = callback;
      callback = null;
      state.currentTime = mediaTime;
      call?.(0, { mediaTime, presentedFrames });
    },
  };
}

const FRAME = 1 / 24;

describe("a film's frames as the screen got them", () => {
  it("misses nothing while every frame of the film's time is presented", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    for (let n = 0; n < 48; n++) f.present(n * FRAME, n + 1);
    expect(watch.read()).toEqual({ playing: true, missed: 0, clock: 47 * FRAME, fed: true });
  });

  it("counts the frames the film's time moved past and the screen was never given", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    for (let n = 0; n < 10; n++) f.present(n * FRAME, n + 1);
    // The film's time moves four frames on; one frame is presented for them: three were never shown.
    f.present(13 * FRAME, 11);
    expect(watch.read()?.missed).toBe(3);
    // And on, whole: nothing more.
    for (let n = 14; n < 24; n++) f.present(n * FRAME, n - 2);
    expect(watch.read()?.missed).toBe(3);
  });

  it("does not take a callback that came late for a frame missed: the frames were presented without it", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    for (let n = 0; n < 10; n++) f.present(n * FRAME, n + 1);
    // The page was busy for six frames of film: the next call says six were presented meanwhile.
    f.present(15 * FRAME, 16);
    expect(watch.read()?.missed).toBe(0);
  });

  it("counts a long gap whole: time that moved was time played, however far", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    for (let n = 0; n < 10; n++) f.present(n * FRAME, n + 1);
    // No frame presented for a second and a half of the film's time: 36 frames due, one shown.
    f.present(9 * FRAME + 1.5, 11);
    expect(watch.read()?.missed).toBe(35);
  });

  it("does not count time that went back", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    for (let n = 0; n < 48; n++) f.present(n * FRAME, n + 1);
    f.present(1, 49);
    f.present(1 + FRAME, 50);
    expect(watch.read()?.missed).toBe(0);
  });

  it("counts a picture standing now, before the call that ends it, and counts it once", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    for (let n = 0; n < 10; n++) f.present(n * FRAME, n + 1);
    // The film's time goes on and no frame is called back for. Under the mark: a frame late, not a picture standing.
    f.state.currentTime = 9 * FRAME + FILM_STANDS_S - 0.01;
    expect(watch.read()?.missed).toBe(0);
    // Half a second on: twelve frames of time, the next of them not yet late.
    f.state.currentTime = 9 * FRAME + 0.5;
    expect(watch.read()?.missed).toBe(11);
    // The frame that ends it: 13 frames due since the last, one shown. Twelve missed in all, not twelve more.
    f.present(22 * FRAME, 11);
    expect(watch.read()?.missed).toBe(12);
    // A film that does not play has no picture standing, whatever its time.
    f.state.paused = true;
    f.state.currentTime = 40;
    expect(watch.read()?.missed).toBe(12);
  });

  it("reads null until a frame has been called back for: nothing is known of a film not yet shown", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    f.state.currentTime = 3;
    expect(watch.read()).toBeNull();
    f.present(3, 1);
    expect(watch.read()).toEqual({ playing: true, missed: 0, clock: 3, fed: true });
  });

  it("says whether the film has data ahead of its time", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    f.present(0, 1);
    f.state.ranges = [[0, 10]];
    f.state.currentTime = 10 - FILM_FED_S;
    expect(watch.read()?.fed).toBe(true);
    f.state.currentTime = 10 - FILM_FED_S + 0.01;
    expect(watch.read()?.fed).toBe(false);
    // Outside every range it holds.
    f.state.ranges = [[20, 30]];
    expect(watch.read()?.fed).toBe(false);
    // A film that does not say what it has buffered is taken to have it.
    const untold = film({ buffered: undefined });
    const other = watchFilmFrames(untold.it);
    untold.present(0, 1);
    expect(other.read()?.fed).toBe(true);
  });

  it("says whether the film plays: not paused, ended or failed", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    f.present(0, 1);
    expect(watch.read()?.playing).toBe(true);
    f.state.paused = true;
    expect(watch.read()?.playing).toBe(false);
    f.state.paused = false;
    f.state.ended = true;
    expect(watch.read()?.playing).toBe(false);
    f.state.ended = false;
    f.state.error = { code: 3 };
    expect(watch.read()?.playing).toBe(false);
  });

  it("asks for the next frame after each, and for none once stopped", () => {
    const f = film();
    const watch = watchFilmFrames(f.it);
    expect(f.asked()).toBe(true);
    f.present(0, 1);
    expect(f.asked()).toBe(true);
    watch.stop();
    expect(f.cancelled()).toBe(1);
    f.present(FRAME, 2);
    expect(f.asked()).toBe(false);
  });

  it("reads the browser's own count of dropped frames where it calls back for none, from the watch's start", () => {
    let dropped = 5;
    const f = film({ requestVideoFrameCallback: undefined, cancelVideoFrameCallback: undefined, getVideoPlaybackQuality: () => ({ droppedVideoFrames: dropped }) });
    const watch = watchFilmFrames(f.it);
    expect(watch.read()?.missed).toBe(0);
    dropped = 8;
    f.state.currentTime = 2.5;
    expect(watch.read()).toEqual({ playing: true, missed: 3, clock: 2.5, fed: true });
  });

  it("reads null where the browser tells nothing of a film's frames", () => {
    const f = film({ requestVideoFrameCallback: undefined, cancelVideoFrameCallback: undefined });
    const watch = watchFilmFrames(f.it);
    expect(watch.read()).toBeNull();
    watch.stop();
  });
});
