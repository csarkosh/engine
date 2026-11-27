/**
 * The shape of a beach: when a place asks for it (`BeachOptions.shape`, `beach.ts`), the ground of its sand gains
 * relief at sizes the 1 m mesh can hold, in four parts, each a height added to the coast's own ground at a point:
 *
 *  - a storm ridge (berm) just above the storm line, 15 to 30 cm over the plain profile, with a seaward face that
 *    rises 2.2 m long and a gentle fall behind, its crest wandering along the shore and breached in places;
 *  - cusps along the swash, 12 to 30 m apart, horns 10 to 20 cm over the bays between;
 *  - bars and channels on the wet flat, 6 to 15 m across, oblique and broken, 8 to 15 cm of relief;
 *  - hummocks at the back of the beach, 3 to 7 m across and 15 to 35 cm high, in irregular fields.
 *
 * Every part is a function of the coast's own height `h` (a window in it, so that it lies where the tide lines
 * lie, and the paint, the objects and the walking that read heights follow it) and of two shore coordinates: `d`,
 * the signed distance from the coastline (m, inland positive), and `z`, along it. Value and slope are analytic,
 * left in `SHAPED` with no allocation, as the dunes' and the cove's are; the added work is gated by the height
 * band, so ground outside it costs nothing and is bit-identical to the ground without the option.
 *
 * Nothing is added inside the road's corridor and its shoulder (`ROAD_CORRIDOR_HALF` to `+SHAPE_ROAD_FADE`), so the
 * road's bed is cut through the ground it always was. The relief is laid before a place's own `shapeD`, so what a
 * place cuts afterwards (a trail's bed, a pad) is cut through it.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot, no Math.random, no time.
 */
import { fbm2dInto, NOISE } from "./field.js";
import { ROAD_CORRIDOR_HALF } from "./road.js";
import { SAND_TOP_HEIGHT, STORM_LINE_HEIGHT } from "./tideLines.js";

// ---- Tunables (every one appears in `beachShapeTunables`) ---------------------
/** Heights (m above the still sea) outside which the shape adds nothing: under the sea, and at the sand's top. */
export const SHAPE_LO = -0.8;
export const SHAPE_HI = SAND_TOP_HEIGHT;
/** The road's corridor is untouched; the relief comes in over this width beyond it. */
export const SHAPE_ROAD_FADE = 4;
/**
 * The grade of the plain ground (rise over run) the ridge's face and back are measured in, as a function of height: `LO`
 * at and under `EDGE_LO`, `HI` at and over `EDGE_HI`, smoothly between. The coast's own beach is 1 in 40 only on its wet flat;
 * by the storm line it has steepened toward the massif (measured on three seeds over 3 km of coast: median 0.05 at +1.0 m,
 * 0.085 at +1.5 m, 0.12 at +2.0 m, 0.155 at +2.5 m), and the cove's face (1 in 12) is at 0.083, much the same there.
 */
export const BERM_GRADE_LO = 0.05;
export const BERM_GRADE_HI = 0.155;
export const BERM_GRADE_EDGE_LO = 1;
export const BERM_GRADE_EDGE_HI = 2.5;
/**
 * Where there is a beach: the relief is laid only on a bay's shore (the coast's blend end past `BAY_LO`, in full by `BAY_HI`: a
 * headland's is 40 m, a bay's up to 500), clear of the cove's headlands (more than `HEAD_LO` m along the shore from their axes, in
 * full by `HEAD_HI`) and landward of the sea stacks (coast distance past `STACK_LO`, in full by `STACK_HI`). Ground steeper than
 * a person walks stands in the rest, and a height window on it would add a steep slope of its own.
 */
export const BAY_LO = 150;
export const BAY_HI = 300;
export const HEAD_LO = 24;
export const HEAD_HI = 45;
export const STACK_LO = -40;
export const STACK_HI = -25;
/** What of the ridge, the cusps and the hummocks the cove keeps (the bars it keeps none of: it has no flat). */
export const SHAPE_COVE_KEEP = 0.5;
/** Shore-parallel features are long across the shore: the length (m) their noise runs over across it. */
export const SHAPE_ACROSS = 200;

