/**
 * The clutter's rebuild as a job that asks the world's worker for the cells it lacks, waits for the answers, and
 * fills the page's memory from them before the lists are rebuilt (`ClutterLists.rebuild`, unchanged). The rebuild
 * still looks up whatever was not answered, so nothing drawn depends on the worker; a job only gains the time the
 * worker saved it.
 *
 * The wait costs no slice: a turn that has nothing to take yields `SLICE_WAITS`, and the scheduler tries again the
 * next frame. It ends when the newest set this job's own ask left out is answered, when the client has failed (a
 * failed client's `through` is its `last`), or `CLUTTER_WAIT_MS` after the job began, by the clock handed in.
 * A job whose own non-empty ask was refused (two sets already out) does not wait: it takes what has arrived and
 * rebuilds at once. When the clutter is behind (the last wait ended at the bound, and no job has since begun with
 * nothing lacking or seen its set answered) a job asks as usual and does not wait, so a worker that has fallen behind
 * costs one bound, not one per job.
 * This runs only for a crossing judged "later" (`rebuildJobs.ts`), never on a path `finish` runs.
 */
import type { ClutterWork } from "../clutterWork.js";
import type { ClutterAnswer } from "../clutterWire.js";
import { SLICE_WAITS, type Slices } from "../syncJobs.js";

/** The longest a job waits for the worker's answers (ms). */
export const CLUTTER_WAIT_MS = 250;

export type ClutterAsking = {
  work: Pick<ClutterWork, "ask" | "asked" | "last" | "through" | "take" | "filled" | "failed">;
  /** Strips of the cells the lists lack at (x, z) that `asked` does not name (`ClutterLists.unknown`). */
  unknown(x: number, z: number, asked: (key: number) => boolean): Int32Array;
  /** Fills the page's memory from an answer (`ClutterLists.take`); false for one that did not fit, dropped whole. */
  take(strips: Int32Array, answer: ClutterAnswer, x: number, z: number): Slices<boolean>;
  /** The lists' own rebuild, which looks up whatever is still unknown. */
  rebuild(x: number, z: number): Slices;
  /**
   * Whether the worker is behind: one object for the renderer's life, shared by every job. A wait that ends at the
   * bound sets it; one that ends with its set answered clears it, and so does a job that begins with nothing lacking.
   * A job that begins while it is set asks as usual and does not wait.
   */
  behind: { value: boolean };
  /** The next crossing's place, or null for none. */
  ahead: { x: number; z: number } | null;
  /** The clock (ms). */
  now(): number;
  /** Whether the meshes are gone. */
  disposed(): boolean;
  /** Told each time a wait ended at the bound. */
  bounds?(): void;
  /** Told how long the job waited, when it waited at least a frame. */
  waited?(ms: number): void;
};

/** Asks for the cells the lists lack at (x, z) that are not already asked; posts nothing when there are none or two sets are out. */
export function askAhead(p: Pick<ClutterAsking, "work" | "unknown">, x: number, z: number): void {
  p.work.ask(p.unknown(x, z, p.work.asked));
}

/** Takes every answer that has arrived and fills the page's memory from it; each set is marked filled even when the job is ended inside the fill. Returns how many were taken. */
export function* fillArrived(p: Pick<ClutterAsking, "work" | "take">, x: number, z: number): Slices<number> {
  let n = 0;
  for (let held = p.work.take(); held !== null; held = p.work.take()) {
    try {
      yield* p.take(held.strips, held.answer, x, z);
    } finally {
      p.work.filled(held.answer.set);
    }
    n++;
  }
  return n;
}

/**
 * The idle work: fills each arrived answer whole, with no yield between taking it and marking it filled (an answer is
 * a few thousand cells, a moment to remember, so it is not sliced), a yield after each, so none is held across one, then asks for the cells of
 * `ahead` (the next crossing), if any.
 */
export function* fillThenAskAhead(
  p: Pick<ClutterAsking, "work" | "unknown" | "take">,
  x: number,
  z: number,
  ahead: { x: number; z: number } | null,
): Slices {
  for (let held = p.work.take(); held !== null; held = p.work.take()) {
    try {
      // The fill is run to its end here; it does not wait.
      const fill = p.take(held.strips, held.answer, x, z);
      while (fill.next().done !== true);
    } finally {
      p.work.filled(held.answer.set);
    }
    yield;
  }
  if (ahead !== null) askAhead(p, ahead.x, ahead.z);
}

/**
 * Asks the worker for the cells this job lacks, waits for them (a bounded time, at no cost) where it should, fills
 * them, then rebuilds. The order at its start: with the client failed, rebuild and return; else take and fill every
 * arrived answer; note whether any cell is lacking (none: the worker has caught up, `behind` is cleared); ask for the
 * cells not already asked, and for the look-ahead; yield. It then waits only if cells were lacking, its own ask was
 * not refused, and the clutter was not behind when it began.
 */
export function* askThenRebuild(p: ClutterAsking, x: number, z: number): Slices {
  const { work } = p;
  if (work.failed) {
    yield* p.rebuild(x, z);
    return;
  }
  const began = p.now();
  yield* fillArrived(p, x, z);
  if (p.disposed()) return;
  const lacking = p.unknown(x, z, () => false).length > 0;
  if (!lacking) p.behind.value = false;
  const wasBehind = p.behind.value;
  const own = p.unknown(x, z, work.asked);
  const refused = own.length > 0 && work.ask(own) === 0;
  const waitFor = work.last;
  if (p.ahead !== null) askAhead(p, p.ahead.x, p.ahead.z);
  yield;
  let waitedAFrame = false;
  if (lacking && !refused && !wasBehind) {
    for (;;) {
      const got = yield* fillArrived(p, x, z);
      if (p.disposed()) return;
      if (work.through >= waitFor) {
        p.behind.value = false;
        break;
      }
      if (work.failed) break;
      if (p.now() - began >= CLUTTER_WAIT_MS) {
        p.behind.value = true;
        p.bounds?.();
        break;
      }
      waitedAFrame = true;
      if (got > 0) yield;
      else yield SLICE_WAITS;
    }
  }
  if (p.disposed()) return;
  yield* fillArrived(p, x, z);
  if (waitedAFrame) p.waited?.(p.now() - began);
  yield* p.rebuild(x, z);
}
