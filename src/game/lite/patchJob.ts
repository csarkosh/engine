/**
 * The rock faces' cells placed as the world's worker sends them (`patchWork.ts`), apart from the meshes they are
 * placed in, which need a GPU: `terrainMeshes.ts` asks the worker for a set's cells and hands this what it takes to
 * place them, as functions.
 *
 * A worker's replies reach the page only between tasks of its event loop, never inside a slice, so one pass over the
 * set's cells, nearest first, finds everything that can be placed in a frame. A slice places what has arrived, each
 * cell held for the frame's upload budget first, and ends by the scheduler's clock, read after every cell placed,
 * since a cell placed is a write to the GPU's buffers. A slice that finds nothing arrived yields `SLICE_WAITS`: the
 * scheduler tries it again next frame and it costs that frame no slice. A worker that fails leaves the rest of the set
 * to this thread, a cell a slice and nearest first, as the rock faces' rebuild builds it without a worker.
 */
import type { FacePatch } from "../facePatches.js";
import { SLICE_READ_UNITS, SLICE_WAITS, sliceDue, type Slices } from "../syncJobs.js";

export type PatchPlacing = {
  /** The cells of the set to build, nearest first, as indices into it. */
  changed: readonly number[];
  /** Whether cell `i` is built and placed already. */
  isReady(i: number): boolean;
  /** The key cell `i` is asked and placed under. */
  key(i: number): number;
  /** What the worker has sent for `key`, taken out (`PatchWork.take`). */
  arrived(key: number): FacePatch | null | undefined;
  /** Whether the worker has failed for good. */
  failed(): boolean;
  /** Waits for the upload budget to have room for `patch` as cell `i`. */
  hold(i: number, patch: FacePatch | null): Slices;
  /** Places `patch` as cell `i`. */
  enter(i: number, patch: FacePatch | null): void;
  /** Builds and places cell `i` on this thread, in slices (today's `makeSlices`). */
  makeHere(i: number): Slices;
  /** Whether the meshes are gone. */
  disposed(): boolean;
};

/** Places every cell of `p.changed` as the worker sends it; with nothing arrived, waits a frame (`SLICE_WAITS`). Returns when every cell is ready, or the meshes are gone. */
export function* placeAsked(p: PatchPlacing): Slices {
  /** Whether a cell has been placed since the slice began. */
  let placed = false;
  while (!p.failed()) {
    if (p.disposed()) return;
    let waiting = false;
    for (const i of p.changed) {
      if (p.isReady(i)) continue;
      if (p.failed()) break;
      if (p.disposed()) return;
      const patch = p.arrived(p.key(i));
      if (patch === undefined) {
        waiting = true;
        continue;
      }
      yield* p.hold(i, patch);
      if (p.disposed()) return;
      p.enter(i, patch);
      placed = true;
      if (sliceDue(SLICE_READ_UNITS)) {
        placed = false;
        yield;
      }
    }
    if (p.failed()) break;
    if (!waiting) return;
    // A slice that placed cells is a slice: the next looks again, and waits if nothing more has come.
    if (placed) {
      placed = false;
      yield;
    } else yield SLICE_WAITS;
  }
  // The worker has failed: what is left is built here.
  for (const i of p.changed) {
    if (p.isReady(i)) continue;
    if (p.disposed()) return;
    yield* p.makeHere(i);
    yield;
  }
}
