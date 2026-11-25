/**
 * The endless highway's pure math: a warped line in
 * coast-distance space, a C² cubic-B-spline grade line over a coarse lattice
 * of the pre-road field, and the C² cut-and-fill corridor blend. This module
 * knows nothing about the coast — blend-window values arrive as parameters —
 * so `olympic.ts` composes it without a dependency cycle.
 *
 * sim/ determinism rules apply: everything here is polynomial plus fbm2d.
 */
import { fbm2dInto, NOISE } from "./field.js";
import type { TerrainSample } from "./terrain.js";

// ---- Tunables (all join the olympic variant record) ------------------------
export const ROAD_WINDOW_FRACTION = 0.12;
export const ROAD_WOBBLE = 0.4;
export const ROAD_WOBBLE_WAVELENGTH = 1400;
export const ROAD_WOBBLE_OCTAVES = 2;
export const ROAD_SALT = 0x40ad;
export const ROAD_LATTICE = 480;
export const ROAD_BED_HALF = 5.5;
export const ROAD_CORRIDOR_HALF = 30;

/** Same off-lattice first coordinate the coast warp uses for 1-D fbm. */
const WOBBLE_LINE_X = 0.318;

/**
 * The road's own coast distance d_r(z) and its exact z-derivative.
 *
 * d_r = (blendStart + ROAD_CORRIDOR_HALF)
 *     + ROAD_WINDOW_FRACTION·(blendEnd − blendStart)·(1 + ROAD_WOBBLE·wobble)
 *
 * The floor term is a structural invariant: the wobble factor is
 * positive for |v| ≤ 1, so the corridor's west edge (d_r − ROAD_CORRIDOR_HALF)
 * can never reach seaward of blendStart — the earthworks never touch the
 * beach band, whatever the two warps do.
 */
export function roadOffsetD(
  seed: number,
  z: number,
  blendStart: number,
  blendEnd: number,
  blendEndDz: number,
): { dr: number; drDz: number } {
  roadOffsetInto(seed, z, blendStart, blendEnd, blendEndDz);
  return { dr: ROAD_OFFSET.dr, drDz: ROAD_OFFSET.drDz };
}

/**
 * Where `roadOffsetInto` leaves its answer. Written by every call of it and read by number, at once, before any
 * other call that may ask for the road's offset (the coast's grade lattice does so from inside a sample).
 */
export const ROAD_OFFSET = { dr: 0, drDz: 0 };

/** `roadOffsetD`, left in `ROAD_OFFSET`: no record is made. */
export function roadOffsetInto(
  seed: number,
  z: number,
  blendStart: number,
  blendEnd: number,
  blendEndDz: number,
): void {
  fbm2dInto(WOBBLE_LINE_X, z / ROAD_WOBBLE_WAVELENGTH, seed ^ ROAD_SALT, ROAD_WOBBLE_OCTAVES);
  const factor = 1 + ROAD_WOBBLE * NOISE.v;
  const factorDz = (ROAD_WOBBLE * NOISE.dz) / ROAD_WOBBLE_WAVELENGTH;
  const span = blendEnd - blendStart;
  ROAD_OFFSET.dr = blendStart + ROAD_CORRIDOR_HALF + ROAD_WINDOW_FRACTION * span * factor;
  ROAD_OFFSET.drDz = ROAD_WINDOW_FRACTION * (blendEndDz * factor + span * factorDz);
}

/**
 * The grade line: a uniform cubic B-spline over `latticeH(i)` — the pre-road
 * terrain height at centerline lattice point i (spacing ROAD_LATTICE). Any
 * query touches exactly four lattice points; the spline is C² with a
 * closed-form derivative, low-passing the field at the lattice scale. It
 * APPROXIMATES rather than interpolates — deliberate: the grade line never
 * needs to touch the terrain; cut-and-fill absorbs the difference.
 */
export function gradeSplineD(
  latticeH: (i: number) => number,
  z: number,
  spacing: number = ROAD_LATTICE,
): { h: number; dz: number } {
  gradeSplineInto(latticeH, z, spacing);
  return { h: GRADE.h, dz: GRADE.dz };
}

/** Where `gradeSplineInto` leaves its answer: written by every call of it, read by number at once. */
export const GRADE = { h: 0, dz: 0 };

