import { describe, expect, it, vi } from "vitest";
import { createFilmClock, sessionNow } from "../../../src/game/film/filmClock.js";

describe("the film clock", () => {
  it("starts at zero", () => {
    expect(createFilmClock(24).time()).toBe(0);
  });

  it("is exactly 30 s after 720 steps at 24 fps, with no drift", () => {
    const clock = createFilmClock(24);
    for (let i = 0; i < 720; i += 1) clock.step();
    expect(clock.time()).toBe(30);
    expect(clock.now()).toBe(30000);
  });

  it("steps one frame on from a seek", () => {
    const clock = createFilmClock(24);
    clock.seek(2.5);
    clock.step();
    expect(clock.time()).toBe(2.5 + 1 / 24);
  });

  it("reads its fps back and honours a start", () => {
    const clock = createFilmClock(30, 4);
    expect(clock.fps).toBe(30);
    expect(clock.time()).toBe(4);
  });

  it("is what the session reads when a film is given, and performance.now otherwise", () => {
    const clock = createFilmClock(24, 1);
    expect(sessionNow({ clock })()).toBe(1000);
    const spy = vi.spyOn(performance, "now").mockReturnValue(123);
    expect(sessionNow(undefined)()).toBe(123);
    spy.mockRestore();
  });
});
