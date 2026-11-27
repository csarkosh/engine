/**
 * The olympic variant: the dense montane config
 * composed with a Pacific coastline west of spawn — sandy bays,
 * headland bluffs, an offshore shelf and jittered-grid sea stacks —
 * then cliff bands, then
 * beach dunes, then the highway road. Inland of the blend window
 * the pre-cliff base is the dense sample UNCHANGED (bit-identity);
 * offshore it never evaluates dense at all. Cliff bands and dunes may
 * then perturb that base — the composed field is bit-identical to dense
 * inland only where BOTH the cliff mask and the dune window are cold. In
 * practice inland is where the dune window is coldest (it shuts above
 * DUNE_ALT_OUT_HI = 8 m) and the cliff mask is hottest, so the two
 * conditions rarely bind at the same place, but the identity claim now
 * depends on both.
 *
 * Same contract as montane.ts: dx/dz are the EXACT analytic derivatives of h.
 * Every piece here is C² in signed coast distance d, so the numeric-vs-analytic
 * harness needs no special pleading at band edges. sim/ determinism rules:
 * no trig, no Math.pow, no `**`, no hypot.
 */
import { fbm2dInto, hash3, NOISE } from "./field.js";
import { DENSE_VARIANT_TUNABLES, denseSampleInto, MONTANE_OUT } from "./montane.js";
import {
  ROAD_WINDOW_FRACTION, ROAD_WOBBLE, ROAD_WOBBLE_WAVELENGTH, ROAD_WOBBLE_OCTAVES,
  ROAD_SALT, ROAD_LATTICE, ROAD_BED_HALF, ROAD_CORRIDOR_HALF,
  roadOffsetInto, ROAD_OFFSET, gradeSplineInto, GRADE, corridorInto, CORRIDOR,
} from "./road.js";
import {
  CLIFF_PERIOD, CLIFF_BENCH, CLIFF_RISER_HALF,
  CLIFF_PHASE_AMP, CLIFF_PHASE_WAVELENGTH, CLIFF_PHASE_OCTAVES, CLIFF_PHASE_SALT,
  CLIFF_ALT_LO, CLIFF_ALT_HI,
  CLIFF_MTN_STRENGTH, CLIFF_MTN_WAVELENGTH, CLIFF_MTN_OCTAVES,
  CLIFF_MTN_LO, CLIFF_MTN_HI, CLIFF_MTN_SALT,
  CLIFF_OUT_STRENGTH, CLIFF_OUT_WAVELENGTH, CLIFF_OUT_OCTAVES,
  CLIFF_OUT_LO, CLIFF_OUT_HI, CLIFF_OUT_ALT_LO, CLIFF_OUT_ALT_HI, CLIFF_OUT_SALT,
  CLIFF_ROAD_NEAR, CLIFF_ROAD_FAR,
  cliffInto, CLIFFED,
} from "./cliffs.js";
import { UNIT_KEEP } from "./cliffs.js";
import {
  registerTerrainVariant, type LakeSource, type TerrainSample, type TerrainVariant, type WaterBodySource,
} from "./terrain.js";
import type { FeatureMask } from "./features.js";
import { beachTunables, resolveShape } from "./beach.js";
import { bayMaskInto, BAY, beachShapeInto, SHAPE_HI, SHAPE_LO, SHAPED } from "./beachShape.js";

// ---- Tunables ---------------------------------------------------------------
export const SEA_LEVEL = 0;
export const COAST_X = -400;
export const COAST_WARP_WAVELENGTH = 1100;
export const COAST_WARP_AMPLITUDE = 220;
export const COAST_WARP_OCTAVES = 2;
export const BLEND_START = 25;
export const BLEND_END_BAY = 500;
export const BLEND_END_HEADLAND = 40;
export const BEACH_GRADE = 0.025;
export const SURF_GRADE = 0.015;
export const GRADE_MORPH = 6;
export const SHELF_BREAK_DEPTH = 8;
export const FLOOR_DEPTH = 25;
export const SHELF_BREAK_WIDTH = 400;
export const STACK_BAND_NEAR = -40;
export const STACK_BAND_FAR = -280;
export const STACK_BAND_FADE = 60;
export const STACK_CELL = 180;
export const STACK_DENSITY = 0.35;
export const STACK_RADIUS_MIN = 12;
export const STACK_RADIUS_MAX = 24;
export const STACK_HEIGHT_MIN = 12;
export const STACK_HEIGHT_MAX = 38;

const STACK_SALT = 0x57ac;

// ---- Dunes --------------------------------------------------------------
/** Peak-to-peak ceiling of the foredune field, metres — the value the noise
 * would reach if the road window, the altitude window and the noise itself
 * were all simultaneously extremal, which they never are. DELIVERED relief is
 * what matters and is much smaller: measured over 1500 shore-normal traverses
 * spanning 15 km of coastline (each 0-120 m inland, sampled at 1 m, composed
 * through `variantOrThrow("olympic").sample`), crest-to-trough across the
 * sand band is p50 0.195 m, p90 0.312 m, max 0.492 m. That is the number to
 * compare against the ~4 m sand band `terrainSurface.ts` paints over. */
export const DUNE_AMPLITUDE = 1.2;
/** Shore-normal wavelength. Shorter than DUNE_WAVELENGTH_Z on purpose: real
 * foredunes elongate ALONG the shore, so ridges must be anisotropic or they
 * read as generic lumps. */
export const DUNE_WAVELENGTH_X = 30;
/** Shore-parallel wavelength — 3x the shore-normal one. */
export const DUNE_WAVELENGTH_Z = 90;
export const DUNE_OCTAVES = 3;
/** Altitude window, metres: rise over [IN_LO, IN_HI], fall over [OUT_LO,
 * OUT_HI]. The rise tracks `terrainSurface.ts`'s own wet-to-dry sand mix
 * (`smoothstep(0, 0.7, altitude)`, terrainSurface.ts:196) so dunes build as
 * the sand dries, and being strictly positive it excludes everything at or
 * below the waterline by construction. The fall starts at SAND_TOP = 4
 * exactly; it ends at 8, which is NOT COAST_FADE_END = 9 — dunes finish
 * fading a metre before the sand paint does, so no dune survives into ground
 * that is no longer painted sand. Closing below CLIFF_OUT_ALT_LO (12) keeps
 * dunes and cliffs disjoint.
 *
 * IN_LO/IN_HI are also the sea-level safety lever. A trough is at worst
 * `0.5·DUNE_AMPLITUDE·rise(h)` below the pre-dune height `h`, so
 * `0.5·DUNE_AMPLITUDE·rise(h) < h` must hold across the whole rise or dunes
 * would pit dry beach below sea level and fill it with water. At
 * DUNE_AMPLITUDE = 1.2 over [0.1, 1.0] the worst case is a trough reaching
 * 69.4% of `h` (at h = 0.777 m), a 1.44x margin, and the absolute margin at
 * the window's own bottom edge is IN_LO = 0.1 m. Raising DUNE_AMPLITUDE
 * requires widening this rise in step. */
export const DUNE_ALT_IN_LO = 0.1;
export const DUNE_ALT_IN_HI = 1.0;
export const DUNE_ALT_OUT_LO = 4;
export const DUNE_ALT_OUT_HI = 8;
/** Road suppression, mirroring CLIFF_ROAD_NEAR/FAR: dunes are absent inside
 * the corridor and fade in outside it, so the earthworks meet flat sand.
 *
 * The fade is deliberately NARROW (10 m, where CLIFF_ROAD_FAR uses 60). The
 * window is already largely redundant: `olympicSample` hands everything
 * inside |u| < ROAD_CORRIDOR_HALF to `corridorD`, which overwrites it, and
 * DUNE_ROAD_NEAR == ROAD_CORRIDOR_HALF — so the only thing the fade width
 * buys is a gentler shoulder, at the cost of deleting dunes from real beach.
 * The highway runs close to and roughly parallel with the shore here, so a
 * wide fade eats the inland half of the beach, which is exactly where the
 * altitude window is open. Measured p50 crest-to-trough across the sand band
 * over 15 km of coastline: 0.035 m at +40, 0.138 m at +10 with nothing else
 * changed. `smootherstepD` is C² at both edges whatever the width, so
 * narrowing costs no continuity. */
