import { describe, expect, it } from "vitest";
import { timeLimit } from "../../testing/timeLimit.js";
import "../../src/sim/montane.js";
import { CLUTTER_CLASS_COUNT, clutterInRect, type ClutterInstance } from "../../src/sim/clutter.js";
import {
  BEACH_CELL, BEACH_DRIFT, BEACH_GRASS, BEACH_KELP, BEACH_KELP_STRAND, BEACH_KIND_COUNT, BEACH_STRAND_SHARE, BEACH_LINE_OUTER, BEACH_SIZES, BEACH_STONE, BEACH_WANDER_AMPLITUDE,
  BEACH_PEBBLE_SALT, BEACH_PEBBLE_WAVELENGTH, beachInCell, beachInRect, beachTunables, resolveBeach, wrackWander, type BeachInstance,
} from "../../src/sim/beach.js";
import { createForest } from "../../src/sim/forest.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import "../../src/sim/passes/elevation.js";
import "../../src/sim/passes/trees.js";
import "../../src/sim/passes/clutter.js";
import "../../src/sim/passes/cliffs.js";
import {
  COAST_FADE_END_HEIGHT, OLD_WRACK_LINE_HEIGHT, SAND_TOP_HEIGHT, STORM_LINE_HEIGHT, WRACK_LINE_HEIGHT,
} from "../../src/sim/tideLines.js";
import { activeTerrainVariant, elevationSampleAt, registerTerrainVariant, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { COAST_FADE_END, GROUND_SALT, GROUND_WAVELENGTH, SAND_TOP } from "../../src/game/terrainSurface.js";
import { valueNoise2 } from "../../src/sim/field.js";

/**
 * A place's beach (`sim/beach.ts`): the wrack, the cobbles, the small driftwood and the dune grass. The same coast
 * registered with no beach is the control, and every claim of "as before" is made against it.
 */

const SEEDS = [20261121, 1, 7];
/** Where the shore is at z, for a seed: the first x whose ground stands over the sea. */
function shoreX(seed: number, z: number): number {
  for (let x = -700; x < 100; x += 0.5) if (elevationSampleAt(seed, x, z).h > 0) return x;
  return NaN;
}
/** A bay's beach (the cove is z = 0): a rect from just seaward of the shore to 260 m inland, 200 m along it. */
function bayRect(seed: number, z: number): [number, number, number, number] {
  const x = shoreX(seed, z);
  return [x - 20, z - 100, x + 260, z + 100];
}
/** The bays that have a beach for each seed: a headland's shore has none. */
const BAYS: readonly (readonly [number, number])[] = [[20261121, 300], [20261121, 700], [1, 700], [7, 300], [7, 700]];

registerOlympic({ tunables: {}, shapeD: (_seed, _x, _z, _u, _uDz, base) => base, beach: {} });
const hooked = activeTerrainVariant();
registerTerrainVariant({ ...hooked, name: "olympic-plain", tunables: Object.fromEntries(Object.entries(hooked.tunables).filter(([k]) => !(k in beachTunables({})))), beach: undefined });
registerTerrainVariant({ ...hooked, name: "olympic-quiet", beach: { wrack: 0.5, cobbles: 0, driftwood: 1, duneGrass: 0.25 }, tunables: { ...hooked.tunables, ...beachTunables({ wrack: 0.5, cobbles: 0, driftwood: 1, duneGrass: 0.25 }) } });
registerTerrainVariant({ ...hooked, name: "olympic-nowrack", beach: { wrack: 0 } });
registerTerrainVariant({ ...hooked, name: "olympic-made", featureMask: () => ({ tree: 1, clutter: 0, meadow: 0, bare: 0, loose: 0 }) });
registerTerrainVariant({ ...hooked, name: "olympic-stands", clutterStands: () => false });

function on<T>(name: string, fn: () => T): T {
  setActiveTerrainVariant(name);
  try {
    return fn();
  } finally {
    setActiveTerrainVariant(hooked.name);
  }
}
/** How far from a tide line's own height a heap's ground stands: the wandering and the band's width. */
const REACH = BEACH_WANDER_AMPLITUDE + BEACH_LINE_OUTER;
const kindOf = (list: readonly BeachInstance[], kind: number): BeachInstance[] => list.filter((i) => i.kind === kind);
const key = (i: BeachInstance): string => `${i.kind}:${i.x}:${i.z}:${i.size}:${i.variant}:${i.hash}`;
const clutterKey = (c: ClutterInstance): string => `${c.cls}:${c.x}:${c.z}:${c.scale}:${c.variant}:${c.hash}`;

describe("the tide lines", () => {
  it("are at the heights the paint is to draw its own at", () => {
    expect(WRACK_LINE_HEIGHT).toBe(0.9);
    expect(OLD_WRACK_LINE_HEIGHT).toBe(0.45);
    expect(STORM_LINE_HEIGHT).toBe(1.7);
  });
  it("sit under the sand the paint lays, whose own edges and pebble mottle these repeat", () => {
    expect(SAND_TOP_HEIGHT).toBe(SAND_TOP);
    expect(COAST_FADE_END_HEIGHT).toBe(COAST_FADE_END);
    expect(BEACH_PEBBLE_WAVELENGTH).toBe(GROUND_WAVELENGTH);
    expect(BEACH_PEBBLE_SALT).toBe(GROUND_SALT);
    expect(WRACK_LINE_HEIGHT).toBeLessThan(STORM_LINE_HEIGHT);
    expect(STORM_LINE_HEIGHT).toBeLessThan(SAND_TOP);
  });
});

describe("a place's beach", () => {
  it("turns every kind on when it gives none of the densities, and reads a density as 0 to 1", () => {
    expect(resolveBeach({})).toEqual({ wrack: 1, cobbles: 1, driftwood: 1, duneGrass: 1 });
    expect(resolveBeach({ wrack: 0, cobbles: 0.5, driftwood: 7, duneGrass: -1 })).toEqual({ wrack: 0, cobbles: 0.5, driftwood: 1, duneGrass: 0 });
  });

  it("leaves a place without one exactly as it was: no instance, no tunable, every clutter class the same", () => {
    expect(Object.keys(on("olympic-plain", () => activeTerrainVariant().tunables)).filter((k) => k.startsWith("BEACHLAY_"))).toEqual([]);
    for (const [seed, z] of BAYS.slice(0, 3)) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      expect(on("olympic-plain", () => beachInRect(seed, x0, z0, x1, z1))).toEqual([]);
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        const plain = on("olympic-plain", () => clutterInRect(seed, cls, x0, z0, x1, z1)).map(clutterKey);
        const beach = on(hooked.name, () => clutterInRect(seed, cls, x0, z0, x1, z1)).map(clutterKey);
        expect(beach).toEqual(plain);
      }
    }
  }, timeLimit(120_000));

  it("changes the level id of a place that opts in, by its densities, and no other", () => {
    for (const seed of SEEDS) {
      const plain = on("olympic-plain", () => createForest(seed).passHash);
      const all = on(hooked.name, () => createForest(seed).passHash);
      const quiet = on("olympic-quiet", () => createForest(seed).passHash);
      expect(all).not.toBe(plain);
      expect(quiet).not.toBe(all);
      expect(quiet).not.toBe(plain);
      // Asked twice, the same.
      expect(on("olympic-plain", () => createForest(seed).passHash)).toBe(plain);
    }
  });

  it("is deterministic: two runs give the same pieces, in the same order", () => {
    for (const [seed, z] of BAYS.slice(0, 2)) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      const a = beachInRect(seed, x0, z0, x1, z1).map(key);
      const b = beachInRect(seed, x0, z0, x1, z1).map(key);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
    }
  });

  it("holds a cell to its own pieces, so a rect is the cells it overlaps", () => {
    const [seed, z] = BAYS[0] as readonly [number, number];
    const x = shoreX(seed, z) + 12;
    const whole = beachInRect(seed, x, z, x + 40, z + 40).map(key).sort();
    const cells: BeachInstance[] = [];
    for (let cx = Math.floor(x / BEACH_CELL); cx <= Math.floor((x + 40) / BEACH_CELL); cx++) {
      for (let cz = Math.floor(z / BEACH_CELL); cz <= Math.floor((z + 40) / BEACH_CELL); cz++) beachInCell(seed, cx, cz, cells);
    }
    const inside = cells.filter((i) => i.x >= x && i.x < x + 40 && i.z >= z && i.z < z + 40).map(key).sort();
    expect(inside).toEqual(whole);
    for (const i of cells) {
      expect(Math.floor(i.x / BEACH_CELL)).toBeGreaterThanOrEqual(Math.floor(x / BEACH_CELL));
    }
  });

  it("draws from streams of its own: a kind turned off leaves every other as it was", () => {
    for (const [seed, z] of BAYS.slice(0, 3)) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      const all = on(hooked.name, () => beachInRect(seed, x0, z0, x1, z1));
      const none = on("olympic-nowrack", () => beachInRect(seed, x0, z0, x1, z1));
      expect(kindOf(none, BEACH_KELP)).toEqual([]);
      expect(kindOf(all, BEACH_KELP).length).toBeGreaterThan(0);
      for (const kind of [BEACH_STONE, BEACH_DRIFT, BEACH_GRASS]) expect(kindOf(none, kind).map(key)).toEqual(kindOf(all, kind).map(key));
    }
  }, timeLimit(60_000));

  it("thins a kind by its density and drops one at 0", () => {
    const [seed, z] = BAYS[1] as readonly [number, number];
    const [x0, z0, x1, z1] = bayRect(seed, z);
    const all = on(hooked.name, () => beachInRect(seed, x0, z0, x1, z1));
    const quiet = on("olympic-quiet", () => beachInRect(seed, x0, z0, x1, z1));
    expect(kindOf(quiet, BEACH_STONE)).toEqual([]);
    expect(kindOf(quiet, BEACH_KELP).length).toBeLessThan(kindOf(all, BEACH_KELP).length);
    expect(kindOf(quiet, BEACH_KELP).length).toBeGreaterThan(0);
    expect(kindOf(quiet, BEACH_GRASS).length).toBeLessThan(kindOf(all, BEACH_GRASS).length);
    // Thinned from the same draws: every one that stands at half the density stood at full.
    const full = new Set(kindOf(all, BEACH_KELP).map(key));
    for (const k of kindOf(quiet, BEACH_KELP)) expect(full.has(key(k))).toBe(true);
    expect(kindOf(quiet, BEACH_DRIFT).map(key)).toEqual(kindOf(all, BEACH_DRIFT).map(key));
  });

  it("keeps each size in its range", () => {
    for (const [seed, z] of BAYS.slice(0, 3)) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      for (const i of beachInRect(seed, x0, z0, x1, z1)) {
        const [lo, hi] = BEACH_SIZES[i.kind] as readonly [number, number];
        expect(i.size).toBeGreaterThanOrEqual(lo);
        expect(i.size).toBeLessThanOrEqual(hi);
        expect(i.hash).toBeGreaterThanOrEqual(0);
        expect(i.hash).toBeLessThan(1);
      }
    }
  }, timeLimit(60_000));

  it("lays the wrack along the two tide lines, which wander 10 to 20 cm and are in clumps with gaps", () => {
    // The lines' wandering: bounded by the amplitude and, over 400 m, wide enough to see.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 400; i++) {
      const w = wrackWander(20261121, -380, i, 0);
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
      expect(Math.abs(w)).toBeLessThanOrEqual(BEACH_WANDER_AMPLITUDE);
    }
    expect(hi - lo).toBeGreaterThan(0.2);
    expect(hi - lo).toBeLessThanOrEqual(2 * BEACH_WANDER_AMPLITUDE);

    let kelp = 0;
    let nearLast = 0;
    let nearOld = 0;
    const counts: number[] = [];
    for (const [seed, z] of BAYS) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      const heaps = kindOf(beachInRect(seed, x0, z0, x1, z1), BEACH_KELP);
      kelp += heaps.length;
      for (const h of heaps) {
        // On a line, within the wandering and the band's own width.
        const onLast = Math.abs(h.groundH - WRACK_LINE_HEIGHT) <= REACH;
        const onOld = Math.abs(h.groundH - OLD_WRACK_LINE_HEIGHT) <= REACH;
        expect(onLast || onOld).toBe(true);
        if (onLast) nearLast++;
        if (onOld) nearOld++;
      }
      // Heaps in 4 m lengths of the line, over 200 m of shore: clumps and gaps.
      const along = new Array<number>(50).fill(0);
      for (const h of heaps) if (Math.abs(h.groundH - WRACK_LINE_HEIGHT) <= REACH) along[Math.min(49, Math.floor((h.z - z0) / 4))]!++;
      counts.push(...along);
    }
    expect(kelp).toBeGreaterThan(100);
    // The last tide's line holds more than the older's.
    expect(nearLast).toBeGreaterThan(nearOld);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / counts.length;
    const empty = counts.filter((n) => n === 0).length / counts.length;
    // Gaps (a fifth of the line's lengths at least hold none) and clumps (more variance than a scatter's, which is the mean).
    expect(empty).toBeGreaterThan(0.2);
    expect(variance).toBeGreaterThan(1.5 * mean);
  }, timeLimit(60_000));

  it("lays cobbles in patches of dozens with bare sand between, most at the storm line", () => {
    let stones = 0;
    let atStorm = 0;
    const cellCounts = new Map<string, number>();
    for (const [seed, z] of BAYS) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      for (const s of kindOf(beachInRect(seed, x0, z0, x1, z1), BEACH_STONE)) {
        stones++;
        if (Math.abs(s.groundH - STORM_LINE_HEIGHT) <= 0.9) atStorm++;
        const k = `${seed}:${Math.floor(s.x / 4)}:${Math.floor(s.z / 4)}`;
        cellCounts.set(k, (cellCounts.get(k) ?? 0) + 1);
        expect(s.groundH).toBeGreaterThan(0.1);
        expect(s.groundH).toBeLessThan(SAND_TOP_HEIGHT + 2);
      }
    }
    expect(stones).toBeGreaterThan(300);
    expect(atStorm / stones).toBeGreaterThan(0.5);
    const per = [...cellCounts.values()].sort((a, b) => a - b);
    // A patch holds dozens in a 16 m² cell; most cells holding any hold few: the patches are a part of the sand.
    expect(per[per.length - 1]).toBeGreaterThanOrEqual(12);
    expect(per[Math.floor(per.length / 2)]).toBeLessThan(per[per.length - 1]! / 2);
  }, timeLimit(60_000));

  it("lays the cobbles by the paint's pebble mottle: more where the layer is pebbles", () => {
    const [seed, z] = BAYS[0] as readonly [number, number];
    const [x0, z0, x1, z1] = bayRect(seed, z);
    const stones = kindOf(beachInRect(seed, x0, z0, x1, z1), BEACH_STONE);
    // Split the dry sand's stones at the storm line by the mottle (`pebbleGround`): the high half holds more of them.
    let high = 0;
    let low = 0;
    for (const s of stones) {
      if (Math.abs(s.groundH - STORM_LINE_HEIGHT) > 0.5) continue;
      if (pebble(seed, s.x, s.z) > 0.55) high++;
      else low++;
    }
    expect(high + low).toBeGreaterThan(20);
    expect(high).toBeGreaterThan(low);
  }, timeLimit(60_000));

  it("lays the small driftwood mostly along the wrack and storm lines", () => {
    let wood = 0;
    let onLine = 0;
    for (const [seed, z] of BAYS) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      for (const d of kindOf(beachInRect(seed, x0, z0, x1, z1), BEACH_DRIFT)) {
        wood++;
        const h = d.groundH;
        if (Math.abs(h - WRACK_LINE_HEIGHT) < 0.35 || Math.abs(h - OLD_WRACK_LINE_HEIGHT) < 0.35 || Math.abs(h - STORM_LINE_HEIGHT) < 0.9) onLine++;
      }
    }
    expect(wood).toBeGreaterThan(20);
    expect(onLine).toBe(wood);
  }, timeLimit(60_000));

  it("lays dune grass from the storm line to the back of the beach, sparse at the line and thicker toward the soil", () => {
    let grass = 0;
    let lowBand = 0;
    let highBand = 0;
    let lowArea = 0;
    let highArea = 0;
    for (const [seed, z] of BAYS) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      for (const g of kindOf(beachInRect(seed, x0, z0, x1, z1), BEACH_GRASS)) {
        grass++;
        expect(g.groundH).toBeGreaterThanOrEqual(STORM_LINE_HEIGHT - 0.4);
        expect(g.groundH).toBeLessThan(COAST_FADE_END_HEIGHT);
        if (g.groundH >= 1.7 && g.groundH < 3.2) lowBand++;
        if (g.groundH >= 4.5 && g.groundH < 6) highBand++;
      }
      // The ground each band covers, by a grid of 2 m: the bands are of height, and a beach's slope is not the same everywhere.
      for (let x = x0; x < x1; x += 2) {
        for (let zz = z0; zz < z1; zz += 2) {
          const h = elevationSampleAt(seed, x, zz).h;
          if (h >= 1.7 && h < 3.2) lowArea++;
          if (h >= 4.5 && h < 6) highArea++;
        }
      }
    }
    expect(grass).toBeGreaterThan(100);
    expect(lowBand).toBeGreaterThan(0);
    expect(highBand / highArea).toBeGreaterThan(2.5 * (lowBand / lowArea));
  }, timeLimit(60_000));

  it("lays nothing below the swash or in the sea, and nothing but grass above the sand", () => {
    for (const [seed, z] of BAYS) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      for (const i of beachInRect(seed, x0 - 50, z0, x1 + 100, z1)) {
        expect(i.groundH).toBeGreaterThan(0.1);
        if (i.kind !== BEACH_GRASS) expect(i.groundH).toBeLessThan(SAND_TOP_HEIGHT + 2);
      }
    }
  }, timeLimit(60_000));

  it("lays more cobbles on the cove, whose beach is pebbles, than on a bay", () => {
    const seed = SEEDS[0] as number;
    const bay = bayRect(seed, 300);
    const cove = bayRect(seed, 0);
    const n = (r: [number, number, number, number]): number => kindOf(beachInRect(seed, ...r), BEACH_STONE).length;
    expect(n(cove)).toBeGreaterThan(n(bay));
  }, timeLimit(60_000));

  it("is kept off ground a game has made, by the feature mask's word for what lies loose and for ground cover, and by clutterStands", () => {
    const [seed, z] = BAYS[0] as readonly [number, number];
    const [x0, z0, x1, z1] = bayRect(seed, z);
    expect(on(hooked.name, () => beachInRect(seed, x0, z0, x1, z1)).length).toBeGreaterThan(0);
    expect(on("olympic-made", () => beachInRect(seed, x0, z0, x1, z1))).toEqual([]);
    expect(on("olympic-stands", () => beachInRect(seed, x0, z0, x1, z1))).toEqual([]);
  }, timeLimit(60_000));

  it("makes about one in six of the kelp a strand, the rest heaps", () => {
    let kelp = 0;
    let strands = 0;
    for (const [seed, z] of BAYS) {
      const [x0, z0, x1, z1] = bayRect(seed, z);
      for (const k of kindOf(beachInRect(seed, x0, z0, x1, z1), BEACH_KELP)) {
        kelp++;
        expect([0, 1]).toContain(k.variant);
        if (k.variant === BEACH_KELP_STRAND) strands++;
      }
    }
    expect(strands / kelp).toBeGreaterThan(BEACH_STRAND_SHARE * 0.6);
    expect(strands / kelp).toBeLessThan(BEACH_STRAND_SHARE * 1.5);
  }, timeLimit(60_000));

  it("keeps the kinds' own count", () => {
    expect(BEACH_KIND_COUNT).toBe(4);
  });
});

function pebble(seed: number, x: number, z: number): number {
  return valueNoise2(x / GROUND_WAVELENGTH, z / GROUND_WAVELENGTH, seed ^ GROUND_SALT);
}
