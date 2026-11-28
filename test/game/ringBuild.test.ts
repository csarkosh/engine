import { describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import {
  RING_CELLS, RING_COUNT, createRingSamples, createRingSamplesSlices, holeCellsFor, ringGeometryBuffers, ringGeometrySlices,
  type CoveredGround, type RingSamples,
} from "../../src/game/clipmap.js";
import { PATCH_CELL, PATCH_REACH, facePatchCover } from "../../src/game/facePatches.js";
import { insideDrawnRing, ringBuildSlices, ringDrawnOf, ringStale, type RingBuffers, type RingDrawn } from "../../src/game/ringBuild.js";
import { SLICE_READ_UNITS, SLICE_TARGET_MS, createSyncJobs, finish, type Slices } from "../../src/game/syncJobs.js";
import { activeTerrainVariant } from "../../src/sim/terrain.js";
import { terrainVertexData as fromPlugins } from "../../src/game/lite/terrainPlugins.js";
import { terrainVertexData } from "../../src/game/terrainVertexData.js";
import { ringVertices } from "../../src/game/terrainVertices.js";

registerOlympic(null);

const SEED = 1;
const CAM_X = (-22 + 0.5) * PATCH_CELL;
const CAM_Z = (-30 + 0.5) * PATCH_CELL;
const rings: RingSamples[] = [];
for (let level = 0; level < RING_COUNT; level++) rings.push(createRingSamples(SEED, level, CAM_X, CAM_Z, 2));
const cover: CoveredGround = facePatchCover(CAM_X, CAM_Z, PATCH_REACH.low);

const empty = (): RingBuffers => ({ geometry: null, indices: null, plugin: null });

/** Every element of `a` and `b` the same by `Object.is`, and the same length. */
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

describe("ringBuildSlices", () => {
  for (const level of [0, 3, RING_COUNT - 1]) {
    for (const covered of [null, cover]) {
      it(`is the composition emit was: level ${level}, ${covered === null ? "no" : "a"} covered ground`, () => {
        const ring = rings[level] as RingSamples;
        const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
        const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
        const to = empty();
        finish(ringBuildSlices(ring, finer, coarser, covered, to));
        const want = ringGeometryBuffers(level > 0);
        finish(ringGeometrySlices(ring, finer === null ? null : holeCellsFor(ring, finer), coarser, want, covered));
        const got = to.geometry;
        if (got === null) throw new Error("no geometry made");
        for (const name of ["positions", "normals", "colors", "weights", "weights2", "cover", "indices"] as const) expect(same(got[name], want[name]), name).toBe(true);
        expect(got.indexCount).toBe(want.indexCount);
        const vertices = ringVertices(want);
        expect(same(to.plugin as Float32Array, terrainVertexData(vertices))).toBe(true);
        const whole = new Uint32Array(want.indices.length);
        whole.set(vertices.indices);
        expect(same(to.indices as Uint32Array, whole)).toBe(true);
      });
    }
  }

  it("leaves out triangles under a covered ground, which is what the zeros after the list are", () => {
    const ring = rings[0] as RingSamples;
    const open = empty();
    finish(ringBuildSlices(ring, null, rings[1] as RingSamples, null, open));
    const left = empty();
    finish(ringBuildSlices(ring, null, rings[1] as RingSamples, cover, left));
    expect((left.geometry?.indexCount ?? 0)).toBeLessThan(open.geometry?.indexCount ?? 0);
    const tail = (left.indices as Uint32Array).subarray(left.geometry?.indexCount ?? 0);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((v) => v === 0)).toBe(true);
  });

  it("writes into the buffers given", () => {
    const to = empty();
    const ring = rings[2] as RingSamples;
    finish(ringBuildSlices(ring, rings[1] as RingSamples, rings[3] as RingSamples, null, to));
    const once = { geometry: to.geometry, indices: to.indices, plugin: to.plugin };
    expect(once.geometry).not.toBeNull();
    finish(ringBuildSlices(ring, rings[1] as RingSamples, rings[3] as RingSamples, cover, to));
    expect(to.geometry).toBe(once.geometry);
    expect(to.indices).toBe(once.indices);
    expect(to.plugin).toBe(once.plugin);
  });
});

/** Every sample array of `a` and `b` the same by `Object.is`, and the rest of them equal. */
function sameSamples(a: RingSamples, b: RingSamples): void {
  for (const name of ["h", "hh", "dx", "dz", "colors", "weights", "weights2", "cover", "normals", "lift"] as const) {
    expect(same(a[name], b[name]), name).toBe(true);
  }
  expect([a.level, a.spacing, a.originX, a.originZ, a.lifted, a.moves]).toEqual([b.level, b.spacing, b.originX, b.originZ, b.lifted, b.moves]);
}

