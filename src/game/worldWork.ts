/**
 * The work of a hike's world, done off the page's thread: what the world's
 * worker runs for the game that serves it (`serveWorldWork`). For the hike
 * that is about to start it posts back the two longest computations a world's
 * build opens with, each as it is made: what the terrain variant prepares for
 * the seed (on the default terrain the bowl: the trail graph, the landmarks,
 * the features), and the pass hash, which probes ten chunks at a seed of its
 * own and builds a second trail to do it; and after them the collision chunks
 * the hike's first spawn reads. The page installs them into the sim's caches
 * (`worldPrep.ts`), and its build then finds them made.
 *
 * The pass hash stays what it is on the page: computed at run time, by this
 * build's passes, in the browser that will play the hike. A worker of the
 * page is that browser's engine.
 *
 * A second request, once the page knows the tier it will draw at, asks for
 * the hike's first scene (`preparedScene.ts`): everything the first renderer
 * samples from the ground around the start, the terrain's rings and the
 * water's among it. It is posted with its typed arrays transferred, never
 * copied, and this thread does not touch them again. It finds the bowl the
 * first request made in this thread's own cache.
 *
 * A third request asks for a set of rock-face cells (`facePatches.ts`) of the
 * world the last of those two made: the page's current wish for the steep
 * ground near its camera. The cells are built one at a time, each posted as
 * it is made with its arrays transferred, and the worker's messages are taken
 * between them, so a newer set, or a world or scene request, is served before
 * the rest of an older set is built. A newer set drops what is left of the
 * older, and an empty one is how the page tells the worker to stop.
 *
 * A fourth request asks for the terrain's rings for a camera place
 * (`ringServe.ts`), of the same world: the worker holds the rings' samples
 * the page gave it, re-centres them, and builds and posts each ring that is
 * stale against what the page has drawn, a ring at a time, with its arrays
 * transferred. The rings go before the rock faces, and between two sets of
 * rings one rock-face cell is built where any is asked for.
 */
import { generateChunk, type Chunk } from "../sim/chunk.js";
import { PLAYER_HALF } from "../sim/constants.js";
import { passHash, passHashKey } from "../sim/forest.js";
import type { Vec3 } from "../sim/core.js";
import { activeTerrainVariant, setActiveTerrainVariant } from "../sim/terrain.js";
import type { TrailGraph } from "../sim/trail.js";
import {
  PATCH_FAR_SPACING, PATCH_NEAR_SPACING, PATCH_WIDE_SPACING, facePatchGeometry, type FacePatch, type PatchStitch, type PavedGround,
} from "./facePatches.js";
import { createClutterServer } from "./clutterServe.js";
import type { ClutterAnswer, WorldClutterRequest } from "./clutterWire.js";
import { prepareScene, sceneTransfer, type PreparedScene } from "./preparedScene.js";
import type { QualityTier } from "./quality.js";
import type { RingDrawn } from "./ringBuild.js";
import { createRingServer, createWorkOrder, type RingSent, type WorldRingsRequest } from "./ringServe.js";

/**
 * `skip`: what the page already holds and the worker leaves out. `quiet`: a second worker prepares the world for
 * itself and posts only `done` (or `failed`): no `prepared`, no pass hash and no chunks.
 */
export type WorldPrepRequest = {
  id: number; seed: number; variant: string; skip?: { prepared?: boolean; passHash?: boolean }; quiet?: true;
};
/** The hike's first scene at `tier`: told from the world's request by its `kind`. */
export type WorldSceneRequest = { id: number; kind: "scene"; seed: number; variant: string; tier: QualityTier };
/** One cell of a set: where, at what spacing, and how it meets its neighbours (`facePatchGeometry`). */
export type PatchCellAsk = { ci: number; cj: number; spacing: number; stitch: PatchStitch };
/**
 * A set of rock-face cells for the world of `seed` and `variant`, to be built in order and posted one by one; `set`
 * numbers the page's wishes, and a newer set drops what is left of an older. Told from the others by its `kind`.
 */
export type WorldPatchesRequest = { id: number; kind: "patches"; seed: number; variant: string; set: number; cells: PatchCellAsk[] };
export type WorldPrepReply =
  | { id: number; kind: "prepared"; seed: number; variant: string; prepared: unknown }
  | { id: number; kind: "passHash"; hash: number; passCount: number; variant: string }
  | { id: number; kind: "chunks"; seed: number; variant: string; chunks: Chunk[] }
  | { id: number; kind: "scene"; scene: PreparedScene }
  | { id: number; kind: "patch"; set: number; index: number; patch: FacePatch | null; ms: number }
  | { id: number; kind: "patchesDone"; set: number }
  | { id: number; kind: "ring"; set: number; level: number; drawn: RingDrawn; ring: RingSent; ms: number }
  | { id: number; kind: "ringsDone"; set: number; ms: number }
  | ({ id: number; kind: "clutterCells" } & ClutterAnswer)
  | { id: number; kind: "done" }
  | { id: number; kind: "failed"; message: string };

