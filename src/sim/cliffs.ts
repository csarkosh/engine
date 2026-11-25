/**
 * Cliff bands and lowland outcrops: a C²
 * terracing remap of the pre-road olympic field, masked by altitude, two
 * noise windows, and road suppression. This module knows nothing about the
 * coast or the road — the signed road offset `u` arrives as a parameter —
 * so `olympic.ts` composes it without a dependency cycle, exactly as it
 * composes road.ts.
 *
 * THE CONTRACT (same as montane.ts): the returned dx/dz are the EXACT
 * analytic derivatives of the returned h. Wherever the mask is exactly
 * zero, the base sample is returned AS THE SAME OBJECT — bit-identity by
 * construction, the corridorD idiom, immune to float re-association.
 *
 * The mask never reads slope: risers concentrate on steep ground anyway
 * (steep ground crosses more band boundaries per horizontal metre), and a
 * slope-keyed mask would need the composed field's second derivatives,
 * which do not exist. Everything the mask reads — the BASE height and
 * fbm2d windows — has exact first derivatives.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */

import { fbm2dInto, NOISE } from "./field.js";
import type { TerrainSample } from "./terrain.js";

// ---- Tunables (all join the olympic variant record) --------
export const CLIFF_PERIOD = 26;
export const CLIFF_BENCH = 0.8;
export const CLIFF_RISER_HALF = 0.12;
export const CLIFF_PHASE_AMP = 14;
export const CLIFF_PHASE_WAVELENGTH = 900;
export const CLIFF_PHASE_OCTAVES = 2;
export const CLIFF_PHASE_SALT = 0xc11f;
export const CLIFF_ALT_LO = 120;
export const CLIFF_ALT_HI = 220;
export const CLIFF_MTN_STRENGTH = 1.0;
export const CLIFF_MTN_WAVELENGTH = 700;
export const CLIFF_MTN_OCTAVES = 2;
export const CLIFF_MTN_LO = 0.45;
export const CLIFF_MTN_HI = 0.75;
export const CLIFF_MTN_SALT = 0x5ca9;
export const CLIFF_OUT_STRENGTH = 1.0;
export const CLIFF_OUT_WAVELENGTH = 300;
export const CLIFF_OUT_OCTAVES = 2;
export const CLIFF_OUT_LO = 0.62;
export const CLIFF_OUT_HI = 0.72;
export const CLIFF_OUT_ALT_LO = 12;
export const CLIFF_OUT_ALT_HI = 20;
export const CLIFF_OUT_SALT = 0x0a7c;
/** = ROAD_CORRIDOR_HALF; retune together. */
export const CLIFF_ROAD_NEAR = 30;
export const CLIFF_ROAD_FAR = 90;

/** Where `smootherstepInto` leaves its answer; read it by number, at once, before any other call. */
const STEP = { v: 0, d: 0 };

/** Quintic smootherstep with derivative — same shape as road.ts's. C²: its
 * second derivative is zero at both edges, which is what makes the band
 * step below C² across the wrap. Left in `STEP`. */
function smootherstepInto(edge0: number, edge1: number, x: number): void {
  const span = edge1 - edge0;
  if (x <= edge0) { STEP.v = 0; STEP.d = 0; return; }
  if (x >= edge1) { STEP.v = 1; STEP.d = 0; return; }
  const t = (x - edge0) / span;
  STEP.v = t * t * t * (t * (t * 6 - 15) + 10);
  STEP.d = (30 * t * t * (t - 1) * (t - 1)) / span;
}

/** Where `terraceStepInto` and `terraceDeltaInto` leave their answer; read by number, at once. */
const TERRACE = { v: 0, d: 0 };

/**
 * One band of the terrace: a blend of identity and a quintic
 * step, compressing CLIFF_BENCH of the band's rise into a riser of
 * half-width CLIFF_RISER_HALF around the band midpoint.
 *
 * step(0) = 0 and step(1) = 1 (the smootherstep window is interior because
 * CLIFF_RISER_HALF < 0.5), and step′ = 1 − CLIFF_BENCH at both edges with
 * step″ = 0 there — so the terrace is C² where f wraps between bands.
 * Monotone by construction: step′ ≥ 1 − CLIFF_BENCH > 0.
 */
export function terraceStepD(f: number): { v: number; d: number } {
  terraceStepInto(f);
  return { v: TERRACE.v, d: TERRACE.d };
}

/** `terraceStepD`, left in `TERRACE`: no record is made. */
function terraceStepInto(f: number): void {
  smootherstepInto(0.5 - CLIFF_RISER_HALF, 0.5 + CLIFF_RISER_HALF, f);
  const sV = STEP.v;
  const sD = STEP.d;
  TERRACE.v = (1 - CLIFF_BENCH) * f + CLIFF_BENCH * sV;
  TERRACE.d = (1 - CLIFF_BENCH) + CLIFF_BENCH * sD;
}

