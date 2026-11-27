/**
 * What lies on a beach: the wrack the tide leaves, the cobbles of the storm line, small driftwood,
 * and the grass of the dunes. A place opts in with `beach` (`CoastOverlay`, `olympic.ts`); a place
 * that gives none gets the world it always had, to the bit, because nothing here is asked then.
 *
 * Four kinds, each a pure point function of (seed, cell) like the clutter's (`clutter.ts`) but from
 * random streams of its own (`BEACH_SALTS`), so that no stream the clutter draws from is touched:
 *
 *  - kelp: heaps of it, 0.3 to 1.2 m, along the line of the last high tide (`WRACK_LINE_HEIGHT`)
 *    and thinner along an older one, the lines wandering 10 to 20 cm of height along the shore,
 *    in clumps with gaps between;
 *  - stone: cobbles and pebbles, 5 to 30 cm, in patches of dozens with bare sand between, more of
 *    them at the storm line (`STORM_LINE_HEIGHT`) and where the paint lays its pebble layer;
 *  - drift: small driftwood, 0.3 to 1.2 m, mostly along the same three lines;
 *  - grass: clumps of dune grass from the storm line to the back of the beach, sparse at the line
 *    and thicker toward the soil.
 *
 * A cell holds several instances (a patch of cobbles is dozens), each at a hashed place inside its
 * own cell, so a rect's instances are those of the cells it overlaps, as the clutter's are. They
 * are solid to nothing: no collider, no wildlife reads them, so they never change how a player
 * walks. What they add to the world is only what a renderer draws, but the place's densities are
 * part of its level id (`beachTunables`), so two places that differ in them refuse each other.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot, no Math.random, no time.
 */
import { fbm2, hash3, valueNoise2 } from "./field.js";
import { activeTerrainVariant, elevationSampleAt, shoreHeight } from "./terrain.js";
import { NO_FEATURE_MASK } from "./features.js";
import { CLUTTER_DRIFTWOOD, CLUTTER_GRASS, CLUTTER_LITTER, CLUTTER_ROCK, CLUTTER_ROCK_ROAD_FAR, CLUTTER_ROCK_ROAD_NEAR } from "./clutter.js";
import { COAST_FADE_END_HEIGHT, OLD_WRACK_LINE_HEIGHT, SAND_TOP_HEIGHT, STORM_LINE_HEIGHT, WRACK_LINE_HEIGHT } from "./tideLines.js";

/**
 * What a place says of its beach: a density a kind, 0 for none, 1 for the engine's own count.
 * Whatever a place leaves out is 1, so `beach: {}` turns every kind on. Above 1 is read as 1.
 */
export type BeachOptions = {
  /** Heaps of kelp along the tide lines. */
  wrack?: number;
  /** Cobbles and pebble patches. */
  cobbles?: number;
  /** Small driftwood. */
  driftwood?: number;
  /** Dune grass. */
  duneGrass?: number;
};

/** The densities a place's `BeachOptions` come to: each a number from 0 to 1. */
export type BeachDensities = { readonly wrack: number; readonly cobbles: number; readonly driftwood: number; readonly duneGrass: number };

// ---- Kinds (ids, not tunables) ---------------------------------------------
export const BEACH_KELP = 0;
export const BEACH_STONE = 1;
export const BEACH_DRIFT = 2;
export const BEACH_GRASS = 3;
export const BEACH_KIND_COUNT = 4;

/** How many models (variants) a renderer draws for a kind: the kelp's heap and strand, the stones' two shapes, the rest one. */
export const BEACH_VARIANTS: readonly number[] = [2, 2, 1, 1];
/** Kelp's two models: the tangled heap, and a single long strand of bull kelp, the share of the kelp that is the latter. */
export const BEACH_KELP_HEAP = 0;
export const BEACH_KELP_STRAND = 1;
export const BEACH_STRAND_SHARE = 1 / 6;

