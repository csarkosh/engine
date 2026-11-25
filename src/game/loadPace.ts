/**
 * How fast a session loads under a film, set by the film's own frames.
 *
 * A session that starts under a film (the intro) is drawn there unseen, so
 * its shaders, pipelines and buffers are made before the cut. Those draws and
 * the pipelines they ask for use the graphics chip that presents the film,
 * and how much of it a machine can spare differs by a factor of ten or more
 * between a phone and a desktop. A fixed pace is right for one machine: four
 * draws a second kept a phone's film whole, and held a laptop's load to
 * sixteen pipelines a second while the laptop stood idle.
 *
 * So the pace is one number, the level, from 0 (the floor: what the slowest
 * machine measured can afford) to 1 (the top: a draw every frame), and the
 * film says which way it goes. The law (`frame`), judged a window at a time:
 *
 * - The film kept its frames and its time through the window, and the page
 *   itself did not stop: the level climbs a step. From the floor to the top
 *   is `1 / PACE_STEP` windows, two seconds.
 * - The film missed a frame, or its time fell behind the page's by more than
 *   `CLOCK_SLIP_S` while it played with data in hand: the level halves, does
 *   not climb again for `PACE_REST_MS`, and for a while is held under where
 *   the trouble came (`PACE_CAP_SHARE` of that level). The hold is
 *   `PACE_CAP_HOLD_MS` the first time and doubles with each trouble after,
 *   to `PACE_CAP_HOLD_MAX_MS` at most, so a machine that cannot afford a
 *   level is asked again less and less often.
 * - The page stopped for more than `PAGE_STOP_MS` in the window (a model's
 *   parse, a build's slice): the level holds. A stop is the load's work on
 *   the page's thread, which the film mostly plays through; it is no reason
 *   to draw more.
 * - A film that does not play (paused, ended) has no frames to keep: the
 *   level climbs. A film nothing can be read of (`filmFrames.ts`) is never
 *   known to be whole: the level stays at the floor.
 *
 * What is not the pace's doing does not move it. A film whose time stands
 * because it has no data ahead waits for the link, and one whose time stood
 * while the page drew no frame for `PACE_AWAY_MS` was paused with its tab:
 * neither is a slip. Trouble at the floor moves nothing, the floor not being
 * what caused it; and the level is the floor or a whole step above it, never
 * between, so trouble a step up comes back to the floor itself, and a level
 * that cannot be held a step up is held at the floor.
 *
 * What the level sets: how often the covered session is drawn
 * (`drawEveryMs`), and how many pipelines a draw may ask for
 * (`asksPerDraw`). Both at the floor are what the load was fixed at before.
 * Nothing here loads an engine or touches the page.
 */
import { COVERED_DRAW_MS } from "./coveredDraw.js";
import type { FilmFramesProbe, FilmFrames } from "./filmFrames.js";

/** The window the film is judged over (ms). */
export const PACE_WINDOW_MS = 250;
/** What a clean window adds to the level. */
export const PACE_STEP = 1 / 8;
/** After trouble, the level does not climb for this long (ms). */
export const PACE_REST_MS = 1000;
/** The share of the level trouble came at that the level is then held under. */
export const PACE_CAP_SHARE = 0.75;
/** How long the first trouble's hold lasts (ms); each trouble after doubles it, to the most a hold lasts. */
export const PACE_CAP_HOLD_MS = 10_000;
export const PACE_CAP_HOLD_MAX_MS = 60_000;
/** A playing film whose time fell this far behind the page's in a window stood (s). */
export const CLOCK_SLIP_S = 0.1;
/** A frame of the page this long after the one before is a stop of the page (ms). */
export const PAGE_STOP_MS = 100;
/** And this long after, the page was away (its tab hidden, its film paused with it): the film's time is not judged across it (ms). */
export const PACE_AWAY_MS = 1000;

/** The draws at the top: one every frame of a page at 60 a second. */
export const TOP_DRAW_MS = 16;
/** The most pipelines one draw asks for, at any level: a draw's asks are compiled together on the thread that presents the film. */
export const ASKS_PER_DRAW_MAX = 4;
/** The pipelines asked for a second at the floor (four a draw, four draws a second) and at the top (one a frame). */
export const FLOOR_ASKS_PER_S = (ASKS_PER_DRAW_MAX * 1000) / COVERED_DRAW_MS;
export const TOP_ASKS_PER_S = 60;

/** The time between the covered session's draws at `level` (ms): the floor's at 0, the top's at 1, a constant ratio a step between. */
export function drawEveryMs(level: number): number {
  return COVERED_DRAW_MS * Math.pow(TOP_DRAW_MS / COVERED_DRAW_MS, clamp01(level));
}

