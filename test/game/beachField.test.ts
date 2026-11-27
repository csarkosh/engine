import { describe, expect, it } from "vitest";
import { timeLimit } from "../../testing/timeLimit.js";
import "../../src/sim/montane.js";
import { BEACH_CELL, BEACH_DRIFT, BEACH_GRASS, BEACH_KELP, BEACH_KELP_HEAP, BEACH_KELP_STRAND, BEACH_KIND_COUNT, BEACH_STONE, BEACH_VARIANTS, type BeachInstance } from "../../src/sim/beach.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import { CLUTTER_SINK } from "../../src/game/clutterInstances.js";
import { clutterReachFor } from "../../src/game/clutterField.js";
import {
  BEACH_BUDGETS, BEACH_FADE_MIN_RAMP, BEACH_LOW_KEEP, BEACH_RADII, beachFadeEdges, createBeachCollector, type BeachBands,
} from "../../src/game/beachField.js";
import {
  BEACH_MODEL_IDS, DRIFT_MODEL, GRASS_MODEL, KELP_SINK, KELP_STRAND_LENGTH, STONE_FLATTEN, STONE_MODEL, STONE_SINK, beachMatrix,
} from "../../src/game/beachInstances.js";
import {
  HEAP_MAX_HEIGHT, HEAP_POINTS, HEAP_RIBBONS, HEAP_STRAYS, STRAND_BLADES, STRAND_POINTS, kelpHeapGeometry, kelpStrandGeometry, type KelpGeometry,
} from "../../src/game/kelpHeap.js";
import { finish } from "../../src/game/syncJobs.js";

/**
 * The beach's pieces round the eye (`game/beachField.ts`), how they are seated (`beachInstances.ts`) and the
 * heap of kelp built in code (`kelpHeap.ts`). The meshes (`lite/beachMeshes.ts`) need a browser and are not run here.
 */

registerOlympic({ tunables: {}, shapeD: (_seed, _x, _z, _u, _uDz, base) => base, beach: {} });

const SEED = 20261121;
/** Where the shore is at z: the first x whose ground stands over the sea. */
function shoreX(seed: number, z: number): number {
  for (let x = -700; x < 100; x += 0.5) if (elevationSampleAt(seed, x, z).h > 0) return x;
  return NaN;
}
/** Standing places: a bay's beach between the wrack and the storm lines, a bay's dunes, and the cove's backshore. */
const SITES: readonly { name: string; seed: number; z: number; inland: number }[] = [
  { name: "bay", seed: SEED, z: 300, inland: 45 },
  { name: "bay 1", seed: 1, z: 700, inland: 45 },
  { name: "bay 7", seed: 7, z: 300, inland: 45 },
  { name: "cove", seed: SEED, z: 0, inland: 20 },
];
const reach = clutterReachFor("high");
const reachLow = clutterReachFor("low");

function bands(site: (typeof SITES)[number], r: number, low: boolean): BeachBands {
  const x = shoreX(site.seed, site.z) + site.inland;
  return finish(createBeachCollector(site.seed).collectSlices(x, site.z, r, low));
}
const counts = (b: BeachBands): number[] => b.map((l) => l.length);