export const DUNE_ROAD_NEAR = ROAD_CORRIDOR_HALF;
export const DUNE_ROAD_FAR = ROAD_CORRIDOR_HALF + 10;

/** In the tunables below, unlike STACK_SALT and COAST_WARP_SALT above.
 * A salt change moves the field, so it must move the level id, and the
 * cliff and road modules already export CLIFF_PHASE_SALT, CLIFF_OUT_SALT
 * and ROAD_SALT into it for exactly that reason. (vegetation.ts:108 records
 * the older montane convention of keeping salts module-private; this is the
 * newer one. The two older salts in this file predate the change and are
 * left alone rather than folded in as a drive-by level-id bump.) */
const DUNE_SALT = 0xd0e5;

// ---- The cove in front of the trailhead ---------------------------------------
/** A pebble pocket beach between two headlands, centred on the pad's frontage
 * (research §4.1, §4.2). Its width along the shore, seeded. */
export const COVE_WIDTH_MIN = 260;
export const COVE_WIDTH_MAX = 360;
/** The cove's ends blend into the bay's profile over ± this about each end,
 * under the headland there. */
export const COVE_END_BLEND = 30;
/** Seaward of the road's corridor the cove comes in over this (m). */
export const COVE_BACK_FADE = 6;
/** The face through the waterline, 1:12, down to COVE_TOE_DEPTH; then the bed
 * at 1:50 to the shelf break, steeper than the bays' 1:67 so swell reaches the
 * face unbroken. */
export const COVE_FACE_GRADE = 1 / 12;
export const COVE_BED_GRADE = 0.02;
export const COVE_TOE_DEPTH = 2;
/** Half-width (m) of the face-to-bed morph about the toe. */
export const COVE_TOE_MORPH = 6;
/** The berm's crest above the sea (m), and the height (m) over which the face
 * rounds into it. */
export const COVE_CREST = 3;
export const COVE_CREST_MORPH = 0.3;
/** Each headland: a ridge out to sea, its crest height and its reach past the
 * waterline (both seeded), its half-width along the shore, the run (m) over
 * which it rises from the corridor's edge, and the taper (m) at its tip. */
export const HEAD_HEIGHT_MIN = 12;
export const HEAD_HEIGHT_MAX = 25;
export const HEAD_REACH_MIN = 100;
export const HEAD_REACH_MAX = 150;
export const HEAD_HALF_WIDTH = 30;
export const HEAD_RISE = 50;
export const HEAD_TIP = 40;
/** One or two stacks off each tip, COVE_STACK_STEP apart beyond it. */
export const COVE_STACK_STEP = 35;
/** The odds that a headland has a second stack off its tip. */
export const COVE_STACK_PAIR_ODDS = 0.5;
export const COVE_STACK_RADIUS_MIN = 8;
export const COVE_STACK_RADIUS_MAX = 14;
export const COVE_STACK_HEIGHT_MIN = 14;
export const COVE_STACK_HEIGHT_MAX = 28;
export const COVE_SALT = 0xc07e;

const COAST_WARP_SALT = 0x0cea;
/** Fixed first coordinate for the 1-D use of fbm2d — off-lattice on purpose. */
const WARP_LINE_X = 0.318;
/** Where the surf grade would reach the shelf-break depth. */
const SHELF_BREAK_D = -(SHELF_BREAK_DEPTH / SURF_GRADE);

/** Where `smootherstepInto` leaves its answer; read it by number, at once, before any other call. */
const STEP = { v: 0, d: 0 };

/** Quintic smootherstep with derivative — C² at both edges. Left in `STEP`. */
function smootherstepInto(edge0: number, edge1: number, x: number): void {
  const span = edge1 - edge0;
  if (x <= edge0) { STEP.v = 0; STEP.d = 0; return; }
  if (x >= edge1) { STEP.v = 1; STEP.d = 0; return; }
  const t = (x - edge0) / span;
  STEP.v = t * t * t * (t * (t * 6 - 15) + 10);
  STEP.d = (30 * t * t * (t - 1) * (t - 1)) / span;
}

/** Where `smoothPosInto` leaves its answer; read it by number, at once. */
const POS = { v: 0, d: 0 };

/** C² softened max(0, d): 0 below −m, exactly d above +m, quintic-derived ramp
 * between (its derivative is the cubic smoothstep of d). Morphs the surf grade
 * into the beach grade without a crease at the waterline. Left in `POS`. */
function smoothPosInto(d: number, m: number): void {
  if (d <= -m) { POS.v = 0; POS.d = 0; return; }
  if (d >= m) { POS.v = d; POS.d = 1; return; }
  const t = (d + m) / (2 * m);
  POS.v = m * t * t * t * (2 - t);
  POS.d = t * t * (3 - 2 * t);
}

/** Re-centres the grade morph so the waterline sits on d = 0 exactly. */
const SHORE_TRIM = ((BEACH_GRADE - SURF_GRADE) * GRADE_MORPH * 3) / 16;

/**
 * The shore profile as a function of signed coast distance alone: beach rising
 * at BEACH_GRADE inland, surf falling at SURF_GRADE seaward, the two morphing
 * C²-smoothly over ±GRADE_MORPH, then a smootherstep blend down to the flat
 * open-water floor across [SHELF_BREAK_D − SHELF_BREAK_WIDTH, SHELF_BREAK_D].
 * Monotone: `near + FLOOR_DEPTH > 0` throughout the blend, so both terms of
 * the derivative are non-negative.
 */
export function shoreProfileD(d: number): { v: number; dd: number } {
  shoreProfileInto(d);
  return { v: PROFILE.v, dd: PROFILE.dd };
}

/** Where `shoreProfileInto` and `coveProfileInto` leave their answer; read by number, at once. */
const PROFILE = { v: 0, dd: 0 };

/** `shoreProfileD`, left in `PROFILE`: no record is made. */
function shoreProfileInto(d: number): void {
  smoothPosInto(d, GRADE_MORPH);
  const rampV = POS.v;
  const rampD = POS.d;
  const near = SURF_GRADE * d + (BEACH_GRADE - SURF_GRADE) * rampV - SHORE_TRIM;
  const nearDd = SURF_GRADE + (BEACH_GRADE - SURF_GRADE) * rampD;
  smootherstepInto(SHELF_BREAK_D - SHELF_BREAK_WIDTH, SHELF_BREAK_D, d);
  const wV = STEP.v;
  const wD = STEP.d;
  PROFILE.v = wV * near + (1 - wV) * -FLOOR_DEPTH;
  PROFILE.dd = wV * nearDd + wD * (near + FLOOR_DEPTH);
}

/** Where the face meets the bed, and where the bed reaches the shelf break. */
const COVE_TOE_D = -COVE_TOE_DEPTH / COVE_FACE_GRADE;
const COVE_BREAK_D = COVE_TOE_D - (SHELF_BREAK_DEPTH - COVE_TOE_DEPTH) / COVE_BED_GRADE;

/**
 * The cove's profile in signed coast distance: a flat backshore at
 * COVE_CREST, rounded into the face at 1:12 through the waterline (d = 0),
 * morphing into the 1:50 bed at the toe, 2 m down, then blended to the open
 * floor past the shelf break exactly as `shoreProfileD` is. C² throughout;
 * monotone, and nowhere steeper than the face.
 */