/** The ridge: how far its crest height wanders from the storm line (m of height) and over what length along the shore (m). */
export const BERM_WANDER = 0.15;
export const BERM_WANDER_LENGTH = 55;
/** The crest's height over the plain profile: `MID` plus up to `SWING` of noise (m), over this length along the shore. */
export const BERM_AMP_MID = 0.225;
export const BERM_AMP_SWING = 0.09;
export const BERM_AMP_LENGTH = 35;
/** The seaward face's length (m, on the grade above) and the fall behind the crest. */
export const BERM_FACE = 2.2;
export const BERM_BACK = 3.5;
/** The breaches: noise over this length along the shore, a breach where it passes `LO` to `HI`, down to `1 - DEPTH` of the crest. */
export const BERM_BREACH_LENGTH = 45;
export const BERM_BREACH_LO = 0.2;
export const BERM_BREACH_HI = 0.4;
export const BERM_BREACH_DEPTH = 0.8;

/** The cusps: the window in height (rise, fall), the spacing (m) and how far it wanders, the horn-to-bay height. */
export const CUSP_RISE_LO = 0.15;
export const CUSP_RISE_HI = 0.4;
export const CUSP_FALL_LO = 0.95;
export const CUSP_FALL_HI = 1.25;
export const CUSP_SPACING = 19;
export const CUSP_WARP = 1;
export const CUSP_WARP_LENGTH = 90;
export const CUSP_AMP_MID = 0.15;
export const CUSP_AMP_SWING = 0.06;
export const CUSP_AMP_LENGTH = 70;

/** The bars: the window in height, their relief's amplitude (m), the shear that makes them oblique, and their size across and along. */
export const BAR_RISE_LO = -0.8;
export const BAR_RISE_HI = -0.4;
export const BAR_FALL_LO = 0.5;
export const BAR_FALL_HI = 0.9;
export const BAR_AMP = 0.21;
export const BAR_SHEAR = 0.3;
export const BAR_ACROSS = 8.5;
export const BAR_ALONG = 40;
export const BAR_OCTAVES = 2;

/** The hummocks: the window in height, their lobes' size (m), the edges a lobe is cut from the noise at, the fields' size (m), and the height. */
export const HUM_RISE_LO = 1.8;
export const HUM_RISE_HI = 2.3;
export const HUM_FALL_LO = 3.4;
export const HUM_FALL_HI = SAND_TOP_HEIGHT;
export const HUM_SIZE = 7;
export const HUM_LOBE_LO = -0.05;
export const HUM_LOBE_HI = 0.55;
export const HUM_FIELD_LENGTH = 45;
export const HUM_FIELD_LO = -0.5;
export const HUM_FIELD_HI = 0;
export const HUM_AMP_MID = 0.28;
export const HUM_AMP_SWING = 0.08;

export const SHAPE_SALTS: readonly number[] = [0x7a01, 0x7a02, 0x7a03, 0x7a04, 0x7a05, 0x7a06, 0x7a07, 0x7a08, 0x7a09];
const SALT_HC = 0, SALT_AMP = 1, SALT_BREACH = 2, SALT_CUSP_PHASE = 3, SALT_CUSP_AMP = 4, SALT_BARS = 5, SALT_HUM = 6, SALT_FIELD = 7;