describe("createRingSamplesSlices", () => {
  it("is createRingSamples to the bit, for a coarse ring", () => {
    sameSamples(finish(createRingSamplesSlices(SEED, 5, CAM_X, CAM_Z, 2)), rings[5] as RingSamples);
  });

  it("is createRingSamples to the bit for the finest ring under the scheduler, no slice past the target by more than one reading's interval of samples", () => {
    // The test clock moves only with the terrain's samples, a hundredth of a millisecond each.
    const SAMPLE_MS = 0.01;
    let now = 0;
    const variant = activeTerrainVariant();
    const sample = variant.sample;
    variant.sample = (seed, x, z) => {
      now += SAMPLE_MS;
      return sample(seed, x, z);
    };
    try {
      const jobs = createSyncJobs(() => now);
      const spans: number[] = [];
      const got: { ring: RingSamples | null } = { ring: null };
      const inner = createRingSamplesSlices(SEED, 0, CAM_X, CAM_Z, 2);
      jobs.begin({}, (function* (): Slices {
        for (;;) {
          const at = now;
          const step = inner.next();
          spans.push(now - at);
          if (step.done === true) {
            got.ring = step.value;
            return;
          }
          yield step.value;
        }
      })());
      for (let frames = 0; got.ring === null && frames < 100_000; frames++) jobs.run();
      if (got.ring === null) throw new Error("the ring was not sampled");
      sameSamples(got.ring, rings[0] as RingSamples);
      // Sliced: a whole ring is more than 80,000 samples, some 800 ms of this clock.
      expect(spans.length).toBeGreaterThan(400);
      expect(Math.max(...spans)).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * SAMPLE_MS + 1e-9);
    } finally {
      variant.sample = sample;
    }
  });
});

describe("ringStale", () => {
  const base: RingDrawn = { x: 1, z: 2, fx: 3, fz: 4, cx: 5, cz: 6, kx: 7, kz: 8, kr: 9, kf: 10 };

  it("is false for equal records, NaN against NaN included", () => {
    expect(ringStale({ ...base }, base)).toBe(false);
    const none = { ...base, fx: Number.NaN, kr: Number.NaN };
    expect(ringStale({ ...none }, none)).toBe(false);
  });

  it("is true when any one of the ten fields differs", () => {
    for (const key of Object.keys(base) as (keyof RingDrawn)[]) {
      expect(ringStale({ ...base, [key]: base[key] + 1 }, base), key).toBe(true);
      expect(ringStale({ ...base, [key]: Number.NaN }, base), `${key} NaN drawn`).toBe(true);
      expect(ringStale(base, { ...base, [key]: Number.NaN }), `${key} NaN now`).toBe(true);
    }
  });

  it("is true for no record", () => {
    expect(ringStale(undefined, base)).toBe(true);
    expect(ringStale(null, base)).toBe(true);
  });
});

describe("ringDrawnOf", () => {
  it("is NaN for a missing finer, coarser or cover", () => {
    const d = ringDrawnOf(rings[0] as RingSamples, null, null, null);
    expect(d.x).toBe((rings[0] as RingSamples).originX);
    expect(d.z).toBe((rings[0] as RingSamples).originZ);
    for (const key of ["fx", "fz", "cx", "cz", "kx", "kz", "kr", "kf"] as const) expect(d[key], key).toBeNaN();
  });

  it("holds the neighbours' origins and the cover's x, z, reach and fine", () => {
    const finer = rings[1] as RingSamples;
    const coarser = rings[3] as RingSamples;
    const d = ringDrawnOf(rings[2] as RingSamples, finer, coarser, cover);
    expect([d.fx, d.fz, d.cx, d.cz]).toEqual([finer.originX, finer.originZ, coarser.originX, coarser.originZ]);
    expect([d.kx, d.kz, d.kr, d.kf]).toEqual([cover.x, cover.z, cover.reach, cover.fine]);
  });
});

describe("insideDrawnRing", () => {
  /** A finest ring drawn with its corner at (x, z). */
  const at = (x: number, z: number): RingDrawn => ({ x, z, fx: Number.NaN, fz: Number.NaN, cx: 0, cz: 0, kx: Number.NaN, kz: Number.NaN, kr: Number.NaN, kf: Number.NaN });
  const drawnAt = at(-40, 24);
  const side = RING_CELLS * 1;

  it("is false with nothing drawn", () => {
    expect(insideDrawnRing(null, 1, 0, 0)).toBe(false);
    expect(insideDrawnRing(undefined, 1, 0, 0)).toBe(false);
  });

  it("is true at the ring's centre and just inside each of its edges", () => {
    expect(insideDrawnRing(drawnAt, 1, -40 + side / 2, 24 + side / 2)).toBe(true);
    expect(insideDrawnRing(drawnAt, 1, -40 + 0.01, 24 + side / 2)).toBe(true);
    expect(insideDrawnRing(drawnAt, 1, -40 + side - 0.01, 24 + side / 2)).toBe(true);
    expect(insideDrawnRing(drawnAt, 1, -40 + side / 2, 24 + 0.01)).toBe(true);
    expect(insideDrawnRing(drawnAt, 1, -40 + side / 2, 24 + side - 0.01)).toBe(true);
  });

  it("is false just outside each of its edges", () => {
    expect(insideDrawnRing(drawnAt, 1, -40 - 0.01, 24 + side / 2)).toBe(false);
    expect(insideDrawnRing(drawnAt, 1, -40 + side + 0.01, 24 + side / 2)).toBe(false);
    expect(insideDrawnRing(drawnAt, 1, -40 + side / 2, 24 - 0.01)).toBe(false);
    expect(insideDrawnRing(drawnAt, 1, -40 + side / 2, 24 + side + 0.01)).toBe(false);
  });

  it("uses the spacing given", () => {
    const camX = -40 + side * 1.5;
    expect(insideDrawnRing(drawnAt, 2, camX, 24 + side / 2)).toBe(true);
    expect(insideDrawnRing(drawnAt, 1, camX, 24 + side / 2)).toBe(false);
  });
});

describe("the interleave", () => {
  it("is unchanged by its move", () => {
    expect(fromPlugins).toBe(terrainVertexData);
  });
});