export function coveProfileD(d: number): { v: number; dd: number } {
  coveProfileInto(d);
  return { v: PROFILE.v, dd: PROFILE.dd };
}

/** `coveProfileD`, left in `PROFILE`: no record is made. */
function coveProfileInto(d: number): void {
  smoothPosInto(d - COVE_TOE_D, COVE_TOE_MORPH);
  const toeV = POS.v;
  const toeD = POS.d;
  const near = -COVE_TOE_DEPTH + COVE_BED_GRADE * (d - COVE_TOE_D) + (COVE_FACE_GRADE - COVE_BED_GRADE) * toeV;
  const nearDd = COVE_BED_GRADE + (COVE_FACE_GRADE - COVE_BED_GRADE) * toeD;
  // A softened min(near, COVE_CREST): the berm's crest.
  smoothPosInto(near - COVE_CREST, COVE_CREST_MORPH);
  const capV = POS.v;
  const capD = POS.d;
  const capped = near - capV;
  const cappedDd = nearDd * (1 - capD);
  smootherstepInto(COVE_BREAK_D - SHELF_BREAK_WIDTH, COVE_BREAK_D, d);
  const wV = STEP.v;
  const wD = STEP.d;
  PROFILE.v = wV * capped + (1 - wV) * -FLOOR_DEPTH;
  PROFILE.dd = wV * cappedDd + wD * (capped + FLOOR_DEPTH);
}

export type Headland = { z: number; height: number; reach: number };
export type CoveStack = { x: number; z: number; radius: number; height: number };
export type Cove = { z0: number; halfWidth: number; heads: Headland[]; stacks: CoveStack[] };

/** Where the cove lies along the coast (z, m): the world's origin. A place laid over this coast that wants the cove at its door anchors itself here. */
export const COVE_Z = 0;

const COVE_CACHE = new Map<number, Cove>();
/** The seed's cove: its width, its two headlands and the stacks off their
 * tips. A pure function of the seed, cached. */
export function coveFor(seed: number): Cove {
  const cached = COVE_CACHE.get(seed);
  if (cached !== undefined) return cached;
  const salted = seed ^ COVE_SALT;
  const halfWidth = (COVE_WIDTH_MIN + (COVE_WIDTH_MAX - COVE_WIDTH_MIN) * hash3(0, 0, 0, salted)) / 2;
  const z0 = COVE_Z;
  const heads: Headland[] = [];
  const stacks: CoveStack[] = [];
  for (let i = 0; i < 2; i++) {
    const z = z0 + (i === 0 ? -halfWidth : halfWidth);
    const height = HEAD_HEIGHT_MIN + (HEAD_HEIGHT_MAX - HEAD_HEIGHT_MIN) * hash3(i + 1, 0, 0, salted);
    const reach = HEAD_REACH_MIN + (HEAD_REACH_MAX - HEAD_REACH_MIN) * hash3(i + 1, 1, 0, salted);
    heads.push({ z, height, reach });
    const count = hash3(i + 1, 2, 0, salted) < COVE_STACK_PAIR_ODDS ? 1 : 2;
    for (let k = 0; k < count; k++) {
      const sz = z + (hash3(i + 1, 3 + k, 0, salted) - 0.5) * HEAD_HALF_WIDTH;
      const d = -(reach + HEAD_TIP + COVE_STACK_STEP * k);
      coastFrame(seed, sz);
      stacks.push({
        x: FRAME.coastlineX + d,
        z: sz,
        radius: COVE_STACK_RADIUS_MIN + (COVE_STACK_RADIUS_MAX - COVE_STACK_RADIUS_MIN) * hash3(i + 1, 5 + k, 0, salted),
        height: COVE_STACK_HEIGHT_MIN + (COVE_STACK_HEIGHT_MAX - COVE_STACK_HEIGHT_MIN) * hash3(i + 1, 7 + k, 0, salted),
      });
    }
  }
  const cove: Cove = { z0, halfWidth, heads, stacks };
  COVE_CACHE.set(seed, cove);
  return cove;
}

/** Where `coveWeightInto` leaves its answer; read by number, at once. */
const WEIGHT = { v: 0, dx: 0, dz: 0 };

/** The cove's weight and its gradient: the along-shore window times the
 * seaward window. Zero at and inside the road's corridor. Left in `WEIGHT`. */
function coveWeightInto(cove: Cove, z: number, u: number, uDz: number): void {
  smootherstepInto(-ROAD_CORRIDOR_HALF - COVE_BACK_FADE, -ROAD_CORRIDOR_HALF, u);
  const seawardV = STEP.v;
  const seawardD = STEP.d;
  const wu = 1 - seawardV;
  if (wu <= 0) { WEIGHT.v = 0; WEIGHT.dx = 0; WEIGHT.dz = 0; return; }
  const off = z - cove.z0;
  // |off| is flat-windowed near 0 (the window is 1 within halfWidth − END_BLEND),
  // so its kink at 0 never reaches the weight.
  const sign = off < 0 ? -1 : 1;
  smootherstepInto(cove.halfWidth - COVE_END_BLEND, cove.halfWidth + COVE_END_BLEND, off * sign);
  const alongV = STEP.v;
  const alongD = STEP.d;
  const wz = 1 - alongV;
  if (wz <= 0) { WEIGHT.v = 0; WEIGHT.dx = 0; WEIGHT.dz = 0; return; }
  // ∂u/∂x = 1, ∂u/∂z = uDz.
  WEIGHT.v = wz * wu;
  WEIGHT.dx = -wz * seawardD;
  WEIGHT.dz = -wz * seawardD * uDz - alongD * sign * wu;
}

/** Where `headlandInto`, `addColumn` and `stackFieldInto` accumulate their sums, and where the last of them
 * leaves it: the caller zeroes it, then reads it by number, at once. */
const ACC = { v: 0, dx: 0, dz: 0 };

/** One headland added into `ACC`: a ridge (1 − t²)³ across its axis, rising
 * from nothing at the corridor's edge over HEAD_RISE, holding out to its reach
 * past the waterline, tapering to nothing over HEAD_TIP. */
function headlandInto(
  head: Headland, z: number, d: number, dDz: number, u: number, uDz: number,
): void {
  const t = (z - head.z) / HEAD_HALF_WIDTH;
  if (t <= -1 || t >= 1) return;
  smootherstepInto(-ROAD_CORRIDOR_HALF - HEAD_RISE, -ROAD_CORRIDOR_HALF, u);
  const riseV = STEP.v;
  const riseD = STEP.d;
  const r = 1 - riseV;
  if (r <= 0) return;
  smootherstepInto(-head.reach - HEAD_TIP, -head.reach, d);
  const tipV = STEP.v;
  const tipD = STEP.d;
  if (tipV <= 0) return;
  const m = 1 - t * t;
  const bump = m * m * m;
  const bumpDz = (-6 * t * m * m) / HEAD_HALF_WIDTH;
  const rDx = -riseD, rDz = -riseD * uDz;
  ACC.v += head.height * bump * r * tipV;
  ACC.dx += head.height * bump * (rDx * tipV + r * tipD);
  ACC.dz += head.height * (bumpDz * r * tipV + bump * (rDz * tipV + r * tipD * dDz));
}

/** Where `coveInto` leaves its answer when it returns true; read by number, at once. */
const COVED: TerrainSample = { h: 0, dx: 0, dz: 0 };

/**
 * The cove's stage, after the dunes: where its weight is 1 the ground IS the
 * cove's profile plus the sea stacks (no dunes, no cliffs, none of the inland
 * blend), blended into the coast's own ground across the weight's edges; then
 * the headlands and their stacks on top. Takes the ground's height and partials
 * (`bh`, `bdx`, `bdz`). Returns false, writing nothing, wherever none of it
 * reaches (the ground stands as it is); true after writing `COVED`.
 */