/** What a shaped beach adds to its place's tunables, and so to the level id. */
export function beachShapeTunables(shape: number): Record<string, number> {
  const out: Record<string, number> = {
    BEACHSHAPE_AMOUNT: shape, BEACHSHAPE_LO: SHAPE_LO, BEACHSHAPE_HI: SHAPE_HI, BEACHSHAPE_ROAD_FADE: SHAPE_ROAD_FADE,
    BEACHSHAPE_BAY_LO: BAY_LO, BEACHSHAPE_BAY_HI: BAY_HI, BEACHSHAPE_HEAD_LO: HEAD_LO, BEACHSHAPE_HEAD_HI: HEAD_HI, BEACHSHAPE_STACK_LO: STACK_LO, BEACHSHAPE_STACK_HI: STACK_HI,
    BEACHSHAPE_BERM_GRADE_LO: BERM_GRADE_LO, BEACHSHAPE_BERM_GRADE_HI: BERM_GRADE_HI, BEACHSHAPE_BERM_GRADE_EDGE_LO: BERM_GRADE_EDGE_LO, BEACHSHAPE_BERM_GRADE_EDGE_HI: BERM_GRADE_EDGE_HI, BEACHSHAPE_COVE_KEEP: SHAPE_COVE_KEEP, BEACHSHAPE_ACROSS: SHAPE_ACROSS,
    BEACHSHAPE_BERM_WANDER: BERM_WANDER, BEACHSHAPE_BERM_WANDER_LENGTH: BERM_WANDER_LENGTH, BEACHSHAPE_BERM_AMP_MID: BERM_AMP_MID,
    BEACHSHAPE_BERM_AMP_SWING: BERM_AMP_SWING, BEACHSHAPE_BERM_AMP_LENGTH: BERM_AMP_LENGTH, BEACHSHAPE_BERM_FACE: BERM_FACE, BEACHSHAPE_BERM_BACK: BERM_BACK,
    BEACHSHAPE_BERM_BREACH_LENGTH: BERM_BREACH_LENGTH, BEACHSHAPE_BERM_BREACH_LO: BERM_BREACH_LO, BEACHSHAPE_BERM_BREACH_HI: BERM_BREACH_HI,
    BEACHSHAPE_BERM_BREACH_DEPTH: BERM_BREACH_DEPTH,
    BEACHSHAPE_CUSP_RISE_LO: CUSP_RISE_LO, BEACHSHAPE_CUSP_RISE_HI: CUSP_RISE_HI, BEACHSHAPE_CUSP_FALL_LO: CUSP_FALL_LO, BEACHSHAPE_CUSP_FALL_HI: CUSP_FALL_HI,
    BEACHSHAPE_CUSP_SPACING: CUSP_SPACING, BEACHSHAPE_CUSP_WARP: CUSP_WARP, BEACHSHAPE_CUSP_WARP_LENGTH: CUSP_WARP_LENGTH,
    BEACHSHAPE_CUSP_AMP_MID: CUSP_AMP_MID, BEACHSHAPE_CUSP_AMP_SWING: CUSP_AMP_SWING, BEACHSHAPE_CUSP_AMP_LENGTH: CUSP_AMP_LENGTH,
    BEACHSHAPE_BAR_RISE_LO: BAR_RISE_LO, BEACHSHAPE_BAR_RISE_HI: BAR_RISE_HI, BEACHSHAPE_BAR_FALL_LO: BAR_FALL_LO, BEACHSHAPE_BAR_FALL_HI: BAR_FALL_HI,
    BEACHSHAPE_BAR_AMP: BAR_AMP, BEACHSHAPE_BAR_SHEAR: BAR_SHEAR, BEACHSHAPE_BAR_ACROSS: BAR_ACROSS, BEACHSHAPE_BAR_ALONG: BAR_ALONG, BEACHSHAPE_BAR_OCTAVES: BAR_OCTAVES,
    BEACHSHAPE_HUM_RISE_LO: HUM_RISE_LO, BEACHSHAPE_HUM_RISE_HI: HUM_RISE_HI, BEACHSHAPE_HUM_FALL_LO: HUM_FALL_LO, BEACHSHAPE_HUM_FALL_HI: HUM_FALL_HI,
    BEACHSHAPE_HUM_SIZE: HUM_SIZE, BEACHSHAPE_HUM_LOBE_LO: HUM_LOBE_LO, BEACHSHAPE_HUM_LOBE_HI: HUM_LOBE_HI, BEACHSHAPE_HUM_FIELD_LENGTH: HUM_FIELD_LENGTH,
    BEACHSHAPE_HUM_FIELD_LO: HUM_FIELD_LO, BEACHSHAPE_HUM_FIELD_HI: HUM_FIELD_HI, BEACHSHAPE_HUM_AMP_MID: HUM_AMP_MID, BEACHSHAPE_HUM_AMP_SWING: HUM_AMP_SWING,
    BEACHSHAPE_STORM_LINE: STORM_LINE_HEIGHT,
  };
  for (let i = 0; i < SHAPE_SALTS.length; i++) out[`BEACHSHAPE_SALT_${i}`] = SHAPE_SALTS[i] as number;
  return out;
}

/** Where `stepInto` leaves its answer: a cubic smoothstep and its slope. Read by number, at once. */
const S = { v: 0, d: 0 };
function stepInto(e0: number, e1: number, x: number): void {
  if (x <= e0) { S.v = 0; S.d = 0; return; }
  if (x >= e1) { S.v = 1; S.d = 0; return; }
  const w = e1 - e0;
  const t = (x - e0) / w;
  S.v = t * t * (3 - 2 * t);
  S.d = (6 * t * (1 - t)) / w;
}

