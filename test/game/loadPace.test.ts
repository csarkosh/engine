import { describe, expect, it } from "vitest";
import { COVERED_DRAW_MS } from "../../src/game/coveredDraw.js";
import type { FilmFrames } from "../../src/game/filmFrames.js";
import {
  ASKS_PER_DRAW_MAX, CLOCK_SLIP_S, PACE_AWAY_MS, PACE_CAP_HOLD_MAX_MS, PACE_CAP_HOLD_MS, PACE_CAP_SHARE, PACE_REST_MS, PACE_STEP, PACE_WINDOW_MS, PAGE_STOP_MS, TOP_DRAW_MS,
  asksPerDraw, createLoadPace, drawEveryMs, paceLine,
} from "../../src/game/loadPace.js";

/**
 * A page of a hundred frames a second under a film: `run(ms)` steps the page's frames ten milliseconds apart (so
 * a window ends on the frame `PACE_WINDOW_MS` after it began, exactly), the film's time keeping the page's unless
 * `stall` is on, and `miss(n)` drops n of the film's frames.
 */
function rig(film: FilmFrames | null = { playing: true, missed: 0, clock: 0, fed: true }) {
  let now = 1000;
  let stall = false;
  const pace = createLoadPace(() => (film === null ? null : { ...film }));
  pace.frame(now);
  return {
    pace,
    film,
    stall(on: boolean) { stall = on; },
    miss(n: number) { if (film !== null) film.missed += n; },
    /** A page frame `ms` after the last, the film's time moving with it. */
    step(ms: number) {
      now += ms;
      if (film !== null && film.playing && !stall) film.clock += ms / 1000;
      pace.frame(now);
    },
    run(ms: number) {
      for (let t = 0; t < ms; t += 10) this.step(10);
    },
  };
}

describe("what a level sets", () => {
  it("is at the floor what the load was fixed at: a draw every COVERED_DRAW_MS, four asks a draw", () => {
    expect(drawEveryMs(0)).toBe(COVERED_DRAW_MS);
    expect(asksPerDraw(0)).toBe(4);
    expect(ASKS_PER_DRAW_MAX).toBe(4);
  });

  it("is at the top a draw every frame of a page at sixty a second, one ask a draw", () => {
    expect(drawEveryMs(1)).toBeCloseTo(TOP_DRAW_MS, 9);
    expect(TOP_DRAW_MS).toBeLessThan(1000 / 60);
    expect(asksPerDraw(1)).toBe(1);
  });

  it("draws more often and asks for more a second at every step up, never more than four a draw", () => {
    let every = Infinity;
    let rate = 0;
    for (let level = 0; level <= 1.0001; level += PACE_STEP) {
      const ms = drawEveryMs(level);
      const asks = asksPerDraw(level);
      expect(ms).toBeLessThan(every);
      expect(asks).toBeGreaterThanOrEqual(1);
      expect(asks).toBeLessThanOrEqual(ASKS_PER_DRAW_MAX);
      // Whole asks a draw round the rate; over a step it never falls by more than the rounding.
      expect((asks * 1000) / ms).toBeGreaterThan(rate * 0.6);
      every = ms;
      rate = (asks * 1000) / ms;
    }
    expect(rate).toBeGreaterThan(55);
    // Outside its range a level reads as its nearest end.
    expect(drawEveryMs(-1)).toBe(drawEveryMs(0));
    expect(drawEveryMs(2)).toBe(drawEveryMs(1));
  });
});