// ---- Tunables (every one appears in BEACH_CONSTANTS) -------------------------
/** The cell side (m): instances stand inside their own cell. */
export const BEACH_CELL = 4;
/** Candidates a cell offers a kind; each is kept by its own draw. */
export const BEACH_CANDIDATES: readonly number[] = [16, 32, 2, 3];
/** Chance a candidate in full band, full clump is kept, a kind each. */
export const BEACH_KEEP: readonly number[] = [0.9, 0.8, 0.22, 0.7];
/** The wandering of a tide line (m of height, half-range) and its wavelength along and across the beach (m). */
export const BEACH_WANDER_AMPLITUDE = 0.2;
export const BEACH_WANDER_WAVELENGTH = 26;
/** A tide line's band: full inside `INNER` of the wandering line, gone `OUTER` from it (m of height). */
export const BEACH_LINE_INNER = 0.04;
export const BEACH_LINE_OUTER = 0.12;
/** What of the last tide's wrack the older line holds. */
export const BEACH_OLD_WRACK_SHARE = 0.4;
/** Kelp clumps: the noise's wavelength (m) and the edges it is kept between (gaps below the first). */
export const BEACH_CLUMP_WAVELENGTH = 4.5;
export const BEACH_CLUMP_LO = 0.5;
export const BEACH_CLUMP_HI = 0.62;
/** Cobble patches: wavelength (m), edges, and what stands outside a patch (a share of a patch's own). */
export const BEACH_PATCH_WAVELENGTH = 7;
export const BEACH_PATCH_LO = 0.52;
export const BEACH_PATCH_HI = 0.68;
export const BEACH_PATCH_STRAY = 0.04;
/** The cobbles' band about the storm line: full inside `INNER`, gone `OUTER` from it (m of height), and the thin
 * scatter between the wrack and the soil. */
export const BEACH_STORM_INNER = 0.25;
export const BEACH_STORM_OUTER = 0.9;
export const BEACH_STRAY_SHARE = 0.18;
/** Where the paint lays its pebble layer: the 34 m value noise it mottles the dry sand with (`GROUND_WAVELENGTH`,
 * `GROUND_SALT`, `game/terrainSurface.ts`), and the stones' share of it: none of the pebble layer, a floor of
 * `FLOOR`; all of it, 1. Held equal to the paint's by `test/sim/beach.test.ts`. */
export const BEACH_PEBBLE_WAVELENGTH = 34;
export const BEACH_PEBBLE_SALT = 0x9a13;
export const BEACH_PEBBLE_LO = 0.4;
export const BEACH_PEBBLE_HI = 0.7;
export const BEACH_PEBBLE_FLOOR = 0.25;
/** Sizes (m): kelp's length, a stone's longest side, driftwood's length, a tuft's height. Each kind's `[min, max]`, drawn
 * as `min + (max - min) * u * u`, so the small ones are the many. */
export const BEACH_SIZES: readonly (readonly [number, number])[] = [[0.3, 1.2], [0.05, 0.3], [0.3, 1.2], [0.45, 0.85]];
/** Dune grass: a trace at the storm line (a share of its density) growing to full at `FULL`, and gone by the soil. */
export const BEACH_GRASS_TRACE = 0.12;
export const BEACH_GRASS_FULL = 6;
export const BEACH_GRASS_CLUMP_WAVELENGTH = 6;
export const BEACH_GRASS_CLUMP_LO = 0.38;
export const BEACH_GRASS_CLUMP_HI = 0.55;
/** Driftwood's gaps: wavelength (m) and edges. */
export const BEACH_DRIFT_CLUMP_WAVELENGTH = 9;
export const BEACH_DRIFT_CLUMP_LO = 0.35;
export const BEACH_DRIFT_CLUMP_HI = 0.55;
/** Nothing lies on ground steeper than this (rise over run), on a trail's bed (m from its edge), or on a road's verge
 * (the rocks' own distances: `CLUTTER_ROCK_ROAD_NEAR`, `CLUTTER_ROCK_ROAD_FAR`). */
export const BEACH_SLOPE_MAX = 0.8;
export const BEACH_TRAIL_CLEAR = 2;
/** The least height a cell's candidates are looked at in, over the plane through its centre: the dunes' relief. */
export const BEACH_CURVE_MARGIN = 0.3;

/** The streams: a salt a kind, none of them the clutter's (`CLUTTER_*_SALT`), and one for the lines' wandering. */
export const BEACH_SALTS: readonly number[] = [0x6b31, 0x6b32, 0x6b33, 0x6b34];
export const BEACH_WANDER_SALT = 0x6b40;
export const BEACH_CLUMP_SALT = 0x6b41;

