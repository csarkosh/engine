import { describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import { writePatchTriangles } from "../../src/game/lite/patchPool.js";
import { RING_CELLS, createRingSamples, ringGeometry } from "../../src/game/clipmap.js";
import {
  NO_STITCH, PATCH_CELL, PATCH_NEAR_SPACING, PATCH_FAR_SPACING, PATCH_PAVED_MARGIN, PATCH_REACH, PATCH_TAPER, PATCH_WIDE_SPACING,
  facePatchCover, facePatchGeometry, patchIndices, type FacePatch, type PavedGround,
} from "../../src/game/facePatches.js";

/**
 * A game that paves ground (`TerrainVariant.pavedGround`) has no patch triangle on it, no relief standing beside it,
 * and no hole under the rings where the patch is not. The ground here is a band 11 m wide running north through the
 * middle of cell (-22, -30) of seed 1, whose ground is steep (the road's bed, as a game's strip would pave it).
 */

registerOlympic(null);

const SEED = 1;
const CI = -22;
const CJ = -30;
const MID_X = (CI + 0.5) * PATCH_CELL;
const MID_Z = (CJ + 0.5) * PATCH_CELL;
const BED_HALF = 5.5;
const BAND_X = MID_X - 8;
const band: PavedGround = (x) => Math.abs(x - BAND_X) - BED_HALF;
const SPACINGS = [PATCH_NEAR_SPACING, PATCH_FAR_SPACING, PATCH_WIDE_SPACING];

/** The world point of vertex `i` of a patch at `spacing`. */
function pointOf(i: number, spacing: number): [number, number] {
  const side = Math.round(PATCH_CELL / spacing) + 1;
  return [CI * PATCH_CELL + (i % side) * spacing, CJ * PATCH_CELL + Math.floor(i / side) * spacing];
}

function made(spacing: number, paved: PavedGround | null): FacePatch {
  const p = facePatchGeometry(SEED, CI, CJ, spacing, NO_STITCH, null, paved);
  if (p === null) throw new Error(`cell (${CI}, ${CJ}) has no patch at ${spacing} m`);
  return p;
}

describe("a patch beside ground a game paves", () => {
  it("has no triangle with a vertex on it, at every spacing", () => {
    for (const spacing of SPACINGS) {
      const whole = made(spacing, null);
      const p = made(spacing, band);
      expect(p.triangleCount).toBeGreaterThan(0);
      expect(p.triangleCount).toBeLessThan(whole.triangleCount);
      expect(p.indices.length).toBe(p.triangleCount * 3);
      for (const i of p.indices) {
        const [x, z] = pointOf(i, spacing);
        expect(band(x, z)).toBeGreaterThan(0);
      }
    }
  });

  it("has no relief within the margin of it, so no relief stands in the air at the edge it ends in", () => {
    for (const spacing of SPACINGS) {
      const p = made(spacing, band);
      const used = new Set(p.indices);
      let beyond = 0;
      for (const i of used) {
        const [x, z] = pointOf(i, spacing);
        const d = band(x, z);
        const ground = elevationSampleAt(SEED, x, z).h;
        if (d <= PATCH_PAVED_MARGIN) {
          expect(p.positions[i * 3]).toBe(Math.fround(x));
          expect(p.positions[i * 3 + 1]).toBe(Math.fround(ground));
          expect(p.positions[i * 3 + 2]).toBe(Math.fround(z));
        } else if (d > PATCH_PAVED_MARGIN + PATCH_TAPER) beyond++;
      }
      // The relief is not taken away from the rest: past the taper the patch is the one made without the option.
      expect(beyond).toBeGreaterThan(0);
      const whole = made(spacing, null);
      for (const i of used) {
        const [x, z] = pointOf(i, spacing);
        if (band(x, z) <= PATCH_PAVED_MARGIN + PATCH_TAPER) continue;
        expect(p.positions[i * 3 + 1]).toBe(whole.positions[i * 3 + 1]);
        expect(p.normals[i * 3 + 1]).toBe(whole.normals[i * 3 + 1]);
      }
    }
  });

  it("is, with ground that is nowhere near, the patch made without the option, bit for bit", () => {
    for (const spacing of SPACINGS) {
      const whole = made(spacing, null);
      const far = made(spacing, () => 1e6);
      for (const key of ["positions", "normals", "colors", "weights", "weights2", "cover", "indices"] as const) {
        expect(far[key]).toEqual(whole[key]);
      }
      expect(far.triangleCount).toBe(whole.triangleCount);
      expect(whole.indices).toEqual(patchIndices(Math.round(PATCH_CELL / spacing)));
    }
  });

  it("is none where the whole cell is paved", () => {
    expect(facePatchGeometry(SEED, CI, CJ, PATCH_FAR_SPACING, NO_STITCH, null, () => -1)).toBeNull();
  });
});

describe("the rings beside ground a game paves", () => {
  const ring = createRingSamples(SEED, 0, MID_X, MID_Z, 2);
  const reach = PATCH_REACH.low;
  const cell = (ix: number, iz: number): number => iz * (RING_CELLS + 1) + ix;
  const kept = (covered: ReturnType<typeof facePatchCover> | null): Set<string> => {
    const g = ringGeometry(ring, null, null, covered);
    const set = new Set<string>();
    for (let k = 0; k < g.indexCount; k += 3) set.add(`${g.indices[k]},${g.indices[k + 1]},${g.indices[k + 2]}`);
    return set;
  };

  it("keep every triangle that lies within the margin of it, where the patch makes none", () => {
    const without = kept(facePatchCover(MID_X, MID_Z, reach));
    const withIt = kept(facePatchCover(MID_X, MID_Z, reach, band));
    let nearBed = 0;
    let left = 0;
    for (let iz = 0; iz < RING_CELLS; iz++) {
      for (let ix = 0; ix < RING_CELLS; ix++) {
        const a = cell(ix, iz);
        const b = a + 1;
        const c = a + RING_CELLS + 1;
        const d = c + 1;
        const x = ring.originX + (ix + 0.5) * ring.spacing;
        const z = ring.originZ + (iz + 0.5) * ring.spacing;
        const near = band(x, z) - (ring.spacing / 2) * Math.SQRT2 <= PATCH_PAVED_MARGIN;
        const abc = `${a},${b},${c}`;
        const bdc = `${b},${d},${c}`;
        if (near) {
          // Whatever the cover would have left out is drawn, both triangles.
          expect(withIt.has(abc)).toBe(true);
          expect(withIt.has(bdc)).toBe(true);
          if (!without.has(abc) || !without.has(bdc)) nearBed++;
        } else if (!withIt.has(abc) || !withIt.has(bdc)) left++;
      }
    }
    // The test bites (without the option the cover leaves triangles out beside the bed), and the option leaves the
    // rest of the cover as it was.
    expect(nearBed).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
    expect(withIt.size).toBeGreaterThan(without.size);
  });

  it("are as they were without the option", () => {
    const plain = facePatchCover(MID_X, MID_Z, reach);
    expect(plain).toEqual({ x: MID_X, z: MID_Z, reach: reach.wide - PATCH_CELL * Math.SQRT2, fine: reach.far, cell: PATCH_CELL });
    expect(kept(plain).size).toBe(kept(facePatchCover(MID_X, MID_Z, reach, () => 1e6)).size);
  });
});

describe("the patches' list of triangles", () => {
  it("draws a patch with triangles left out by its own, and any other by its band's", () => {
    const own = made(PATCH_WIDE_SPACING, band).indices;
    const slot = (at: number) => ({ at, spacing: PATCH_WIDE_SPACING });
    const full = patchIndices(Math.round(PATCH_CELL / PATCH_WIDE_SPACING));
    const out = new Uint32Array(own.length + full.length);
    const count = writePatchTriangles(
      [{ slot: slot(100), place: 1, pattern: own }, { slot: slot(200), place: 2 }],
      new Map([[PATCH_WIDE_SPACING, full]]), out,
    );
    expect(count).toBe(own.length + full.length);
    expect([...out.subarray(0, own.length)]).toEqual([...own].map((i) => i + 100));
    expect([...out.subarray(own.length)]).toEqual([...full].map((i) => i + 200));
  });
});
