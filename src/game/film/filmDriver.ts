/**
 * A film's frames, drawn one at a time on the film's clock: what `GameHandle.film` is
 * (`app.ts`), and what a recorder drives through `window.engineFilm` (`filmApi.ts`).
 *
 * A frame steps the clock one frame, runs the ticks that step gives, puts the camera where the
 * path is at the clock's time under the film's hour and weather, and draws. The frame after a
 * seek (and the first frame) does not step: it is drawn at the seek's time exactly (a recorder
 * seeks to i / fps and takes the next frame as that time), with the warm frames a cut is given; then it draws on until the world
 * near the camera is built (`settle`). Then the anti-aliasing starts again (its jitter's first
 * step, a fresh history) and the frame is drawn `FILM_TAA_DRAWS` times more, so the picture kept
 * depends on the film's time alone, never on how long it settled, in a straight run and in one
 * resumed at that frame alike. It resolves on the animation frame after, when the picture has
 * been presented and a screenshot reads it, with whether it settled and how many draws it took.
 * The clock does not move while it settles: every draw of a frame is of the same moment.
 */
import { TAA_SAMPLES } from "../postParams.js";
import type { FreecamView } from "../rendererTypes.js";
import type { WeatherParams } from "../weather.js";
import { samplePath, type CameraPath } from "./cameraPath.js";
import type { FilmClock } from "./filmClock.js";
import { SETTLE_FRAMES, settle } from "./settle.js";

/** The most draws a frame settles for before it is taken as it stands. */
export const SETTLE_MAX_FRAMES = 600;
/** Draws made at a stretch while settling before the page is given a turn: a model lands, and a worker answers, only between two of the page's tasks. */
export const SETTLE_STRETCH = 8;
/** The draws after the anti-aliasing restarts: one whole walk of its jitter, averaged evenly (`TaaFrame.restart`). */
export const FILM_TAA_DRAWS = TAA_SAMPLES;

/** What a film's frame came to: whether the world settled before it was kept, and the draws it took in all. */
export type FilmFrame = { settled: boolean; draws: number };

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
    /** The uploads still streaming, or a rebuild job still pending (one waiting on its worker too). */
    streaming(): boolean;
    /** Starts the anti-aliasing's walk and history again (`WorldRenderer.restartAntialiasing`). */
    restartAntialiasing(): void;
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
  frame(): Promise<FilmFrame>;
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
  let draws = 0;
  const draw = (): void => {
    deps.draw();
    draws += 1;
  };
  /**
   * One settling draw, with a turn of the page after a stretch of them, and after every one while anything is still
   * to come (a model to land, a worker's answer to a job): those arrive only between two of the page's tasks.
   */
  const settleDraw = async (): Promise<void> => {
    draw();
    stretch += 1;
    if (stretch >= SETTLE_STRETCH || busy()) {
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
      draws = 0;
      place();
      draw();
      if (after) for (let i = 0; i < SETTLE_FRAMES; i++) draw();
      stretch = 0;
      const { settled } = await settle(settleDraw, busy, SETTLE_MAX_FRAMES);
      // The picture kept is of a fixed run of draws from a fresh start of the anti-aliasing: the same however long it settled.
      view.restartAntialiasing();
      for (let i = 0; i < FILM_TAA_DRAWS; i++) draw();
      await deps.nextFrame();
      return { settled, draws };
    },
    time: () => clock.time(),
    still() {
      place();
      deps.draw();
    },
  };
}

/**
 * What hides everything on the page under a film but its frame (every element that neither is the film's canvas nor
 * holds it), takes the body's margin and padding away, and holds the canvas at the viewport's corner at the film's
 * size, whatever the page's own styles say: the screenshot is the viewport, the film's size at scale 1.
 */
export function filmOnlyCss(width: number, height: number): string {
  return [
    "body.film *:not([data-film-canvas]):not(:has([data-film-canvas])) { display: none !important; }",
    "body.film { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }",
    `body.film [data-film-canvas] { pointer-events: none; position: fixed !important; left: 0 !important; top: 0 !important; margin: 0 !important; width: ${width}px !important; height: ${height}px !important; }`,
  ].join(" ");
}

/**
 * Marks the page a film's (`body.film`): nothing shows but `canvas`, at the corner at `width` x
 * `height` CSS pixels, and the canvas takes no pointer (so nothing asks for its lock). Returns
 * what puts the page back.
 */
export function showFilmOnly(canvas: HTMLCanvasElement, width: number, height: number): () => void {
  canvas.dataset.filmCanvas = "";
  const style = document.createElement("style");
  style.textContent = filmOnlyCss(width, height);
  document.head.append(style);
  document.body.classList.add("film");
  return () => {
    document.body.classList.remove("film", "film-ready");
    style.remove();
    delete canvas.dataset.filmCanvas;
  };
}
