/**
 * What a beach's piece is drawn with, as plain numbers: which model a kind draws and how big the
 * model is as it ships, and an instance's matrix. `lite/beachMeshes.ts` says what is drawn;
 * `beachField.ts` says which. The kinds are placed by `sim/beach.ts`. Loads no engine.
 *
 * Every piece is placed on the ground's own plane and **sunk into it**, so that it reads as
 * seated and not set down: a cobble by a third of its height, a piece of driftwood by 0.3 of its
 * thickness, a heap of kelp and a tuft by a centimetre or two. The engine has no contact shadow
 * for clutter (the sun casts none on any tier); the only darkening under a piece is the kelp's
 * own, baked into its vertex colours (`kelpHeap.ts`).
 */
import { BEACH_DRIFT, BEACH_KELP, BEACH_KELP_STRAND, BEACH_STONE, type BeachInstance } from "../sim/beach.js";
import { CLUTTER_SINK } from "./clutterInstances.js";
import { seatOnGround } from "./groundTilt.js";
import { composeInto, quatAboutAxis, type Quat, type Vec3 } from "./instancePose.js";

/** The catalog models each kind draws, by variant: the heaps are built in code (`kelpHeap.ts`); the cobbles are
 * the clutter's rocks (rounded, uncut), the driftwood and the grass the clutter's own. */
export const BEACH_MODEL_IDS: readonly (readonly string[])[] = [
  [],
  ["clutter.rock_a", "clutter.rock_b"],
  ["clutter.driftwood"],
  ["clutter.grass_b"],
];

/** The LOD of each a kind draws. The cobbles, the driftwood and the tufts are small and seen at a few paces: one level each, so
 * that a kind is one draw. These are in the files the clutter loads already, and the loader keeps one copy. */
export const BEACH_LOD = "LOD1";

/** The longest side and the height of each model as it ships (m), measured from the files' LOD1 positions. A cobble or a
 * piece of driftwood is scaled so its longest side is the instance's `size`; a tuft so its height is. */
export const STONE_MODEL: readonly { readonly length: number; readonly height: number }[] = [
  { length: 0.32, height: 0.14 },
  { length: 0.12, height: 0.08 },
];
export const DRIFT_MODEL = { length: 0.57, thickness: 0.1, under: 0.04 } as const;
export const GRASS_MODEL = { height: 0.37 } as const;

/** A cobble is flattened to between these shares of its height, and its breadth varied between these, by its own hash. */
export const STONE_FLATTEN: readonly [number, number] = [0.6, 1];
export const STONE_BREADTH: readonly [number, number] = [0.8, 1.2];
/** A cobble is sunk this share of its height. */
export const STONE_SINK = 1 / 3;
/** A piece of driftwood is sunk this share of its thickness, lies within this (rad) either way of the shore. */
export const DRIFT_SINK = 0.3;
export const DRIFT_SWING = 0.5;
/** A heap of kelp: its height as a share of the unit heap's, between these by its length, its breadth's share, and its sink (m). */
export const KELP_FLATTEN: readonly [number, number] = [0.55, 1];
export const KELP_BREADTH: readonly [number, number] = [0.75, 1.25];
export const KELP_SINK = 0.01;
/** A heap lies within this (rad) either way of the contour; a strand is 1 to 2.5 m long. */
export const KELP_SWING = 0.35;
export const KELP_STRAND_LENGTH: readonly [number, number] = [1, 2.5];

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const scratchQ: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** The fractional part of `h` scaled: one more draw out of an instance's one hash, not correlated with its yaw. */
function again(h: number, k: number): number {
  const v = h * k;
  return v - Math.floor(v);
}