function coveInto(
  seed: number, x: number, z: number, d: number, dDz: number, u: number, uDz: number,
  bh: number, bdx: number, bdz: number,
): boolean {
  const cove = coveFor(seed);
  let changed = false;
  let oh = bh;
  let odx = bdx;
  let odz = bdz;
  coveWeightInto(cove, z, u, uDz);
  const wV = WEIGHT.v;
  const wDx = WEIGHT.dx;
  const wDz = WEIGHT.dz;
  if (wV > 0) {
    coveProfileInto(d);
    const pV = PROFILE.v;
    const pDd = PROFILE.dd;
    stackBandInto(seed, x, z, d, dDz);
    const stV = BAND.v;
    const stDx = BAND.dx;
    const stDz = BAND.dz;
    const th = pV + stV;
    const tdx = pDd + stDx;
    const tdz = pDd * dDz + stDz;
    const gap = th - bh;
    oh = bh + wV * gap;
    odx = bdx + wV * (tdx - bdx) + wDx * gap;
    odz = bdz + wV * (tdz - bdz) + wDz * gap;
    changed = true;
  }
  ACC.v = 0;
  ACC.dx = 0;
  ACC.dz = 0;
  for (let i = 0; i < cove.heads.length; i++) headlandInto(cove.heads[i] as Headland, z, d, dDz, u, uDz);
  for (let i = 0; i < cove.stacks.length; i++) {
    const s = cove.stacks[i] as CoveStack;
    addColumn(s.x, s.z, s.radius, s.height, x, z);
  }
  if (ACC.v === 0 && ACC.dx === 0 && ACC.dz === 0) {
    if (!changed) return false;
    COVED.h = oh;
    COVED.dx = odx;
    COVED.dz = odz;
    return true;
  }
  COVED.h = oh + ACC.v;
  COVED.dx = odx + ACC.dx;
  COVED.dz = odz + ACC.dz;
  return true;
}

/** The cove's weight at (x, z), 0 to 1: the ground paint and the clutter read it. */
function coveMaskHook(seed: number, x: number, z: number): number {
  // Past the along-shore window's far edge the weight is 0 whatever the
  // seaward window says: skip the coast's frame there.
  const cove = coveFor(seed);
  if (Math.abs(z - cove.z0) >= cove.halfWidth + COVE_END_BLEND) return 0;
  coastFrame(seed, z);
  const coastlineX = FRAME.coastlineX;
  const frameDDz = FRAME.dDz;
  const roadBlendEnd = FRAME.roadBlendEnd;
  const roadBlendEndDz = FRAME.roadBlendEndDz;
  roadOffsetInto(seed, z, BLEND_START, roadBlendEnd, roadBlendEndDz);
  const dr = ROAD_OFFSET.dr;
  const drDz = ROAD_OFFSET.drDz;
  coveWeightInto(cove, z, x - coastlineX - dr, frameDDz - drDz);
  return WEIGHT.v;
}

/** One C² column, height·(1 − r²/R²)³ inside R, and its gradient, added into
 * `ACC`. The sea stacks' shape: the stack field's and the cove's. */
function addColumn(
  px: number, pz: number, radius: number, height: number, x: number, z: number,
): void {
  const rx = x - px;
  const rz = z - pz;
  const u = (rx * rx + rz * rz) / (radius * radius);
  if (u >= 1) return;
  const s = 1 - u;
  // column = height·(1 − u)³;  ∂column/∂x = −3·height·(1 − u)²·(2·rx/R²)
  ACC.v += height * s * s * s;
  const dPerR = (-6 * height * s * s) / (radius * radius);
  ACC.dx += dPerR * rx;
  ACC.dz += dPerR * rz;
}

/** The stack field and its exact gradient, BEFORE the band window, left in
 * `ACC`. Sums C² columns from the 3×3 cell neighbourhood; STACK_RADIUS_MAX ≤
 * STACK_CELL / 2 guarantees no column escapes it. */
function stackFieldInto(seed: number, x: number, z: number): void {
  const cellX = Math.floor(x / STACK_CELL);
  const cellZ = Math.floor(z / STACK_CELL);
  ACC.v = 0;
  ACC.dx = 0;
  ACC.dz = 0;
  for (let cz = cellZ - 1; cz <= cellZ + 1; cz++) {
    for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
      if (hash3(cx, cz, 0, seed ^ STACK_SALT) >= STACK_DENSITY) continue;
      const px = (cx + 0.2 + 0.6 * hash3(cx, cz, 1, seed ^ STACK_SALT)) * STACK_CELL;
      const pz = (cz + 0.2 + 0.6 * hash3(cx, cz, 2, seed ^ STACK_SALT)) * STACK_CELL;
      const radius =
        STACK_RADIUS_MIN + (STACK_RADIUS_MAX - STACK_RADIUS_MIN) * hash3(cx, cz, 3, seed ^ STACK_SALT);
      const height =
        STACK_HEIGHT_MIN + (STACK_HEIGHT_MAX - STACK_HEIGHT_MIN) * hash3(cx, cz, 4, seed ^ STACK_SALT);
      addColumn(px, pz, radius, height, x, z);
    }
  }
}

/** Where `stackBandInto` leaves its answer; read by number, at once. */
const BAND = { v: 0, dx: 0, dz: 0 };

/** The stack field windowed by a C² band in d, so stacks fade in past the
 * surf and out again before the shelf break. The window depends on position
 * only through d, so its gradient rides ∂d/∂x = 1 and ∂d/∂z = dDz. Band
 * support ends at d = STACK_BAND_NEAR < BLEND_START, so stacks never reach the
 * montane blend region. Left in `BAND`. */
function stackBandInto(seed: number, x: number, z: number, d: number, dDz: number): void {
  smootherstepInto(STACK_BAND_FAR, STACK_BAND_FAR + STACK_BAND_FADE, d);
  const bInV = STEP.v;
  const bInD = STEP.d;
  smootherstepInto(STACK_BAND_NEAR - STACK_BAND_FADE, STACK_BAND_NEAR, d);
  const bOutV = STEP.v;
  const bOutD = STEP.d;
  const band = bInV * (1 - bOutV);
  const bandDd = bInD * (1 - bOutV) - bInV * bOutD;
  if (!(band > 0)) { BAND.v = 0; BAND.dx = 0; BAND.dz = 0; return; }
  stackFieldInto(seed, x, z);
  const stV = ACC.v;
  const stDx = ACC.dx;
  const stDz = ACC.dz;
  BAND.v = band * stV;
  BAND.dx = band * stDx + bandDd * stV; // ∂band/∂x = bandDd·(∂d/∂x = 1)
  BAND.dz = band * stDz + bandDd * dDz * stV;
}

/**
 * Foredunes on the beach. Windowed on the
 * pre-dune base HEIGHT rather than on coast distance: that confines dunes to
 * exactly the altitude band `terrainSurface.ts` paints sand over, self-adjusts
 * around bays and headlands with no reference to `blendEnd`, and excludes
 * everything below the waterline by construction.
 *
 * Takes `uDz` (unlike a first draft of this function, which dropped it):
 * `u` enters through an absolute-value road-suppression window — not a
 * squared one like `cliffMaskD`'s, so its chain-rule term is `sign(u)` rather
 * than `2u` — and that window is transitioning (`road.d ≠ 0`) throughout the
 * annulus `DUNE_ROAD_NEAR..DUNE_ROAD_FAR`. `olympicSample` only applies
 * `corridorD` for `|u| < ROAD_CORRIDOR_HALF`, and `DUNE_ROAD_NEAR ==
 * ROAD_CORRIDOR_HALF`, so that whole annulus sits outside the corridor with
 * nothing else to correct the approximation — the term is required, not an
 * acceptable simplification.
 */
