import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { activeTerrainVariant, activeTerrainVariantName, terrainVariant, type TerrainVariant } from "../../src/sim/terrain.js";
import type { TrailGraph } from "../../src/sim/trail.js";
import {
  NO_STITCH, OPEN_NORTH_EAST, OPEN_WEST, PATCH_CELL, PATCH_FAR_SPACING, PATCH_NEAR_SPACING, PATCH_WIDE_SPACING,
  facePatchGeometry, type FacePatch, type PatchStitch,
} from "../../src/game/facePatches.js";
import {
  createPatchServer, patchTransfer, prepareSceneReply, prepareWorld, type PatchCellAsk, type WorldPatchesRequest, type WorldPrepReply,
} from "../../src/game/worldWork.js";

/**
 * The worker's third request: a set of rock-face cells, built one at a time and posted back with the arrays
 * transferred. Cells of seed 1 with steep ground (`facePatchesPaved.test.ts`), with and without a paved ground.
 */

registerOlympic(null);

const SEED = 1;
const VARIANT = activeTerrainVariantName();
const MID_X = (-22 + 0.5) * PATCH_CELL;
/** The paved band of `facePatchesPaved.test.ts`: 11 m wide, running north through cell (-22, -30). */
const BAND_X = MID_X - 8;
const BED_HALF = 5.5;
const bandHook = (_seed: number, x: number): number => Math.abs(x - BAND_X) - BED_HALF;

const COARSE_WEST: PatchStitch = { west: true, east: false, north: false, south: false, open: 0 };
const OPEN_EDGES: PatchStitch = { west: false, east: true, north: false, south: true, open: OPEN_WEST | OPEN_NORTH_EAST };
const CELLS: PatchCellAsk[] = [
  { ci: -22, cj: -30, spacing: PATCH_NEAR_SPACING, stitch: NO_STITCH },
  { ci: -23, cj: -30, spacing: PATCH_NEAR_SPACING, stitch: COARSE_WEST },
  { ci: -22, cj: -31, spacing: PATCH_FAR_SPACING, stitch: OPEN_EDGES },
  { ci: -21, cj: -31, spacing: PATCH_FAR_SPACING, stitch: NO_STITCH },
  { ci: -22, cj: -30, spacing: PATCH_WIDE_SPACING, stitch: NO_STITCH },
  { ci: -24, cj: -30, spacing: PATCH_WIDE_SPACING, stitch: OPEN_EDGES },
];
/** A cell with no steep ground. */
const FLAT: PatchCellAsk = { ci: -26, cj: -30, spacing: PATCH_FAR_SPACING, stitch: NO_STITCH };

type Posted = { reply: WorldPrepReply; transfer: ArrayBuffer[] };

function request(set: number, cells: PatchCellAsk[], over: Partial<WorldPatchesRequest> = {}): WorldPatchesRequest {
  return { id: 7, kind: "patches", seed: SEED, variant: VARIANT, set, cells, ...over };
}

function collect(madeFor: () => { seed: number; variant: string } | null = () => ({ seed: SEED, variant: VARIANT }), now?: () => number) {
  const posted: Posted[] = [];
  const server = createPatchServer((reply, transfer) => posted.push({ reply, transfer }), madeFor, now);
  const run = (): void => { while (server.step()) { /* one cell a step */ } };
  return { posted, server, run };
}

const KEYS = ["positions", "normals", "colors", "weights", "weights2", "cover", "indices"] as const;

function expectSame(got: FacePatch | null, want: FacePatch | null): void {
  if (want === null) { expect(got).toBeNull(); return; }
  expect(got).not.toBeNull();
  const g = got as FacePatch;
  for (const key of KEYS) {
    expect(g[key].length).toBe(want[key].length);
    let differ = 0;
    for (let i = 0; i < want[key].length; i++) if (!Object.is(g[key][i], want[key][i])) differ++;
    expect(differ).toBe(0);
  }
  expect(g.vertexCount).toBe(want.vertexCount);
  expect(g.triangleCount).toBe(want.triangleCount);
}

