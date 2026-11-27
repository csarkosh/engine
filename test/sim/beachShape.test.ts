import { describe, expect, it, vi } from "vitest";
import { timeLimit } from "../../testing/timeLimit.js";
import "../../src/sim/montane.js";
import type { BeachOptions } from "../../src/sim/beach.js";
import type { CoastOverlay } from "../../src/sim/olympic.js";
import type { TerrainSample, TerrainVariant } from "../../src/sim/terrain.js";
import {
  BERM_BACK, BERM_FACE, BERM_GRADE_HI, BERM_GRADE_LO, BERM_WANDER, CUSP_FALL_HI, CUSP_RISE_LO, SHAPE_HI, SHAPE_LO, SHAPE_ROAD_FADE, hummockTop,
} from "../../src/sim/beachShape.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { SAND_TOP_HEIGHT, STORM_LINE_HEIGHT } from "../../src/sim/tideLines.js";

/**
 * The shape of a beach (`sim/beachShape.ts`): a storm ridge with a step, cusps, bars and channels, and hummocks, added to the coast's ground
 * where a place gives `beach` (`shape` left out is 1). Each world here is a fresh copy of the engine's modules (`load`), so the same coast can
 * be had with and without the option and compared point by point: the difference is the relief itself.
 */

const identity: CoastOverlay["shapeD"] = (_seed, _x, _z, _u, _uDz, base) => base;
const place = (beach?: BeachOptions, shapeD: CoastOverlay["shapeD"] = identity): CoastOverlay => ({ tunables: {}, shapeD, ...(beach === undefined ? {} : { beach }) });

type World = {
  sample(seed: number, x: number, z: number): TerrainSample;
  variant: TerrainVariant;
  passHash(seed: number): number;
  beachInRect: typeof import("../../src/sim/beach.js").beachInRect;
  beachTunables: typeof import("../../src/sim/beach.js").beachTunables;
};
async function load(overlay: CoastOverlay): Promise<World> {
  vi.resetModules();
  await import("../../src/sim/montane.js");
  const olympic = await import("../../src/sim/olympic.js");
  olympic.registerOlympic(overlay);
  const terrain = await import("../../src/sim/terrain.js");
  await import("../../src/sim/passes/elevation.js");
  await import("../../src/sim/passes/trees.js");
  await import("../../src/sim/passes/clutter.js");
  await import("../../src/sim/passes/cliffs.js");
  const forest = await import("../../src/sim/forest.js");
  const beach = await import("../../src/sim/beach.js");
  const variant = terrain.activeTerrainVariant();
  return { sample: (seed, x, z) => variant.sample(seed, x, z), variant, passHash: (seed) => forest.createForest(seed).passHash, beachInRect: beach.beachInRect, beachTunables: beach.beachTunables };
}

/** Bays whose beach the relief reaches in full: a seed and 400 m of shore. The cove (z = 0) and the headlands are left out. */
const SITES: readonly (readonly [number, number])[] = [[1, 300], [20261121, -1500], [7, 1000]];
const SITE_LENGTH = 400;

const plain = await load(place());
const shaped = await load(place({}));
const off = await load(place({ shape: 0 }));

type Cell = { x: number; p: TerrainSample; q: TerrainSample };
const COLUMNS = new Map<string, Cell[]>();
/** The ground at x, 0.5 m apart, from 60 m seaward of the coastline to the top of the sand: without the shape (`p`) and with it (`q`). */
function column(seed: number, z: number): Cell[] {
  const key = `${seed}:${z}`;
  const cached = COLUMNS.get(key);
  if (cached !== undefined) return cached;
  const coastX = -plain.variant.coastDistance!(seed, 0, z);
  const cells: Cell[] = [];
  for (let x = coastX - 60; x < coastX + 200; x += 0.5) {
    const p = plain.sample(seed, x, z);
    if (p.h > SHAPE_HI + 0.2) break;
    cells.push({ x, p, q: shaped.sample(seed, x, z) });
  }
  COLUMNS.set(key, cells);
  return cells;
}
const siteColumns = (seed: number, z0: number): Cell[][] => Array.from({ length: SITE_LENGTH }, (_, i) => column(seed, z0 + i));
const delta = (c: Cell): number => c.q.h - c.p.h;
const percentile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
};

