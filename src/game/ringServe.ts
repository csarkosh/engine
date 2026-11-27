/**
 * The terrain's rings as the world's worker serves them (`worldWork.ts`): it holds the seven rings' samples for a
 * page, re-centres them on the camera of each set the page asks for, and builds and posts each ring that is stale
 * against what the page has drawn, so the page only writes them to its meshes. The steps are the page's own
 * (`lite/terrainMeshes.ts`): every ring that must move is re-centred first, the finest first, since the border of a
 * ring blends toward the coarser ring's samples; then each stale ring is built with `ringBuildSlices`, the finest
 * first. So a ring the worker posts is the page's to the bit.
 *
 * A ring's positions, normals, plugin vertex data and triangles go to the page transferred, and the worker does not
 * touch them again; the page gives them back with a later request, and the worker builds its next rings into them.
 * Its other vertex arrays never leave the worker and are kept, one set for each shape of ring. Once warm, nothing is
 * made new. This module loads nothing of the renderer.
 */
import {
  RING_COUNT, coversRing, ringGeometryBuffers, ringSampleSlices, snapOrigin,
  type CoveredGround, type RingArrays, type RingGeometry, type RingSamples,
} from "./clipmap.js";
import { ringBuildSlices, ringDrawnOf, ringStale, type RingDrawn } from "./ringBuild.js";
import { finish } from "./syncJobs.js";
import { TERRAIN_VERTEX_FLOATS } from "./terrainVertexData.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import type { PatchServer, WorldPrepReply } from "./worldWork.js";

/** A covered ground as it can be sent: without its paved-ground function. `pavedMargin` is null where the page's has no paved ground. */
export type RingCover = { x: number; z: number; reach: number; fine: number; cell: number; pavedMargin: number | null };
/** A ring as the page writes it: what goes round between the threads. */
export type RingSent = { positions: Float32Array; normals: Float32Array; plugin: Float32Array; indices: Uint32Array };
export type WorldRingsRequest = {
  id: number; kind: "rings"; seed: number; variant: string; set: number;
  camX: number; camZ: number; cover: RingCover | null;
  /** What the page has drawn for each of the seven rings, null for none. */
  drawn: (RingDrawn | null)[];
  /** The seven rings' samples, level 0 first: given where the worker holds none for this id, or the page built on its own thread since. */
  samples?: RingSamples[];
  /** Buffers the page no longer reads, for the worker's next rings. */
  spare?: RingSent[];
  /** Drop the set in hand and forget this id's samples; nothing is answered. */
  stop?: boolean;
};

/** The typed arrays of a ring's samples, which a move swaps whole (`RingArrays`). */
const SAMPLE_ARRAYS = ["h", "hh", "dx", "dz", "colors", "weights", "weights2", "cover", "normals", "lift"] as const satisfies readonly (keyof RingArrays)[];

/** The four buffers of a ring sent, for a post that transfers them. */
export function ringSentTransfer(ring: RingSent): ArrayBuffer[] {
  return [ring.positions, ring.normals, ring.plugin, ring.indices].map((a) => a.buffer as ArrayBuffer);
}

/** The buffers of a request's samples and spare rings, each once, for a post that transfers them. */
export function ringsRequestTransfer(request: WorldRingsRequest): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const ring of request.samples ?? []) for (const name of SAMPLE_ARRAYS) buffers.add(ring[name].buffer as ArrayBuffer);
  for (const ring of request.spare ?? []) for (const buffer of ringSentTransfer(ring)) buffers.add(buffer);
  return [...buffers];
}

export type RingServer = {
  ask(request: WorldRingsRequest): void;
  /** Does the next step of the set in hand (re-centring a ring, or building and posting one, or posting that the set is done); false when there is none. */
  step(): boolean;
  /** Whether a set is in hand. */
  readonly working: boolean;
  /** Arrays made new since made, for the read-out and the tests: none once warm. */
  readonly made: number;
};

/** A page's rings as the worker holds them: the seven rings' samples, and the spare set of sample arrays their moves share. */
type Held = { rings: RingSamples[]; spare: RingArrays[] };

