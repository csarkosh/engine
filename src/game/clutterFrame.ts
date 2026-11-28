/**
 * An instance's frame: what the clutter's lists keep for it, its matrix and,
 * for a class that wears the foliage, its ground tint (`KEPT_STRIDE` floats,
 * `instanceLists.ts`). One function for the page's lists and the world's
 * worker, so both write the same floats.
 *
 * Loads no engine.
 */
import type { ClutterInstance } from "../sim/clutter.js";
import { FOLIAGE_BY_CLASS, instanceMatrixFor, trampleFrame, writeFoliage } from "./clutterInstances.js";
import { KEPT_FOLIAGE } from "./instanceLists.js";

/** One matrix's worth of scratch floats, so an instance's matrix can be
 * composed and copied into the kept values at any offset without a
 * per-instance subarray view. */
const scratchMat = new Float32Array(16);

/**
 * An instance's matrix, and its tint for a class that wears the foliage, written
 * at `offset` of `out`. Both are functions of the instance and the seed alone:
 * the trample frame is the trail's, the tint the ground under it. Nothing here
 * depends on the eye, the tier's radius, the time or the wind.
 */
export function clutterFrameInto(seed: number, inst: ClutterInstance, out: Float32Array, offset: number): void {
  const frame = trampleFrame(seed, inst);
  instanceMatrixFor(inst, frame, scratchMat);
  out.set(scratchMat, offset);
  if (FOLIAGE_BY_CLASS.has(inst.cls)) writeFoliage(seed, inst, out, offset + KEPT_FOLIAGE, frame);
}