export function duneD(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  base: TerrainSample,
): TerrainSample {
  if (!duneInto(seed, x, z, u, uDz, base.h, base.dx, base.dz)) return base;
  return { h: DUNED.h, dx: DUNED.dx, dz: DUNED.dz };
}

/** Where `duneInto` leaves its answer when it returns true; read by number, at once. */
const DUNED: TerrainSample = { h: 0, dx: 0, dz: 0 };

/**
 * `duneD` on the base's three numbers (`bh`, `bdx`, `bdz`). Returns false, writing nothing, where the
 * base stands as it is; true after writing `DUNED`.
 */
function duneInto(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  bh: number,
  bdx: number,
  bdz: number,
): boolean {
  const absU = u < 0 ? -u : u;
  const signU = u < 0 ? -1 : 1;
  smootherstepInto(DUNE_ROAD_NEAR, DUNE_ROAD_FAR, absU);
  const roadV = STEP.v;
  const roadD = STEP.d;
  if (roadV === 0) return false;
  // d(road.v)/d(x,z), through |u|: ∂|u|/∂x = sign(u), ∂|u|/∂z = sign(u)·uDz.
  const roadDx = roadD * signU;
  const roadDz = roadD * signU * uDz;

  // Altitude window: rise over [IN_LO, IN_HI], fall over [OUT_LO, OUT_HI].
  smootherstepInto(DUNE_ALT_IN_LO, DUNE_ALT_IN_HI, bh);
  const riseV = STEP.v;
  const riseD = STEP.d;
  smootherstepInto(DUNE_ALT_OUT_LO, DUNE_ALT_OUT_HI, bh);
  const fallV = STEP.v;
  const fallD = STEP.d;
  const w = riseV * (1 - fallV);
  if (w === 0) return false;
  // d(window)/d(base.h)
  const wDh = riseD * (1 - fallV) - riseV * fallD;

  fbm2dInto(x / DUNE_WAVELENGTH_X, z / DUNE_WAVELENGTH_Z, seed ^ DUNE_SALT, DUNE_OCTAVES);
  const fV = NOISE.v;
  const fDx = NOISE.dx;
  const fDz = NOISE.dz;
  // fbm2d is already zero-centred — it sums gradientNoise2 and is normalized
  // to [-1, 1] (field.ts:218), unlike fbm2 (sums valueNoise2, [0, 1]). Halving
  // it gives exactly the [-0.5, 0.5] this field wants, so dunes cut troughs as
  // well as raising crests without an additive re-centring term.
  const v = 0.5 * fV;
  const a = DUNE_AMPLITUDE * roadV;
  const aDx = DUNE_AMPLITUDE * roadDx;
  const aDz = DUNE_AMPLITUDE * roadDz;

  // Δh = a(u)·w(base.h)·v(x, z) — the DUNE'S CONTRIBUTION, added to base.h
  // below, not the height itself. All three factors' gradients are live:
  // the road window's through u, the altitude window's through base.h, and
  // the noise field's own. Same product-rule shape as the sea-stack block
  // above, with one more live factor. v = 0.5·f.v, so ∂v/∂x = 0.5·f.dx /
  // DUNE_WAVELENGTH_X and likewise for z.
  DUNED.h = bh + a * w * v;
  DUNED.dx = bdx + aDx * w * v + a * wDh * bdx * v + a * (w * (0.5 * fDx)) / DUNE_WAVELENGTH_X;
  DUNED.dz = bdz + aDz * w * v + a * wDh * bdz * v + a * (w * (0.5 * fDz)) / DUNE_WAVELENGTH_Z;
  return true;
}

/**
 * Signed coast distance for the variant registry — the same `d` that
 * `coastFrame` derives (`x − coastlineX`), duplicated as two lines rather
 * than calling `coastFrame` and discarding the rest: `coastFrame` also
 * computes `dDz`, `blendEnd` and `blendEndDz`, none of which this needs, so
 * sharing would mean carrying an unused wider return shape here.
 */
function signedCoastDistance(seed: number, x: number, z: number): number {
  fbm2dInto(WARP_LINE_X, z / COAST_WARP_WAVELENGTH, seed ^ COAST_WARP_SALT, COAST_WARP_OCTAVES);
  return x - (COAST_X + COAST_WARP_AMPLITUDE * NOISE.v);
}

/** Where `olympicBaseFrom` leaves its answer; read by number, at once. */
const BASE: TerrainSample = { h: 0, dx: 0, dz: 0 };

/** The pre-road field: shore profile + stacks + dense blend, left in `BASE`. Extracted
 * unchanged from the old olympicSample so its arithmetic is untouched —
 * the montane-family snapshots and the outside-corridor bit-identity test
 * both pin this. */
function olympicBaseFrom(
  seed: number, x: number, z: number,
  d: number, dDz: number, blendEnd: number, blendEndDz: number,
): void {
  // Short-circuit: inland of the window, dense bit-identically.
  if (d >= blendEnd) {
    denseSampleInto(seed, x, z);
    BASE.h = MONTANE_OUT.h;
    BASE.dx = MONTANE_OUT.dx;
    BASE.dz = MONTANE_OUT.dz;
    return;
  }

  shoreProfileInto(d);
  const shoreV = PROFILE.v;
  const shoreDd = PROFILE.dd;

  stackBandInto(seed, x, z, d, dDz);
  const baseH = shoreV + BAND.v;
  const baseDx = shoreDd + BAND.dx;
  const baseDz = shoreDd * dDz + BAND.dz;

  const span = blendEnd - BLEND_START;
  const t = (d - BLEND_START) / span;
  if (t <= 0) {
    BASE.h = baseH;
    BASE.dx = baseDx;
    BASE.dz = baseDz;
    return;
  }

  // Blend region: quintic smootherstep of t, whose z-derivative carries both
  // the coastline's movement and the window's own z-dependence:
  //   ∂t/∂x = 1/span,  ∂t/∂z = (dDz·span − (d − BLEND_START)·blendEndDz)/span².
  denseSampleInto(seed, x, z);
  const mH = MONTANE_OUT.h;
  const mDx = MONTANE_OUT.dx;
  const mDz = MONTANE_OUT.dz;
  const s = t * t * t * (t * (t * 6 - 15) + 10);
  const sDt = 30 * t * t * (t - 1) * (t - 1);
  const tDx = 1 / span;
  const tDz = (dDz * span - (d - BLEND_START) * blendEndDz) / (span * span);
  BASE.h = baseH + s * (mH - baseH);
  BASE.dx = baseDx + s * (mDx - baseDx) + sDt * tDx * (mH - baseH);
  BASE.dz = baseDz + s * (mDz - baseDz) + sDt * tDz * (mH - baseH);
}

/**
 * Where `coastFrame` leaves its answer. Asked again from inside the road's grade lattice while an outer
 * sample is still running, so a caller copies what it needs into locals before it calls anything else.
 */
const FRAME = {
  coastlineX: 0, dDz: 0, blendEnd: 0, blendEndDz: 0, roadBlendEnd: 0, roadBlendEndDz: 0,
};

/**
 * The coastline-warp preamble, left in `FRAME`: coast x, its z-derivative, and the blend
 * window's endpoint and z-derivative — TWO of the latter. Shared by the
 * sample, the pre-road base export, and the road lattice so all three see the
 * same warp.
 *
 * `blendEnd` is the APRONED window: inside
 * the trail's z-window it is pulled out to APRON_BLEND_END so the shore→montane
 * climb happens over ~500 m rather than a headland's 100. ONLY
 * `olympicBaseFrom`'s terrain blend may read it.
 *
 * `roadBlendEnd` is the headland/bay value the coast has always had, and EVERY
 * `roadOffsetD` caller reads it — the sample, the pre-trail sample, the pre-pad
 * sample, the road frame, the road distance, the centreline and the grade
 * lattice — because `roadOffsetD`'s coast offset is a FRACTION
 * (ROAD_WINDOW_FRACTION) of the blend window, so a window pulled out to 600 m
 * moves the highway itself inland with it.
 *
 * 2026-09-09: the apron shifted
 * the road 32–50 m inland inside its z-window (seed 24301 at z = 0:
 * −230 → −198) and put a 45° jog in the centreline across the window's fade at
 * z ≈ ±660 (|d roadCenterX / dz| up to 1.020, against 0.479 anywhere on the
 * pre-apron road itself — on the coast warp, well outside the apron's window).
 * The apron is a TERRAIN change; the highway is not part of it.
 * `apron.test.ts` pins the centreline bit-identical to the pre-apron formula
 * and holds its drift under 0.5, which is the control's own worst plus a
 * margin.
 */
