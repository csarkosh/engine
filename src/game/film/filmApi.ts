/**
 * `window.engineFilm`: what a recorder reads and drives of a film started with `startFilm`
 * (`filmMode.ts`). It seeks, draws a frame at a time, and reads the film's definition and what
 * `checkPath` finds wrong with its camera path; `body.film-ready` is set once the world is in.
 */
import type { GameHandle } from "../../app.js";
import { checkPath, COMFORT } from "./cameraPath.js";
import type { FilmDefinition } from "./filmMode.js";

/** The film's definition as a recorder reads it: what to record and at what size. */
export type EngineFilmDef = Pick<FilmDefinition, "name" | "fps" | "width" | "height" | "seconds" | "loop"> & { recordSeconds: number };

export type EngineFilm = {
  def: EngineFilmDef;
  /** Resolves once the world is in (`GameHandle.ready`). */
  ready: Promise<void>;
  seek(t: number): void;
  frame(): Promise<void>;
  time(): number;
  /** What breaks the comfort limits along the path (`checkPath`); empty means good. */
  problems: string[];
};

/** The length the path must cover: the film, and the blend of its loop where it has one. */
export function recordSeconds(def: Pick<FilmDefinition, "seconds" | "loop">): number {
  return def.seconds + (def.loop?.blend ?? 0);
}

/**
 * Sets `window.engineFilm` for `handle`'s film. `groundAt` is the height the camera must stay
 * clear of: the higher of the session's ground and the sea.
 */
export function installFilmApi(
  handle: Pick<GameHandle, "ready" | "film">,
  def: FilmDefinition,
  groundAt: (x: number, z: number) => number,
): EngineFilm {
  const film = handle.film;
  if (film === undefined) throw new Error("installFilmApi: the session is not a film's (no GameHandle.film)");
  const api: EngineFilm = {
    def: { name: def.name, fps: def.fps, width: def.width, height: def.height, seconds: def.seconds, loop: def.loop, recordSeconds: recordSeconds(def) },
    ready: handle.ready.then(() => {
      if (typeof document !== "undefined") document.body.classList.add("film-ready");
    }),
    seek: (t) => film.seek(t),
    frame: () => film.frame(),
    time: () => film.time(),
    problems: checkPath(def.path, def.fps, COMFORT, groundAt),
  };
  (globalThis as { engineFilm?: EngineFilm }).engineFilm = api;
  return api;
}