describe("the beach's pieces round the eye", () => {
  it("lists each kind within its own radius at the tier's reach, and the same twice", () => {
    for (const site of SITES) {
      const x = shoreX(site.seed, site.z) + site.inland;
      const ax = Math.floor(x / BEACH_CELL) * BEACH_CELL;
      const az = Math.floor(site.z / BEACH_CELL) * BEACH_CELL;
      const a = bands(site, reach, false);
      const b = bands(site, reach, false);
      expect(b).toEqual(a);
      expect(a).toHaveLength(BEACH_KIND_COUNT);
      a.forEach((list, kind) => {
        for (const inst of list) {
          expect(inst.kind).toBe(kind);
          expect(Math.hypot(inst.x - ax, inst.z - az)).toBeLessThan((BEACH_RADII[kind] as number) * reach);
        }
      });
    }
  }, timeLimit(60_000));

  it("measures what a bay and the cove draw, inside every budget", () => {
    for (const site of SITES) {
      const full = counts(bands(site, reach, false));
      const low = counts(bands(site, reachLow, true));
      full.forEach((n, kind) => expect(n).toBeLessThanOrEqual(BEACH_BUDGETS[kind] as number));
      // The low tier draws at most half what the full tiers do: a smaller reach and the half of the pieces whose hash is under a half.
      const sum = (c: number[]): number => c.reduce((a, b) => a + b, 0);
      expect(sum(low)).toBeLessThanOrEqual(0.5 * sum(full));
      expect(sum(full)).toBeGreaterThan(0);
    }
  }, timeLimit(60_000));

  it("keeps on the low tier only pieces the full tiers keep, and only the lower half of the hashes", () => {
    const site = SITES[0] as (typeof SITES)[number];
    const full = new Set(bands(site, reach, false).flat().map((i) => `${i.kind}:${i.x}:${i.z}`));
    for (const inst of bands(site, reachLow, true).flat()) {
      expect(inst.hash).toBeLessThan(BEACH_LOW_KEEP);
      expect(full.has(`${inst.kind}:${inst.x}:${inst.z}`)).toBe(true);
    }
  }, timeLimit(60_000));

  it("clamps a kind to its budget, nearest first", () => {
    const site = SITES[3] as (typeof SITES)[number];
    const over = finish(createBeachCollector(site.seed).collectSlices(shoreX(site.seed, site.z) + site.inland, site.z, 3, false));
    over.forEach((list, kind) => expect(list.length).toBeLessThanOrEqual(BEACH_BUDGETS[kind] as number));
    // At three times the reach the cove's stones outrun their budget, and the ones kept are the nearest.
    const stones = over[BEACH_STONE] as BeachInstance[];
    expect(stones.length).toBe(BEACH_BUDGETS[BEACH_STONE]);
    const x = Math.floor((shoreX(site.seed, site.z) + site.inland) / BEACH_CELL) * BEACH_CELL;
    const z = Math.floor(site.z / BEACH_CELL) * BEACH_CELL;
    const far = Math.max(...stones.map((s) => Math.hypot(s.x - x, s.z - z)));
    expect(far).toBeLessThan((BEACH_RADII[BEACH_STONE] as number) * 3);
  }, timeLimit(60_000));

  it("is as many draws as models: at most six, on every tier, and two of them the kelp's", () => {
    const buckets = BEACH_VARIANTS.reduce((a, b) => a + b, 0);
    expect(buckets).toBeLessThanOrEqual(6);
    // The kinds that ship a model name one a variant; the heap is built in code.
    BEACH_VARIANTS.forEach((n, kind) => {
      if (kind !== BEACH_KELP) expect(BEACH_MODEL_IDS[kind]).toHaveLength(n);
    });
    expect(BEACH_MODEL_IDS[BEACH_KELP]).toEqual([]);
    expect(BEACH_VARIANTS[BEACH_KELP]).toBe(2);
  });

  it("stays inside two megabytes of instance data and geometry standing at once", () => {
    // Every bucket's list at its budget, staged and shown (80 bytes an instance: a matrix and the fade's four floats),
    // and the heap's own mesh. The models are the clutter's, already held.
    const instances = BEACH_BUDGETS.reduce((a, b) => a + b, 0);
    const heap = [kelpHeapGeometry(), kelpStrandGeometry()].reduce(
      (n, g) => n + g.positions.byteLength + g.normals.byteLength + g.colors.byteLength + g.indices.byteLength, 0,
    );
    expect(instances * 80 * 2 + heap).toBeLessThan(2_000_000);
  });

  it("fades each kind out over the last of its radius, wider than the cell it is snapped to", () => {
    for (let kind = 0; kind < BEACH_KIND_COUNT; kind++) {
      for (const r of [reach, reachLow]) {
        const e = beachFadeEdges(kind, r);
        expect(e.end).toBe((BEACH_RADII[kind] as number) * r);
        expect(e.end - e.start).toBeGreaterThanOrEqual(BEACH_FADE_MIN_RAMP - 1e-9);
        expect(e.start).toBeGreaterThan(0);
      }
    }
  });
});

const flat = (kind: number, variant = 0, size = 0.2): BeachInstance => ({ kind, x: 10, z: -4, groundH: 1.5, groundDx: 0, groundDz: 0, size, variant, hash: 0.3 });
const column = (m: Float32Array, c: number): number[] => [m[c * 4] as number, m[c * 4 + 1] as number, m[c * 4 + 2] as number];
const len = (v: number[]): number => Math.hypot(v[0] as number, v[1] as number, v[2] as number);