/**
 * Δ(g) = T(g) − g where T(g) = PERIOD·(n + step(f)) terraces the
 * phase-shifted altitude g. Returned d is dΔ/dg = step′(f) − 1; the caller
 * chains it onto ∂g/∂x. |Δ| ≤ PERIOD·CLIFF_BENCH/2 — the census bound,
 * derived from the terrace's own geometry.
 */
export function terraceDeltaD(g: number): { v: number; d: number } {
  terraceDeltaInto(g);
  return { v: TERRACE.v, d: TERRACE.d };
}

/** `terraceDeltaD`, left in `TERRACE`: no record is made. */
function terraceDeltaInto(g: number): void {
  const s = g / CLIFF_PERIOD;
  const n = Math.floor(s);
  terraceStepInto(s - n);
  const stV = TERRACE.v;
  const stD = TERRACE.d;
  TERRACE.v = CLIFF_PERIOD * (n + stV) - g;
  TERRACE.d = stD - 1;
}

/**
 * The cliff mask m ∈ [0, 1] with its exact gradient:
 *
 *   m = smootherstep(0, 1, M + O) · R
 *
 * M — mountain component: altitude ramp × patchy noise window.
 * O — outcrop component: sparse noise threshold × altitude floor (so sand
 *     and shore are never terraced).
 * R — road suppression on u², exactly 0 for |u| ≤ CLIFF_ROAD_NEAR, so the
 *     grade lattice at the centerline is untouched and the road census
 *     keeps its measured behaviour.
 *
 * Reads the BASE height only — never the terraced output, never slope.
 */
export function cliffMaskD(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  base: TerrainSample,
): { v: number; dx: number; dz: number } {
  cliffMaskInto(seed, x, z, u, uDz, base.h, base.dx, base.dz);
  return { v: MASK.v, dx: MASK.dx, dz: MASK.dz };
}

/** Where `cliffMaskInto` leaves its answer; read by number, at once. */
const MASK = { v: 0, dx: 0, dz: 0 };

/** `cliffMaskD` on the base's three numbers, left in `MASK`: no record is made. */
function cliffMaskInto(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  bh: number,
  bdx: number,
  bdz: number,
): void {
  smootherstepInto(
    CLIFF_ROAD_NEAR * CLIFF_ROAD_NEAR,
    CLIFF_ROAD_FAR * CLIFF_ROAD_FAR,
    u * u,
  );
  const rV = STEP.v;
  const rD = STEP.d;
  if (rV === 0) { MASK.v = 0; MASK.dx = 0; MASK.dz = 0; return; }

  smootherstepInto(CLIFF_ALT_LO, CLIFF_ALT_HI, bh);
  const aMV = STEP.v;
  const aMD = STEP.d;
  smootherstepInto(CLIFF_OUT_ALT_LO, CLIFF_OUT_ALT_HI, bh);
  const aOV = STEP.v;
  const aOD = STEP.d;
  if (aMV === 0 && aOV === 0) { MASK.v = 0; MASK.dx = 0; MASK.dz = 0; return; }

  // Mountain component M = STRENGTH · altRamp(h) · window(wm). The altitude
  // ramp chains through the base gradient; the window through fbm2d's own.
  let mV = 0;
  let mDx = 0;
  let mDz = 0;
  if (aMV > 0) {
    fbm2dInto(x / CLIFF_MTN_WAVELENGTH, z / CLIFF_MTN_WAVELENGTH, seed ^ CLIFF_MTN_SALT, CLIFF_MTN_OCTAVES);
    const nV = NOISE.v;
    const nDx = NOISE.dx;
    const nDz = NOISE.dz;
    smootherstepInto(CLIFF_MTN_LO, CLIFF_MTN_HI, 0.5 + 0.5 * nV);
    const wV = STEP.v;
    const wD = STEP.d;
    const wDx = (wD * 0.5 * nDx) / CLIFF_MTN_WAVELENGTH;
    const wDz = (wD * 0.5 * nDz) / CLIFF_MTN_WAVELENGTH;
    mV = CLIFF_MTN_STRENGTH * aMV * wV;
    mDx = CLIFF_MTN_STRENGTH * (aMD * bdx * wV + aMV * wDx);
    mDz = CLIFF_MTN_STRENGTH * (aMD * bdz * wV + aMV * wDz);
  }

  // Outcrop component O — same shape, sparse threshold. Its altitude gate
  // saturates at 1 above CLIFF_OUT_ALT_HI, so outcrops also add on mountain
  // ground; the saturating clamp below absorbs the overlap.
  let oV = 0;
  let oDx = 0;
  let oDz = 0;
  if (aOV > 0) {
    fbm2dInto(x / CLIFF_OUT_WAVELENGTH, z / CLIFF_OUT_WAVELENGTH, seed ^ CLIFF_OUT_SALT, CLIFF_OUT_OCTAVES);
    const nV = NOISE.v;
    const nDx = NOISE.dx;
    const nDz = NOISE.dz;
    smootherstepInto(CLIFF_OUT_LO, CLIFF_OUT_HI, 0.5 + 0.5 * nV);
    const wV = STEP.v;
    const wD = STEP.d;
    const wDx = (wD * 0.5 * nDx) / CLIFF_OUT_WAVELENGTH;
    const wDz = (wD * 0.5 * nDz) / CLIFF_OUT_WAVELENGTH;
    oV = CLIFF_OUT_STRENGTH * aOV * wV;
    oDx = CLIFF_OUT_STRENGTH * (aOD * bdx * wV + aOV * wDx);
    oDz = CLIFF_OUT_STRENGTH * (aOD * bdz * wV + aOV * wDz);
  }

  // C² saturating clamp (exactly 1 with zero derivative above 1), then the
  // road factor. ∂R/∂x = r.d·2u·∂u/∂x with ∂u/∂x = 1 and ∂u/∂z = uDz.
  smootherstepInto(0, 1, mV + oV);
  const sV = STEP.v;
  const sD = STEP.d;
  const rDx = rD * 2 * u;
  const rDz = rD * 2 * u * uDz;
  MASK.v = sV * rV;
  MASK.dx = sD * (mDx + oDx) * rV + sV * rDx;
  MASK.dz = sD * (mDz + oDz) * rV + sV * rDz;
}