describe("the pace of a load under a film", () => {
  it("starts at the floor and climbs a step a clean window, to the top in two seconds", () => {
    const r = rig();
    expect(r.pace.level()).toBe(0);
    expect(r.pace.drawEveryMs()).toBe(COVERED_DRAW_MS);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(PACE_STEP);
    r.run(2000 - PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
    expect(r.pace.asksPerDraw()).toBe(1);
    expect((1 / PACE_STEP) * PACE_WINDOW_MS).toBe(2000);
    // And no higher.
    r.run(1000);
    expect(r.pace.level()).toBe(1);
  });

  it("halves when the film misses a frame, rests, and is then held under where the trouble came", () => {
    const r = rig();
    r.run(2000);
    expect(r.pace.level()).toBe(1);
    r.miss(2);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0.5);
    // No climb while it rests: the windows that end before the rest does.
    r.run(PACE_REST_MS - PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0.5);
    // Then up to the share of the level the trouble came at, and no further while the hold lasts.
    r.run(3 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(PACE_CAP_SHARE);
    r.run(PACE_CAP_HOLD_MS - PACE_REST_MS - 3 * PACE_WINDOW_MS - PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(PACE_CAP_SHARE);
    // The hold over, it climbs again.
    r.run(3 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
    expect(r.pace.course()).toMatchObject({ peak: 1, level: 1, missed: 1, frames: 2, slips: 0, stops: 0 });
  });

  it("holds twice as long after each trouble more", () => {
    const r = rig();
    r.run(2000);
    r.miss(1);
    r.run(PACE_WINDOW_MS);
    r.run(PACE_CAP_HOLD_MS + 2 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
    // The second trouble, at the top again: held under three quarters for twice the first hold.
    r.miss(1);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0.5);
    r.run(2 * PACE_CAP_HOLD_MS - PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(PACE_CAP_SHARE);
    r.run(3 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
  });

  it("halves when a playing film's time falls behind the page's", () => {
    const r = rig();
    r.run(2000);
    r.stall(true);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0.5);
    expect(r.pace.course()).toMatchObject({ slips: 1, missed: 0 });
    expect(CLOCK_SLIP_S).toBeLessThan(PACE_WINDOW_MS / 1000);
  });

  it("does not climb in a window the page stopped in, and is not cut for it", () => {
    const r = rig();
    r.run(1000);
    expect(r.pace.level()).toBe(0.5);
    // A stop of the page's thread: one frame comes late, the film playing through it.
    r.step(PAGE_STOP_MS + 50);
    r.run(PACE_WINDOW_MS - PAGE_STOP_MS - 50);
    expect(r.pace.level()).toBe(0.5);
    expect(r.pace.course().stops).toBe(1);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0.5 + PACE_STEP);
  });

  it("is not cut for a film whose time stands for want of data: the link's doing, not the machine's", () => {
    const film: FilmFrames = { playing: true, missed: 0, clock: 0, fed: true };
    const r = rig(film);
    r.run(2000);
    film.fed = false;
    r.stall(true);
    r.run(4 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
    // Fed again and playing on: the window it was fed in began unfed, and is not a slip either.
    film.fed = true;
    r.stall(false);
    r.run(2 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
    expect(r.pace.course()).toMatchObject({ slips: 0, missed: 0 });
  });

  it("is not cut for a film paused with its tab: no frame of the page for a while is the page away", () => {
    const film: FilmFrames = { playing: true, missed: 0, clock: 0, fed: true };
    const r = rig(film);
    r.run(2000);
    // The tab is hidden five seconds: the page draws no frame, and the film, paused with it, plays again on return.
    r.stall(true);
    r.step(5000);
    r.stall(false);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(1);
    expect(r.pace.course()).toMatchObject({ slips: 0, missed: 0 });
    expect(PACE_AWAY_MS).toBeGreaterThan(PAGE_STOP_MS);
    // A film that missed frames is cut all the same, however long the page's frame took.
    r.miss(4);
    r.step(PACE_AWAY_MS + 500);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0.5);
  });

  it("is the floor or a whole step above it: trouble a step up comes back to the floor, held there, not ratcheted under it", () => {
    const r = rig();
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(PACE_STEP);
    r.miss(1);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0);
    // Held at the floor while the hold lasts: three quarters of a step is no level.
    r.run(PACE_CAP_HOLD_MS - 2 * PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0);
    // More trouble meanwhile, at the floor, moves and lengthens nothing: the hold ends when it was to.
    r.miss(1);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0);
    // That trouble's rest over, it climbs: the hold ended meanwhile, no later for it.
    r.run(PACE_REST_MS);
    expect(r.pace.level()).toBe(PACE_STEP);
  });

  it("holds no longer than PACE_CAP_HOLD_MAX_MS, however many troubles", () => {
    const r = rig();
    for (let n = 0; n < 6; n++) {
      r.run(PACE_CAP_HOLD_MAX_MS + 3000);
      expect(r.pace.level(), `trouble ${n}`).toBe(1);
      r.miss(1);
      r.run(PACE_WINDOW_MS);
    }
    expect(PACE_CAP_HOLD_MS * 2 ** 5).toBeGreaterThan(PACE_CAP_HOLD_MAX_MS);
  });

  it("is moved by no trouble at the floor, which did not cause it", () => {
    const r = rig();
    r.miss(3);
    r.run(PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0);
    // It rests, then climbs with nothing holding it under the top.
    r.run(PACE_REST_MS - PACE_WINDOW_MS);
    expect(r.pace.level()).toBe(0);
    r.run(PACE_WINDOW_MS + 2000);
    expect(r.pace.level()).toBe(1);
  });

  it("climbs under a film that does not play: it has no frames to keep", () => {
    const r = rig({ playing: false, missed: 0, clock: 71.9, fed: true });
    r.run(2000);
    expect(r.pace.level()).toBe(1);
  });

  it("stays at the floor where nothing can be read of the film", () => {
    const r = rig(null);
    r.run(5000);
    expect(r.pace.level()).toBe(0);
    expect(r.pace.drawEveryMs()).toBe(COVERED_DRAW_MS);
    expect(r.pace.asksPerDraw()).toBe(4);
  });

  it("says how it went in one line", () => {
    const r = rig();
    r.run(2000);
    r.miss(2);
    r.run(PACE_WINDOW_MS);
    expect(paceLine(r.pace.course())).toBe("Load pace under the film: peak 1.00, ended at 0.50; cut 1 time for frames missed (2 in all), 0 for the film's time; held for 0 page stops; 9 windows.");
  });
});
