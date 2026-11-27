/**
 * The page's side of rock faces built off its thread: sends the world's
 * worker sets of cells (`WorldPatchesRequest`, served by `createPatchServer`
 * in `worldWork.ts`) and holds what arrives until the rock faces' rebuild
 * takes it.
 *
 * Each `ask` is a newer set, and the worker drops what is left of an older
 * one, so the new request names every cell whose key has not arrived, even
 * one an older set asked: that cell might never be built otherwise. A reply is
 * kept when its key is named by the newest set and has neither arrived nor
 * been taken; the first reply for a key wins, and a key taken stays taken
 * until a later `ask` names it again. What arrived under a key the newest set
 * does not name is let go at the `ask`.
 *
 * Memory is bounded. The index-to-key lists of the sets asked are kept only
 * while a reply may still come (the newest `KEPT_SETS`, and none older than
 * the set of any reply received; a set's own list ends at its `patchesDone`),
 * and what arrived or was taken is limited to the keys the newest set names.
 *
 * The client fails for good when the worker answers `failed` to it, the link fails (the worker errs, sends a
 * message that cannot be read, or a post throws): it holds nothing, posts
 * nothing and `take` gives undefined. A `failed` reply answers one request: it fails this client alone, of the
 * clients on the link. `dispose` releases the client's hold on the link, which ends the worker once no hold is left.
 *
 * This module imports types only, so it reaches no terrain at run time.
 */
import type { FacePatch } from "./facePatches.js";
import type { WorldLink } from "./worldLink.js";
import type { PatchCellAsk, WorldPatchesRequest } from "./worldWork.js";

/**
 * Counts since the client was made, for the read-out. `workerMs` is the worker's time over every `patch` reply of this
 * client's received, kept or dropped, and `replies` how many those are, so `workerMs / replies` is the worker's time a
 * cell; `arrived` counts only the replies kept.
 */
export type PatchWorkRecord = { asked: number; arrived: number; waiting: number; workerMs: number; replies: number; sets: number; failed: boolean };

export type PatchWork = {
  /** Asks for `cells` as the newest set, `cells[i]` under `keys[i]`. What arrived under a key the set does not name is let go. */
  ask(cells: readonly PatchCellAsk[], keys: readonly number[]): void;
  /** What has arrived under `key`, taken out: the patch, null for a cell with no steep ground, undefined for not yet. */
  take(key: number): FacePatch | null | undefined;
  /** True once the client's request has failed, or the worker has erred or been ended: nothing more will arrive, for good. */
  readonly failed: boolean;
  /** Forgets everything asked and arrived, and sends the worker an empty set so it stops. */
  clear(): void;
  /** Counts since made. */
  record(): PatchWorkRecord;
  /** Releases this client's hold on the link, and stops listening. */
  dispose(): void;
};

/** How many sets' index-to-key lists are kept for replies still to come. */
const KEPT_SETS = 8;

export function createPatchWork(link: WorldLink, input: { seed: number; variant: string }): PatchWork {
  const id = link.nextId();
  let failed = false;
  let released = false;
  let set = 0;
  let asked = 0;
  let arrivedCount = 0;
  let sets = 0;
  let workerMs = 0;
  let replies = 0;
  /** Index-to-key lists of sets a reply may still come for, by set number. */
  const lists = new Map<number, number[]>();
  /** Keys the newest set names, and which of them have not arrived. */
  let wanted = new Set<number>();
  const pending = new Set<number>();
  const arrived = new Map<number, FacePatch | null>();
  const taken = new Set<number>();

  const letGo = (): void => {
    lists.clear();
    wanted = new Set();
    pending.clear();
    arrived.clear();
    taken.clear();
  };
  const fail = (): void => {
    failed = true;
    letGo();
  };
  const post = (cells: PatchCellAsk[]): boolean => {
    set += 1;
    const request: WorldPatchesRequest = { id, kind: "patches", seed: input.seed, variant: input.variant, set, cells };
    if (!link.post(request)) {
      fail();
      return false;
    }
    sets += 1;
    asked += cells.length;
    return true;
  };

  link.listen(id, (reply) => {
    if (failed) return;
    if (reply.kind === "failed") fail();
    else if (reply.kind === "patchesDone") lists.delete(reply.set);
    else if (reply.kind === "patch") {
      workerMs += reply.ms;
      replies += 1;
      for (const older of [...lists.keys()]) if (older < reply.set) lists.delete(older);
      const key = lists.get(reply.set)?.[reply.index];
      if (key === undefined || !wanted.has(key) || arrived.has(key) || taken.has(key)) return;
      arrived.set(key, reply.patch);
      pending.delete(key);
      arrivedCount += 1;
    }
  });
  link.onFail(fail);
  const release = link.hold();

  return {
    ask(cells, keys) {
      if (cells.length !== keys.length) throw new Error("patchWork: cells and keys differ in length");
      if (failed) return;
      const named = new Set(keys);
      for (const key of [...arrived.keys()]) if (!named.has(key)) arrived.delete(key);
      taken.clear();
      wanted = named;
      pending.clear();
      const list: number[] = [];
      const asking: PatchCellAsk[] = [];
      keys.forEach((key, i) => {
        if (arrived.has(key)) return;
        pending.add(key);
        list.push(key);
        asking.push(cells[i] as PatchCellAsk);
      });
      if (!post(asking)) return;
      lists.set(set, list);
      for (const older of [...lists.keys()]) if (older <= set - KEPT_SETS) lists.delete(older);
    },
    take(key) {
      if (failed || !arrived.has(key)) return undefined;
      const patch = arrived.get(key);
      arrived.delete(key);
      taken.add(key);
      return patch;
    },
    get failed() {
      return failed;
    },
    clear() {
      if (failed) return;
      letGo();
      post([]);
    },
    record() {
      return { asked, arrived: arrivedCount, waiting: pending.size, workerMs, replies, sets, failed };
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