describe("how a piece is seated", () => {
  const m = new Float32Array(16);

  it("sinks a cobble by a third of its height, its longest side the instance's size", () => {
    for (const variant of [0, 1]) {
      const inst = flat(BEACH_STONE, variant, 0.12);
      beachMatrix(inst, m);
      const model = STONE_MODEL[variant] as (typeof STONE_MODEL)[number];
      const s = 0.12 / model.length;
      // Flat ground: the y of its origin is the ground's less a third of its flattened height.
      const sy = len(column(m, 1));
      expect(sy).toBeGreaterThanOrEqual(s * STONE_FLATTEN[0] - 1e-6);
      expect(sy).toBeLessThanOrEqual(s * STONE_FLATTEN[1] + 1e-6);
      expect(m[13]).toBeCloseTo(1.5 - STONE_SINK * model.height * sy, 5);
      expect(STONE_SINK).toBeCloseTo(1 / 3, 10);
      expect(m[12]).toBe(10);
      expect(m[14]).toBe(-4);
    }
  });

  it("tilts a cobble to the slope: its up is the ground's normal", () => {
    const inst: BeachInstance = { ...flat(BEACH_STONE), groundDx: 0.3, groundDz: -0.1 };
    beachMatrix(inst, m);
    const up = column(m, 1);
    const l = len(up);
    const n = Math.hypot(0.3, 1, 0.1);
    expect((up[0] as number) / l).toBeCloseTo(-0.3 / n, 5);
    expect((up[1] as number) / l).toBeCloseTo(1 / n, 5);
    expect((up[2] as number) / l).toBeCloseTo(0.1 / n, 5);
  });

  it("lays driftwood along the shore, sunk into the sand, its length the instance's size", () => {
    // On a slope falling toward -x (the sea), the contour runs along z: the log's long axis (the model's z) lies within its swing of it.
    const inst: BeachInstance = { ...flat(BEACH_DRIFT, 0, 0.9), groundDx: 0.025, groundDz: 0 };
    beachMatrix(inst, m);
    const along = column(m, 2);
    expect(len(along)).toBeCloseTo(0.9 / DRIFT_MODEL.length, 4);
    const flatLen = Math.hypot(along[0] as number, along[2] as number);
    // Within 0.5 rad (the swing) of the z axis, whichever end is forward.
    expect(Math.abs(along[2] as number) / flatLen).toBeGreaterThan(Math.cos(0.5) - 1e-6);
    // The underside sits below the sand: the model's lowest point is 4 cm under its origin, which is 0.3 of its thickness under the ground.
    const s = 0.9 / DRIFT_MODEL.length;
    expect(m[13]).toBeCloseTo(1.5 + (DRIFT_MODEL.under - 0.3 * DRIFT_MODEL.thickness) * s, 4);
  });

  it("sinks kelp a centimetre, lays it along the contour, and stands a tuft as the clutter's grass does", () => {
    // Ground falling toward -x: the contour runs along z, and the heap's long side (the model's x) lies within its swing of it.
    const heap: BeachInstance = { ...flat(BEACH_KELP, BEACH_KELP_HEAP, 0.6), groundDx: 0.025 };
    beachMatrix(heap, m);
    expect(m[13]).toBeCloseTo(1.5 - KELP_SINK, 6);
    const x = column(m, 0);
    expect(len(x)).toBeCloseTo(0.6, 5);
    expect(Math.abs(x[2] as number) / Math.hypot(x[0] as number, x[2] as number)).toBeGreaterThan(Math.cos(0.35) - 1e-3);
    const strand: BeachInstance = { ...flat(BEACH_KELP, BEACH_KELP_STRAND, 1.2), groundDx: 0.025 };
    beachMatrix(strand, m);
    expect(len(column(m, 0))).toBeCloseTo(KELP_STRAND_LENGTH[1], 5);
    beachMatrix({ ...strand, size: 0.3 }, m);
    expect(len(column(m, 0))).toBeCloseTo(KELP_STRAND_LENGTH[0], 5);
    beachMatrix(flat(BEACH_GRASS, 0, 0.6), m);
    expect(m[13]).toBeCloseTo(1.5 - CLUTTER_SINK, 6);
    expect(len(column(m, 1))).toBeCloseTo(0.6 / GRASS_MODEL.height, 5);
    expect(column(m, 1)[0]).toBeCloseTo(0, 6);
    expect(column(m, 1)[2]).toBeCloseTo(0, 6);
  });

  it("turns a heap end for end for about half of them, and swings each its own way", () => {
    let turned = 0;
    const yaws = new Set<string>();
    for (let i = 0; i < 200; i++) {
      beachMatrix({ ...flat(BEACH_KELP, BEACH_KELP_HEAP, 0.6), groundDx: 0.025, hash: (i + 0.5) / 200 }, m);
      if ((m[2] as number) < 0) turned++;
      yaws.add((m[2] as number).toFixed(3));
    }
    // A heap's x is along the contour, in z: the sign that shows the turn is z's.
    expect(yaws.size).toBeGreaterThan(30);
    expect(turned).toBeGreaterThan(60);
    expect(turned).toBeLessThan(140);
  });
});

