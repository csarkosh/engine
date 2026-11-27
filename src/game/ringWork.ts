/**
 * The page's side of the terrain's rings built off its thread: asks the
 * world's worker for the rings of a camera place (`WorldRingsRequest`, served
 * by `createRingServer` in `ringServe.ts`) and holds the rings that arrive
 * until the terrain's rebuild takes them.
 *
 * The client keeps one id and counts sets up from 1, one for each `ask` and
 * each `stop`; a reply of any set but the one out is dropped. The first `ask`,
 * and the first after a `stop`, carry the rings' samples, which are
 * transferred to the worker: the caller must not touch them afterwards. The
 * worker holds them from then on and re-centres them itself, so later asks
 * carry only the place and what the page has drawn. A ring the page has read
 * is given back, and goes to the worker, transferred, with the next `ask`.
 *
 * A set is `out` from its `ask` until its `ringsDone` (or a `stop`, or a
 * failure), and a second `ask` while one is out throws. `take` gives the
 * rings of the set asked last in the order the worker posted them, once each,
 * also after `ringsDone` until none is left.
 *
 * The client fails for good when the worker answers `failed` to it or the link
 * fails: it holds nothing, posts nothing, `done` is true, `take` gives nothing
 * and `ask` does nothing (a caller checks `failed`). A `failed` reply answers
 * one request and fails this client alone, of the clients on the link.
 * `dispose` stops, releases the client's hold on the link, which ends the
 * worker once no hold is left.
 *
 * This module imports types only (and the wire's pure functions), so it
 * reaches no terrain at run time.
 */
import type { RingSamples } from "./clipmap.js";
import type { RingDrawn } from "./ringBuild.js";
import { ringsRequestTransfer, type RingCover, type RingSent, type WorldRingsRequest } from "./ringWire.js";
import type { WorldLink } from "./worldLink.js";

/** A ring that arrived: its level (0 is the finest), what it was built against, and its buffers. */
export type RingArrived = { level: number; drawn: RingDrawn; ring: RingSent };

/** Counts since the client was made, for the read-out. `workerMs` is the worker's time over the `ringsDone` replies kept. */
export type RingWorkRecord = { sets: number; rings: number; workerMs: number; out: boolean; holds: boolean; failed: boolean };

export type RingWork = {
  /** True once the rings' work has failed, for good: a `failed` reply of this client's id, or the link failed. */
  readonly failed: boolean;
  /** Whether the worker holds this client's rings' samples. */
  readonly holds: boolean;
  /** Whether a set is out and not yet done. */
  readonly out: boolean;
  /** Whether the set asked last is done: every ring of it has arrived. True with none asked. */
  readonly done: boolean;
  /** Asks for the rings for a camera place. `samples` must be given where `holds` is false. Throws while a set is out. */
  ask(a: { camX: number; camZ: number; cover: RingCover | null; drawn: (RingDrawn | null)[]; samples?: RingSamples[] }): void;
  /** The next ring of the set out that has arrived and was not taken, in the order posted. */
  take(): RingArrived | undefined;
  /** Buffers the page no longer reads: sent to the worker with the next `ask`. */
  giveBack(ring: RingSent): void;
  /** Drops the set out and what arrived untaken, and has the worker forget the samples: `holds` becomes false. Late replies are dropped. */
  stop(): void;
  record(): RingWorkRecord;
  /** Stops, releases the link, and fails. */
  dispose(): void;
};

export function createRingWork(link: WorldLink, input: { seed: number; variant: string }): RingWork {
  const id = link.nextId();
  let failed = false;
  let released = false;
  let holds = false;
  let out = false;
  let set = 0;
  let sets = 0;
  let ringsKept = 0;
  let workerMs = 0;
  let arrived: RingArrived[] = [];
  let given: RingSent[] = [];

  const letGo = (): void => {
    holds = false;
    out = false;
    arrived = [];
    given = [];
  };
  const fail = (): void => {
    failed = true;
    letGo();
  };
  const post = (request: WorldRingsRequest): boolean => {
    if (link.post(request, ringsRequestTransfer(request))) return true;
    fail();
    return false;
  };

  link.listen(id, (reply) => {
    if (failed) return;
    if (reply.kind === "failed") fail();
    else if (reply.kind === "ring") {
      if (!out || reply.set !== set) return;
      arrived.push({ level: reply.level, drawn: reply.drawn, ring: reply.ring });
      ringsKept += 1;
    } else if (reply.kind === "ringsDone") {
      if (!out || reply.set !== set) return;
      out = false;
      workerMs += reply.ms;
    }
  });
  link.onFail(fail);
  const release = link.hold();

  const stop = (): void => {
    if (failed || (!holds && !out)) return;
    set += 1;
    const request: WorldRingsRequest = { id, kind: "rings", seed: input.seed, variant: input.variant, set, camX: 0, camZ: 0, cover: null, drawn: [], stop: true };
    letGo();
    post(request);
  };

  return {
    ask(a) {
      if (failed) return;
      if (out) throw new Error("ringWork: a set is out");
      if (!holds && a.samples === undefined) throw new Error("ringWork: the worker holds no samples, and none are given");
      set += 1;
      const request: WorldRingsRequest = { id, kind: "rings", seed: input.seed, variant: input.variant, set, camX: a.camX, camZ: a.camZ, cover: a.cover, drawn: a.drawn };
      if (a.samples !== undefined) request.samples = a.samples;
      if (given.length > 0) request.spare = given;
      arrived = [];
      if (!post(request)) return;
      given = [];
      if (a.samples !== undefined) holds = true;
      sets += 1;
      out = true;
    },
    take() {
      return failed ? undefined : arrived.shift();
    },
    giveBack(ring) {
      if (!failed) given.push(ring);
    },
    stop,
    get failed() {
      return failed;
    },
    get holds() {
      return holds;
    },
    get out() {
      return out;
    },
    get done() {
      return !out;
    },
    record() {
      return { sets, rings: ringsKept, workerMs, out, holds, failed };
    },
    dispose() {
      stop();
      fail();
      link.unlisten(id);
      if (released) return;
      released = true;
      release();
    },
  };
}