function coastFrame(seed: number, z: number): void {
  // Coastline: 1-D fbm along z. fbm2d's derivatives are w.r.t. its own inputs,
  // so ∂/∂z of warp(z / λ) is warp.dz / λ.
  fbm2dInto(WARP_LINE_X, z / COAST_WARP_WAVELENGTH, seed ^ COAST_WARP_SALT, COAST_WARP_OCTAVES);
  const warpV = NOISE.v;
  const warpDz = NOISE.dz;
  const coastlineX = COAST_X + COAST_WARP_AMPLITUDE * warpV;
  const dDz = (-COAST_WARP_AMPLITUDE * warpDz) / COAST_WARP_WAVELENGTH; // ∂d/∂z; ∂d/∂x = 1

  // Blend window, narrowed on headlands: warp seaward ⇒ v < 0 ⇒
  // window toward BLEND_END_HEADLAND; deepest bay ⇒ v ≈ +1 ⇒ BLEND_END_BAY.
  const head = 0.5 + 0.5 * warpV;
  const headDz = (0.5 * warpDz) / COAST_WARP_WAVELENGTH;

  // The apron: inside the trail's z-window
  // the blend end is pulled out to APRON_BLEND_END so the shore→montane climb
  // happens over ~500 m rather than a headland's 100. Outside the window
  // this is the headland/bay value exactly (W = 0). Product rule through W(z).
  const b0 = BLEND_END_HEADLAND + (BLEND_END_BAY - BLEND_END_HEADLAND) * head;
  const b0Dz = (BLEND_END_BAY - BLEND_END_HEADLAND) * headDz;
  const blend = overlay === null ? undefined : overlay.blend;
  if (blend === undefined) {
    FRAME.coastlineX = coastlineX;
    FRAME.dDz = dDz;
    FRAME.blendEnd = b0;
    FRAME.blendEndDz = b0Dz;
    FRAME.roadBlendEnd = b0;
    FRAME.roadBlendEndDz = b0Dz;
    return;
  }
  // The place's own end, which may be the seed's (a bay drawn out further in one world than another).
  const end = typeof blend.end === "number" ? blend.end : blend.end(seed);
  const W = blend.windowD(z, seed);
  FRAME.coastlineX = coastlineX;
  FRAME.dDz = dDz;
  FRAME.blendEnd = b0 + (end - b0) * W.v;
  FRAME.blendEndDz = b0Dz * (1 - W.v) + (end - b0) * W.dz;
  FRAME.roadBlendEnd = b0;
  FRAME.roadBlendEndDz = b0Dz;
}

/** The pre-road field, exported for census purposes and any future tooling
 * that needs terrain without the highway cut into it. */
export function olympicBaseSample(seed: number, x: number, z: number): TerrainSample {
  coastFrame(seed, z);
  olympicBaseFrom(seed, x, z, x - FRAME.coastlineX, FRAME.dDz, FRAME.blendEnd, FRAME.blendEndDz);
  return { h: BASE.h, dx: BASE.dx, dz: BASE.dz };
}

/** Pre-road heights at road-centerline lattice points, memoized per seed.
 * Pure memoization of a pure function — bit-transparent, and the
 * query-order test pins that. Growth is one entry per ROAD_LATTICE (480 m)
 * of travelled z: negligible. Deliberately samples the pre-cliff field: at
 * the centerline u = 0, cliffD is the identity, so the lattice cannot see
 * cliffs by construction. */
const LATTICE_CACHE = new Map<number, Map<number, number>>();
/** The seed's lattice reader, made once: a sample asks for it at every point inside the corridor. */
const LATTICE_READERS = new Map<number, (i: number) => number>();

function latticeHFor(seed: number): (i: number) => number {
  const reader = LATTICE_READERS.get(seed);
  if (reader !== undefined) return reader;
  let perSeed = LATTICE_CACHE.get(seed);
  if (perSeed === undefined) {
    perSeed = new Map();
    LATTICE_CACHE.set(seed, perSeed);
  }
  const cache = perSeed;
  const made = (i: number): number => {
    let h = cache.get(i);
    if (h === undefined) {
      const z = i * ROAD_LATTICE;
      coastFrame(seed, z);
      const coastlineX = FRAME.coastlineX;
      const frameDDz = FRAME.dDz;
      const blendEnd = FRAME.blendEnd;
      const blendEndDz = FRAME.blendEndDz;
      roadOffsetInto(seed, z, BLEND_START, FRAME.roadBlendEnd, FRAME.roadBlendEndDz);
      const dr = ROAD_OFFSET.dr;
      // The centerline point: x = coastlineX + dr, so x − coastlineX is dr
      // only up to the float rounding of that addition — consistent to
      // ~1 ulp (~4e-14 m measured), not bit-exactly. The independent-oracle
      // test below re-derives d as x − coastlineX and checks agreement with
      // a tolerance rather than toBe for exactly this reason.
      olympicBaseFrom(seed, coastlineX + dr, z, dr, frameDDz, blendEnd, blendEndDz);
      h = BASE.h;
      cache.set(i, h);
    }
    return h;
  };
  LATTICE_READERS.set(seed, made);
  return made;
}

/** The road's grade line height and z-slope at a given z. */
export function roadGradeAt(seed: number, z: number): { h: number; dz: number } {
  gradeSplineInto(latticeHFor(seed), z);
  return { h: GRADE.h, dz: GRADE.dz };
}

/** The road frame at a world point: signed offset u and its z-derivative. */
export function roadFrameAt(seed: number, x: number, z: number): { u: number; uDz: number } {
  coastFrame(seed, z);
  const d = x - FRAME.coastlineX;
  const frameDDz = FRAME.dDz;
  roadOffsetInto(seed, z, BLEND_START, FRAME.roadBlendEnd, FRAME.roadBlendEndDz);
  return { u: d - ROAD_OFFSET.dr, uDz: frameDDz - ROAD_OFFSET.drDz };
}

/**
 * Where `coastStagesInto` leaves its answer: the road's frame at the point and the coast's ground there, as
 * numbers. Written by every call of it; read at once.
 */
const COAST = { u: 0, uDz: 0, d: 0, dDz: 0, blendEnd: 0, blendEndDz: 0, h: 0, dx: 0, dz: 0 };

/**
 * The coast's ground before any place is laid over it, with the road's frame it was made in, left in
 * `COAST`: the massif, the coast, the cliffs, the dunes and the cove.
 */
