import { describe, expect, it } from "vitest";
import { timeLimit } from "../../testing/timeLimit.js";
import "../../src/sim/montane.js";
import { registerOlympic, olympicBaseSample, roadGradeAt, roadFrameAt, coastGround, roadCenterX, roadCorridorOverD, duneD, shoreProfileD, coveProfileD, COAST_X } from "../../src/sim/olympic.js";
import "../../src/sim/passes/elevation.js";
import "../../src/sim/passes/trees.js";
import "../../src/sim/passes/clutter.js";
import "../../src/sim/passes/cliffs.js";
import { fbm2, fbm2d, gradientNoise2, hash2, hash3, valueNoise2 } from "../../src/sim/field.js";
import { corridorD, gradeSplineD, roadOffsetD } from "../../src/sim/road.js";
import { cliffD, cliffMaskD, terraceDeltaD, terraceStepD } from "../../src/sim/cliffs.js";
import { cellularD, faceKindD, faceReliefD, groundPatchD, groundReliefD, groundWalkD } from "../../src/sim/faceRelief.js";
import { lakeWobble } from "../../src/sim/lakeShape.js";
import { createGroundField } from "../../src/sim/ground.js";
import { generateChunk } from "../../src/sim/chunk.js";
import { setActiveTerrainVariant, terrainVariant, elevationAt, elevationSampleAt } from "../../src/sim/terrain.js";
import { clutterInRect } from "../../src/sim/clutter.js";

/**
 * The terrain's numbers, to the bit. Every function the ground is made of is asked at many thousand places and the
 * doubles it answers are folded into a digest; the digests below were taken from the functions as they stood at
 * v0.2.12, before any of them was rewritten to answer without making an object. A rewrite of how a function carries
 * its answer (a register in place of a record) must leave every digest as it is: the arithmetic, and its order, are
 * the world's identity, and two peers must agree on it.
 *
 * A digest that moves means the arithmetic moved. Put the arithmetic back; never the digest.
 */

registerOlympic(null);

const SEEDS = [20261121, 1, 6, 24301];

/** Folds doubles into 64 bits, by their own bits. */
class Digest {
  private a = 0x811c9dc5 | 0;
  private b = 0x01000193 | 0;
  private readonly f = new Float64Array(1);
  private readonly u = new Uint32Array(this.f.buffer);
  count = 0;
  add(n: number): void {
    this.f[0] = n;
    const lo = this.u[0] as number, hi = this.u[1] as number;
    this.a = Math.imul(this.a ^ lo, 0x01000193);
    this.a = Math.imul(this.a ^ hi, 0x01000193);
    this.b = Math.imul(this.b ^ hi, 0x85ebca6b) + lo | 0;
    this.b = (this.b << 13) | (this.b >>> 19);
    this.count++;
  }
  rec(o: Readonly<Record<string, number>>, keys: readonly string[]): void {
    for (const k of keys) this.add(o[k] as number);
  }
  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, "0") + (this.b >>> 0).toString(16).padStart(8, "0");
  }
}

/** A run of numbers in [0, 1) of its own (mulberry32): the places asked are no function of what is under test. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HDXZ = ["h", "dx", "dz"] as const;
const VDXZ = ["v", "dx", "dz"] as const;
const NOISE = ["v", "dx", "dz", "dxx", "dxz", "dzz"] as const;

/** Places over the coast: the sea, the shore, the road, the blend and the massif, with a share drawn in close to the road and the cove. */
function places(seed: number, n: number, each: (x: number, z: number) => void): void {
  const r = rng(seed ^ 0x51ed);
  for (let i = 0; i < n; i++) {
    const kind = i % 4;
    const z = kind === 3 ? (r() - 0.5) * 900 : (r() - 0.5) * 12000;
    let x: number;
    if (kind === 0) x = COAST_X - 900 + r() * 3600;
    else if (kind === 1) x = roadCenterX(seed, z) + (r() - 0.5) * 240;
    else if (kind === 2) x = COAST_X - 500 + r() * 1100;
    else x = COAST_X - 450 + r() * 900;
    each(x, z);
  }
}

