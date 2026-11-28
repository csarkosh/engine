/**
 * The page's end of the world's worker, shared by the clients that talk to
 * it (the rock faces' `patchWork.ts`, the rings' `ringWork.ts` and the clutter's `clutterWork.ts`). The link owns the worker's handlers and
 * its end; a client takes an id of its own, listens for the replies that carry
 * it, and holds the worker while it has use for it.
 *
 * A `failed` reply goes to the listener of its id alone, so one client's
 * request failing leaves the others working. The worker itself being of no
 * more use (an `error` event, a message that cannot be read, a post that
 * throws, or the link ended) fails the link, and every client with it.
 *
 * The worker is ended once: when every hold taken has been released, or by
 * `dispose`, whichever comes first.
 *
 * This module imports types only, so it reaches no terrain at run time.
 */
import type { WorldPrepReply } from "./worldWork.js";

export type WorldLink = {
  /** A new id for a client's requests, which no other client of this link has. */
  nextId(): number;
  /** Posts to the worker. A post that throws fails the link and returns false. Posts nothing once failed. */
  post(message: unknown, transfer?: Transferable[]): boolean;
  /** Hears every reply whose `id` is `id`, until `unlisten(id)`. */
  listen(id: number, heard: (reply: WorldPrepReply) => void): void;
  unlisten(id: number): void;
  /** True once the worker itself is of no more use: an `error` event, a message that cannot be read, a post that threw, or the link ended. A `failed` reply does not set it: that reply goes to its id's listener alone. */
  readonly failed: boolean;
  /** Called once, when `failed` becomes true (at once if it already is). */
  onFail(heard: () => void): void;
  /** A client's hold on the worker; the worker is ended when every hold taken has been released, or by `dispose`. */
  hold(): () => void;
  /** Ends the worker now, once, and fails the link. */
  dispose(): void;
};

/** Ids are counted across links, so no two clients on a page share one. */
let lastId = 0;

export function createWorldLink(worker: Worker): WorldLink {
  let failed = false;
  let ended = false;
  let holds = 0;
  const listeners = new Map<number, (reply: WorldPrepReply) => void>();
  const failures: Array<() => void> = [];

  const fail = (): void => {
    if (failed) return;
    failed = true;
    const heard = failures.splice(0);
    for (const call of heard) {
      try {
        call();
      } catch (error) {
        console.error("worldLink: a listener of the link's failure threw.", error);
      }
    }
  };
  const end = (): void => {
    if (ended) return;
    ended = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    listeners.clear();
    worker.terminate();
    fail();
  };

  worker.onmessage = (event: MessageEvent<WorldPrepReply>): void => {
    if (failed) return;
    listeners.get(event.data.id)?.(event.data);
  };
  worker.onerror = (): void => fail();
  worker.onmessageerror = (): void => fail();

  return {
    nextId: () => ++lastId,
    post(message, transfer) {
      if (failed) return false;
      try {
        worker.postMessage(message, transfer ?? []);
      } catch {
        fail();
        return false;
      }
      return true;
    },
    listen(id, heard) {
      if (!ended) listeners.set(id, heard);
    },
    unlisten(id) {
      listeners.delete(id);
    },
    get failed() {
      return failed;
    },
    onFail(heard) {
      if (failed) heard();
      else failures.push(heard);
    },
    hold() {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0) end();
      };
    },
    dispose: end,
  };
}
