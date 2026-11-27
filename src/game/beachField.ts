/**
 * The beach's pieces round the eye, banded by kind: which of `sim/beach.ts`'s instances are drawn, out to each
 * kind's own radius, thinned on the low tier and clamped to each kind's budget, the far tail first. Pure and
 * Babylon-free, as `clutterField.ts` is; `lite/beachMeshes.ts` draws what it says.
 *
 * **The tiers.** Every radius is scaled by the tier's reach (`clutterReachFor`: 0.7, the low tier's 0.6), as the
 * clutter's are; the low tier also keeps the half of the pieces whose own hash is below a half (`BEACH_LOW_KEEP`),
 * so it draws at most half the density and a piece never comes and goes as the eye moves.
 *
 * **What is looked up.** A cell of `sim/beach.ts` is looked up once and kept (`CELLS_KEPT`): a crossing of the
 * 4 m grid the walk is snapped to asks only for the cells it adds.
 */
import { BEACH_CELL, BEACH_KIND_COUNT, beachInCell, type BeachInstance } from "../sim/beach.js";
import { sliceDue, type Slices } from "./syncJobs.js";

/** The radius (m) each kind is drawn to, at the tier's reach 1: kelp, cobbles, driftwood, dune grass. A cobble of 5 cm is
 * a speck past 40 m; a heap is a metre across and a piece of driftwood a log; a tuft is a pale mark. */
export const BEACH_RADII: readonly number[] = [70, 60, 100, 90];

/**
 * Each kind's budget: the most instances of it drawn at once, a clamp and not a target. The beach's own bands hold
 * most of what the radii would allow far fewer (`test/game/beachField.test.ts` measures them on a bay and on the cove):
 * the wrack is two lines a few metres wide, the driftwood a share of them, the cobbles patches, the grass the back of
 * the beach. At 80 bytes an instance (a matrix and its fade) the four come to about 360 KB, twice over while a rebuild is
 * staged.
 */
export const BEACH_BUDGETS: readonly number[] = [800, 2600, 450, 700];

/** The share of the low tier's pieces kept, by hash. */
export const BEACH_LOW_KEEP = 0.5;

/** The share of a kind's radius its fade runs over (the clutter's own 0.2 widened a little: nothing here hands off to a far level). */
export const BEACH_FADE_FRACTION = 0.25;

/** The floor on a fade's width (m): the walk is snapped to a 4 m cell and a piece lies within it. */
export const BEACH_FADE_MIN_RAMP = BEACH_CELL * Math.SQRT2;

/** A kind's fade edges at the tier's reach: its radius, and its start a fraction inside. */
export function beachFadeEdges(kind: number, reach: number): { start: number; end: number } {
  const end = (BEACH_RADII[kind] as number) * reach;
  const start = Math.max(0, Math.min(end * (1 - BEACH_FADE_FRACTION), end - BEACH_FADE_MIN_RAMP));
  return { start, end };
}

/** Cells kept before the cells outside every kind's radius are let go. */
const CELLS_KEPT = 12000;
const CELL_KEY_HALF = 1 << 20;
const CELL_KEY_SPAN = 1 << 21;
/** Cells a slice of the walk looks at before it yields (a cell is some forty microseconds). */
const SLICE_CELLS = 64;

export type BeachBands = BeachInstance[][];

export type BeachCollector = {
  /** The pieces of every kind round (camX, camZ), as slices (`syncJobs.ts`): the nearest within each budget. */
  collectSlices(camX: number, camZ: number, reach: number, low: boolean): Slices<BeachBands>;
  /** Cells held. */
  readonly size: number;
};

export function createBeachCollector(seed: number): BeachCollector {
  const cache = new Map<number, BeachInstance[]>();
  const scratch: BeachInstance[] = [];
  function cell(cx: number, cz: number): BeachInstance[] {
    const key = (cx + CELL_KEY_HALF) * CELL_KEY_SPAN + (cz + CELL_KEY_HALF);
    let held = cache.get(key);
    if (held === undefined) {
      scratch.length = 0;
      beachInCell(seed, cx, cz, scratch);
      held = scratch.slice();
      cache.set(key, held);
    }
    return held;
  }
  function* collectSlices(camX: number, camZ: number, reach: number, low: boolean): Slices<BeachBands> {
    const ax = Math.floor(camX / BEACH_CELL) * BEACH_CELL;
    const az = Math.floor(camZ / BEACH_CELL) * BEACH_CELL;
    let widest = 0;
    for (let k = 0; k < BEACH_KIND_COUNT; k++) widest = Math.max(widest, (BEACH_RADII[k] as number) * reach);
    const c0x = Math.floor((ax - widest) / BEACH_CELL);
    const c1x = Math.floor((ax + widest) / BEACH_CELL);
    const c0z = Math.floor((az - widest) / BEACH_CELL);
    const c1z = Math.floor((az + widest) / BEACH_CELL);
    const found: { inst: BeachInstance; d2: number }[][] = Array.from({ length: BEACH_KIND_COUNT }, () => []);
    const r2 = Array.from({ length: BEACH_KIND_COUNT }, (_, k) => ((BEACH_RADII[k] as number) * reach) ** 2);
    let looked = 0;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        // A cell wholly outside the widest disc holds nothing drawn.
        const nx = Math.max(cx * BEACH_CELL - ax, 0, ax - (cx + 1) * BEACH_CELL);
        const nz = Math.max(cz * BEACH_CELL - az, 0, az - (cz + 1) * BEACH_CELL);
        if (nx * nx + nz * nz >= widest * widest) continue;
        for (const inst of cell(cx, cz)) {
          if (low && inst.hash >= BEACH_LOW_KEEP) continue;
          const dx = inst.x - ax;
          const dz = inst.z - az;
          const d2 = dx * dx + dz * dz;
          if (d2 < (r2[inst.kind] as number)) (found[inst.kind] as { inst: BeachInstance; d2: number }[]).push({ inst, d2 });
        }
        if (++looked % SLICE_CELLS === 0 && sliceDue(SLICE_CELLS / 16)) yield;
      }
    }
    const bands: BeachBands = [];
    for (let k = 0; k < BEACH_KIND_COUNT; k++) {
      const list = found[k] as { inst: BeachInstance; d2: number }[];
      const budget = BEACH_BUDGETS[k] as number;
      // Over budget the nearest are kept: the far tail goes first, as the clutter's does. The order is the cells', so a
      // tie is broken the same on every machine.
      if (list.length > budget) {
        list.sort((a, b) => a.d2 - b.d2);
        list.length = budget;
      }
      bands.push(list.map((p) => p.inst));
    }
    if (cache.size > CELLS_KEPT) {
      const keep = widest + 8 * BEACH_CELL;
      for (const key of cache.keys()) {
        const czPart = key % CELL_KEY_SPAN;
        const cz = czPart - CELL_KEY_HALF;
        const cx = (key - czPart) / CELL_KEY_SPAN - CELL_KEY_HALF;
        const dx = Math.max(cx * BEACH_CELL - ax, 0, ax - (cx + 1) * BEACH_CELL);
        const dz = Math.max(cz * BEACH_CELL - az, 0, az - (cz + 1) * BEACH_CELL);
        if (dx * dx + dz * dz >= keep * keep) cache.delete(key);
      }
    }
    return bands;
  }
  return {
    collectSlices,
    get size() {
      return cache.size;
    },
  };
}
