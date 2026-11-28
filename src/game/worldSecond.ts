/**
 * The page's second world worker, for a game that asks for two (`PageGame.worldWorkers`). It is made and given its
 * link at once, and told to prepare the world for itself and say only when it has (`quiet`); a client made on the
 * link may post requests before that, and the worker's own queue holds them behind the prepare. A prepare that fails
 * fails the link, so its clients fall back to the page's thread. Nothing is moved to the first worker.
 */
import { createWorldLink, type WorldLink } from "./worldLink.js";
import type { WorldPrepReply, WorldPrepRequest } from "./worldWork.js";

export type SecondWorld = {
  readonly link: WorldLink;
  /** How long the worker took to prepare (null until it has), and whether it has failed. */
  record(): { preparedMs: number | null; failed: boolean };
};

/** Null where no worker can be made. */
export function startSecondWorld(
  start: () => Worker,
  from: { seed: number; variant: string },
  now: () => number = () => performance.now(),
): SecondWorld | null {
  let worker: Worker;
  try {
    worker = start();
  } catch {
    return null;
  }
  const began = now();
  const link = createWorldLink(worker);
  let preparedMs: number | null = null;
  const id = link.nextId();
  link.listen(id, (reply: WorldPrepReply) => {
    if (reply.kind === "done") {
      preparedMs = now() - began;
      link.unlisten(id);
    } else if (reply.kind === "failed") {
      link.unlisten(id);
      link.dispose();
    }
  });
  const request: WorldPrepRequest = { id, seed: from.seed, variant: from.variant, quiet: true };
  link.post(request);
  return { link, record: () => ({ preparedMs, failed: link.failed }) };
}