/** `gradeSplineD`, left in `GRADE`: no record is made. */
export function gradeSplineInto(
  latticeH: (i: number) => number,
  z: number,
  spacing: number = ROAD_LATTICE,
): void {
  const s = z / spacing;
  const i = Math.floor(s);
  const t = s - i;
  const p0 = latticeH(i - 1);
  const p1 = latticeH(i);
  const p2 = latticeH(i + 1);
  const p3 = latticeH(i + 2);
  const omt = 1 - t;
  const b0 = (omt * omt * omt) / 6;
  const b1 = (3 * t * t * t - 6 * t * t + 4) / 6;
  const b2 = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6;
  const b3 = (t * t * t) / 6;
  const db0 = -(omt * omt) / 2;
  const db1 = (3 * t * t - 4 * t) / 2;
  const db2 = (-3 * t * t + 2 * t + 1) / 2;
  const db3 = (t * t) / 2;
  GRADE.h = b0 * p0 + b1 * p1 + b2 * p2 + b3 * p3;
  GRADE.dz = (db0 * p0 + db1 * p1 + db2 * p2 + db3 * p3) / spacing;
}

/** Where `smootherstepInto` leaves its answer; read it by number, at once, before any other call. */
const STEP = { v: 0, d: 0 };

/** Quintic smootherstep with derivative — same shape as olympic.ts's. Left in `STEP`. */
function smootherstepInto(edge0: number, edge1: number, x: number): void {
  const span = edge1 - edge0;
  if (x <= edge0) { STEP.v = 0; STEP.d = 0; return; }
  if (x >= edge1) { STEP.v = 1; STEP.d = 0; return; }
  const t = (x - edge0) / span;
  STEP.v = t * t * t * (t * (t * 6 - 15) + 10);
  STEP.d = (30 * t * t * (t - 1) * (t - 1)) / span;
}

/**
 * The cut-and-fill blend: h = w·grade + (1 − w)·base with
 * w = 1 − smootherstep(BED, CORRIDOR, |u|). `u` is the signed road offset
 * (u = d − d_r, so ∂u/∂x = 1 and ∂u/∂z = uDz arrives from the caller's
 * chain rule). Early returns make the two guarantees exact by construction:
 * outside the corridor the base sample is returned AS THE SAME OBJECT
 * (bit-identity), and on the bed h is exactly the grade with dx = 0.
 */
export function corridorD(
  u: number,
  uDz: number,
  grade: { h: number; dz: number },
  base: TerrainSample,
): TerrainSample {
  if (!corridorInto(u, uDz, grade.h, grade.dz, base.h, base.dx, base.dz)) return base;
  return { h: CORRIDOR.h, dx: CORRIDOR.dx, dz: CORRIDOR.dz };
}

/** Where `corridorInto` leaves its answer when it returns true: written by every call of it, read by number at once. */
export const CORRIDOR = { h: 0, dx: 0, dz: 0 };

/**
 * `corridorD` on numbers: the grade's height and z-slope (`gh`, `gdz`) and the base's height and partials.
 * Returns false, writing nothing, where the base stands as it is (outside the corridor); true after
 * writing `CORRIDOR`.
 */
export function corridorInto(
  u: number,
  uDz: number,
  gh: number,
  gdz: number,
  bh: number,
  bdx: number,
  bdz: number,
): boolean {
  const a = Math.abs(u);
  if (a >= ROAD_CORRIDOR_HALF) return false;
  if (a <= ROAD_BED_HALF) {
    CORRIDOR.h = gh;
    CORRIDOR.dx = 0;
    CORRIDOR.dz = gdz;
    return true;
  }
  smootherstepInto(ROAD_BED_HALF, ROAD_CORRIDOR_HALF, a);
  const sV = STEP.v;
  const sD = STEP.d;
  const w = 1 - sV;
  // dW/du carries the sign of u through |u|.
  const dWdu = u >= 0 ? -sD : sD;
  const diff = gh - bh;
  CORRIDOR.h = w * gh + (1 - w) * bh;
  CORRIDOR.dx = dWdu * diff + (1 - w) * bdx;
  CORRIDOR.dz = w * gdz + dWdu * uDz * diff + (1 - w) * bdz;
  return true;
}