/** What a game tells the world's work: where a player first stands, and the chunk cells that first spawn reads. */
export type WorldWorkGame = {
  /** Where the first scene is centred for a seed (the active terrain already set), or null where the game says nowhere. */
  startOf(seed: number): { x: number; z: number } | null;
  /** The chunk cells the first spawn reads for a hull of `half`; none where there is no such place. */
  spawnCells(seed: number, half: Vec3): { cx: number; cz: number }[];
};

/**
 * The request's results, posted in order: what the variant prepares for the
 * seed (where it prepares anything), the pass hash, the chunks the first
 * spawn reads, then `done`; either of the first two left out where the
 * request says the page holds it. A terrain
 * the sim does not know, a computation that throws or a result that cannot be
 * posted ends the run with one `failed`, and nothing after it. Returns true
 * where the run ended with `done`, false where it ended with `failed`.
 */
export function prepareWorld(request: WorldPrepRequest, post: (reply: WorldPrepReply) => void, game: WorldWorkGame): boolean {
  const { id, seed, variant } = request;
  try {
    setActiveTerrainVariant(variant);
    if (request.quiet === true) {
      activeTerrainVariant().prepare?.(seed);
      post({ id, kind: "done" });
      return true;
    }
    const prepared = request.skip?.prepared === true ? undefined : activeTerrainVariant().prepare?.(seed);
    if (prepared !== undefined) post({ id, kind: "prepared", seed, variant, prepared });
    if (request.skip?.passHash !== true) post({ id, kind: "passHash", hash: passHash(), ...passHashKey() });
    // The chunks the hike's first spawn reads, for the grid the page is about to make (`installChunks`):
    // sent whatever the page holds, since every hike makes its grid anew. None on a terrain with no trailhead.
    const chunks = game.spawnCells(seed, PLAYER_HALF).map(({ cx, cz }) => generateChunk(seed, cx, cz));
    if (chunks.length > 0) post({ id, kind: "chunks", seed, variant, chunks });
    post({ id, kind: "done" });
    return true;
  } catch (error) {
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * The scene request's results: the scene, posted with every one of its typed
 * arrays' buffers in the transfer list, then `done`. An unknown terrain, a
 * sampling that throws or a scene that cannot be posted is one `failed`, and
 * nothing after it. Returns true where it ended with `done`, false where it
 * ended with `failed`.
 */
export function prepareSceneReply(
  request: WorldSceneRequest, post: (reply: WorldPrepReply, transfer: ArrayBuffer[]) => void, game: WorldWorkGame,
): boolean {
  const { id } = request;
  try {
    const scene = prepareScene(request.seed, request.variant, request.tier, game.startOf);
    post({ id, kind: "scene", scene }, sceneTransfer(scene));
    post({ id, kind: "done" }, []);
    return true;
  } catch (error) {
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) }, []);
    return false;
  }
}

/** The seven buffers of a patch's arrays, for a post that transfers them; none for a cell with no patch. */
export function patchTransfer(patch: FacePatch | null): ArrayBuffer[] {
  if (patch === null) return [];
  return [patch.positions, patch.normals, patch.colors, patch.weights, patch.weights2, patch.cover, patch.indices].map(
    (a) => a.buffer as ArrayBuffer,
  );
}

export type PatchServer = {
  /** Takes `request` as the newest set: what is left of an older one is dropped. */
  ask(request: WorldPatchesRequest): void;
  /** Builds and posts the next cell of the current set; false when there is none left to build. */
  step(): boolean;
};

/** The spacings the bands build at; a cell asked at any other is refused. */
const PATCH_SPACINGS: readonly number[] = [PATCH_NEAR_SPACING, PATCH_FAR_SPACING, PATCH_WIDE_SPACING];

/** The set being built: its request, the next cell to build, and what every cell of it shares. */
type PatchRun = { request: WorldPatchesRequest; next: number; trail: TrailGraph | null; paved: PavedGround | null };

/**
 * The set requests' logic, apart from the worker's loop. `madeFor` is the seed and variant the last world or scene
 * request served, null before any: a set for another world is one `failed`. A step builds the next cell with the
 * active terrain, posts it (a cell with no steep ground as a null patch) with its arrays transferred, and posts
 * `patchesDone` after the last. A cell that throws, a spacing no band has, or a world that is no longer the set's is
 * one `failed` and ends the set. The arrays are not touched after they are posted. The world's trail graph is made
 * once for its seed and variant, by the first set for it, and again only for a set of another world.
 */
