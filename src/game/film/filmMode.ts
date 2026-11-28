/**
 * Film mode: a game's world recorded on a fixed clock, a camera path through it and no one
 * playing. A film is a definition (`FilmDefinition`); `startFilm` starts a host session on it
 * with what the page's shell starts for a session (the world's worker, its prepared scene, its
 * clients for the rock faces, the rings and the clutter), and hands a recorder
 * `window.engineFilm` (`filmApi.ts`), which draws it a frame at a time (`filmDriver.ts`).
 *
 * The look is the game's own `SessionGame.look`: a game builds a film's `SessionGame` with the
 * film's look.
 */
import { startGame, type GameHandle } from "../../app.js";
import { elevationAt } from "../../sim/terrain.js";
import { SEA_LEVEL } from "../../sim/olympic.js";
import type { ClientSession } from "../../net/client.js";
import type { HostSession } from "../../net/host.js";
import type { AmbientAudio } from "../ambientAudio.js";
import type { RenderPlayer, RenderState } from "../lite/renderGame.js";
import type { PageGame } from "../pageGame.js";
import type { PageHud, PageRenderer, PageWorld, SessionGame } from "../sessionGame.js";
import { sessionWorkers } from "../sessionWorkers.js";
import type { WeatherParams } from "../weather.js";
import { worldInputs } from "../worldInputs.js";
import { createWorldLink } from "../worldLink.js";
import { startWorldPrep, worldPrepLine, type WorldPrepOutcome } from "../worldPrep.js";
import type { PreparedScene } from "../preparedScene.js";
import { startSecondWorld } from "../worldSecond.js";
import type { CameraPath } from "./cameraPath.js";
import { installFilmApi } from "./filmApi.js";
import { createFilmClock } from "./filmClock.js";

/** The tier a film is drawn at. */
export const FILM_TIER = "high" as const;

export type FilmDefinition = {
  /** The film's name, for the files a recorder writes. */
  name: string;
  /** The world's token: the seed and the terrain the session is made from (`worldInputs`). */
  token: string;
  fps: number;
  /** The frame's size in CSS pixels. */
  width: number;
  height: number;
  /** The film's length in seconds, its loop's blend not counted. */
  seconds: number;
  /** A film that loops: its last `blend` seconds are recorded past `seconds`, to blend into its start. */
  loop: { blend: number } | null;
  hour: number;
  weather: WeatherParams;
  path: CameraPath;
};

/** The height a film's camera must stay clear of at (x, z): the higher of the session's ground and the sea. */
export function filmGroundAt(seed: number): (x: number, z: number) => number {
  return (x, z) => Math.max(elevationAt(seed, x, z), SEA_LEVEL);
}

/**
 * Starts the film `def` on `canvas` (in the page, sized by the caller or here to the film's
 * frame) as a host session with no lobby, and sets `window.engineFilm`. `workers` is the game's
 * world worker, as its page hands the shell it (`PageGame.worldWorker`). Resolves once the world
 * is in (`GameHandle.ready`).
 */
export async function startFilm<
  W extends PageWorld<S>,
  S extends RenderState<P>,
  P extends RenderPlayer,
  R extends PageRenderer<S>,
  A extends AmbientAudio,
  H extends PageHud,
  HostS extends HostSession<W, unknown>,
  ClientS extends ClientSession<W, P, S, unknown>,
>(
  canvas: HTMLCanvasElement,
  def: FilmDefinition,
  game: SessionGame<W, S, P, R, A, H, HostS, ClientS>,
  workers: Pick<PageGame<W, S, P, R, A, H, HostS, ClientS>, "worldWorker" | "worldWorkers">,
): Promise<GameHandle> {
  canvas.style.width = `${def.width}px`;
  canvas.style.height = `${def.height}px`;
  // The world's worker makes the trail, the level check and the first scene at the film's tier, as the shell's start does.
  const madeFrom = worldInputs(def.token, location.search);
  const prep = startWorldPrep(madeFrom, workers.worldWorker);
  const second = (workers.worldWorkers ?? 1) >= 2 ? startSecondWorld(workers.worldWorker, madeFrom) : null;
  const sampling = prep.scene(FILM_TIER);
  let outcome: WorldPrepOutcome;
  let sampled: PreparedScene | null;
  try {
    outcome = await prep.ready;
    sampled = await sampling;
  } catch (error) {
    prep.dispose();
    second?.link.dispose();
    throw error;
  }
  console.info(worldPrepLine(outcome));
  const takePrepared = (): PreparedScene | null => {
    const scene = sampled;
    sampled = null;
    return scene;
  };
  const worker = prep.handOver();
  const link = worker === null ? null : createWorldLink(worker);
  const links = second !== null ? [link, second.link] : [link];
  const clients = sessionWorkers(links, madeFrom, () => second);
  let handle: GameHandle;
  try {
    handle = startGame(canvas, def.token, {
      film: { clock: createFilmClock(def.fps), def },
      lobby: null,
      peerId: "film",
      onExit: () => undefined,
      onContinueOffline: () => undefined,
      onPauseChange: () => undefined,
      takePrepared,
      ...clients,
      engineFor: () => ({ canvas: document.createElement("canvas") }),
      engineFailed: (reason) => console.error(`film: the engine failed (${reason}).`),
      // A film's frames are of one renderer: a lost device ends it, and the recorder sees the session end.
      losses: { note: () => ({ losses: 1, recent: 1, sinceMs: null, end: true }), ended: () => undefined },
      tier: FILM_TIER,
      tierSource: "override",
      fallbackTiers: [],
      onTierFallback: () => undefined,
      onGovernorDrop: () => undefined,
      quality: {
        choice: () => FILM_TIER,
        stored: () => false,
        auto: () => null,
        override: FILM_TIER,
        notice: () => null,
        save: () => undefined,
      },
      mode: { choice: () => game.modes.initial, save: () => undefined },
      mute: {
        bind: (apply) => {
          apply(true);
          return () => undefined;
        },
      },
    }, game);
  } catch (error) {
    // A start that throws holds the workers no more: its clients end them.
    clients.patchWork?.dispose();
    clients.ringWork?.dispose();
    clients.clutterWork?.dispose();
    throw error;
  } finally {
    // The build has what it wanted of the worker: the prep lets go of the scene, and of a worker it did not hand over.
    prep.dispose();
  }
  installFilmApi(handle, def, filmGroundAt(madeFrom.seed));
  await handle.ready;
  return handle;
}