/** The multiplier a caller may put on the cliff mask, with world partials.
 * The default leaves the mask alone; olympic.ts passes the apron's keep. */
export type MaskKeep = { v: number; dx: number; dz: number };
export const UNIT_KEEP: MaskKeep = { v: 1, dx: 0, dz: 0 };

/**
 * The cliff stage: h′ = h + m·Δ(g) over the phase-shifted
 * altitude g = h + φ. Cheapest gates first — these early-outs ARE the
 * bit-identity guarantee, and they cost zero noise calls on sea, beach and
 * road-corridor ground. `keep` (default UNIT_KEEP) multiplies the mask —
 * the apron's `1 − A(u, z)`, exactly 0 inside the apron so the stage returns
 * base as the same object there.
 */
export function cliffD(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  base: TerrainSample,
  keep: MaskKeep = UNIT_KEEP,
): TerrainSample {
  if (!cliffInto(seed, x, z, u, uDz, base.h, base.dx, base.dz, keep)) return base;
  return { h: CLIFFED.h, dx: CLIFFED.dx, dz: CLIFFED.dz };
}

/** Where `cliffInto` leaves its answer when it returns true; read by number, at once. */
export const CLIFFED: TerrainSample = { h: 0, dx: 0, dz: 0 };

/**
 * `cliffD` on the base's three numbers. Returns false, writing nothing, where the base stands as it
 * is; true after writing `CLIFFED`. Written by every call of it and of `cliffD`.
 */
export function cliffInto(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  bh: number,
  bdx: number,
  bdz: number,
  keep: MaskKeep = UNIT_KEEP,
): boolean {
  if (u * u <= CLIFF_ROAD_NEAR * CLIFF_ROAD_NEAR) return false;
  if (bh < CLIFF_OUT_ALT_LO) return false;
  if (keep.v === 0) return false; // the apron: the mask is exactly 0 here
  cliffMaskInto(seed, x, z, u, uDz, bh, bdx, bdz);
  const m0v = MASK.v;
  const m0dx = MASK.dx;
  const m0dz = MASK.dz;
  if (m0v === 0) return false;
  // The caller's multiplier, product rule in world partials. Value-based,
  // not `keep === UNIT_KEEP`: olympic.ts constructs a fresh MaskKeep on
  // every call (apronKeepD returns the shared UNIT_KEEP only outside the
  // apron), so a reference check would never take this fast path there.
  const unit = keep.v === 1 && keep.dx === 0 && keep.dz === 0;
  const mV = unit ? m0v : m0v * keep.v;
  const mDx = unit ? m0dx : m0dx * keep.v + m0v * keep.dx;
  const mDz = unit ? m0dz : m0dz * keep.v + m0v * keep.dz;

  // Phase-shifted bands: scarps must not ring the world at the
  // same altitudes — the perturbed-snow-line reasoning, applied to rock.
  fbm2dInto(x / CLIFF_PHASE_WAVELENGTH, z / CLIFF_PHASE_WAVELENGTH, seed ^ CLIFF_PHASE_SALT, CLIFF_PHASE_OCTAVES);
  const phV = NOISE.v;
  const phDx = NOISE.dx;
  const phDz = NOISE.dz;
  const g = bh + CLIFF_PHASE_AMP * phV;
  const gDx = bdx + (CLIFF_PHASE_AMP * phDx) / CLIFF_PHASE_WAVELENGTH;
  const gDz = bdz + (CLIFF_PHASE_AMP * phDz) / CLIFF_PHASE_WAVELENGTH;
  terraceDeltaInto(g);
  const delV = TERRACE.v;
  const delD = TERRACE.d;
  CLIFFED.h = bh + mV * delV;
  CLIFFED.dx = bdx + mDx * delV + mV * delD * gDx;
  CLIFFED.dz = bdz + mDz * delV + mV * delD * gDz;
  return true;
}