/** The pipelines a draw may ask for at `level`: the level's rate over its draws, one at least and `ASKS_PER_DRAW_MAX` at most. */
export function asksPerDraw(level: number): number {
  const rate = FLOOR_ASKS_PER_S * Math.pow(TOP_ASKS_PER_S / FLOOR_ASKS_PER_S, clamp01(level));
  return Math.max(1, Math.min(ASKS_PER_DRAW_MAX, Math.round((rate * drawEveryMs(level)) / 1000)));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** What a pace did, from its first frame on. */
export type PaceCourse = {
  /** The highest level reached, and the level now. */
  peak: number;
  level: number;
  /** Windows judged. */
  windows: number;
  /** Times the level was cut: for frames the film missed, and for its time falling behind. */
  missed: number;
  slips: number;
  /** The film's frames missed in all while it was paced. */
  frames: number;
  /** Windows the level held for a stop of the page. */
  stops: number;
};

export type LoadPace = {
  /** A frame of the page at `now` (ms, the page's clock): the film is read, and at a window's end the level set. */
  frame(now: number): void;
  level(): number;
  drawEveryMs(): number;
  asksPerDraw(): number;
  course(): PaceCourse;
};

export function createLoadPace(film: FilmFramesProbe): LoadPace {
  let level = 0;
  /** The level's bound after trouble, and when it lifts. */
  let cap = 1;
  let capUntil = 0;
  let restUntil = 0;
  let troubles = 0;
  let lastFrame: number | null = null;
  let windowFrom: number | null = null;
  let filmFrom: FilmFrames | null = null;
  let stopped = false;
  let away = false;
  const course: PaceCourse = { peak: 0, level: 0, windows: 0, missed: 0, slips: 0, frames: 0, stops: 0 };

  function trouble(now: number): void {
    if (level > 0) {
      troubles++;
      // Held under a share of where it came; a share that is under one step is the floor.
      const under = level * PACE_CAP_SHARE;
      cap = Math.min(cap, under < PACE_STEP ? 0 : under);
      capUntil = now + Math.min(PACE_CAP_HOLD_MAX_MS, PACE_CAP_HOLD_MS * Math.pow(2, troubles - 1));
      level /= 2;
      if (level < PACE_STEP) level = 0;
    }
    restUntil = now + PACE_REST_MS;
  }

  function judge(to: FilmFrames | null, elapsedMs: number, now: number): void {
    course.windows++;
    if (now >= capUntil) cap = 1;
    if (filmFrom === null || to === null) {
      // Nothing is read of the film: it is never known to be whole.
      level = 0;
      return;
    }
    const missed = to.missed - filmFrom.missed;
    // The film's time standing is the machine's doing only where the film had data to play and the page was here.
    const slipped = !away && filmFrom.playing && to.playing && filmFrom.fed && to.fed && to.clock - filmFrom.clock < elapsedMs / 1000 - CLOCK_SLIP_S;
    if (missed > 0) {
      course.missed++;
      course.frames += missed;
      trouble(now);
    } else if (slipped) {
      course.slips++;
      trouble(now);
    } else if (stopped) {
      course.stops++;
    } else if (now >= restUntil) {
      level = Math.min(cap, level + PACE_STEP);
    }
    course.peak = Math.max(course.peak, level);
  }

  return {
    frame(now) {
      if (lastFrame !== null && now - lastFrame > PAGE_STOP_MS) stopped = true;
      if (lastFrame !== null && now - lastFrame > PACE_AWAY_MS) away = true;
      lastFrame = now;
      if (windowFrom === null) {
        windowFrom = now;
        filmFrom = film();
        return;
      }
      if (now - windowFrom < PACE_WINDOW_MS) return;
      const to = film();
      judge(to, now - windowFrom, now);
      windowFrom = now;
      filmFrom = to;
      stopped = false;
      away = false;
    },
    level: () => level,
    drawEveryMs: () => drawEveryMs(level),
    asksPerDraw: () => asksPerDraw(level),
    course: () => ({ ...course, level }),
  };
}

/** A line for the console of how a load was paced under its film. */
export function paceLine(course: PaceCourse): string {
  return `Load pace under the film: peak ${course.peak.toFixed(2)}, ended at ${course.level.toFixed(2)}; cut ${course.missed} time${course.missed === 1 ? "" : "s"} for frames missed (${course.frames} in all), ${course.slips} for the film's time; held for ${course.stops} page stop${course.stops === 1 ? "" : "s"}; ${course.windows} windows.`;
}