/** The set in hand: its request and rings, the covered ground it leaves out, where it stands, and the time its steps took. */
type RingRun = {
  request: WorldRingsRequest; held: Held; cover: CoveredGround | null;
  /** Re-centring the rings that must move, then building the stale ones. */
  building: boolean;
  /** The level the next step looks from. */
  level: number;
  ms: number;
};

/** A ring's vertex arrays that never leave the worker: a ring's geometry less its positions and normals. */
type KeptGeometry = Omit<RingGeometry, "positions" | "normals">;

/**
 * The rings requests' logic, apart from the worker's loop. `madeFor` is the seed and variant of the world the worker
 * made, null before any: a set for another world is one `failed`, as is a set asked with no samples held for its id,
 * a paved ground asked of a terrain that paves none, or a step that throws. After a failure the set ends and the
 * samples of its id are forgotten. A newer request replaces the set in hand. A ring's `ms` is the time its building
 * took, `ringsDone`'s the whole set's, its re-centring included.
 */
export function createRingServer(
  post: (reply: WorldPrepReply, transfer: ArrayBuffer[]) => void,
  madeFor: () => { seed: number; variant: string } | null,
  now: () => number = () => performance.now(),
): RingServer {
  let run: RingRun | null = null;
  let made = 0;
  const held = new Map<number, Held>();
  /** Buffers given back, by length: positions and normals are one length, the plugin vertex data another, the triangles one a shape of ring. */
  const floats = new Map<number, Float32Array[]>();
  const words = new Map<number, Uint32Array[]>();
  /** The kept arrays of a ring with a hole and of the finest, which has none. */
  const kept = new Map<boolean, KeptGeometry>();

  const keep = <T extends Float32Array | Uint32Array>(pool: Map<number, T[]>, array: T): void => {
    // A buffer transferred elsewhere since is empty, and of no use.
    if (array.length === 0) return;
    const list = pool.get(array.length);
    if (list === undefined) pool.set(array.length, [array]);
    else list.push(array);
  };
  const takeFloats = (length: number): Float32Array => {
    const given = floats.get(length)?.pop();
    if (given !== undefined) return given;
    made++;
    return new Float32Array(length);
  };
  const takeWords = (length: number): Uint32Array => {
    const given = words.get(length)?.pop();
    if (given !== undefined) return given;
    made++;
    return new Uint32Array(length);
  };
  /** The kept arrays of a ring of this shape, made with its first; the first positions and normals made with them go to the pool. */
  const keptOf = (hole: boolean): KeptGeometry => {
    const have = kept.get(hole);
    if (have !== undefined) return have;
    const { positions, normals, ...rest } = ringGeometryBuffers(hole);
    made += 2 + Object.values(rest).filter((v) => ArrayBuffer.isView(v)).length;
    keep(floats, positions);
    keep(floats, normals);
    kept.set(hole, rest);
    return rest;
  };

  const fail = (id: number, error: unknown): void => {
    run = null;
    held.delete(id);
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) }, []);
  };
  const isMadeFor = (request: WorldRingsRequest): boolean => {
    const world = madeFor();
    return world !== null && world.seed === request.seed && world.variant === request.variant;
  };
  /** The covered ground the request names, its paved ground made from the terrain's hook as the rock faces' is (`createPatchServer`). */
  const coveredOf = (request: WorldRingsRequest): CoveredGround | null => {
    const { cover, seed } = request;
    if (cover === null) return null;
    const { x, z, reach, fine, cell, pavedMargin } = cover;
    if (pavedMargin === null) return { x, z, reach, fine, cell };
    const hook = activeTerrainVariant().pavedGround;
    if (hook === undefined) throw new Error(`terrain "${request.variant}" paves no ground, and the rings were asked to keep clear of it`);
    return { x, z, reach, fine, cell, paved: (px, pz) => hook(seed, px, pz), pavedMargin };
  };

  /** Re-centres the next ring from `run.level` whose snapped origin differs; false where none does. */
  const moveNext = (current: RingRun): boolean => {
    const { rings, spare } = current.held;
    const { camX, camZ, seed } = current.request;
    for (let level = current.level; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      if (snapOrigin(camX, ring.spacing) === ring.originX && snapOrigin(camZ, ring.spacing) === ring.originZ) continue;
      // A move with no spare set makes one; the ring's old set is the spare after it.
      const fresh = spare.length === 0;
      finish(ringSampleSlices(ring, seed, camX, camZ, spare));
      if (fresh) made += SAMPLE_ARRAYS.length;
      current.level = level + 1;
      return true;
    }
    return false;
  };

  /** Builds and posts the next ring from `run.level` that is stale; false where none is. */
  const buildNext = (current: RingRun): boolean => {
    const { rings } = current.held;
    const { id, set, drawn } = current.request;
    for (let level = current.level; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
      const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
      const cover = coversRing(current.cover, ring.spacing) ? current.cover : null;
      const against = ringDrawnOf(ring, finer, coarser, cover);
      if (!ringStale(drawn[level], against)) continue;
      const shape = keptOf(finer !== null);
      const vertices = shape.cover.length;
      const geometry: RingGeometry = { ...shape, positions: takeFloats(vertices * 3), normals: takeFloats(vertices * 3) };
      const to = { geometry, indices: takeWords(shape.indices.length), plugin: takeFloats(vertices * TERRAIN_VERTEX_FLOATS) };
      const start = now();
      finish(ringBuildSlices(ring, finer, coarser, cover, to));
      const ms = now() - start;
      current.ms += ms;
      current.level = level + 1;
      const sent: RingSent = { positions: geometry.positions, normals: geometry.normals, plugin: to.plugin, indices: to.indices };
      post({ id, kind: "ring", set, level, drawn: against, ring: sent, ms }, ringSentTransfer(sent));
      return true;
    }
    return false;
  };

  return {
    get working() {
      return run !== null;
    },
    get made() {
      return made;
    },
    ask(request) {
      run = null;
      for (const ring of request.spare ?? []) {
        keep(floats, ring.positions);
        keep(floats, ring.normals);
        keep(floats, ring.plugin);
        keep(words, ring.indices);
      }
      const { id } = request;
      if (request.stop === true) {
        held.delete(id);
        return;
      }
      try {
        if (request.samples !== undefined) {
          if (request.samples.length !== RING_COUNT) throw new Error(`${request.samples.length} rings of samples given, not ${RING_COUNT}`);
          held.set(id, { rings: request.samples, spare: held.get(id)?.spare ?? [] });
        }
        if (!isMadeFor(request)) throw new Error(`no world of seed ${request.seed} on terrain "${request.variant}" has been made`);
        const mine = held.get(id);
        if (mine === undefined) throw new Error(`no rings are held for ${id}, and none were given`);
        run = { request, held: mine, cover: coveredOf(request), building: false, level: 0, ms: 0 };
      } catch (error) {
        fail(id, error);
      }
    },
    step() {
      const current = run;
      if (current === null) return false;
      const { request } = current;
      const { id, set } = request;
      try {
        if (!isMadeFor(request)) throw new Error(`the world of seed ${request.seed} on terrain "${request.variant}" is no longer the one made`);
        if (!current.building) {
          const start = now();
          const moved = moveNext(current);
          if (moved) {
            current.ms += now() - start;
            return true;
          }
          // Every ring has moved: the builds begin, the finest first.
          current.building = true;
          current.level = 0;
        }
        if (buildNext(current)) return true;
        run = null;
        post({ id, kind: "ringsDone", set, ms: current.ms }, []);
      } catch (error) {
        fail(id, error);
      }
      return true;
    },
  };
}

/** Which of the worker's two kinds of work goes next: the rings first, and one rock-face cell between two sets of rings. */
export function createWorkOrder(rings: Pick<RingServer, "step" | "working">, patches: Pick<PatchServer, "step">): { step(): boolean } {
  /** Whether a set of rings ended since a rock-face cell was last offered its turn. */
  let owed = false;
  return {
    step() {
      if (!rings.working) {
        owed = false;
        return patches.step();
      }
      if (owed) {
        owed = false;
        if (patches.step()) return true;
      }
      rings.step();
      if (!rings.working) owed = true;
      return true;
    },
  };
}
