/**
 * `window.engineFilm`: what a recorder reads and drives of a film started with `startFilm`
 * (`filmMode.ts`). It seeks, draws a frame at a time, and reads the film's definition and what
 * `checkPath` finds wrong with its camera path; `body.film-ready` is set once the world is in.
 */
import type { GameHandle } from "../../app.js";
import { checkPath, COMFORT } from "./cameraPath.js";
import type { FilmFrame } from "./filmDriver.js";
import type { FilmDefinition } from "./filmMode.js";

/**
 * The film's definition as a recorder reads it: what to record and at what size, and `digest`, a stable hash of
 * everything the frames are made from (`filmDigest`), which a resumed recording must match.
 */
export type EngineFilmDef = Pick<FilmDefinition, "name" | "fps" | "width" | "height" | "seconds" | "loop"> & { recordSeconds: number; digest: string };

export type EngineFilm = {
  def: EngineFilmDef;
  /** Resolves once the world is in (`GameHandle.ready`). */
  ready: Promise<void>;
  seek(t: number): void;
  /** Draws the next frame; resolves with whether the world settled before it was kept, and the draws it took. */
  frame(): Promise<FilmFrame>;
  time(): number;
  /** What breaks the comfort limits along the path (`checkPath`), and a path that does not cover the recording; empty means good. */
  problems: string[];
};

/** The length the path must cover: the film, and the blend of its loop where it has one. */
export function recordSeconds(def: Pick<FilmDefinition, "seconds" | "loop">): number {
  return def.seconds + (def.loop?.blend ?? 0);
}

/** `value` as JSON with every object's keys in order, so two equal definitions give one string. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** FNV-1a over `text`'s UTF-16 code units from `seed`, as 8 hex digits. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A stable hash (16 hex digits) of what a film's frames are made from: the world's token, the frame's size, the fps,
 * the length and the loop, the hour, the weather, every key of the path, and the game's `lookDigest` where it gives
 * one. The name is not in it: a film renamed is the same film.
 */
export function filmDigest(def: FilmDefinition): string {
  const made: Partial<FilmDefinition> = { ...def };
  delete made.name;
  const text = stableJson(made);
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01234567);
}

/** What is wrong with how much of the recording `def`'s path covers: it must start by 0 and end at `recordSeconds` or after. */
export function pathCoverage(def: Pick<FilmDefinition, "path" | "seconds" | "loop">): string[] {
  const keys = def.path.keys;
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) return [];
  const out: string[] = [];
  if (first.t > 0) out.push(`the path starts at t=${first.t} s, after the recording's start at 0 s`);
  const end = recordSeconds(def);
  if (last.t < end) out.push(`the path ends at t=${last.t} s, before the recording's end at ${end} s`);
  return out;
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
    def: { name: def.name, fps: def.fps, width: def.width, height: def.height, seconds: def.seconds, loop: def.loop, recordSeconds: recordSeconds(def), digest: filmDigest(def) },
    ready: handle.ready.then(() => {
      if (typeof document !== "undefined") document.body.classList.add("film-ready");
    }),
    seek: (t) => film.seek(t),
    frame: () => film.frame(),
    time: () => film.time(),
    problems: [...checkPath(def.path, def.fps, COMFORT, groundAt), ...pathCoverage(def)],
  };
  (globalThis as { engineFilm?: EngineFilm }).engineFilm = api;
  return api;
}
