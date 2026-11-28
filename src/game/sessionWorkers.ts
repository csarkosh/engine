/**
 * A session's clients of the world's workers, from the links the start holds (`shell.ts`'s build, `startFilm`): the
 * rock faces', the rings' and the clutter's, each on the link `WORLD_ROUTES` puts it on (`worldRoutes.ts`), and what
 * the measurement mode reads of them. A worker no kind is on has no client to end it: it ends here.
 */
import { createClutterWork, type ClutterWork } from "./clutterWork.js";
import { createPatchWork, type PatchWork } from "./patchWork.js";
import { createRingWork, type RingWork } from "./ringWork.js";
import type { WorldMadeFrom } from "./worldAhead.js";
import type { WorldLink } from "./worldLink.js";
import { linkFor, type WorldKind, type WorldWorkRead } from "./worldRoutes.js";
import type { SecondWorld } from "./worldSecond.js";

export type SessionWorkers = {
  patchWork: PatchWork | null;
  ringWork: RingWork | null;
  clutterWork: ClutterWork | null;
  worldRead: () => WorldWorkRead;
};

export function sessionWorkers(links: readonly (WorldLink | null)[], madeFrom: WorldMadeFrom, second: () => SecondWorld | null): SessionWorkers {
  const on = <T>(kind: WorldKind, make: (at: WorldLink, from: WorldMadeFrom) => T): T | null => {
    const at = linkFor(kind, links);
    return at === null ? null : make(at, madeFrom);
  };
  const patchWork = on("patches", createPatchWork);
  const ringWork = on("rings", createRingWork);
  const clutterWork = on("clutter", createClutterWork);
  for (const made of links) if (made !== null && !(["rings", "clutter", "patches"] as const).some((kind) => linkFor(kind, links) === made)) made.dispose();
  const routeOf = (kind: WorldKind): number => {
    const at = linkFor(kind, links);
    return at === null ? -1 : links.indexOf(at);
  };
  const worldRead = (): WorldWorkRead => ({
    workers: links.filter((made) => made !== null && !made.failed).length,
    routes: {
      rings: routeOf("rings"),
      clutter: routeOf("clutter"),
      patches: routeOf("patches"),
    },
    second: second()?.record() ?? null,
  });
  return { patchWork, ringWork, clutterWork, worldRead };
}