/** Local extremes of a series (index, value, +1 a maximum, -1 a minimum) that stand `prominence` clear of the last of the other kind. */
function extremes(series: readonly number[], prominence: number): { i: number; v: number; kind: 1 | -1 }[] {
  const out: { i: number; v: number; kind: 1 | -1 }[] = [];
  let hi = 0;
  let lo = 0;
  let mode = 0;
  for (let i = 1; i < series.length; i++) {
    const v = series[i] as number;
    if (mode >= 0 && v > (series[hi] as number)) hi = i;
    if (mode <= 0 && v < (series[lo] as number)) lo = i;
    if (mode >= 0 && v < (series[hi] as number) - prominence) {
      out.push({ i: hi, v: series[hi] as number, kind: 1 });
      mode = -1;
      lo = i;
    } else if (mode <= 0 && v > (series[lo] as number) + prominence) {
      out.push({ i: lo, v: series[lo] as number, kind: -1 });
      mode = 1;
      hi = i;
    }
  }
  return out;
}

/** Where the ground, walking inland, first reaches `height`, and the relief there (the difference of the two worlds, by interpolation). */
function atContour(cells: readonly Cell[], height: number): number {
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1] as Cell;
    const b = cells[i] as Cell;
    if (a.p.h < height && b.p.h >= height) {
      const t = (height - a.p.h) / (b.p.h - a.p.h);
      return delta(a) + (delta(b) - delta(a)) * t;
    }
  }
  return NaN;
}