describe("the world's worker serving a set of rock-face cells", () => {
  const variant = activeTerrainVariant();
  const before = variant.pavedGround;
  beforeEach(() => { variant.pavedGround = undefined; });
  afterEach(() => { variant.pavedGround = before; });

  for (const withPaved of [false, true]) {
    it(`a cell from the server is the page's cell to the bit, ${withPaved ? "with" : "without"} a paved ground`, () => {
      if (withPaved) variant.pavedGround = bandHook;
      const hook = variant.pavedGround;
      const trail = variant.trailGraph?.(SEED) ?? null;
      const paved = hook === undefined ? null : (x: number, z: number): number => hook(SEED, x, z);
      const { posted, server, run } = collect();
      server.ask(request(1, CELLS));
      run();
      const patches = posted.filter((p) => p.reply.kind === "patch").map((p) => p.reply as Extract<WorldPrepReply, { kind: "patch" }>);
      expect(patches.length).toBe(CELLS.length);
      CELLS.forEach((c, i) => {
        const want = facePatchGeometry(SEED, c.ci, c.cj, c.spacing, c.stitch, trail, paved);
        expect(want).not.toBeNull();
        expectSame(patches[i]?.patch ?? null, want);
      });
      // The hook really cuts the first cell, so the paved run is not the unpaved one.
      const whole = facePatchGeometry(SEED, -22, -30, PATCH_NEAR_SPACING, NO_STITCH, trail, null) as FacePatch;
      const first = patches[0]?.patch as FacePatch;
      if (withPaved) expect(first.triangleCount).toBeLessThan(whole.triangleCount);
      else expect(first.triangleCount).toBe(whole.triangleCount);
    });
  }

  it("a cell with no steep ground is posted as null", () => {
    expect(facePatchGeometry(SEED, FLAT.ci, FLAT.cj, FLAT.spacing, FLAT.stitch)).toBeNull();
    const { posted, server, run } = collect();
    server.ask(request(1, [FLAT]));
    run();
    expect(posted[0]?.reply).toMatchObject({ id: 7, kind: "patch", set: 1, index: 0, patch: null });
    expect(posted[0]?.transfer).toEqual([]);
  });

  it("cells are posted in the order asked, one a step, then patchesDone", () => {
    const { posted, server } = collect();
    server.ask(request(3, CELLS));
    for (let i = 0; i < CELLS.length; i++) {
      expect(server.step()).toBe(true);
      expect(posted.length).toBe(i + (i === CELLS.length - 1 ? 2 : 1));
    }
    const kinds = posted.map((p) => p.reply.kind);
    expect(kinds).toEqual([...CELLS.map(() => "patch"), "patchesDone"]);
    posted.slice(0, CELLS.length).forEach((p, i) => {
      expect(p.reply).toMatchObject({ id: 7, kind: "patch", set: 3, index: i });
    });
    expect(posted[CELLS.length]?.reply).toEqual({ id: 7, kind: "patchesDone", set: 3 });
    expect(server.step()).toBe(false);
    expect(posted.length).toBe(CELLS.length + 1);
  });

  it("a newer set drops what is left of the older", () => {
    const { posted, server, run } = collect();
    server.ask(request(1, CELLS.slice(0, 5)));
    server.step();
    server.step();
    server.ask(request(2, CELLS.slice(0, 2), { id: 8 }));
    run();
    const brief = posted.map((p) => {
      const r = p.reply;
      return r.kind === "patch" ? `patch ${r.set}:${r.index}` : r.kind === "patchesDone" ? `done ${r.set}` : r.kind;
    });
    expect(brief).toEqual(["patch 1:0", "patch 1:1", "patch 2:0", "patch 2:1", "done 2"]);
  });

  it("an empty set posts patchesDone alone, and drops the older set", () => {
    const { posted, server, run } = collect();
    server.ask(request(1, CELLS));
    server.step();
    server.ask(request(2, [], { id: 9 }));
    run();
    expect(posted.length).toBe(2);
    expect(posted[0]?.reply).toMatchObject({ kind: "patch", set: 1, index: 0 });
    expect(posted[1]?.reply).toEqual({ id: 9, kind: "patchesDone", set: 2 });
  });

  it("the transfer list is the patch's seven buffers", () => {
    const patch = facePatchGeometry(SEED, -22, -30, PATCH_FAR_SPACING, NO_STITCH) as FacePatch;
    const list = patchTransfer(patch);
    expect(list.length).toBe(7);
    for (const key of KEYS) expect(list).toContain(patch[key].buffer);
    expect(patchTransfer(null)).toEqual([]);
    const { posted, server, run } = collect();
    server.ask(request(1, [CELLS[0] as PatchCellAsk]));
    run();
    const sent = (posted[0]?.reply as Extract<WorldPrepReply, { kind: "patch" }>).patch as FacePatch;
    expect(posted[0]?.transfer.length).toBe(7);
    for (const key of KEYS) expect(posted[0]?.transfer).toContain(sent[key].buffer);
  });

  it("a set for another seed or variant than the world's is refused", () => {
    for (const made of [() => ({ seed: 7, variant: VARIANT }), () => ({ seed: SEED, variant: "elsewhere" }), () => null]) {
      const { posted, server } = collect(made);
      server.ask(request(1, CELLS, { seed: 8 }));
      expect(posted.length).toBe(1);
      expect(posted[0]?.reply).toMatchObject({ id: 7, kind: "failed" });
      expect(typeof (posted[0]?.reply as { message: string }).message).toBe("string");
      expect(server.step()).toBe(false);
      expect(posted.length).toBe(1);
    }
    const { posted, server } = collect(() => null);
    server.ask(request(1, CELLS));
    expect(posted.map((p) => p.reply.kind)).toEqual(["failed"]);
    expect(server.step()).toBe(false);
  });

  it("a cell that throws answers failed and ends the set", () => {
    // No band has a spacing of 3, and the geometry itself builds one: the server refuses it.
    const { posted, server, run } = collect();
    server.ask(request(1, [CELLS[0] as PatchCellAsk, { ci: -22, cj: -30, spacing: 3, stitch: NO_STITCH }, CELLS[1] as PatchCellAsk]));
    run();
    expect(posted.map((p) => p.reply.kind)).toEqual(["patch", "failed"]);
    expect(posted[1]?.reply).toMatchObject({ id: 7, kind: "failed" });
    expect(server.step()).toBe(false);
  });

  it("makes the trail graph once for the world made, and again only for another world", () => {
    const before = variant.trailGraph;
    /** A graph with no trail: what it is matters not here, only how often it is made. */
    const none = { nodes: [], edges: [], trailhead: { x: 0, z: 0, u: 0 }, summit: 0, stem: [], loops: [], features: [] } as unknown as TrailGraph;
    let made = 0;
    variant.trailGraph = () => {
      made++;
      return none;
    };
    try {
      let world = { seed: SEED, variant: VARIANT };
      const { posted, server, run } = collect(() => world);
      server.ask(request(1, [FLAT]));
      run();
      server.ask(request(2, [FLAT]));
      run();
      expect(made).toBe(1);
      world = { seed: 2, variant: VARIANT };
      server.ask(request(3, [FLAT], { seed: 2 }));
      run();
      expect(made).toBe(2);
      expect(posted.map((p) => p.reply.kind)).toEqual(["patch", "patchesDone", "patch", "patchesDone", "patch", "patchesDone"]);
    } finally {
      variant.trailGraph = before;
    }
  });

  it("ms is the time the cell took", () => {
    let t = 0;
    const { posted, server, run } = collect(undefined, () => (t += 5));
    server.ask(request(1, CELLS.slice(0, 3)));
    run();
    const patches = posted.filter((p) => p.reply.kind === "patch").map((p) => p.reply as Extract<WorldPrepReply, { kind: "patch" }>);
    expect(patches.length).toBe(3);
    for (const p of patches) expect(p.ms).toBe(5);
  });
});