/** Where `noiseInto` leaves its answer: a noise in [-1, 1] and its slope in x and z of the world. */
const R = { v: 0, dx: 0, dz: 0 };
/**
 * Gradient noise over the shore's coordinates: `a` across (its z-derivative `aDz`), `b` along, at wavelengths `la`, `lb`.
 * Left in `R` as the value and the total derivatives with respect to the world's x and z (∂a/∂x = 1, ∂b/∂z = 1).
 */
function noiseInto(a: number, b: number, aDz: number, seed: number, la: number, lb: number, octaves: number): void {
  fbm2dInto(a / la, b / lb, seed, octaves);
  R.v = NOISE.v;
  R.dx = NOISE.dx / la;
  R.dz = (NOISE.dx * aDz) / la + NOISE.dz / lb;
}

/** Where `bayMaskInto` leaves its answer: the weight and its slope along z (it has none along x). */
export const BAY = { v: 0, dz: 0 };
/**
 * Where a place is a bay's shore and not a headland's: the coast's blend end (and its slope along z) and the z of the cove's two headland
 * axes. 1 on a bay clear of the headlands, 0 on a headland.
 */
export function bayMaskInto(blendEnd: number, blendEndDz: number, z: number, head0: number, head1: number): void {
  stepInto(BAY_LO, BAY_HI, blendEnd);
  let v = S.v;
  let dz = S.d * blendEndDz;
  for (let i = 0; i < 2; i++) {
    const off = z - (i === 0 ? head0 : head1);
    const sign = off < 0 ? -1 : 1;
    stepInto(HEAD_LO, HEAD_HI, off * sign);
    dz = dz * S.v + v * S.d * sign;
    v *= S.v;
  }
  BAY.v = v;
  BAY.dz = dz;
}

/** Where `beachShapeInto` leaves the shaped ground when it returns true. */
export const SHAPED = { h: 0, dx: 0, dz: 0 };

/**
 * The ground `h` (slopes `hx`, `hz`) at a place with the beach's relief added, in `SHAPED`; false, and nothing written,
 * where the shape adds nothing (outside its band, in the road's corridor). `d` is the signed coast distance and `dDz` its
 * slope along z, `u` and `uDz` the road's frame; `cw` (and its slopes) is the cove's weight there, 0 to 1; `bay` (and its slope along z) `bayMaskInto`'s; `shape`, 0 to 1,
 * scales the relief.
 */