/** Each kind's band of height (m) outside which none stands: a cell wholly outside it is not looked at. */
const BAND: readonly (readonly [number, number])[] = [
  [OLD_WRACK_LINE_HEIGHT - 0.4, WRACK_LINE_HEIGHT + 0.4],
  [0.1, SAND_TOP_HEIGHT + 2],
  [OLD_WRACK_LINE_HEIGHT - 0.4, STORM_LINE_HEIGHT + 1],
  [STORM_LINE_HEIGHT - 0.4, COAST_FADE_END_HEIGHT],
];

/** The clutter class each kind answers to where a place says what stands (`clutterStands`). */
export const BEACH_STANDS_AS: readonly number[] = [CLUTTER_LITTER, CLUTTER_ROCK, CLUTTER_DRIFTWOOD, CLUTTER_GRASS];

/** A number kept between 0 and 1; not a number, 0. */
function unit(v: number | undefined): number {
  if (v === undefined || !(v > 0)) return v === undefined ? 1 : 0;
  return v > 1 ? 1 : v;
}

/** A place's `BeachOptions` as the densities they come to: left out, 1. */
export function resolveBeach(options: BeachOptions): BeachDensities {
  return { wrack: unit(options.wrack), cobbles: unit(options.cobbles), driftwood: unit(options.driftwood), duneGrass: unit(options.duneGrass) };
}

/** What a place with a beach adds to its terrain's tunables (keyed `BEACHLAY_`: the coast has a `BEACH_GRADE` of its own), and so to the level id: its densities and every constant
 * above. A place without one adds nothing, and its level id is what it was. */
