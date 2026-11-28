/**
 * A terrain ring made from its samples: its geometry, its triangles and its plugin vertex data, written into
 * the arrays a mesh is made from. The page's thread and a worker both call `ringBuildSlices`, so a ring is the
 * same to the bit whichever made it. This module loads nothing of the renderer. `ringDrawnOf` and `ringStale`
 * are the record of what a ring was made against and the test of whether it must be made again, and
 * `insideDrawnRing` whether the finest ring drawn still covers the camera.
 */
import { RING_CELLS, holeCellsFor, ringGeometryBuffers, ringGeometrySlices, type CoveredGround, type RingGeometry, type RingSamples } from "./clipmap.js";
import type { Slices } from "./syncJobs.js";
import { terrainVertexDataSlices } from "./terrainVertexData.js";
import { ringVertices } from "./terrainVertices.js";

/** What a drawn ring was made against: its place, its finer and coarser neighbours' places, and the covered ground (NaN where there is none). */
export type RingDrawn = { x: number; z: number; fx: number; fz: number; cx: number; cz: number; kx: number; kz: number; kr: number; kf: number };

/** What a ring made as `ring` stands against `finer`, `coarser` and `cover` is made against: a neighbour or covered ground that is not there is NaN. */
export function ringDrawnOf(ring: RingSamples, finer: RingSamples | null, coarser: RingSamples | null, cover: CoveredGround | null): RingDrawn {
  return {
    x: ring.originX, z: ring.originZ,
    fx: finer?.originX ?? Number.NaN, fz: finer?.originZ ?? Number.NaN,
    cx: coarser?.originX ?? Number.NaN, cz: coarser?.originZ ?? Number.NaN,
    kx: cover?.x ?? Number.NaN, kz: cover?.z ?? Number.NaN, kr: cover?.reach ?? Number.NaN, kf: cover?.fine ?? Number.NaN,
  };
}

/** Whether a ring drawn as `drawn` must be made again to be `now`: any field differs (`Object.is`), or none is drawn. */
export function ringStale(drawn: RingDrawn | null | undefined, now: RingDrawn): boolean {
  if (drawn === null || drawn === undefined) return true;
  return !Object.is(drawn.x, now.x) || !Object.is(drawn.z, now.z) ||
    !Object.is(drawn.fx, now.fx) || !Object.is(drawn.fz, now.fz) ||
    !Object.is(drawn.cx, now.cx) || !Object.is(drawn.cz, now.cz) ||
    !Object.is(drawn.kx, now.kx) || !Object.is(drawn.kz, now.kz) ||
    !Object.is(drawn.kr, now.kr) || !Object.is(drawn.kf, now.kf);
}

/** Whether (camX, camZ) lies inside the finest ring drawn as `drawn` at `spacing`: a build judged at once there can wait for the worker's set, since every ring drawn still covers the camera. */
export function insideDrawnRing(drawn: RingDrawn | null | undefined, spacing: number, camX: number, camZ: number): boolean {
  if (drawn === null || drawn === undefined) return false;
  const side = RING_CELLS * spacing;
  return camX >= drawn.x && camX <= drawn.x + side && camZ >= drawn.z && camZ <= drawn.z + side;
}

/** What a ring is written from. `geometry` is made on first use; `indices` is the ring's triangles at the index buffer's full size; `plugin` its plugin vertex data. */
export type RingBuffers = { geometry: RingGeometry | null; indices: Uint32Array | null; plugin: Float32Array | null };

/**
 * The ring made again from its samples into `to`, in slices: its geometry, then its plugin vertex data, then its
 * triangles. `cover` is the covered ground this ring leaves out, null where it leaves none out (`coversRing`).
 * The hole it leaves for `finer` is `holeCellsFor`, none for the finest ring. The border blends to `coarser`'s
 * samples, so every ring has moved before any ring is made.
 */
export function* ringBuildSlices(
  ring: RingSamples, finer: RingSamples | null, coarser: RingSamples | null, cover: CoveredGround | null, to: RingBuffers,
): Slices {
  const geometry = to.geometry ?? ringGeometryBuffers(finer !== null);
  to.geometry = geometry;
  yield* ringGeometrySlices(ring, finer === null ? null : holeCellsFor(ring, finer), coarser, geometry, cover);
  const vertices = ringVertices(geometry);
  to.plugin = yield* terrainVertexDataSlices(vertices, to.plugin);
  const whole = to.indices ?? new Uint32Array(geometry.indices.length);
  to.indices = whole;
  whole.set(vertices.indices);
  // The triangles left out: three times the first vertex, which draws nothing.
  whole.fill(0, vertices.indices.length);
}