describe("the kelp built in code", () => {
  const heap = kelpHeapGeometry();
  const strand = kelpStrandGeometry();
  const box = (g: KelpGeometry): { min: number[]; max: number[] } => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.positions.length; i++) {
      const v = g.positions[i] as number;
      min[i % 3] = Math.min(min[i % 3] as number, v);
      max[i % 3] = Math.max(max[i % 3] as number, v);
    }
    return { min, max };
  };

  it("is a tangle of ribbons under 200 triangles, and a strand of fewer, always the same", () => {
    const ribbons = HEAP_RIBBONS + HEAP_STRAYS;
    expect(heap.positions.length / 3).toBe(ribbons * HEAP_POINTS * 2);
    expect(heap.indices.length / 3).toBe(ribbons * (HEAP_POINTS - 1) * 2);
    expect(heap.indices.length / 3).toBeLessThan(200);
    expect(HEAP_RIBBONS).toBeGreaterThanOrEqual(4);
    expect(HEAP_RIBBONS + HEAP_STRAYS).toBeLessThanOrEqual(11);
    const blades = STRAND_BLADES * (HEAP_POINTS - 1) * 2;
    expect(strand.indices.length / 3).toBe((STRAND_POINTS - 1) * 2 + blades + 18);
    expect(strand.indices.length / 3).toBeLessThan(200);
    expect(kelpHeapGeometry()).toEqual(heap);
    expect(kelpStrandGeometry()).toEqual(strand);
    for (const g of [heap, strand]) {
      expect(g.normals.length).toBe(g.positions.length);
      expect(g.colors.length / 4).toBe(g.positions.length / 3);
      for (const i of g.indices) expect(i).toBeLessThan(g.positions.length / 3);
    }
  });

  it("is a low pile about a metre long and three times longer than across, on the sand", () => {
    const { min, max } = box(heap);
    expect(min[1]).toBeGreaterThanOrEqual(0);
    expect(max[1]).toBeLessThanOrEqual(HEAP_MAX_HEIGHT);
    expect(max[1]).toBeGreaterThan(0.03);
    const length = (max[0] as number) - (min[0] as number);
    const across = (max[2] as number) - (min[2] as number);
    expect(length).toBeGreaterThan(0.8);
    expect(length).toBeLessThan(1.4);
    expect(length / across).toBeGreaterThan(2);
    expect(length / across).toBeLessThan(4.5);
  });

  it("has no ribbon that is a spoke from one centre: the ribbons begin at places of their own", () => {
    // The first vertex pair of each ribbon is where it begins: they must not all be the same place.
    const starts = new Set<string>();
    for (let r = 0; r < HEAP_RIBBONS + HEAP_STRAYS; r++) {
      const v = r * HEAP_POINTS * 2;
      starts.add(`${((heap.positions[v * 3] as number) * 20).toFixed(0)}:${((heap.positions[v * 3 + 2] as number) * 20).toFixed(0)}`);
    }
    expect(starts.size).toBeGreaterThanOrEqual(8);
  });

  it("is a metre-long strand with its bulb at one end, lying flat", () => {
    const { min, max } = box(strand);
    expect((max[0] as number) - (min[0] as number)).toBeGreaterThan(0.9);
    expect(min[0]).toBeLessThan(-0.45);
    expect(max[1]).toBeLessThan(0.06);
    expect(min[1]).toBeGreaterThanOrEqual(0);
    expect((max[2] as number) - (min[2] as number)).toBeLessThan(0.3);
  });

  it("is dark olive-brown to black-green under vertex colour, never bright or saturated, its normals unit and up", () => {
    for (const g of [heap, strand]) {
      for (let i = 0; i < g.colors.length; i += 4) {
        const [r, gr, b] = [g.colors[i] as number, g.colors[i + 1] as number, g.colors[i + 2] as number];
        expect(Math.max(r, gr, b)).toBeLessThan(0.1);
        // Never greener than a dark olive: green over red at most a half more; blue the least.
        expect(gr).toBeLessThanOrEqual(r * 1.6);
        expect(b).toBeLessThan(gr);
      }
      for (let i = 0; i < g.normals.length; i += 3) {
        expect(Math.hypot(g.normals[i] as number, g.normals[i + 1] as number, g.normals[i + 2] as number)).toBeCloseTo(1, 3);
        expect(g.normals[i + 1] as number).toBeGreaterThan(0.2);
      }
    }
    expect(new Set(Array.from(heap.colors).map((v) => v.toFixed(4))).size).toBeGreaterThan(20);
  });
});