function coastStagesInto(seed: number, x: number, z: number): void {
  coastFrame(seed, z);
  const coastlineX = FRAME.coastlineX;
  const frameDDz = FRAME.dDz;
  const blendEnd = FRAME.blendEnd;
  const blendEndDz = FRAME.blendEndDz;
  const roadBlendEnd = FRAME.roadBlendEnd;
  const roadBlendEndDz = FRAME.roadBlendEndDz;
  const d = x - coastlineX;
  roadOffsetInto(seed, z, BLEND_START, roadBlendEnd, roadBlendEndDz);
  const u = d - ROAD_OFFSET.dr;
  const uDz = frameDDz - ROAD_OFFSET.drDz;
  olympicBaseFrom(seed, x, z, d, frameDDz, blendEnd, blendEndDz);
  const baseH = BASE.h;
  const baseDx = BASE.dx;
  const baseDz = BASE.dz;
  // Cliff bands sit between the pre-road field and the corridor: the road
  // then cuts through cliffed ground, and the
  // mask's road suppression keeps the corridor and grade lattice untouched
  // (cliffD is the identity for |u| ≤ CLIFF_ROAD_NEAR = ROAD_CORRIDOR_HALF).
  const keep = overlay === null || overlay.cliffKeepD === undefined ? UNIT_KEEP : overlay.cliffKeepD(u, uDz, z, seed);
  let h = baseH;
  let dx = baseDx;
  let dz = baseDz;
  if (cliffInto(seed, x, z, u, uDz, baseH, baseDx, baseDz, keep)) {
    h = CLIFFED.h;
    dx = CLIFFED.dx;
    dz = CLIFFED.dz;
  }
  // Dunes AFTER cliffs so cliffD reads the exact base it read before this
  // feature existed (its own early-out is base.h < 12, and the dune window is
  // cold above 8, so the two are disjoint either way — this ordering just
  // makes that bit-exact rather than merely true). BEFORE the corridor, so
  // road earthworks still flatten whatever dunes would have been there.
  //
  // This placement does NOT keep dune noise off the grade spline — an
  // earlier version of this comment claimed it did; that was wrong. The
  // spline is immune independent of where duneD is called: latticeHFor
  // samples exactly the road centerline (u = 0), and DUNE_ROAD_NEAR ==
  // ROAD_CORRIDOR_HALF, so duneD's own road-suppression window is already
  // stone cold at u = 0, whatever the call site. See the "keeps duneD out
  // of olympicBaseFrom" guard in olympic.test.ts: it checks the call site
  // textually rather than numerically for exactly this reason — moving
  // duneD into olympicBaseFrom leaves every lattice point in that test's
  // sweep numerically unchanged.
  if (duneInto(seed, x, z, u, uDz, h, dx, dz)) {
    h = DUNED.h;
    dx = DUNED.dx;
    dz = DUNED.dz;
  }
  if (coveInto(seed, x, z, d, frameDDz, u, uDz, h, dx, dz)) {
    h = COVED.h;
    dx = COVED.dx;
    dz = COVED.dz;
  }
  COAST.u = u;
  COAST.uDz = uDz;
  COAST.d = d;
  COAST.dDz = frameDDz;
  COAST.blendEnd = blendEnd;
  COAST.blendEndDz = blendEndDz;
  COAST.h = h;
  COAST.dx = dx;
  COAST.dz = dz;
}

/**
 * The coast's ground before any place is laid over it, with the road's frame it was made in:
 * the massif, the coast, the cliffs, the dunes and the cove. What a place plans itself on,
 * before it has a shape of its own to lay.
 */
export function coastGround(seed: number, x: number, z: number): { u: number; uDz: number; ground: TerrainSample } {
  coastStagesInto(seed, x, z);
  return { u: COAST.u, uDz: COAST.uDz, ground: { h: COAST.h, dx: COAST.dx, dz: COAST.dz } };
}

/** `ground` with the road's corridor cut through it, as the last stage of the coast's ground cuts it. */
export function roadCorridorOverD(seed: number, z: number, u: number, uDz: number, ground: TerrainSample): TerrainSample {
  if (Math.abs(u) >= ROAD_CORRIDOR_HALF) return ground;
  gradeSplineInto(latticeHFor(seed), z);
  if (!corridorInto(u, uDz, GRADE.h, GRADE.dz, ground.h, ground.dx, ground.dz)) return ground;
  return { h: CORRIDOR.h, dx: CORRIDOR.dx, dz: CORRIDOR.dz };
}

/** The made-feature mask hook: samples the composed field itself only
 * when the caller doesn't already hold the ground height at (x, z) — the
 * peak's treeline is a height, not a radius, so `featureMaskAt` needs it, but
 * a caller that already sampled the ground should not
 * pay for a second `olympicSample`. */
const WATER_BODIES_CACHE = new Map<number, readonly WaterBodySource[]>();
/** The sea, then the lakes of the place laid over the coast. A pure function of the seed, so
 * a per-seed cache is bit-transparent. */
function waterBodiesHook(seed: number): readonly WaterBodySource[] {
  let bodies = WATER_BODIES_CACHE.get(seed);
  if (bodies === undefined) {
    const list: WaterBodySource[] = [{ kind: "sea", level: SEA_LEVEL }];
    if (overlay !== null && overlay.lakes !== undefined) list.push(...overlay.lakes(seed));
    bodies = list;
    WATER_BODIES_CACHE.set(seed, bodies);
  }
  return bodies;
}

function featureMaskOf(place: CoastOverlay): TerrainVariant["featureMask"] {
  const mask = place.featureMask;
  if (mask === undefined) return undefined;
  return (seed: number, x: number, z: number, h?: number): FeatureMask => mask(seed, x, z, h ?? olympicSample(seed, x, z).h);
}

function olympicSample(seed: number, x: number, z: number): TerrainSample {
  coastStagesInto(seed, x, z);
  const u = COAST.u;
  const uDz = COAST.uDz;
  const cH = COAST.h;
  const cDx = COAST.dx;
  const cDz = COAST.dz;
  // The place laid over the coast, if there is one: its ground over the cove's and under the
  // road's corridor, so the road's earthworks still cut whatever it made in their way. Its
  // interface takes and returns a record: one is made to hand it, and its answer is read by number.
  let sH = cH;
  let sDx = cDx;
  let sDz = cDz;
  // A place that asked for its beach's own relief: laid on the coast's ground (the road's corridor and the
  // ground under the sea or above the sand untouched) before the place's own ground and the road's cut.
  if (beachShape > 0 && cH > SHAPE_LO && cH < SHAPE_HI) {
    const cove = coveFor(seed);
    coveWeightInto(cove, z, u, uDz);
    bayMaskInto(COAST.blendEnd, COAST.blendEndDz, z, (cove.heads[0] as Headland).z, (cove.heads[1] as Headland).z);
    if (beachShapeInto(seed, z, COAST.d, COAST.dDz, u, uDz, cH, cDx, cDz, WEIGHT.v, WEIGHT.dx, WEIGHT.dz, BAY.v, BAY.dz, beachShape)) {
      sH = SHAPED.h;
      sDx = SHAPED.dx;
      sDz = SHAPED.dz;
    }
  }
  let placed: TerrainSample | null = null;
  if (overlay !== null) {
    placed = overlay.shapeD(seed, x, z, u, uDz, { h: sH, dx: sDx, dz: sDz });
    sH = placed.h;
    sDx = placed.dx;
    sDz = placed.dz;
  }
  if (Math.abs(u) >= ROAD_CORRIDOR_HALF) return placed === null ? { h: sH, dx: sDx, dz: sDz } : placed;
  gradeSplineInto(latticeHFor(seed), z);
  if (!corridorInto(u, uDz, GRADE.h, GRADE.dz, sH, sDx, sDz)) return placed === null ? { h: sH, dx: sDx, dz: sDz } : placed;
  return { h: CORRIDOR.h, dx: CORRIDOR.dx, dz: CORRIDOR.dz };
}

/** Absolute distance to the road centerline — the |u| the road math uses. */
function roadDistance(seed: number, x: number, z: number): number {
  coastFrame(seed, z);
  const coastlineX = FRAME.coastlineX;
  roadOffsetInto(seed, z, BLEND_START, FRAME.roadBlendEnd, FRAME.roadBlendEndDz);
  return Math.abs(x - coastlineX - ROAD_OFFSET.dr);
}