export function beachShapeInto(
  seed: number, z: number, d: number, dDz: number, u: number, uDz: number,
  h: number, hx: number, hz: number, cw: number, cwx: number, cwz: number, bay: number, bayDz: number, shape: number,
): boolean {
  if (!(h > SHAPE_LO && h < SHAPE_HI)) return false;
  const au = u < 0 ? -u : u;
  if (au <= ROAD_CORRIDOR_HALF) return false;
  stepInto(ROAD_CORRIDOR_HALF, ROAD_CORRIDOR_HALF + SHAPE_ROAD_FADE, au);
  let rm = S.v;
  const sg = u < 0 ? -1 : 1;
  let rmx = S.d * sg;
  let rmz = S.d * sg * uDz;
  // The shore's own mask: bay (by z), landward of the stacks (by d); the whole relief is scaled by it and the road's.
  if (bay <= 0) return false;
  stepInto(STACK_LO, STACK_HI, d);
  if (S.v === 0) return false;
  const mx = S.d;
  const mz = S.d * dDz;
  const mv = S.v * bay;
  rmx = rmx * mv + rm * mx * bay;
  rmz = rmz * mv + rm * (mz * bay + S.v * bayDz);
  rm *= mv;
  const keepLoss = 1 - SHAPE_COVE_KEEP;
  const kc = 1 - keepLoss * cw;
  const kcx = -keepLoss * cwx;
  const kcz = -keepLoss * cwz;
  const kb = 1 - cw;
  const kbx = -cwx;
  const kbz = -cwz;

  // P: the ridge, the cusps and the hummocks; Q: the bars.
  let pv = 0, px = 0, pz = 0;
  let qv = 0, qx = 0, qz = 0;

  // ---- The storm ridge ---------------------------------------------------------
  if (h > STORM_LINE_HEIGHT - BERM_WANDER - BERM_FACE * BERM_GRADE_HI && h < STORM_LINE_HEIGHT + BERM_WANDER + BERM_BACK * BERM_GRADE_HI) {
    noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_HC] as number), SHAPE_ACROSS, BERM_WANDER_LENGTH, 1);
    const hc = STORM_LINE_HEIGHT + BERM_WANDER * R.v;
    const hcx = BERM_WANDER * R.dx;
    const hcz = BERM_WANDER * R.dz;
    const rel = h - hc;
    // t: the metres, on the plain ground's grade at this height, from the crest's contour, seaward negative.
    stepInto(BERM_GRADE_EDGE_LO, BERM_GRADE_EDGE_HI, h);
    const grade = BERM_GRADE_LO + (BERM_GRADE_HI - BERM_GRADE_LO) * S.v;
    const gradeH = (BERM_GRADE_HI - BERM_GRADE_LO) * S.d;
    const t = rel / grade;
    if (t > -BERM_FACE && t < BERM_BACK) {
      // t = rel / grade(h): ∂t = (∂h - ∂hc) / grade - t * grade' * ∂h / grade.
      const dt = 1 / grade;
      const dtGrade = (t * gradeH) / grade;
      const tx = (hx - hcx) * dt - dtGrade * hx;
      const tz = (hz - hcz) * dt - dtGrade * hz;
      let b: number;
      let bt: number;
      if (t < 0) {
        const tau = (t + BERM_FACE) / BERM_FACE;
        b = tau * tau * (3 - 2 * tau);
        bt = (6 * tau * (1 - tau)) / BERM_FACE;
      } else {
        const tau = t / BERM_BACK;
        b = 1 - tau * tau * (3 - 2 * tau);
        bt = (-6 * tau * (1 - tau)) / BERM_BACK;
      }
      noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_AMP] as number), SHAPE_ACROSS, BERM_AMP_LENGTH, 1);
      const a = BERM_AMP_MID + BERM_AMP_SWING * R.v;
      const ax = BERM_AMP_SWING * R.dx;
      const az = BERM_AMP_SWING * R.dz;
      noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_BREACH] as number), SHAPE_ACROSS, BERM_BREACH_LENGTH, 1);
      stepInto(BERM_BREACH_LO, BERM_BREACH_HI, R.v);
      const m = 1 - BERM_BREACH_DEPTH * S.v;
      const mx = -BERM_BREACH_DEPTH * S.d * R.dx;
      const mz = -BERM_BREACH_DEPTH * S.d * R.dz;
      const amp = a * m;
      pv += amp * b;
      px += (ax * m + a * mx) * b + amp * bt * tx;
      pz += (az * m + a * mz) * b + amp * bt * tz;
    }
  }

  // ---- Cusps along the swash ---------------------------------------------------
  if (h > CUSP_RISE_LO && h < CUSP_FALL_HI) {
    stepInto(CUSP_RISE_LO, CUSP_RISE_HI, h);
    const riseV = S.v;
    const riseD = S.d;
    stepInto(CUSP_FALL_LO, CUSP_FALL_HI, h);
    const w = riseV * (1 - S.v);
    const wh = riseD * (1 - S.v) - riseV * S.d;
    if (w > 0 || wh !== 0) {
      noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_CUSP_PHASE] as number), SHAPE_ACROSS, CUSP_WARP_LENGTH, 1);
      const phase = z / CUSP_SPACING + CUSP_WARP * R.v;
      const phx = CUSP_WARP * R.dx;
      const phz = 1 / CUSP_SPACING + CUSP_WARP * R.dz;
      const p = phase - Math.floor(phase);
      let f: number;
      let fp: number;
      if (p < 0.5) {
        const q = 2 * p;
        f = -1 + 2 * q * q * (3 - 2 * q);
        fp = 24 * q * (1 - q);
      } else {
        const q = 2 * p - 1;
        f = 1 - 2 * q * q * (3 - 2 * q);
        fp = -24 * q * (1 - q);
      }
      noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_CUSP_AMP] as number), SHAPE_ACROSS, CUSP_AMP_LENGTH, 1);
      const a = CUSP_AMP_MID + CUSP_AMP_SWING * R.v;
      const ax = CUSP_AMP_SWING * R.dx;
      const az = CUSP_AMP_SWING * R.dz;
      // Horns over bays by `a`: the half-range of f (-1 to 1) is a/2.
      pv += 0.5 * a * f * w;
      px += 0.5 * (ax * f * w + a * fp * phx * w + a * f * wh * hx);
      pz += 0.5 * (az * f * w + a * fp * phz * w + a * f * wh * hz);
    }
  }

  // ---- Bars and channels on the wet flat --------------------------------------
  if (h > BAR_RISE_LO && h < BAR_FALL_HI) {
    stepInto(BAR_RISE_LO, BAR_RISE_HI, h);
    const riseV = S.v;
    const riseD = S.d;
    stepInto(BAR_FALL_LO, BAR_FALL_HI, h);
    const w = riseV * (1 - S.v);
    const wh = riseD * (1 - S.v) - riseV * S.d;
    noiseInto(d + BAR_SHEAR * z, z, dDz + BAR_SHEAR, seed ^ (SHAPE_SALTS[SALT_BARS] as number), BAR_ACROSS, BAR_ALONG, BAR_OCTAVES);
    qv = BAR_AMP * w * R.v;
    qx = BAR_AMP * (w * R.dx + wh * hx * R.v);
    qz = BAR_AMP * (w * R.dz + wh * hz * R.v);
  }

  // ---- Hummocks at the back of the beach --------------------------------------
  if (h > HUM_RISE_LO && h < HUM_FALL_HI) {
    stepInto(HUM_RISE_LO, HUM_RISE_HI, h);
    const riseV = S.v;
    const riseD = S.d;
    stepInto(HUM_FALL_LO, HUM_FALL_HI, h);
    const w = riseV * (1 - S.v);
    const wh = riseD * (1 - S.v) - riseV * S.d;
    if (w > 0 || wh !== 0) {
      noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_FIELD] as number), HUM_FIELD_LENGTH, HUM_FIELD_LENGTH, 1);
      const fv = R.v;
      const fdx = R.dx;
      const fdz = R.dz;
      stepInto(HUM_FIELD_LO, HUM_FIELD_HI, fv);
      const pres = S.v;
      const presx = S.d * fdx;
      const presz = S.d * fdz;
      const amp = HUM_AMP_MID + HUM_AMP_SWING * fv;
      const ampx = HUM_AMP_SWING * fdx;
      const ampz = HUM_AMP_SWING * fdz;
      noiseInto(d, z, dDz, seed ^ (SHAPE_SALTS[SALT_HUM] as number), HUM_SIZE, HUM_SIZE, 1);
      stepInto(HUM_LOBE_LO, HUM_LOBE_HI, R.v);
      const lobe = S.v;
      const lobex = S.d * R.dx;
      const lobez = S.d * R.dz;
      const body = amp * lobe * pres;
      const bodyx = ampx * lobe * pres + amp * lobex * pres + amp * lobe * presx;
      const bodyz = ampz * lobe * pres + amp * lobez * pres + amp * lobe * presz;
      pv += w * body;
      px += w * bodyx + wh * hx * body;
      pz += w * bodyz + wh * hz * body;
    }
  }

  const e = kc * pv + kb * qv;
  const ex = kcx * pv + kc * px + kbx * qv + kb * qx;
  const ez = kcz * pv + kc * pz + kbz * qv + kb * qz;
  SHAPED.h = h + shape * rm * e;
  SHAPED.dx = hx + shape * (rmx * e + rm * ex);
  SHAPED.dz = hz + shape * (rmz * e + rm * ez);
  return true;
}

/**
 * How near the top of a hummock a place is, 0 to 1 (a value only): the lobe's weight times the field's, as the relief
 * has them. The dune grass leans toward it. `d` is the signed coast distance.
 */
export function hummockTop(seed: number, d: number, z: number): number {
  noiseInto(d, z, 0, seed ^ (SHAPE_SALTS[SALT_FIELD] as number), HUM_FIELD_LENGTH, HUM_FIELD_LENGTH, 1);
  stepInto(HUM_FIELD_LO, HUM_FIELD_HI, R.v);
  const pres = S.v;
  if (pres === 0) return 0;
  noiseInto(d, z, 0, seed ^ (SHAPE_SALTS[SALT_HUM] as number), HUM_SIZE, HUM_SIZE, 1);
  stepInto(HUM_LOBE_LO, HUM_LOBE_HI, R.v);
  return S.v * pres;
}
