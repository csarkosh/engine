/**
 * A film's frames, drawn one at a time on the film's clock: what `GameHandle.film` is
 * (`app.ts`), and what a recorder drives through `window.engineFilm` (`filmApi.ts`).
 *
 * A frame steps the clock one frame, runs the ticks that step gives, puts the camera where the
 * path is at the clock's time under the film's hour and weather, and draws. The frame after a
 * seek (and the first frame) does not step: it is drawn at the seek's time exactly (a recorder
 * seeks to i / fps and takes the next frame as that time), with the warm frames a cut is given; then it draws on until the world
 * near the camera is built (`settle`), and resolves on the animation frame after, when the
 * picture has been presented and a screenshot reads it. The clock does not move while it
 * settles: every draw of a frame is of the same moment.
 */
import type { FreecamView } from "../rendererTypes.js";
import type { WeatherParams } from "../weather.js";
import { samplePath, type CameraPath } from "./cameraPath.js";
import type { FilmClock } from "./filmClock.js";
import { SETTLE_FRAMES, settle } from "./settle.js";

/** The most draws a frame settles for before it is taken as it stands. */
export const SETTLE_MAX_FRAMES = 600;
/** Draws made at a stretch while settling before the page is given a turn: a model lands, and a worker answers, only between two of the page's tasks. */
export const SETTLE_STRETCH = 8;

export type FilmDriverDeps = {
  clock: FilmClock;
  def: { hour: number; weather: WeatherParams; path: CameraPath };
  /** Runs the simulation ticks the accumulator gives for the clock's step just made. */
  step(): void;
  /** The session's renderer, read when called: what the frame's view goes to and the settle reads. */
  view: {
    setView(hour: number, weather: WeatherParams): void;
    setFreecam(view: FreecamView | null): void;
    waitingItems(): number;
    streaming(): boolean;
  };
  /** Syncs the renderer to the session's state and draws one frame. */
  draw(): void;
  /** Resolves on the page's next animation frame. */
  nextFrame(): Promise<void>;
};

export type FilmDriver = {
  /** Moves the film to `t` seconds; the next frame is drawn at `t` itself, and settles as after a cut. */
  seek(t: number): void;
  /** Steps, draws and settles one frame of the film; resolves once it has been presented. */
  frame(): Promise<void>;
  /** The film's time in seconds. */
  time(): number;
  /** Puts the camera where the path is at the clock's time and draws, the clock unmoved: the frames that bring the world in before the first. */
  still(): void;
};

export function createFilmDriver(deps: FilmDriverDeps): FilmDriver {
  const { clock, def, view } = deps;
  /** The next frame comes after a seek, or is the first: the world round the camera is drawn in before it counts. */
  let cut = true;
  const place = (): void => {
    view.setView(def.hour, def.weather);
    view.setFreecam(samplePath(def.path, clock.time()));
  };
  const busy = (): boolean => view.waitingItems() > 0 || view.streaming();
  let stretch = 0;
  /** One settling draw, with a turn of the page after a stretch of them or while a model is still to land. */
  const settleDraw = async (): Promise<void> => {
    deps.draw();
    stretch += 1;
    if (stretch >= SETTLE_STRETCH || view.waitingItems() > 0) {
      stretch = 0;
      await deps.nextFrame();
    }
  };
  return {
    seek(t) {
      clock.seek(t);
      cut = true;
    },
    async frame() {
      // The frame after a seek (and the first) is of the seek's time itself; every later one is a frame on.
      const after = cut;
      cut = false;
      if (!after) {
        clock.step();
        deps.step();
      }
      place();
      deps.draw();
      if (after) for (let i = 0; i < SETTLE_FRAMES; i++) deps.draw();
      stretch = 0;
      await settle(settleDraw, busy, SETTLE_MAX_FRAMES);
      await deps.nextFrame();
    },
    time: () => clock.time(),
    still() {
      place();
      deps.draw();
    },
  };
}

/** What hides everything on the page under a film but its frame: every element that neither is the film's canvas nor holds it. */
const FILM_ONLY_CSS = "body.film *:not([data-film-canvas]):not(:has([data-film-canvas])) { display: none !important; } body.film [data-film-canvas] { pointer-events: none; }";

/**
 * Marks the page a film's (`body.film`): nothing shows but `canvas`, and the canvas takes no
 * pointer (so nothing asks for its lock). Returns what puts the page back.
 */
export function showFilmOnly(canvas: HTMLCanvasElement): () => void {
  canvas.dataset.filmCanvas = "";
  const style = document.createElement("style");
  style.textContent = FILM_ONLY_CSS;
  document.head.append(style);
  document.body.classList.add("film");
  return () => {
    document.body.classList.remove("film", "film-ready");
    style.remove();
    delete canvas.dataset.filmCanvas;
  };
}