export function beachTunables(options: BeachOptions): Record<string, number> {
  const d = resolveBeach(options);
  const out: Record<string, number> = {
    BEACHLAY_WRACK_D: d.wrack, BEACHLAY_COBBLES_D: d.cobbles, BEACHLAY_DRIFTWOOD_D: d.driftwood, BEACHLAY_DUNE_GRASS_D: d.duneGrass,
    BEACHLAY_CELL: BEACH_CELL, BEACHLAY_WANDER_AMPLITUDE: BEACH_WANDER_AMPLITUDE, BEACHLAY_WANDER_WAVELENGTH: BEACH_WANDER_WAVELENGTH, BEACHLAY_LINE_INNER: BEACH_LINE_INNER, BEACHLAY_LINE_OUTER: BEACH_LINE_OUTER, BEACHLAY_OLD_WRACK_SHARE: BEACH_OLD_WRACK_SHARE,
    BEACHLAY_CLUMP_WAVELENGTH: BEACH_CLUMP_WAVELENGTH, BEACHLAY_CLUMP_LO: BEACH_CLUMP_LO, BEACHLAY_CLUMP_HI: BEACH_CLUMP_HI, BEACHLAY_PATCH_WAVELENGTH: BEACH_PATCH_WAVELENGTH, BEACHLAY_PATCH_LO: BEACH_PATCH_LO, BEACHLAY_PATCH_HI: BEACH_PATCH_HI,
    BEACHLAY_PATCH_STRAY: BEACH_PATCH_STRAY, BEACHLAY_STORM_INNER: BEACH_STORM_INNER, BEACHLAY_STORM_OUTER: BEACH_STORM_OUTER, BEACHLAY_STRAY_SHARE: BEACH_STRAY_SHARE, BEACHLAY_PEBBLE_WAVELENGTH: BEACH_PEBBLE_WAVELENGTH, BEACHLAY_PEBBLE_SALT: BEACH_PEBBLE_SALT,
    BEACHLAY_PEBBLE_LO: BEACH_PEBBLE_LO, BEACHLAY_PEBBLE_HI: BEACH_PEBBLE_HI, BEACHLAY_PEBBLE_FLOOR: BEACH_PEBBLE_FLOOR, BEACHLAY_GRASS_TRACE: BEACH_GRASS_TRACE, BEACHLAY_GRASS_FULL: BEACH_GRASS_FULL, BEACHLAY_GRASS_CLUMP_WAVELENGTH: BEACH_GRASS_CLUMP_WAVELENGTH,
    BEACHLAY_GRASS_CLUMP_LO: BEACH_GRASS_CLUMP_LO, BEACHLAY_GRASS_CLUMP_HI: BEACH_GRASS_CLUMP_HI, BEACHLAY_DRIFT_CLUMP_WAVELENGTH: BEACH_DRIFT_CLUMP_WAVELENGTH, BEACHLAY_DRIFT_CLUMP_LO: BEACH_DRIFT_CLUMP_LO, BEACHLAY_DRIFT_CLUMP_HI: BEACH_DRIFT_CLUMP_HI,
    BEACHLAY_STRAND_SHARE: BEACH_STRAND_SHARE, BEACHLAY_SLOPE_MAX: BEACH_SLOPE_MAX, BEACHLAY_TRAIL_CLEAR: BEACH_TRAIL_CLEAR, BEACHLAY_CURVE_MARGIN: BEACH_CURVE_MARGIN, BEACHLAY_WANDER_SALT: BEACH_WANDER_SALT, BEACHLAY_CLUMP_SALT: BEACH_CLUMP_SALT,
    WRACK_LINE_HEIGHT, OLD_WRACK_LINE_HEIGHT, STORM_LINE_HEIGHT,
  };
  for (let k = 0; k < BEACH_KIND_COUNT; k++) {
    out[`BEACHLAY_CANDIDATES_${k}`] = BEACH_CANDIDATES[k] as number;
    out[`BEACHLAY_KEEP_${k}`] = BEACH_KEEP[k] as number;
    out[`BEACHLAY_SIZE_MIN_${k}`] = (BEACH_SIZES[k] as readonly [number, number])[0];
    out[`BEACHLAY_SIZE_MAX_${k}`] = (BEACH_SIZES[k] as readonly [number, number])[1];
    out[`BEACHLAY_SALT_${k}`] = BEACH_SALTS[k] as number;
  }
  return out;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/** How far (m of height) the tide line `line` wanders from its height at a place: the same for every kind, so
 * the heaps, the cobbles and the driftwood lie on one line. */
export function wrackWander(seed: number, x: number, z: number, line: number): number {
  const w = 1 / BEACH_WANDER_WAVELENGTH;
  return (fbm2(x * w, z * w, seed ^ BEACH_WANDER_SALT ^ (line * 0x101), 2) - 0.5) * 2 * BEACH_WANDER_AMPLITUDE;
}

/** The weight (0 to 1) of the tide line at height `at` on ground whose height the shore's rules read as `sh`. */
function lineWeight(seed: number, x: number, z: number, sh: number, at: number, line: number): number {
  const d = sh - at - wrackWander(seed, x, z, line);
  return 1 - smoothstep(BEACH_LINE_INNER, BEACH_LINE_OUTER, d < 0 ? -d : d);
}

/** The last tide's line and, thinner, the older one: the wrack's own band. */
export function wrackBand(seed: number, x: number, z: number, sh: number): number {
  const last = lineWeight(seed, x, z, sh, WRACK_LINE_HEIGHT, 0);
  const old = lineWeight(seed, x, z, sh, OLD_WRACK_LINE_HEIGHT, 1) * BEACH_OLD_WRACK_SHARE;
  return last > old ? last : old;
}

/** The storm line's broad band, between the soil and the sand. */
function stormBand(sh: number): number {
  const d = sh - STORM_LINE_HEIGHT;
  return 1 - smoothstep(BEACH_STORM_INNER, BEACH_STORM_OUTER, d < 0 ? -d : d);
}

/** The paint's own mottle of sand and pebbles: 0 where the dry sand is sand, 1 where it is the pebble layer. */
export function pebbleGround(seed: number, x: number, z: number): number {
  const w = 1 / BEACH_PEBBLE_WAVELENGTH;
  return valueNoise2(x * w, z * w, seed ^ BEACH_PEBBLE_SALT);
}

/** One heap, cobble, piece of driftwood or tuft. Everything a renderer needs, nothing it must not draw twice. */
export type BeachInstance = {
  kind: number;
  x: number;
  z: number;
  groundH: number;
  groundDx: number;
  groundDz: number;
  /** Metres: a heap's or a piece of driftwood's length, a stone's longest side, a tuft's height. */
  size: number;
  /** Which of the kind's `BEACH_VARIANTS` models. */
  variant: number;
  /** A plain [0, 1) draw, for what the renderer decides by trig (its yaw) or by thinning (the low tier keeps the half below 0.5). */
  hash: number;
};

/**
 * The instances of every kind in cell (cx, cz), appended to `out`: none where the active terrain has no
 * beach. A kind that stands in a cell stands there however its neighbours do: nothing reads across a cell's edge.
 */
export function beachInCell(seed: number, cx: number, cz: number, out: BeachInstance[]): void {
  const variant = activeTerrainVariant();
  const beach = variant.beach;
  if (beach === undefined) return;
  const half = BEACH_CELL / 2;
  const x0 = cx * BEACH_CELL;
  const z0 = cz * BEACH_CELL;
  const centre = elevationSampleAt(seed, x0 + half, z0 + half);
  const reach = (centre.dx < 0 ? -centre.dx : centre.dx) * half + (centre.dz < 0 ? -centre.dz : centre.dz) * half + BEACH_CURVE_MARGIN;
  const lo = centre.h - reach;
  const hi = shoreHeight(seed, x0 + half, z0 + half, centre.h) + reach;
  const densities = resolveBeach(beach);
  const density = [densities.wrack, densities.cobbles, densities.driftwood, densities.duneGrass];
  for (let kind = 0; kind < BEACH_KIND_COUNT; kind++) {
    const d = density[kind] as number;
    if (d <= 0) continue;
    const band = BAND[kind] as readonly [number, number];
    if (hi < band[0] || lo > band[1]) continue;
    const salted = seed ^ (BEACH_SALTS[kind] as number);
    const candidates = BEACH_CANDIDATES[kind] as number;
    for (let j = 0; j < candidates; j++) {
      const at = j * 8;
      const x = x0 + hash3(cx, cz, at, salted) * BEACH_CELL;
      const z = z0 + hash3(cx, cz, at + 1, salted) * BEACH_CELL;
      const u = hash3(cx, cz, at + 2, salted);
      // What the noise alone allows: asked before the ground is, since most candidates fail it.
      const keep = d * (BEACH_KEEP[kind] as number);
      let p = keep * noiseWeight(seed, kind, x, z);
      if (u >= p) continue;
      const g = elevationSampleAt(seed, x, z);
      const slopeSq = g.dx * g.dx + g.dz * g.dz;
      if (slopeSq > BEACH_SLOPE_MAX * BEACH_SLOPE_MAX) continue;
      const sh = shoreHeight(seed, x, z, g.h);
      p *= heightWeight(seed, kind, x, z, sh);
      if (u >= p) continue;
      const road = variant.roadDistance?.(seed, x, z) ?? Infinity;
      p *= smoothstep(CLUTTER_ROCK_ROAD_NEAR, CLUTTER_ROCK_ROAD_FAR, road);
      if (u >= p) continue;
      if (kind === BEACH_STONE) {
        // Where the paint lays pebbles; the cove's whole beach is, whatever the mottle says.
        const cove = variant.coveMask?.(seed, x, z) ?? 0;
        p *= cove + (1 - cove) * pebbleShare(pebbleGround(seed, x, z));
        if (u >= p) continue;
      }
      if ((variant.trailDistance?.(seed, x, z) ?? Infinity) < BEACH_TRAIL_CLEAR) continue;
      const mask = variant.featureMask?.(seed, x, z, g.h) ?? NO_FEATURE_MASK;
      const factor = kind === BEACH_GRASS ? mask.clutter : (mask.loose ?? 1);
      if (u >= p * factor) continue;
      const stands = variant.clutterStands;
      if (stands !== undefined && !stands(seed, BEACH_STANDS_AS[kind] as number, x, z)) continue;
      const size = BEACH_SIZES[kind] as readonly [number, number];
      const s = hash3(cx, cz, at + 3, salted);
      out.push({
        kind, x, z, groundH: g.h, groundDx: g.dx, groundDz: g.dz,
        size: size[0] + (size[1] - size[0]) * s * s,
        variant: variantOf(kind, hash3(cx, cz, at + 4, salted)),
        hash: hash3(cx, cz, at + 5, salted),
      });
    }
  }
}

/** Which of a kind's models a draw picks: about one in six of the kelp is a strand, the rest a heap. */
function variantOf(kind: number, u: number): number {
  if (kind === BEACH_KELP) return u < BEACH_STRAND_SHARE ? BEACH_KELP_STRAND : BEACH_KELP_HEAP;
  return (u * (BEACH_VARIANTS[kind] as number)) | 0;
}

/** The stones' share of the paint's pebble layer: a floor where it is sand, 1 where it is pebbles. */
function pebbleShare(ground: number): number {
  return BEACH_PEBBLE_FLOOR + (1 - BEACH_PEBBLE_FLOOR) * smoothstep(BEACH_PEBBLE_LO, BEACH_PEBBLE_HI, ground);
}

/** A cobble patch's weight at a place: full in a patch, a trace outside. */
function noiseOnlyPatch(seed: number, x: number, z: number): number {
  const w = 1 / BEACH_PATCH_WAVELENGTH;
  const patch = smoothstep(BEACH_PATCH_LO, BEACH_PATCH_HI, fbm2(x * w, z * w, seed ^ BEACH_CLUMP_SALT ^ 0x51, 2));
  return BEACH_PATCH_STRAY + (1 - BEACH_PATCH_STRAY) * patch;
}

/** A kind's weight from the clump and patch noises alone, 0 to 1. */
function noiseWeight(seed: number, kind: number, x: number, z: number): number {
  switch (kind) {
    case BEACH_KELP: {
      const w = 1 / BEACH_CLUMP_WAVELENGTH;
      return smoothstep(BEACH_CLUMP_LO, BEACH_CLUMP_HI, fbm2(x * w, z * w, seed ^ BEACH_CLUMP_SALT, 2));
    }
    case BEACH_STONE:
      return noiseOnlyPatch(seed, x, z);
    case BEACH_DRIFT: {
      const w = 1 / BEACH_DRIFT_CLUMP_WAVELENGTH;
      return smoothstep(BEACH_DRIFT_CLUMP_LO, BEACH_DRIFT_CLUMP_HI, fbm2(x * w, z * w, seed ^ BEACH_CLUMP_SALT ^ 0x52, 2));
    }
    default: {
      const w = 1 / BEACH_GRASS_CLUMP_WAVELENGTH;
      return smoothstep(BEACH_GRASS_CLUMP_LO, BEACH_GRASS_CLUMP_HI, fbm2(x * w, z * w, seed ^ BEACH_CLUMP_SALT ^ 0x53, 2));
    }
  }
}

/** A kind's weight from the height the shore's rules read, 0 to 1. */
function heightWeight(seed: number, kind: number, x: number, z: number, sh: number): number {
  switch (kind) {
    case BEACH_KELP:
      return wrackBand(seed, x, z, sh);
    case BEACH_STONE: {
      // The storm line's band, the wrack's and the scatter between them and the soil.
      const wrack = wrackBand(seed, x, z, sh) * 0.5;
      const stray = BEACH_STRAY_SHARE * smoothstep(0.2, 0.6, sh) * (1 - smoothstep(SAND_TOP_HEIGHT, SAND_TOP_HEIGHT + 2, sh));
      const storm = stormBand(sh);
      const best = storm > wrack ? storm : wrack;
      return best > stray ? best : stray;
    }
    case BEACH_DRIFT: {
      const wrack = wrackBand(seed, x, z, sh);
      const storm = stormBand(sh);
      return storm > wrack ? storm : wrack;
    }
    default: {
      // Grass: a trace at the storm line, full toward the soil, and gone where the ordinary grass has come in.
      const up = smoothstep(STORM_LINE_HEIGHT - 0.3, STORM_LINE_HEIGHT + 0.4, sh);
      const grow = BEACH_GRASS_TRACE + (1 - BEACH_GRASS_TRACE) * smoothstep(STORM_LINE_HEIGHT, BEACH_GRASS_FULL, sh);
      return up * grow * (1 - smoothstep(COAST_FADE_END_HEIGHT - 2, COAST_FADE_END_HEIGHT, sh));
    }
  }
}

/** Every instance inside the half-open rect [minX, maxX) × [minZ, maxZ), cell by cell. */
export function beachInRect(seed: number, minX: number, minZ: number, maxX: number, maxZ: number): BeachInstance[] {
  const out: BeachInstance[] = [];
  const cells: BeachInstance[] = [];
  const c0x = Math.floor(minX / BEACH_CELL);
  const c1x = Math.floor(maxX / BEACH_CELL);
  const c0z = Math.floor(minZ / BEACH_CELL);
  const c1z = Math.floor(maxZ / BEACH_CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      cells.length = 0;
      beachInCell(seed, cx, cz, cells);
      for (const inst of cells) if (inst.x >= minX && inst.x < maxX && inst.z >= minZ && inst.z < maxZ) out.push(inst);
    }
  }
  return out;
}
