/**
 * The film's clock: time that moves only when `step` is called, one frame of the film at a time.
 *
 * Time is an integer frame count over the fps plus a seek offset, so 720 steps at 24 fps are
 * exactly 30 s and nothing is added up in floating point.
 */
export type FilmClock = {
  /** The film's time in milliseconds: what the session reads where it would read `performance.now()`. */
  now(): number;
  /** The film's time in seconds. */
  time(): number;
  /** Moves the film's time to `t` seconds; the next `step` is one frame on from it. */
  seek(t: number): void;
  /** Moves the film on by exactly one frame, `1 / fps` s. */
  step(): void;
  readonly fps: number;
};

/** What a session is handed to run on a film's clock (Task 5 of the film tool adds fields). */
export type FilmSession = { clock: FilmClock };

export function createFilmClock(fps: number, start = 0): FilmClock {
  let offset = start;
  let frames = 0;
  const time = (): number => offset + frames / fps;
  return {
    fps,
    time,
    now: () => time() * 1000,
    seek(t: number): void {
      offset = t;
      frames = 0;
    },
    step(): void {
      frames += 1;
    },
  };
}

/** The clock a session reads (ms): the film's when one is given, `performance.now` otherwise. */
export function sessionNow(film: FilmSession | undefined): () => number {
  return film === undefined ? () => performance.now() : film.clock.now;
}
