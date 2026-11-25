/**
 * When each part of a session's load ended, for the `ready` row.
 *
 * A session is ready some seconds after it is launched, and one number does
 * not say where they went: on a fast link the wait is the machine's (the
 * pipelines, the parses), on a slow one it is the files', and a part that
 * waits for another (the terrain for the ground's images, the models for the
 * renderer) shows only as a bar standing still. So the loads' own reports
 * (`loadProgress.ts`) are timed as they pass, and what the page asked the
 * network for is read off the browser's record of it:
 *
 * - `groundMs`: the last of the ground's images and the sounds was in.
 * - `terrainMs`: the terrain's first ring stood. The renderer is made before
 *   it, so this is how long the renderer took to stand.
 * - `modelsAskedMs`, `modelsMs`: the first model was asked for, and the last
 *   was in and parsed; `modelsMB` is their size where the catalog or the
 *   answers said it.
 * - `netMB`, `files`, `cached` (`loadNet`): the megabytes that came over the
 *   network, the files asked for, and how many of those the browser's cache
 *   answered. A start with most files cached is a returning player's.
 *
 * Every time is in milliseconds from `from` (the session's launch), and a
 * part that never reported is left out. Pure: the clock and the browser's
 * record are handed in.
 */
import type { LoadProgress, Stage } from "./loadProgress.js";

export type LoadTimes = {
  groundMs?: number;
  terrainMs?: number;
  modelsAskedMs?: number;
  modelsMs?: number;
  modelsMB?: number;
};

export type TimedProgress = {
  /** The progress to report to: everything is passed on to `inner`. */
  progress: LoadProgress;
  /** The times so far, from `from` (the same clock's); a time before it reads 0. */
  read(from: number): LoadTimes;
};

/** The world stage's items that are the terrain's rings (`app.ts`). */
const RING = /^ring\d+$/;

export function timedProgress(inner: LoadProgress, now: () => number): TimedProgress {
  const lastDone = new Map<Stage, number>();
  let firstRing: number | null = null;
  let modelsAsked: number | null = null;
  const modelBytes = new Map<string, number>();
  return {
    progress: {
      total: (stage, n) => inner.total(stage, n),
      start(stage, id, bytes) {
        if (stage === "models") {
          modelsAsked ??= now();
          if (bytes !== undefined) modelBytes.set(id, bytes);
        }
        inner.start(stage, id, bytes);
      },
      bytes(stage, id, loaded, total) {
        if (stage === "models" && total !== undefined) modelBytes.set(id, total);
        inner.bytes(stage, id, loaded, total);
      },
      done(stage, id) {
        const at = now();
        lastDone.set(stage, at);
        if (stage === "world" && RING.test(id)) firstRing ??= at;
        inner.done(stage, id);
      },
      gate: () => inner.gate(),
      view: () => inner.view(),
    },
    read(from) {
      const since = (at: number | null | undefined): number | undefined => (at === null || at === undefined ? undefined : Math.max(0, Math.round(at - from)));
      const out: LoadTimes = {};
      const set = <K extends keyof LoadTimes>(key: K, value: LoadTimes[K] | undefined): void => {
        if (value !== undefined) out[key] = value;
      };
      set("groundMs", since(lastDone.get("ground")));
      set("terrainMs", since(firstRing));
      set("modelsAskedMs", since(modelsAsked));
      if (modelsAsked !== null) set("modelsMs", since(lastDone.get("models")));
      let bytes = 0;
      for (const n of modelBytes.values()) bytes += n;
      if (bytes > 0) out.modelsMB = megabytes(bytes);
      return out;
    },
  };
}

/** What the browser records of a file it asked for (`PerformanceResourceTiming`). */
export type AskedFile = { startTime: number; transferSize: number; encodedBodySize: number };

export type LoadNet = { netMB: number; files: number; cached: number };

/**
 * What the page asked for from `from` on (the page's clock, ms): the megabytes that came over the network, the files
 * with a body, and how many of those the cache answered (nothing transferred). A file of another origin that does not
 * let its sizes be read shows as neither and is not counted.
 */
export function loadNet(entries: readonly AskedFile[], from: number): LoadNet {
  let bytes = 0, files = 0, cached = 0;
  for (const e of entries) {
    if (e.startTime < from || e.encodedBodySize <= 0) continue;
    files++;
    if (e.transferSize === 0) cached++;
    else bytes += e.transferSize;
  }
  return { netMB: megabytes(bytes), files, cached };
}

function megabytes(bytes: number): number {
  return Math.round((bytes / 1048576) * 10) / 10;
}