/** The instance's world matrix, written into `out` (16 floats, offset 0). */
export function beachMatrix(inst: BeachInstance, out: Float32Array): void {
  const yaw = inst.hash * Math.PI * 2;
  switch (inst.kind) {
    case BEACH_STONE: {
      const model = STONE_MODEL[inst.variant] ?? (STONE_MODEL[0] as (typeof STONE_MODEL)[number]);
      const s = inst.size / model.length;
      const flat = STONE_FLATTEN[0] + (STONE_FLATTEN[1] - STONE_FLATTEN[0]) * again(inst.hash, 97.13);
      const broad = STONE_BREADTH[0] + (STONE_BREADTH[1] - STONE_BREADTH[0]) * again(inst.hash, 31.7);
      seatOnGround(yaw, inst.groundDx, inst.groundDz, scratchQ);
      composeInto(out, 0, s, s * flat, s * broad, scratchQ, inst.x, inst.groundH - STONE_SINK * model.height * s * flat, inst.z);
      return;
    }
    case BEACH_DRIFT: {
      const s = inst.size / DRIFT_MODEL.length;
      // The model's long axis is +Z, which a turn of `a` about Y carries to (sin a, cos a): laid along the contour (-dz, dx).
      const steep = Math.sqrt(inst.groundDx * inst.groundDx + inst.groundDz * inst.groundDz);
      const along = steep > 1e-3 ? Math.atan2(-inst.groundDz, inst.groundDx) : yaw;
      const flip = again(inst.hash, 53.9) < 0.5 ? 0 : Math.PI;
      seatOnGround(along + flip + (again(inst.hash, 17.3) - 0.5) * 2 * DRIFT_SWING, inst.groundDx, inst.groundDz, scratchQ);
      // Its underside is 4 cm below the model's origin: that plus the sink goes under the sand.
      composeInto(out, 0, s, s, s, scratchQ, inst.x, inst.groundH + (DRIFT_MODEL.under - DRIFT_SINK * DRIFT_MODEL.thickness) * s, inst.z);
      return;
    }
    case BEACH_KELP: {
      const t = Math.min(1, Math.max(0, (inst.size - 0.3) / 0.9));
      // Laid along the contour (the model's x, as the drift's z is), swung a little by its own hash, and end for end half the time:
      // the heap is not symmetrical, so the turn shows. A mirror would turn the strips' winding under the one-sided light.
      const steep = Math.sqrt(inst.groundDx * inst.groundDx + inst.groundDz * inst.groundDz);
      const along = steep > 1e-3 ? Math.atan2(-inst.groundDx, -inst.groundDz) : yaw;
      const flip = again(inst.hash, 53.9) < 0.5 ? 0 : Math.PI;
      seatOnGround(along + flip + (again(inst.hash, 17.3) - 0.5) * 2 * KELP_SWING, inst.groundDx, inst.groundDz, scratchQ);
      const broad = KELP_BREADTH[0] + (KELP_BREADTH[1] - KELP_BREADTH[0]) * again(inst.hash, 41.3);
      if (inst.variant === BEACH_KELP_STRAND) {
        // A strand: 1 to 2.5 m long, its thickness its own.
        const length = KELP_STRAND_LENGTH[0] + (KELP_STRAND_LENGTH[1] - KELP_STRAND_LENGTH[0]) * t;
        composeInto(out, 0, length, 1, broad, scratchQ, inst.x, inst.groundH - KELP_SINK, inst.z);
        return;
      }
      const flat = KELP_FLATTEN[0] + (KELP_FLATTEN[1] - KELP_FLATTEN[0]) * t;
      composeInto(out, 0, inst.size, inst.size * flat, inst.size * broad, scratchQ, inst.x, inst.groundH - KELP_SINK, inst.z);
      return;
    }
    default: {
      // A tuft stands: yaw about the vertical, uniform, as the clutter's own grass does.
      const s = inst.size / GRASS_MODEL.height;
      quatAboutAxis(UP, yaw, scratchQ);
      composeInto(out, 0, s, s, s, scratchQ, inst.x, inst.groundH - CLUTTER_SINK, inst.z);
    }
  }
}