export function createPatchServer(
  post: (reply: WorldPrepReply, transfer: ArrayBuffer[]) => void,
  madeFor: () => { seed: number; variant: string } | null,
  now: () => number = () => performance.now(),
): PatchServer {
  let run: PatchRun | null = null;
  /** The trail graph of the world made, with its seed and variant: made for the first set of a world, kept for the next. */
  let trailFor: { seed: number; variant: string; trail: TrailGraph | null } | null = null;
  const trailOf = (seed: number, variant: string): TrailGraph | null => {
    if (trailFor === null || trailFor.seed !== seed || trailFor.variant !== variant) {
      trailFor = { seed, variant, trail: activeTerrainVariant().trailGraph?.(seed) ?? null };
    }
    return trailFor.trail;
  };

  const fail = (id: number, error: unknown): void => {
    run = null;
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) }, []);
  };
  const isMadeFor = (request: WorldPatchesRequest): boolean => {
    const made = madeFor();
    return made !== null && made.seed === request.seed && made.variant === request.variant;
  };

  return {
    ask(request) {
      run = null;
      try {
        if (!isMadeFor(request)) throw new Error(`no world of seed ${request.seed} on terrain "${request.variant}" has been made`);
        const { seed } = request;
        const hook = activeTerrainVariant().pavedGround;
        run = {
          request, next: 0, trail: trailOf(seed, request.variant),
          paved: hook === undefined ? null : (x, z) => hook(seed, x, z),
        };
      } catch (error) {
        fail(request.id, error);
      }
    },
    step() {
      const current = run;
      if (current === null) return false;
      const { request } = current;
      const { id, set } = request;
      try {
        const cell = request.cells[current.next];
        if (cell !== undefined) {
          if (!isMadeFor(request)) throw new Error(`the world of seed ${request.seed} on terrain "${request.variant}" is no longer the one made`);
          if (!PATCH_SPACINGS.includes(cell.spacing)) throw new Error(`no band builds cells at a spacing of ${cell.spacing} m`);
          const start = now();
          const patch = facePatchGeometry(request.seed, cell.ci, cell.cj, cell.spacing, cell.stitch, current.trail, current.paved);
          const ms = now() - start;
          post({ id, kind: "patch", set, index: current.next, patch, ms }, patchTransfer(patch));
          current.next++;
        }
        if (current.next >= request.cells.length) {
          run = null;
          post({ id, kind: "patchesDone", set }, []);
        }
      } catch (error) {
        fail(id, error);
      }
      return true;
    },
  };
}

/**
 * Serves the world's requests in a worker, for `game`: the world's, the first
 * scene's, each served whole when its message is taken, sets of rock-face
 * cells, which `createPatchServer` builds a cell at a time, and sets of rings,
 * which `createRingServer` works a ring at a time, and the clutter's cells,
 * which `createClutterServer` looks up; `createWorkOrder` says which goes
 * next. Between steps the worker's messages are taken (a message to
 * itself over a `MessageChannel`, which a timer, clamped, would not give), so
 * a request that arrives while a set is worked is served before the next step,
 * and a rings request that stops is taken at once. One turn is asked at a
 * time. The seed and variant of the last world or scene request served, where
 * it ended with `done`, are the world a set is built for; after one that failed
 * there is none. Only inside a worker: under Node, where a test imports
 * `prepareWorld`, and on a page, there is no WorkerGlobalScope, and this does
 * nothing.
 */
export function serveWorldWork(game: WorldWorkGame): void {
  if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") {
    let made: { seed: number; variant: string } | null = null;
    const post = (reply: WorldPrepReply, transfer: ArrayBuffer[]): void => self.postMessage(reply, { transfer });
    const patches = createPatchServer(post, () => made);
    const rings = createRingServer(post, () => made);
    const clutter = createClutterServer(post, () => made);
    const order = createWorkOrder(rings, clutter, patches);
    const turn = new MessageChannel();
    let asked = false;
    const next = (): void => {
      if (asked) return;
      asked = true;
      turn.port2.postMessage(null);
    };
    turn.port1.onmessage = (): void => {
      asked = false;
      if (order.step()) next();
    };
    self.onmessage = (event: MessageEvent<WorldPrepRequest | WorldSceneRequest | WorldPatchesRequest | WorldRingsRequest | WorldClutterRequest>): void => {
      const request = event.data;
      if ("kind" in request && request.kind === "patches") {
        patches.ask(request);
        next();
        return;
      }
      if ("kind" in request && request.kind === "rings") {
        rings.ask(request);
        next();
        return;
      }
      if ("kind" in request && request.kind === "clutter") {
        clutter.ask(request);
        next();
        return;
      }
      const served = "kind" in request
        ? prepareSceneReply(request, (reply, transfer) => self.postMessage(reply, { transfer }), game)
        : prepareWorld(request, (reply) => self.postMessage(reply), game);
      made = served ? { seed: request.seed, variant: request.variant } : null;
    };
  }
}