/** World x of the road centerline at z — where `roadDistance` is zero. The
 * same two calls `roadDistance` makes, minus the subtraction. A function
 * hook rather than a tunable, so the level id does not move; the renderer
 * bakes it into a 1-D table for per-fragment road paint. */
export function roadCenterX(seed: number, z: number): number {
  coastFrame(seed, z);
  const coastlineX = FRAME.coastlineX;
  roadOffsetInto(seed, z, BLEND_START, FRAME.roadBlendEnd, FRAME.roadBlendEndDz);
  return coastlineX + ROAD_OFFSET.dr;
}

/** What the coast declares of itself for the level id, before any place adds its own. */
const COAST_TUNABLES: Readonly<Record<string, number>> = {
    ...DENSE_VARIANT_TUNABLES,
    SEA_LEVEL,
    COAST_X,
    COAST_WARP_WAVELENGTH,
    COAST_WARP_AMPLITUDE,
    COAST_WARP_OCTAVES,
    BLEND_START,
    BLEND_END_BAY,
    BLEND_END_HEADLAND,
    BEACH_GRADE,
    SURF_GRADE,
    GRADE_MORPH,
    SHELF_BREAK_DEPTH,
    FLOOR_DEPTH,
    SHELF_BREAK_WIDTH,
    STACK_BAND_NEAR,
    STACK_BAND_FAR,
    STACK_BAND_FADE,
    STACK_CELL,
    STACK_DENSITY,
    STACK_RADIUS_MIN,
    STACK_RADIUS_MAX,
    STACK_HEIGHT_MIN,
    STACK_HEIGHT_MAX,
    DUNE_AMPLITUDE,
    DUNE_WAVELENGTH_X,
    DUNE_WAVELENGTH_Z,
    DUNE_OCTAVES,
    DUNE_ALT_IN_LO,
    DUNE_ALT_IN_HI,
    DUNE_ALT_OUT_LO,
    DUNE_ALT_OUT_HI,
    DUNE_ROAD_NEAR,
    DUNE_ROAD_FAR,
    DUNE_SALT,
    COVE_WIDTH_MIN, COVE_WIDTH_MAX, COVE_END_BLEND, COVE_BACK_FADE, COVE_FACE_GRADE, COVE_BED_GRADE,
    COVE_TOE_DEPTH, COVE_TOE_MORPH, COVE_CREST, COVE_CREST_MORPH,
    HEAD_HEIGHT_MIN, HEAD_HEIGHT_MAX, HEAD_REACH_MIN, HEAD_REACH_MAX, HEAD_HALF_WIDTH, HEAD_RISE, HEAD_TIP,
    COVE_STACK_STEP, COVE_STACK_PAIR_ODDS, COVE_STACK_RADIUS_MIN, COVE_STACK_RADIUS_MAX,
    COVE_STACK_HEIGHT_MIN, COVE_STACK_HEIGHT_MAX,
    COVE_SALT,
    ROAD_WINDOW_FRACTION,
    ROAD_WOBBLE,
    ROAD_WOBBLE_WAVELENGTH,
    ROAD_WOBBLE_OCTAVES,
    ROAD_SALT,
    ROAD_LATTICE,
    ROAD_BED_HALF,
    ROAD_CORRIDOR_HALF,
    CLIFF_PERIOD,
    CLIFF_BENCH,
    CLIFF_RISER_HALF,
    CLIFF_PHASE_AMP,
    CLIFF_PHASE_WAVELENGTH,
    CLIFF_PHASE_OCTAVES,
    CLIFF_PHASE_SALT,
    CLIFF_ALT_LO,
    CLIFF_ALT_HI,
    CLIFF_MTN_STRENGTH,
    CLIFF_MTN_WAVELENGTH,
    CLIFF_MTN_OCTAVES,
    CLIFF_MTN_LO,
    CLIFF_MTN_HI,
    CLIFF_MTN_SALT,
    CLIFF_OUT_STRENGTH,
    CLIFF_OUT_WAVELENGTH,
    CLIFF_OUT_OCTAVES,
    CLIFF_OUT_LO,
    CLIFF_OUT_HI,
    CLIFF_OUT_ALT_LO,
    CLIFF_OUT_ALT_HI,
    CLIFF_OUT_SALT,
    CLIFF_ROAD_NEAR,
    CLIFF_ROAD_FAR,
};

/**
 * A place laid over the coast: ground of its own over the coast's, and its answers to what the
 * rest of the world asks about it. The coast stays what it is everywhere the place does not
 * reach; a world with no place laid over it is the plain coast and the massif behind it.
 */
export type CoastOverlay = {
  /** What the place declares of itself: joined to the coast's own, and so part of the level id. */
  tunables: Readonly<Record<string, number>>;
  /**
   * A window along the coast (its weight at z, with the weight's slope) inside which the
   * shore's climb to the massif is drawn out to end `end` metres inland, whatever the bay or
   * the headland there would have had. The end and the window may each be the seed's, so that a
   * place's bay is broad in one world and narrow in another; a place that takes no notice of the
   * seed gives a number and a window of z alone.
   */
  blend?: { end: number | ((seed: number) => number); windowD(z: number, seed: number): { v: number; dz: number } };
  /** How much of the cliff bands is kept at a place in the road's frame: 1 all of them, 0 none. The seed is handed for a place whose reach is the seed's. */
  cliffKeepD?(u: number, uDz: number, z: number, seed: number): { v: number; dx: number; dz: number };
  /** The place's ground at a point, over the coast's (`base`, through the cove) and under the road's corridor, in the road's frame. */
  shapeD(seed: number, x: number, z: number, u: number, uDz: number, base: TerrainSample): TerrainSample;
  /** The place's lakes, which follow the sea among the world's water bodies. */
  lakes?(seed: number): readonly LakeSource[];
  /** The made features' mask at a place whose ground stands at `h`. */
  featureMask?(seed: number, x: number, z: number, h: number): FeatureMask;
} & Pick<
  TerrainVariant,
  "trailDistance" | "trailGraph" | "sceneryLandmarks" | "landmarkMask" | "prepare" | "install" | "isPrepared" | "shoreStrip" | "clearing" | "wildlifeGround" | "clutterStands" | "beach" | "pavedGround"
>;

/** The place laid over the coast in this thread, once the coast is registered with one. */
let overlay: CoastOverlay | null = null;
/** How much of the beach's own relief the place asked for (`BeachOptions.shape`): 0 where it gave no beach or no shape. */
let beachShape = 0;

/**
 * Registers the coast as the terrain `olympic`, with the place a game lays over it or with
 * none. Once a thread, before a world is asked for: every thread that builds a world (a
 * worker's too) registers the same place, or the two build different worlds.
 */
export function registerOlympic(place: CoastOverlay | null): void {
  registerTerrainVariant({
    name: "olympic",
    tunables: place === null ? COAST_TUNABLES : { ...COAST_TUNABLES, ...place.tunables, ...(place.beach === undefined ? {} : beachTunables(place.beach)) },
    waterLevel: SEA_LEVEL,
    waterBodies: waterBodiesHook,
    coveMask: coveMaskHook,
    coastDistance: signedCoastDistance,
    roadDistance,
    roadCenterX,
    trailDistance: place?.trailDistance,
    trailGraph: place?.trailGraph,
    sceneryLandmarks: place?.sceneryLandmarks,
    landmarkMask: place?.landmarkMask,
    featureMask: place === null ? undefined : featureMaskOf(place),
    prepare: place?.prepare,
    install: place?.install,
    isPrepared: place?.isPrepared,
    shoreStrip: place?.shoreStrip,
    clearing: place?.clearing,
    wildlifeGround: place?.wildlifeGround,
    clutterStands: place?.clutterStands,
    beach: place?.beach,
    pavedGround: place?.pavedGround,
    sample: olympicSample,
  });
  overlay = place;
  beachShape = place?.beach === undefined ? 0 : resolveShape(place.beach);
}