describe("a shaped beach: the default", () => {
  it("gives a place with no beach, or shape 0, the ground the coast always had, to the bit, and its level id", async () => {
    const bits = (s: TerrainSample): string => `${s.h}/${s.dx}/${s.dz}`;
    let band = 0;
    for (const [seed, z0] of SITES) {
      for (let z = z0; z < z0 + 60; z += 3) {
        for (const c of column(seed, z)) {
          if (c.p.h > SHAPE_LO && c.p.h < SHAPE_HI) band++;
          expect(bits(off.sample(seed, c.x, z))).toBe(bits(c.p));
        }
      }
    }
    expect(band).toBeGreaterThan(1000);
    for (const seed of [20261121, 1]) {
      const old = Object.keys(off.variant.tunables).filter((k) => k.startsWith("BEACHSHAPE_") || k === "BEACHLAY_GRASS_LEAN");
      expect(old).toEqual([]);
      // A beach with shape 0 is the beach the engine had before the shape: the same tunables as a beach with every other option, and none of the shape's.
      expect(Object.keys(plain.variant.tunables).filter((k) => k.startsWith("BEACHLAY_"))).toEqual([]);
      const without = plain.passHash(seed);
      const none = off.passHash(seed);
      const all = shaped.passHash(seed);
      expect(none).not.toBe(without);
      expect(all).not.toBe(none);
      expect(shaped.passHash(seed)).toBe(all);
    }
    expect(Object.keys(shaped.variant.tunables).filter((k) => k.startsWith("BEACHSHAPE_")).length).toBeGreaterThan(40);
    expect(shaped.variant.tunables.BEACHSHAPE_AMOUNT).toBe(1);
    const half = await load(place({ shape: 0.5 }));
    expect(half.variant.tunables.BEACHSHAPE_AMOUNT).toBe(0.5);
    expect(half.passHash(1)).not.toBe(shaped.passHash(1));
  }, timeLimit(60_000));

  it("repeats itself: two worlds of the same place give the same ground", async () => {
    const again = await load(place({}));
    for (const [seed, z0] of SITES) {
      for (let z = z0; z < z0 + 40; z += 5) {
        for (const c of column(seed, z).filter((_, i) => i % 4 === 0)) {
          const a = again.sample(seed, c.x, z);
          expect(a.h).toBe(c.q.h);
          expect(a.dx).toBe(c.q.dx);
          expect(a.dz).toBe(c.q.dz);
        }
      }
    }
  }, timeLimit(60_000));

  it("scales with shape", async () => {
    const half = await load(place({ shape: 0.5 }));
    let seen = 0;
    for (const [seed, z0] of SITES) {
      for (let z = z0; z < z0 + 100; z += 7) {
        for (const c of column(seed, z)) {
          const d = delta(c);
          if (Math.abs(d) < 0.05) continue;
          seen++;
          expect(half.sample(seed, c.x, z).h - c.p.h).toBeCloseTo(d / 2, 9);
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
  }, timeLimit(60_000));
});

describe("a shaped beach: where it lies", () => {
  it("changes the ground only between -0.8 m and the sand's top, and nowhere else", () => {
    let inside = 0;
    for (const [seed, z0] of SITES) {
      for (let z = z0; z < z0 + 200; z += 4) {
        for (const c of column(seed, z)) {
          if (c.p.h <= SHAPE_LO || c.p.h >= SHAPE_HI) {
            expect(c.q.h).toBe(c.p.h);
            expect(c.q.dx).toBe(c.p.dx);
            expect(c.q.dz).toBe(c.p.dz);
          } else if (c.q.h !== c.p.h) inside++;
        }
      }
    }
    expect(SHAPE_HI).toBe(SAND_TOP_HEIGHT);
    expect(inside).toBeGreaterThan(2000);
    // Seaward of the sea stacks' band and inland of the sand, over the whole of a bay and the massif behind it: not a metre of difference.
    for (const [seed, z0] of SITES) {
      const c0 = plain.variant.coastDistance!(seed, 0, z0 + 100);
      for (let d = -300; d < 400; d += 10) {
        const x = -c0 + d;
        const p = plain.sample(seed, x, z0 + 100);
        if (p.h > SHAPE_LO && p.h < SHAPE_HI) continue;
        expect(shaped.sample(seed, x, z0 + 100).h).toBe(p.h);
      }
    }
  }, timeLimit(120_000));

  it("keeps the analytic slope the slope of the height, by finite differences, on bays, headlands and the cove", () => {
    const e = 1e-4;
    let worst = 0;
    let moved = 0;
    const points: [number, number, number][] = [];
    for (const [seed, z0] of SITES) {
      for (let z = z0 + 3.37; z < z0 + 330; z += 6.1) for (const c of column(seed, Math.floor(z)).filter((_, i) => i % 7 === 0)) points.push([seed, c.x + 0.13, z]);
    }
    // The cove and a stretch of shore that is partly headland, whose masks have slopes of their own.
    for (const seed of [1, 20261121, 7]) {
      for (let z = -170; z < 170; z += 9.3) {
        const coastX = -plain.variant.coastDistance!(seed, 0, z);
        for (let x = coastX - 20; x < coastX + 90; x += 3.7) points.push([seed, x, z]);
      }
      for (let z = -1500; z < 1500; z += 41.3) {
        const coastX = -plain.variant.coastDistance!(seed, 0, z);
        for (let x = coastX - 30; x < coastX + 90; x += 5.9) points.push([seed, x, z]);
      }
    }
    for (const [seed, x, z] of points) {
      const q = shaped.sample(seed, x, z);
      const fdx = (shaped.sample(seed, x + e, z).h - shaped.sample(seed, x - e, z).h) / (2 * e);
      const fdz = (shaped.sample(seed, x, z + e).h - shaped.sample(seed, x, z - e).h) / (2 * e);
      worst = Math.max(worst, Math.abs(fdx - q.dx), Math.abs(fdz - q.dz));
      if (q.h !== plain.sample(seed, x, z).h) moved++;
    }
    expect(points.length).toBeGreaterThan(2000);
    expect(moved).toBeGreaterThan(300);
    expect(worst).toBeLessThan(2e-3);
  }, timeLimit(120_000));

  it("adds no slope a person cannot walk: under 0.35, on the bays, the cove and the headlands", () => {
    let worst = 0;
    let n = 0;
    const note = (seed: number, x: number, z: number): void => {
      const p = plain.sample(seed, x, z);
      if (p.h <= SHAPE_LO || p.h >= SHAPE_HI) return;
      const q = shaped.sample(seed, x, z);
      worst = Math.max(worst, Math.hypot(q.dx - p.dx, q.dz - p.dz));
      n++;
    };
    for (const seed of [20261121, 1, 7]) {
      for (let z = -1500; z < 1500; z += 5.3) {
        const coastX = -plain.variant.coastDistance!(seed, 0, z);
        for (let x = coastX - 40; x < coastX + 120; x += 0.9) note(seed, x, z);
      }
    }
    expect(n).toBeGreaterThan(100_000);
    expect(worst).toBeLessThan(0.35);
  }, timeLimit(180_000));

  it("leaves the road's bed and a place's own cut corridor as they were", async () => {
    // A bed the place cuts after the relief (a trail, a railbed): flat at 1.2 m along z in [400, 406] across the beach.
    const cut: CoastOverlay["shapeD"] = (_seed, _x, z, _u, _uDz, base) => (z >= 400 && z <= 406 ? { h: 1.2, dx: 0, dz: 0 } : base);
    const withCut = await load(place({}, cut));
    const withCutPlain = await load(place(undefined, cut));
    let bed = 0;
    for (const seed of [1, 7]) {
      for (let z = 395; z < 412; z += 0.5) {
        const coastX = -plain.variant.coastDistance!(seed, 0, z);
        for (let x = coastX - 20; x < coastX + 90; x += 0.5) {
          const a = withCut.sample(seed, x, z);
          // (Within reach of the road the road's own corridor blends it, as it does without the shape.)
          if (z >= 400 && z <= 406 && withCut.variant.roadDistance!(seed, x, z) > ROAD_CORRIDOR_HALF) {
            expect(a.h).toBe(1.2);
            expect(a.dx).toBe(0);
            bed++;
          }
          if (z < 399 || z > 407) continue;
          // The cut's own two edges aside, the shape is what differs between the two worlds.
          expect(withCutPlain.sample(seed, x, z).h === a.h || z < 400 || z > 406 || withCut.variant.roadDistance!(seed, x, z) <= ROAD_CORRIDOR_HALF).toBe(true);
        }
      }
    }
    expect(bed).toBeGreaterThan(300);
    // The road: every point in its corridor is the ground the road always cut (the relief comes in over SHAPE_ROAD_FADE beyond it).
    let inCorridor = 0;
    let inShoulder = 0;
    for (const seed of [1, 20261121, 7]) {
      for (let z = -1500; z < 1500; z += 13) {
        const coastX = -plain.variant.coastDistance!(seed, 0, z);
        for (let x = coastX - 20; x < coastX + 400; x += 1.1) {
          const r = plain.variant.roadDistance!(seed, x, z);
          const p = plain.sample(seed, x, z);
          const q = shaped.sample(seed, x, z);
          if (r <= ROAD_CORRIDOR_HALF) {
            inCorridor++;
            expect(q.h).toBe(p.h);
            expect(q.dx).toBe(p.dx);
            expect(q.dz).toBe(p.dz);
          } else if (r < ROAD_CORRIDOR_HALF + SHAPE_ROAD_FADE) {
            inShoulder++;
          }
        }
      }
    }
    expect(inCorridor).toBeGreaterThan(10_000);
    expect(inShoulder).toBeGreaterThan(1000);
  }, timeLimit(180_000));
});

describe("a shaped beach: its four parts", () => {
  it("lays a storm ridge above the storm line, 15 to 30 cm over the plain profile, with a step of 20 to 40 cm on its seaward face, wandering and breached", () => {
    const amps: number[] = [];
    const drops: number[] = [];
    const crestHeights: number[] = [];
    const runs: number[] = [];
    for (const [seed, z0] of SITES) {
      const series: number[] = [];
      for (const cells of siteColumns(seed, z0)) {
        let best = -Infinity;
        let at = -1;
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i] as Cell;
          if (c.p.h < STORM_LINE_HEIGHT - BERM_WANDER - 0.1 || c.p.h > STORM_LINE_HEIGHT + BERM_WANDER + 0.1) continue;
          if (delta(c) > best) { best = delta(c); at = i; }
        }
        series.push(best);
        amps.push(best);
        if (best >= 0.12) {
          const c = cells[at] as Cell;
          crestHeights.push(c.p.h);
          // The step: the ground's drop from the crest over the face's length seaward of it (the plain profile's own rise included).
          const toe = cells[Math.max(0, at - Math.round(BERM_FACE / 0.5))] as Cell;
          drops.push(c.q.h - toe.q.h);
        }
      }
      // Breaches: runs of shore where the crest stands under half of its usual height.
      const usual = percentile(series, 0.75);
      let run = 0;
      for (const a of series) {
        if (a < 0.5 * usual) run++;
        else { if (run > 0) runs.push(run); run = 0; }
      }
    }
    // The crest's height over the plain profile, where it stands: 15 to 30 cm (a hair over, where the wandering and the grade's second order meet).
    expect(percentile(amps, 0.9)).toBeGreaterThanOrEqual(0.15);
    expect(percentile(amps, 0.9)).toBeLessThanOrEqual(0.3);
    expect(Math.max(...amps)).toBeLessThanOrEqual(0.32);
    expect(percentile(amps, 0.1)).toBeLessThan(0.08);
    // Its height wanders along the shore: at least 5 cm between its quiet and loud stretches.
    expect(percentile(amps, 0.9) - percentile(amps, 0.5)).toBeGreaterThan(0.03);
    // It lies about the storm line, wandering 10 to 15 cm of height.
    expect(percentile(crestHeights, 0.5)).toBeGreaterThan(STORM_LINE_HEIGHT - 0.1);
    expect(percentile(crestHeights, 0.5)).toBeLessThan(STORM_LINE_HEIGHT + 0.4);
    expect(percentile(crestHeights, 0.9) - percentile(crestHeights, 0.1)).toBeGreaterThan(0.1);
    // The step.
    expect(drops.length).toBeGreaterThan(200);
    expect(percentile(drops, 0.5)).toBeGreaterThanOrEqual(0.2);
    expect(percentile(drops, 0.5)).toBeLessThanOrEqual(0.4);
    expect(percentile(drops, 0.1)).toBeGreaterThan(0.12);
    // Breaches: runs of 5 to 15 m exist, and none is the whole shore.
    const breaches = runs.filter((r) => r >= 5 && r <= 15);
    expect(breaches.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...runs)).toBeLessThan(60);
    // The face and the back are as long as they say.
    expect(BERM_FACE).toBeGreaterThanOrEqual(1.5);
    expect(BERM_FACE).toBeLessThanOrEqual(3);
    expect(BERM_BACK).toBeGreaterThan(0);
    expect(BERM_GRADE_LO).toBeLessThan(BERM_GRADE_HI);
  }, timeLimit(120_000));

  it("lays cusps along the swash 12 to 30 m apart, their horns 10 to 20 cm over the bays between", () => {
    const spacings: number[] = [];
    const horn: number[] = [];
    for (const [seed, z0] of SITES) {
      // The relief along the shore on the +0.6 m contour of the plain ground, where the bars have faded and the ridge is far.
      const series = siteColumns(seed, z0).map((cells) => atContour(cells, 0.6));
      expect(series.filter((v) => Number.isNaN(v)).length).toBe(0);
      const ext = extremes(series, 0.04);
      let lastMax = -1;
      for (let k = 0; k < ext.length; k++) {
        const e = ext[k]!;
        if (e.kind === 1) {
          if (lastMax >= 0) spacings.push(e.i - lastMax);
          lastMax = e.i;
        }
        if (k > 0) {
          const d = Math.abs(e.v - ext[k - 1]!.v);
          // A horn over its neighbouring bay.
          if (d > 0) horn.push(d);
        }
      }
    }
    expect(spacings.length).toBeGreaterThan(20);
    expect(percentile(spacings, 0.5)).toBeGreaterThanOrEqual(12);
    expect(percentile(spacings, 0.5)).toBeLessThanOrEqual(30);
    expect(percentile(spacings, 0.1)).toBeGreaterThanOrEqual(8);
    expect(percentile(spacings, 0.9)).toBeLessThanOrEqual(36);
    expect(percentile(horn, 0.5)).toBeGreaterThanOrEqual(0.1);
    expect(percentile(horn, 0.5)).toBeLessThanOrEqual(0.2);
    expect(percentile(horn, 0.9)).toBeLessThanOrEqual(0.26);
    expect(CUSP_RISE_LO).toBeGreaterThan(0);
    expect(CUSP_FALL_HI).toBeLessThanOrEqual(1.3);
  }, timeLimit(120_000));

  it("lays bars and channels on the wet flat, 6 to 15 m across and 8 to 15 cm of relief, and so an irregular waterline with pools in it", () => {
    const rises: number[] = [];
    const across: number[] = [];
    let rowsWithPool = 0;
    let plainPools = 0;
    let rows = 0;
    let waterlines = 0;
    const shore: number[] = [];
    for (const [seed, z0] of SITES) {
      for (let k = 0; k < SITE_LENGTH; k += 2) {
        const cells = column(seed, z0 + k);
        rows++;
        // The relief along the flat, between -0.35 and +0.45 m of the plain ground.
        const flat = cells.filter((c) => c.p.h > -0.35 && c.p.h < 0.45);
        const series = flat.map(delta);
        const ext = extremes(series, 0.03);
        for (let j = 1; j < ext.length; j++) {
          rises.push(Math.abs(ext[j]!.v - ext[j - 1]!.v));
          if (ext[j]!.kind === 1 && ext[j - 1]!.kind === -1 && j >= 2) across.push((flat[ext[j]!.i]!.x - flat[ext[j - 2]!.i]!.x));
        }
        // The waterline: where the ground, going inland, first stands over the still sea. And a pool: ground over 0, then under it, then over it again.
        const crossing = (get: (c: Cell) => number): { first: number; pool: boolean } => {
          let first = NaN;
          let state = 0;
          let pool = false;
          for (const c of cells) {
            const h = get(c);
            if (state === 0 && h > 0.01) { state = 1; first = c.x; }
            else if (state === 1 && h < -0.01) state = 2;
            else if (state === 2 && h > 0.01) { pool = true; break; }
          }
          return { first, pool };
        };
        const s = crossing((c) => c.q.h);
        if (s.pool) rowsWithPool++;
        if (crossing((c) => c.p.h).pool) plainPools++;
        if (!Number.isNaN(s.first)) { waterlines++; shore.push(s.first - (cells[0] as Cell).x); }
      }
    }
    expect(percentile(rises, 0.5)).toBeGreaterThanOrEqual(0.08);
    expect(percentile(rises, 0.5)).toBeLessThanOrEqual(0.15);
    expect(percentile(rises, 0.9)).toBeLessThanOrEqual(0.28);
    expect(across.length).toBeGreaterThan(100);
    expect(percentile(across, 0.5)).toBeGreaterThanOrEqual(6);
    expect(percentile(across, 0.5)).toBeLessThanOrEqual(15);
    // Pools: ground below the still sea inland of ground above it, where the plain beach has none.
    expect(plainPools).toBe(0);
    expect(rowsWithPool).toBeGreaterThanOrEqual(3);
    expect(waterlines).toBeGreaterThan(0.8 * rows);
    expect(shore.length).toBe(waterlines);
  }, timeLimit(120_000));

  it("lays hummocks at the back of the beach, 3 to 7 m across and 15 to 35 cm high, in irregular fields", () => {
    const heights: number[] = [];
    const widths: number[] = [];
    let tops = 0;
    for (const [seed, z0] of SITES) {
      const cols = siteColumns(seed, z0);
      // The highest the relief stands, row by row along the shore, over the plain ground between +2.3 and +3.3 m, above the ridge, where the hummocks stand.
      const series = cols.map((cells) => Math.max(...cells.filter((c) => c.p.h > 2.3 && c.p.h < 3.3).map(delta)));
      const ext = extremes(series, 0.05);
      for (const e of ext) {
        if (e.kind !== 1) continue;
        tops++;
        heights.push(e.v);
        // Its width along the shore: out to half its height either side.
        let a = e.i;
        let b = e.i;
        while (a > 0 && (series[a - 1] as number) > e.v / 2) a--;
        while (b < series.length - 1 && (series[b + 1] as number) > e.v / 2) b++;
        widths.push(b - a + 1);
      }
    }
    expect(tops).toBeGreaterThan(15);
    expect(percentile(heights, 0.5)).toBeGreaterThanOrEqual(0.15);
    expect(percentile(heights, 0.9)).toBeLessThanOrEqual(0.35);
    expect(Math.max(...heights)).toBeLessThanOrEqual(0.36);
    expect(percentile(widths, 0.5)).toBeGreaterThanOrEqual(3);
    expect(percentile(widths, 0.5)).toBeLessThanOrEqual(8);
    // Fields: the stretches between mounds are not all one length.
    expect(percentile(widths, 0.9)).toBeGreaterThan(percentile(widths, 0.1));
  }, timeLimit(120_000));

  it("leans the dune grass toward the hummocks' tops, and no grass stands on a beach that has no shape", async () => {
    const lean = (world: World): number => {
      let sum = 0;
      let n = 0;
      for (const [seed, z0] of SITES) {
        const coastX = -plain.variant.coastDistance!(seed, 0, z0 + 200);
        for (const g of world.beachInRect(seed, coastX - 20, z0, coastX + 150, z0 + SITE_LENGTH)) {
          if (g.kind !== 3) continue;
          sum += hummockTop(seed, world.variant.coastDistance!(seed, g.x, g.z), g.z);
          n++;
        }
      }
      expect(n).toBeGreaterThan(100);
      return sum / n;
    };
    expect(lean(shaped)).toBeGreaterThan(1.25 * lean(off));
  }, timeLimit(120_000));
});

describe("a shaped beach: what reads the ground", () => {
  it("is followed by the beach's objects, which stand by the ground's height, wherever the relief puts it", () => {
    let n = 0;
    for (const [seed, z0] of SITES) {
      const coastX = -plain.variant.coastDistance!(seed, 0, z0 + 200);
      for (const inst of shaped.beachInRect(seed, coastX - 20, z0, coastX + 150, z0 + SITE_LENGTH)) {
        const g = shaped.sample(seed, inst.x, inst.z);
        expect(inst.groundH).toBe(g.h);
        expect(inst.groundDx).toBe(g.dx);
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
  }, timeLimit(120_000));
});
