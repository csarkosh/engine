/**
 * The page's side of the clutter looked up off its thread: sends the world's worker strips of cells
 * (`WorldClutterRequest`, served by the clutter server in `worldWork.ts`) and hands on what comes back to whoever
 * fills the page's memory. It holds no clutter itself.
 *
 * Each `ask` is a set, numbered up from 1; at most `CLUTTER_WORK_OUT` are unanswered at a time, and a further `ask`
 * posts nothing. The worker answers every set once, in the order asked. A cell is `asked` from the `ask` that names it
 * until `filled` of that set, so the collector does not ask for it again meanwhile; `take` hands over the answers
 * that have arrived, oldest first, and a set taken stays asked until it is filled.
 *
 * `reset` (a new renderer) forgets everything asked and arrived. The sets then still out are answered by the worker
 * all the same: those answers are dropped, and each frees its place among the sets out.
 *
 * The client fails for good when the worker answers `failed` to it or the link fails: nothing is asked, `take` gives
 * null and `through` is `last`, so nothing waits on it. `dispose` releases the client's hold on the link, which ends
 * the worker once no hold is left.
 *
 * This module imports types and the cell key only, so it reaches no terrain at run time.
 */
import { CLUTTER_STRIP_INTS, clutterCellKey, type ClutterAnswer, type WorldClutterRequest } from "./clutterWire.js";
import type { WorldLink } from "./worldLink.js";

/** How many requests may be unanswered at once. */
export const CLUTTER_WORK_OUT = 2;

/** An answer that has arrived, with the strips it was asked with. */
export type ClutterTaken = { strips: Int32Array; answer: ClutterAnswer };

/** Counts since the client was made, for the read-out. */
export type ClutterWorkRecord = {
  /** Requests posted. */
  asked: number;
  /** Cells asked in all. */
  cells: number;
  /** Instances received. */
  instances: number;
  /** Replies received, those dropped after a reset included. */
  answered: number;
  /** The sum of the replies' `ms`. */
  workerMs: number;
  /** Requests unanswered now. */
  out: number;
  /** Asks that posted nothing because `CLUTTER_WORK_OUT` were out. */
  refused: number;
  failed: boolean;
};

export type ClutterWork = {
  /** Asks for `strips` (`CLUTTER_STRIP_INTS` ints each) as the next set and returns its number, or 0 when nothing was posted. */
  ask(strips: Int32Array): number;
  /** True for a cell (by `clutterCellKey`) named by a set posted and not yet `filled`. */
  asked(key: number): boolean;
  /** The newest set posted, 0 before any. */
  readonly last: number;
  /** The newest set whose answer has arrived, 0 before any. `last` once reset or failed, so nothing waits for a set that will be dropped. */
  readonly through: number;
  /** The oldest answer that has arrived and not been taken, or null. */
  take(): ClutterTaken | null;
  /** The set's cells are no longer asked; the answer is no longer held. Nothing for a set not posted or already filled. */
  filled(set: number): void;
  /** Forgets everything asked and arrived, and drops the answers of every set posted so far. */
  reset(): void;
  /** True once a request has failed or the link has: nothing more will be asked or arrive, for good. */
  readonly failed: boolean;
  record(): ClutterWorkRecord;
  /** Releases this client's hold on the link, and stops listening. */
  dispose(): void;
};

export function createClutterWork(link: WorldLink, input: { seed: number; variant: string }): ClutterWork {
  const id = link.nextId();
  let failed = false;
  let released = false;
  let last = 0;
  let through = 0;
  /** Sets up to this number are dropped when they arrive. */
  let dropUpTo = 0;
  let askedCount = 0;
  let cells = 0;
  let instances = 0;
  let answered = 0;
  let workerMs = 0;
  let refused = 0;
  /** Sets posted and not yet answered, dropped ones included. */
  const out = new Set<number>();
  /** Sets posted since the last reset and not yet filled, with the strips they were asked with. */
  const live = new Map<number, Int32Array>();
  /** How many live sets name each cell's key. */
  const counts = new Map<number, number>();
  /** Answers arrived and not taken, oldest first. */
  let waiting: ClutterTaken[] = [];

  const forEachKey = (strips: Int32Array, each: (key: number) => void): void => {
    for (let s = 0; s + CLUTTER_STRIP_INTS <= strips.length; s += CLUTTER_STRIP_INTS) {
      const cls = strips[s] as number;
      for (let cx = strips[s + 1] as number; cx <= (strips[s + 2] as number); cx++) {
        for (let cz = strips[s + 3] as number; cz <= (strips[s + 4] as number); cz++) each(clutterCellKey(cls, cx, cz));
      }
    }
  };
  const forget = (set: number): void => {
    const strips = live.get(set);
    if (strips === undefined) return;
    live.delete(set);
    forEachKey(strips, (key) => {
      const n = (counts.get(key) as number) - 1;
      if (n > 0) counts.set(key, n);
      else counts.delete(key);
    });
  };
  const letGo = (): void => {
    live.clear();
    counts.clear();
    waiting = [];
  };
  const fail = (): void => {
    failed = true;
    letGo();
    through = last;
  };

  link.listen(id, (reply) => {
    if (failed) return;
    if (reply.kind === "failed") {
      fail();
      return;
    }
    if (reply.kind !== "clutterCells") return;
    if (!out.delete(reply.set)) return;
    workerMs += reply.ms;
    answered += 1;
    instances += reply.cells.length / 3;
    const strips = live.get(reply.set);
    if (reply.set <= dropUpTo || strips === undefined) return;
    if (reply.set > through) through = reply.set;
    waiting.push({ strips, answer: reply });
  });
  link.onFail(fail);
  const release = link.hold();

  return {
    ask(strips) {
      if (failed) return 0;
      if (strips.length < CLUTTER_STRIP_INTS) return 0;
      if (out.size >= CLUTTER_WORK_OUT) {
        refused += 1;
        return 0;
      }
      const set = last + 1;
      const request: WorldClutterRequest = { id, kind: "clutter", seed: input.seed, variant: input.variant, set, strips };
      if (!link.post(request)) {
        fail();
        return 0;
      }
      last = set;
      out.add(set);
      live.set(set, strips);
      askedCount += 1;
      forEachKey(strips, (key) => {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        cells += 1;
      });
      return set;
    },
    asked: (key) => counts.has(key),
    get last() {
      return last;
    },
    get through() {
      return through;
    },
    take() {
      return waiting.shift() ?? null;
    },
    filled(set) {
      forget(set);
      waiting = waiting.filter((held) => held.answer.set !== set);
    },
    reset() {
      if (failed) return;
      letGo();
      dropUpTo = last;
      through = last;
    },
    get failed() {
      return failed;
    },
    record() {
      return { asked: askedCount, cells, instances, answered, workerMs, out: out.size, refused, failed };
    },
    dispose() {
      fail();
      link.unlisten(id);
      if (released) return;
      released = true;
      release();
    },
  };
}
