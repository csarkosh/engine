/**
 * The terrain's rings placed as the world's worker sends them (`ringWork.ts`), apart from the meshes they are written
 * to, which need a GPU: `terrainMeshes.ts` hands this how to ask the worker for a camera place's rings and what it
 * takes to write and show them, as functions, and the ask is made as the job first runs (`askThenPlaceRings`).
 *
 * So a job begun with it asks nothing until the scheduler runs its first slice: a request held behind a job that has
 * started asks nothing until that job is shown, and a job replaced before it ran asks nothing. Each ring that has
 * arrived is held for the frame's upload budget, then written to its level's hidden mesh, a ring a slice, since a
 * ring's write is a long step. A slice that finds nothing arrived and the set not done yields `SLICE_WAITS`: the
 * scheduler tries it again next frame and it costs that frame no slice. Once the set is done and every ring of it is
 * written, the rings written are shown in one step, so no frame draws one ring moved against a neighbour that has not.
 * A worker that fails before the show leaves the set to this thread (`finishHere`), which shows it itself.
 */
import type { RingArrived } from "../ringWork.js";
import { SLICE_WAITS, type Slices } from "../syncJobs.js";

export type RingPlacing = {
  /** Sends the request for this job's camera place. Called once, on the first resumption. */
  ask(): void;
  /** The next arrived ring, taken (`RingWork.take`). */
  arrived(): RingArrived | undefined;
  /** Whether the set is done (`RingWork.done`), the rings' work has failed, the meshes are gone. */
  done(): boolean;
  failed(): boolean;
  disposed(): boolean;
  /** Waits for the frame's upload budget to have room to write `ring`. */
  holdWrite(ring: RingArrived): Slices;
  /** Writes `ring` to its level's hidden mesh. */
  write(ring: RingArrived): void;
  /** Waits for the budget to show the rings written, then shows them in one step. */
  holdShow(): Slices;
  show(): void;
  /** Samples anew on this thread and finishes this job's set there (the worker failed). */
  finishHere(): Slices;
};

/** Asks, then writes each ring as it arrives and shows the set when it is done and every ring of it is written; with none arrived, waits a frame (`SLICE_WAITS`). */
export function* askThenPlaceRings(p: RingPlacing): Slices {
  p.ask();
  let written = false;
  for (;;) {
    if (p.disposed()) return;
    if (p.failed()) break;
    const ring = p.arrived();
    if (ring !== undefined) {
      yield* p.holdWrite(ring);
      if (p.disposed()) return;
      if (p.failed()) break;
      p.write(ring);
      written = true;
      // A ring's write is a long step: the scheduler looks between rings.
      yield;
      continue;
    }
    if (!p.done()) {
      yield SLICE_WAITS;
      continue;
    }
    // Done, and every ring of the set written.
    if (!written) return;
    yield* p.holdShow();
    if (p.disposed()) return;
    if (p.failed()) break;
    p.show();
    return;
  }
  // The worker has failed: the set is finished here, shown included.
  yield* p.finishHere();
}