describe("what the world's requests report", () => {
  const game = { startOf: () => null, spawnCells: () => [] };
  const kinds = (posted: WorldPrepReply[]): string[] => posted.map((r) => r.kind);

  it("prepareWorld is true where it ends with done, false with one failed for a terrain the sim does not know", () => {
    const ok: WorldPrepReply[] = [];
    expect(prepareWorld({ id: 1, seed: SEED, variant: VARIANT, skip: { prepared: true, passHash: true } }, (r) => ok.push(r), game)).toBe(true);
    expect(kinds(ok)).toEqual(["done"]);
    const bad: WorldPrepReply[] = [];
    expect(prepareWorld({ id: 2, seed: SEED, variant: "nowhere" }, (r) => bad.push(r), game)).toBe(false);
    expect(kinds(bad)).toEqual(["failed"]);
  });

  it("a quiet prepare posts only done, prepares once and generates no chunk; an ordinary one is as it was", () => {
    const variant = terrainVariant(VARIANT) as TerrainVariant;
    const before = variant.prepare;
    let prepares = 0;
    let spawns = 0;
    variant.prepare = () => { prepares++; return { made: true }; };
    const counting = { startOf: () => null, spawnCells: () => { spawns++; return [{ cx: 0, cz: 0 }]; } };
    try {
      const quiet: WorldPrepReply[] = [];
      expect(prepareWorld({ id: 1, seed: SEED, variant: VARIANT, quiet: true }, (r) => quiet.push(r), counting)).toBe(true);
      expect(quiet).toEqual([{ id: 1, kind: "done" }]);
      expect(prepares).toBe(1);
      expect(spawns).toBe(0);
      const loud: WorldPrepReply[] = [];
      expect(prepareWorld({ id: 2, seed: SEED, variant: VARIANT }, (r) => loud.push(r), counting)).toBe(true);
      expect(kinds(loud)).toEqual(["prepared", "passHash", "chunks", "done"]);
      expect(prepares).toBe(2);
      expect(spawns).toBe(1);
      const bad: WorldPrepReply[] = [];
      expect(prepareWorld({ id: 3, seed: SEED, variant: "nowhere", quiet: true }, (r) => bad.push(r), counting)).toBe(false);
      expect(kinds(bad)).toEqual(["failed"]);
    } finally {
      variant.prepare = before;
    }
  });

  it("prepareSceneReply is true where it ends with done, false with one failed for a terrain the sim does not know", () => {
    const ok: WorldPrepReply[] = [];
    expect(prepareSceneReply({ id: 1, kind: "scene", seed: SEED, variant: VARIANT, tier: "low" }, (r) => ok.push(r), game)).toBe(true);
    expect(kinds(ok)).toEqual(["scene", "done"]);
    const bad: WorldPrepReply[] = [];
    expect(prepareSceneReply({ id: 2, kind: "scene", seed: SEED, variant: "nowhere", tier: "low" }, (r) => bad.push(r), game)).toBe(false);
    expect(kinds(bad)).toEqual(["failed"]);
  });
});