function digests(): Record<string, string> {
  const out: Record<string, string> = {};
  const group = (name: string, fill: (d: Digest) => void): void => {
    const d = new Digest();
    fill(d);
    out[name] = `${d.hex()}/${d.count}`;
  };

  group("field", (d) => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < 40000; i++) {
        const x = (r() - 0.5) * 4000, z = (r() - 0.5) * 4000;
        d.add(hash2(Math.floor(x), Math.floor(z), seed));
        d.add(hash3(Math.floor(x), Math.floor(z), i & 7, seed));
        d.add(valueNoise2(x, z, seed));
        d.add(fbm2(x * 0.1, z * 0.1, seed, 1 + (i % 6)));
        d.rec(gradientNoise2(x, z, seed), NOISE);
        d.rec(fbm2d(x * 0.03, z * 0.03, seed ^ 0x77, 1 + (i % 8)), NOISE);
      }
    }
  });

  for (const name of ["montane", "plain", "ridged", "dense", "olympic"]) {
    group(`variant:${name}`, (d) => {
      const v = terrainVariant(name);
      if (v === undefined) throw new Error(`no ${name}`);
      for (const seed of SEEDS) places(seed, 24000, (x, z) => d.rec(v.sample(seed, x, z), HDXZ));
    });
  }

  group("olympic:hooks", (d) => {
    const v = terrainVariant("olympic");
    if (v === undefined) throw new Error("no olympic");
    for (const seed of SEEDS) {
      places(seed, 16000, (x, z) => {
        d.add(v.coastDistance?.(seed, x, z) ?? 0);
        d.add(v.roadDistance?.(seed, x, z) ?? 0);
        d.add(v.roadCenterX?.(seed, z) ?? 0);
        d.add(v.coveMask?.(seed, x, z) ?? 0);
        d.rec(olympicBaseSample(seed, x, z), HDXZ);
        const g = roadGradeAt(seed, z);
        d.add(g.h); d.add(g.dz);
        const f = roadFrameAt(seed, x, z);
        d.add(f.u); d.add(f.uDz);
        const c = coastGround(seed, x, z);
        d.add(c.u); d.add(c.uDz); d.rec(c.ground, HDXZ);
        d.rec(roadCorridorOverD(seed, z, c.u, c.uDz, c.ground), HDXZ);
        d.rec(duneD(seed, x, z, f.u, f.uDz, { h: (x - COAST_X) * 0.02, dx: 0.02, dz: 0.001 }), HDXZ);
      });
    }
    const r = rng(9);
    for (let i = 0; i < 60000; i++) {
      const dist = (r() - 0.5) * 2400;
      const s = shoreProfileD(dist);
      d.add(s.v); d.add(s.dd);
      const c = coveProfileD(dist * 0.25);
      d.add(c.v); d.add(c.dd);
    }
  });

  group("road", (d) => {
    const lattice = (i: number): number => Math.sin(i * 0.7) * 30 + i;
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0x40ad);
      for (let i = 0; i < 40000; i++) {
        const z = (r() - 0.5) * 20000;
        const end = 40 + r() * 460, endDz = (r() - 0.5) * 0.4;
        const o = roadOffsetD(seed, z, 25, end, endDz);
        d.add(o.dr); d.add(o.drDz);
        const g = gradeSplineD(lattice, z);
        d.add(g.h); d.add(g.dz);
        const u = (r() - 0.5) * 80;
        d.rec(corridorD(u, o.drDz, g, { h: r() * 40, dx: r() - 0.5, dz: r() - 0.5 }), HDXZ);
      }
    }
  });

  group("cliffs", (d) => {
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0xc11f);
      for (let i = 0; i < 40000; i++) {
        const x = (r() - 0.5) * 6000, z = (r() - 0.5) * 6000;
        const u = (r() - 0.5) * 400, uDz = (r() - 0.5) * 0.6;
        const base = { h: r() * 320, dx: (r() - 0.5) * 2, dz: (r() - 0.5) * 2 };
        const t = terraceStepD(r() * 3);
        d.add(t.v); d.add(t.d);
        const td = terraceDeltaD(base.h);
        d.add(td.v); d.add(td.d);
        d.rec(cliffMaskD(seed, x, z, u, uDz, base), VDXZ);
        d.rec(cliffD(seed, x, z, u, uDz, base), HDXZ);
        d.rec(cliffD(seed, x, z, u, uDz, base, { v: r(), dx: (r() - 0.5) * 0.01, dz: (r() - 0.5) * 0.01 }), HDXZ);
      }
    }
  });

  group("relief", (d) => {
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0xface);
      for (let i = 0; i < 30000; i++) {
        const x = (r() - 0.5) * 3000, z = (r() - 0.5) * 3000;
        d.rec(faceKindD(seed, x, z), VDXZ);
        d.rec(faceReliefD(seed, x, z), VDXZ);
        d.rec(groundPatchD(seed, x, z), VDXZ);
        d.rec(groundReliefD(seed, x, z), VDXZ);
        d.rec(groundWalkD(seed, x, z), VDXZ);
        d.rec(lakeWobble(x * 0.05, z * 0.05, seed), VDXZ);
      }
    }
    void cellularD;
  });

  group("ground", (d) => {
    setActiveTerrainVariant("olympic");
    const n = { x: 0, y: 0, z: 0 };
    for (const seed of SEEDS) {
      const field = createGroundField(seed);
      places(seed, 12000, (x, z) => {
        d.add(elevationAt(seed, x, z));
        d.rec(elevationSampleAt(seed, x, z), HDXZ);
        const h = field.heightAt(x, z);
        d.add(h);
        field.normalAt(x, z, n);
        d.add(n.x); d.add(n.y); d.add(n.z);
        d.add(field.above?.(x, h + 0.05, z) === true ? 1 : 0);
        d.add(field.standNormalY?.(x, z) ?? 0);
      });
    }
  });

  group("chunks", (d) => {
    setActiveTerrainVariant("olympic");
    for (const seed of SEEDS.slice(0, 2)) {
      for (const [cx, cz] of [[0, 0], [-14, 3], [5, -9], [20, 1]] as const) {
        const c = generateChunk(seed, cx, cz);
        for (const q of c.columns) d.add(q);
        for (const p of c.props) {
          d.add(p.box.min.x); d.add(p.box.min.y); d.add(p.box.min.z);
          d.add(p.box.max.x); d.add(p.box.max.y); d.add(p.box.max.z);
        }
      }
      for (let cls = 0; cls < 12; cls++) {
        let list: ReturnType<typeof clutterInRect>;
        try {
          list = clutterInRect(seed, cls, -40, -60, 60, 60);
        } catch {
          continue;
        }
        for (const it of list) {
          d.add(it.x); d.add(it.z); d.add(it.groundH); d.add(it.groundDx); d.add(it.groundDz); d.add(it.scale); d.add(it.variant);
        }
      }
    }
  });

  return out;
}

const PINNED: Record<string, string> = {
  chunks: "ba3b4eea9cbdba4e/248312",
  cliffs: "de0e52a638745148/2080000",
  field: "532eab0c3f691297/2560000",
  ground: "c727785eb877b509/480000",
  "olympic:hooks": "e0cdb282d7fe789b/1648000",
  relief: "78db36bcf6a4840a/2160000",
  road: "875de322312d77c9/1120000",
  "variant:dense": "a1c26434a081e5cc/288000",
  "variant:montane": "d331d495a330ca09/288000",
  "variant:olympic": "764258fdd98c3f98/288000",
  "variant:plain": "5e5f83899eb1c4cb/288000",
  "variant:ridged": "2d9729f078de773a/288000",
};

describe("the terrain's numbers", () => {
  it("are what they were, to the bit", () => {
    expect(digests()).toEqual(PINNED);
  }, timeLimit(240_000));
});
