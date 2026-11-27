import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { activeTerrainVariant, activeTerrainVariantName } from "../../src/sim/terrain.js";
import {
  RING_COUNT, coversRing, createRingSamples, ringSampleSlices, snapOrigin,
  type CoveredGround, type RingArrays, type RingSamples,
} from "../../src/game/clipmap.js";
import { PATCH_CELL, PATCH_REACH, facePatchCover, type PatchReach } from "../../src/game/facePatches.js";
import { ringBuildSlices, ringDrawnOf, ringStale, type RingBuffers, type RingDrawn } from "../../src/game/ringBuild.js";
import {
  createRingServer, createWorkOrder, ringSentTransfer, ringsRequestTransfer,
  type RingCover, type RingSent, type WorldRingsRequest,
} from "../../src/game/ringServe.js";
import { finish } from "../../src/game/syncJobs.js";
import { timeLimit } from "../../testing/timeLimit.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

/**
 * The worker's fourth request: a set of rings for a camera place, re-centred and built by the worker and posted back
 * with the arrays transferred. The reference is the page's own steps (`lite/terrainMeshes.ts`, `build`), written out
 * here from the same pure functions. On the low tier's spacing, about steep ground of seed 1 (`ringBuild.test.ts`).
 */

registerOlympic(null);

const SEED = 1;
const VARIANT = activeTerrainVariantName();
const BASE = 2;
/** A crossing of the finest ring's lattice. */
const STEP = 2 * BASE;
const START_X = (-22 + 0.5) * PATCH_CELL;
const START_Z = (-30 + 0.5) * PATCH_CELL;
/** The paved band of `patchWorkServe.test.ts`: 11 m wide, running north through the start's cell. */
const BAND_X = START_X - 8;
const BED_HALF = 5.5;
const bandHook = (_seed: number, x: number): number => Math.abs(x - BAND_X) - BED_HALF;

let first: RingSamples[] = [];
// The seven rings sampled at the start, once for the file: about twenty seconds on a loaded machine.
beforeAll(() => {
  first = Array.from({ length: RING_COUNT }, (_, level) => createRingSamples(SEED, level, START_X, START_Z, BASE));
}, timeLimit(120_000));
/** A copy of the seven rings sampled at the start. */
function startRings(): RingSamples[] {
  return structuredClone(first);
}

const NONE: (RingDrawn | null)[] = Array.from({ length: RING_COUNT }, () => null);
type RingReply = Extract<WorldPrepReply, { kind: "ring" }>;

/** Every element of `a` and `b` the same by `Object.is`, and the same length. */
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function sameDrawn(a: RingDrawn, b: RingDrawn): boolean {
  return (Object.keys(b) as (keyof RingDrawn)[]).every((key) => Object.is(a[key], b[key])) && Object.keys(a).length === Object.keys(b).length;
}

/** A covered ground as the page sends it. */
function sent(cover: CoveredGround | null): RingCover | null {
  if (cover === null) return null;
  return { x: cover.x, z: cover.z, reach: cover.reach, fine: cover.fine, cell: cover.cell, pavedMargin: cover.pavedMargin ?? null };
}

function request(set: number, camX: number, camZ: number, over: Partial<WorldRingsRequest> = {}): WorldRingsRequest {
  return { id: 3, kind: "rings", seed: SEED, variant: VARIANT, set, camX, camZ, cover: null, drawn: NONE, ...over };
}

type World = { seed: number; variant: string } | null;

/**
 * A server whose posts go as a worker's do: each reply cloned with its transfer list, so the server's own arrays are
 * detached once posted. `ask` sends a request the same way, its samples and spares transferred.
 */
function collect(madeFor: () => World = () => ({ seed: SEED, variant: VARIANT }), now?: () => number) {
  const posted: WorldPrepReply[] = [];
  const server = createRingServer((reply, transfer) => posted.push(structuredClone(reply, { transfer })), madeFor, now);
  const ask = (r: WorldRingsRequest): void => server.ask(structuredClone(r, { transfer: ringsRequestTransfer(r) }));
  const run = (): void => { while (server.step()) { /* one unit a step */ } };
  const brief = (): string[] => posted.map((r) =>
    r.kind === "ring" ? `ring ${r.set}:${r.level}` : r.kind === "ringsDone" ? `done ${r.set}` : r.kind);
  return { posted, server, ask, run, brief };
}

/** The page's rings as it holds them: their samples, the spare set their moves share, and what each ring was drawn as. */
type Page = { rings: RingSamples[]; spare: RingArrays[]; drawn: (RingDrawn | null)[] };

/** The page's own steps for a camera place (`build`): every ring moved, then each stale ring made, then all shown. */
function pageSet(page: Page, camX: number, camZ: number, cover: CoveredGround | null): { level: number; to: RingBuffers; drawn: RingDrawn }[] {
  for (const ring of page.rings) finish(ringSampleSlices(ring, SEED, camX, camZ, page.spare));
  const made: { level: number; to: RingBuffers; drawn: RingDrawn }[] = [];
  for (let level = 0; level < RING_COUNT; level++) {
    const ring = page.rings[level] as RingSamples;
    const finer = level > 0 ? (page.rings[level - 1] as RingSamples) : null;
    const coarser = level < RING_COUNT - 1 ? (page.rings[level + 1] as RingSamples) : null;
    const covered = coversRing(cover, ring.spacing) ? cover : null;
    const drawn = ringDrawnOf(ring, finer, coarser, covered);
    if (!ringStale(page.drawn[level], drawn)) continue;
    const to: RingBuffers = { geometry: null, indices: null, plugin: null };
    finish(ringBuildSlices(ring, finer, coarser, covered, to));
    made.push({ level, to, drawn });
  }
  for (const { level, drawn } of made) page.drawn[level] = drawn;
  return made;
}

/** The camera's places: a start, then `perLeg` crossings along x, as many along z, and as many diagonally, (+x, `dz`). */
function path(perLeg: number, dz: 1 | -1): { x: number; z: number }[] {
  const places = [{ x: START_X, z: START_Z }];
  let x = START_X;
  let z = START_Z;
  for (const [sx, sz] of [[1, 0], [0, 1], [1, dz]] as const) {
    for (let i = 0; i < perLeg; i++) {
      x += sx * STEP;
      z += sz * STEP;
      places.push({ x, z });
    }
  }
  return places;
}

describe("the world's worker serving sets of rings", { timeout: timeLimit(20_000) }, () => {
  const variant = activeTerrainVariant();
  const before = variant.pavedGround;
  beforeEach(() => { variant.pavedGround = undefined; });
  afterEach(() => { variant.pavedGround = before; });

  for (const withPaved of [false, true]) {
    it(`along a path the worker's rings are the page's to the bit, ${withPaved ? "with" : "without"} a paved ground`, () => {
      if (withPaved) variant.pavedGround = bandHook;
      const hook = variant.pavedGround;
      const paved = hook === undefined ? null : (x: number, z: number): number => hook(SEED, x, z);
      const low = PATCH_REACH.low;
      const near: PatchReach = { near: low.near, far: low.near, wide: low.near };
      const coverA = facePatchCover(START_X, START_Z, low, paved);
      const coverB = facePatchCover(START_X + PATCH_CELL, START_Z, low, paved);
      const coverC = facePatchCover(START_X + PATCH_CELL, START_Z, near, paved);
      // The covered ground changes twice, then goes to none, and comes back after it.
      const coverAt = (set: number): CoveredGround | null =>
        set < 5 ? coverA : set < 10 ? coverB : set < 14 ? coverC : set < 18 ? null : coverA;
      const places = path(7, -1);
      expect(places.length).toBe(22);

      const page: Page = { rings: startRings(), spare: [], drawn: [...NONE] };
      const { posted, server, ask } = collect();
      /** The rings each set posted, given back with the request after next. */
      const out: RingSent[][] = [];
      let leftOut = 0;
      let leftOutAfterNone = 0;
      places.forEach(({ x, z }, set) => {
        const cover = coverAt(set);
        const drawn = [...page.drawn];
        ask(request(set, x, z, {
          cover: sent(cover), drawn, ...(set === 0 ? { samples: startRings() } : {}), ...(set >= 2 ? { spare: out[set - 2] } : {}),
        }));
        const from = posted.length;
        while (server.step()) { /* the whole set */ }
        const replies = posted.slice(from);
        const want = pageSet(page, x, z, cover);
        expect(replies.map((r) => r.kind)).toEqual([...want.map(() => "ring"), "ringsDone"]);
        const rings = replies.filter((r): r is RingReply => r.kind === "ring");
        expect(rings.map((r) => r.level)).toEqual(want.map((w) => w.level));
        rings.forEach((got, i) => {
          const w = want[i] as (typeof want)[number];
          const geometry = w.to.geometry;
          if (geometry === null) throw new Error("no geometry made");
          expect(got.set).toBe(set);
          expect(same(got.ring.positions, geometry.positions), `set ${set} level ${w.level} positions`).toBe(true);
          expect(same(got.ring.normals, geometry.normals), `set ${set} level ${w.level} normals`).toBe(true);
          expect(same(got.ring.plugin, w.to.plugin as Float32Array), `set ${set} level ${w.level} plugin`).toBe(true);
          expect(same(got.ring.indices, w.to.indices as Uint32Array), `set ${set} level ${w.level} indices`).toBe(true);
          expect(sameDrawn(got.drawn, w.drawn), `set ${set} level ${w.level} drawn`).toBe(true);
          if (geometry.indexCount < geometry.indices.length) {
            leftOut++;
            if (set === 18) leftOutAfterNone++;
          }
        });
        out.push(rings.map((r) => r.ring));
      });
      // The covers leave triangles out, the one after none among them, into index arrays a set under none filled.
      expect(leftOut).toBeGreaterThan(0);
      expect(leftOutAfterNone).toBeGreaterThan(0);
      // The rings were built into buffers given back.
      const sentRings = out.reduce((n, rings) => n + rings.length, 0);
      expect(server.made).toBeLessThan(4 * sentRings);
      if (paved !== null) {
        // The paved ground keeps triangles of the finest ring the cover alone leaves out.
        const rings = startRings();
        const [bare, kept] = [{ ...coverA, paved: undefined, pavedMargin: undefined }, coverA].map((c) => {
          const to: RingBuffers = { geometry: null, indices: null, plugin: null };
          finish(ringBuildSlices(rings[0] as RingSamples, null, rings[1] as RingSamples, c, to));
          return to.geometry?.indexCount ?? 0;
        });
        expect(kept).toBeGreaterThan(bare as number);
      }
    }, timeLimit(120_000));
  }

  it("a set with nothing stale is done at once", () => {
    const rings = startRings();
    const drawn = rings.map((ring, level) => ringDrawnOf(ring, rings[level - 1] ?? null, rings[level + 1] ?? null, null));
    const { posted, server, ask } = collect(undefined, () => 0);
    ask(request(1, START_X, START_Z, { samples: rings, drawn }));
    expect(server.working).toBe(true);
    expect(server.step()).toBe(true);
    expect(posted).toEqual([{ id: 3, kind: "ringsDone", set: 1, ms: 0 }]);
    expect(server.working).toBe(false);
    expect(server.step()).toBe(false);
    expect(posted.length).toBe(1);
  });

  it("a set posts ring by ring, one a step, then ringsDone", () => {
    const rings = startRings();
    const camX = START_X + STEP;
    const movers = rings.filter((ring) => snapOrigin(camX, ring.spacing) !== ring.originX).length;
    expect(movers).toBeGreaterThan(0);
    let t = 0;
    const { posted, server, ask, brief } = collect(undefined, () => (t += 1));
    ask(request(4, camX, START_Z, { samples: rings }));
    // The rings that must move are re-centred first, one a step, posting nothing.
    for (let i = 0; i < movers; i++) {
      expect(server.step()).toBe(true);
      expect(posted.length).toBe(0);
    }
    for (let level = 0; level < RING_COUNT; level++) {
      expect(server.step()).toBe(true);
      expect(posted.length).toBe(level + 1);
    }
    expect(server.step()).toBe(true);
    expect(brief()).toEqual([...Array.from({ length: RING_COUNT }, (_, level) => `ring 4:${level}`), "done 4"]);
    for (const r of posted.slice(0, RING_COUNT)) expect((r as RingReply).ms).toBe(1);
    // The whole set's time: each move's and each build's.
    expect(posted[RING_COUNT]).toEqual({ id: 3, kind: "ringsDone", set: 4, ms: movers + RING_COUNT });
    expect(server.step()).toBe(false);
  });

  it("nothing is made new once warm", () => {
    const { posted, server, ask } = collect();
    // On this path the second set's rings with the first's are as many as any two sets in a row post: the pool given
    // back then holds enough for every later set.
    const places = path(10, 1);
    expect(places.length).toBe(31);
    const out: RingSent[][] = [];
    let drawn = [...NONE];
    const made: number[] = [];
    places.forEach(({ x, z }, set) => {
      ask(request(set, x, z, { drawn, ...(set === 0 ? { samples: startRings() } : {}), ...(set >= 2 ? { spare: out[set - 2] } : {}) }));
      const from = posted.length;
      while (server.step()) { /* the whole set */ }
      const rings = posted.slice(from).filter((r): r is RingReply => r.kind === "ring");
      drawn = [...drawn];
      for (const r of rings) drawn[r.level] = r.drawn;
      out.push(rings.map((r) => r.ring));
      made.push(server.made);
    });
    expect(made[0]).toBeGreaterThan(0);
    for (let set = 3; set < made.length; set++) expect(made[set], `set ${set}`).toBe(made[2]);
  }, timeLimit(120_000));

  it("the samples given replace the ones held", () => {
    const { posted, server, ask, run } = collect();
    ask(request(1, START_X, START_Z, { samples: startRings() }));
    run();
    const given = startRings();
    const ring = given[0] as RingSamples;
    // The middle of the finest ring, away from its border's blend: its height is its own lift.
    const middle = 64 * 129 + 64;
    const was = ring.lift[middle] as number;
    for (let i = 0; i < ring.lift.length; i++) ring.lift[i] = (ring.lift[i] as number) + 1;
    const lift = ring.lift[middle] as number;
    expect(Math.fround(lift)).not.toBe(Math.fround(was));
    ask(request(2, START_X, START_Z, { samples: given }));
    run();
    const ring0 = posted.filter((r): r is RingReply => r.kind === "ring" && r.level === 0);
    expect(ring0.map((r) => r.set)).toEqual([1, 2]);
    expect(ring0[1]?.ring.positions[middle * 3 + 1]).toBe(Math.fround(lift));
    expect(ring0[0]?.ring.positions[middle * 3 + 1]).toBe(Math.fround(was));
    expect(server.working).toBe(false);
  });

  it("a set with none held is refused", () => {
    const { posted, server, ask, run } = collect();
    ask(request(1, START_X, START_Z));
    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ id: 3, kind: "failed" });
    expect(typeof (posted[0] as { message: string }).message).toBe("string");
    expect(server.working).toBe(false);
    expect(server.step()).toBe(false);
    // Held for another id is not held for this one.
    ask(request(2, START_X, START_Z, { id: 4, samples: startRings() }));
    run();
    ask(request(3, START_X, START_Z));
    expect(posted[posted.length - 1]).toMatchObject({ id: 3, kind: "failed" });
  });

  it("stop forgets the samples and answers nothing", () => {
    const { posted, server, ask, brief } = collect();
    ask(request(1, START_X, START_Z, { samples: startRings() }));
    server.step();
    server.step();
    ask(request(2, START_X, START_Z, { stop: true }));
    expect(server.working).toBe(false);
    expect(server.step()).toBe(false);
    expect(brief()).toEqual(["ring 1:0", "ring 1:1"]);
    ask(request(3, START_X, START_Z));
    expect(brief()).toEqual(["ring 1:0", "ring 1:1", "failed"]);
    expect(posted[2]).toMatchObject({ id: 3, kind: "failed" });
  });

  it("a newer set replaces the one in hand", () => {
    const { server, ask, run, brief } = collect();
    ask(request(1, START_X, START_Z, { samples: startRings() }));
    server.step();
    server.step();
    ask(request(2, START_X, START_Z));
    run();
    expect(brief()).toEqual(["ring 1:0", "ring 1:1", ...Array.from({ length: RING_COUNT }, (_, level) => `ring 2:${level}`), "done 2"]);
  });

  it("a set for another seed or variant is refused", () => {
    for (const other of [{ seed: 7, variant: VARIANT }, { seed: SEED, variant: "elsewhere" }, null]) {
      let world: World = other;
      const { posted, server, ask } = collect(() => world);
      ask(request(1, START_X, START_Z, { samples: startRings() }));
      expect(posted.map((r) => r.kind)).toEqual(["failed"]);
      expect(posted[0]).toMatchObject({ id: 3, kind: "failed" });
      expect(server.step()).toBe(false);
      // The samples of a refused set are forgotten.
      world = { seed: SEED, variant: VARIANT };
      ask(request(2, START_X, START_Z));
      expect(posted.map((r) => r.kind)).toEqual(["failed", "failed"]);
    }
    // A world no longer the set's ends it.
    let world: World = { seed: SEED, variant: VARIANT };
    const { server, ask, brief } = collect(() => world);
    ask(request(1, START_X, START_Z, { samples: startRings() }));
    server.step();
    world = { seed: 2, variant: VARIANT };
    server.step();
    expect(brief()).toEqual(["ring 1:0", "failed"]);
    expect(server.step()).toBe(false);
    // A paved ground asked of a terrain that paves none.
    const cover = sent(facePatchCover(START_X, START_Z, PATCH_REACH.low, () => 0));
    expect(cover?.pavedMargin).not.toBeNull();
    const paving = collect();
    paving.ask(request(1, START_X, START_Z, { samples: startRings(), cover }));
    expect(paving.brief()).toEqual(["failed"]);
    expect(paving.server.working).toBe(false);
  });

  it("a throw answers failed and ends the set", () => {
    variant.pavedGround = () => { throw new Error("no paving here"); };
    const { posted, server, ask, run, brief } = collect();
    const cover = sent(facePatchCover(START_X, START_Z, PATCH_REACH.low, () => 0));
    ask(request(1, START_X, START_Z, { samples: startRings(), cover }));
    run();
    // The finest ring leaves steep ground out, and asks the paved ground of it first.
    expect(brief()).toEqual(["failed"]);
    expect(posted[0]).toEqual({ id: 3, kind: "failed", message: "no paving here" });
    expect(server.working).toBe(false);
    expect(server.step()).toBe(false);
    // Its samples are forgotten.
    variant.pavedGround = undefined;
    ask(request(2, START_X, START_Z));
    expect(brief()).toEqual(["failed", "failed"]);
  });

  it("the transfer lists", () => {
    const ring: RingSent = { positions: new Float32Array(3), normals: new Float32Array(3), plugin: new Float32Array(4), indices: new Uint32Array(6) };
    expect(ringSentTransfer(ring)).toEqual([ring.positions.buffer, ring.normals.buffer, ring.plugin.buffer, ring.indices.buffer]);
    const samples = startRings();
    const other: RingSent = { positions: new Float32Array(3), normals: new Float32Array(3), plugin: new Float32Array(4), indices: new Uint32Array(6) };
    const list = ringsRequestTransfer(request(1, START_X, START_Z, { samples, spare: [ring, other] }));
    const want = new Set<ArrayBufferLike>();
    for (const r of samples) for (const v of Object.values(r)) if (ArrayBuffer.isView(v)) want.add(v.buffer);
    for (const r of [ring, other]) for (const v of Object.values(r)) want.add((v as Float32Array | Uint32Array).buffer);
    expect(want.size).toBe(RING_COUNT * 10 + 8);
    expect(list.length).toBe(want.size);
    for (const buffer of want) expect(list).toContain(buffer);
    expect(ringsRequestTransfer(request(1, START_X, START_Z))).toEqual([]);
    // A ring posted names its own four buffers.
    const posted: { reply: WorldPrepReply; transfer: ArrayBuffer[] }[] = [];
    const server = createRingServer((reply, transfer) => posted.push({ reply, transfer }), () => ({ seed: SEED, variant: VARIANT }));
    server.ask(request(1, START_X, START_Z, { samples: startRings() }));
    server.step();
    const first = posted[0] as { reply: RingReply; transfer: ArrayBuffer[] };
    expect(first.reply.kind).toBe("ring");
    expect(first.transfer).toEqual(ringSentTransfer(first.reply.ring));
    while (server.step()) { /* the rest */ }
    expect(posted[posted.length - 1]?.transfer).toEqual([]);
  });
});

describe("the order of the worker's work", () => {
  /** A rings server of sets of `steps` steps each, and a patch server of `cells` cells, both writing to `log`. */
  function fakes(cells: number) {
    const log: string[] = [];
    let left = 0;
    const rings = {
      get working() { return left > 0; },
      ask(steps: number) { left = steps; },
      step() {
        if (left === 0) return false;
        left--;
        log.push("r");
        return true;
      },
    };
    let cellsLeft = cells;
    const patches = {
      step() {
        if (cellsLeft === 0) return false;
        cellsLeft--;
        log.push("p");
        return true;
      },
    };
    return { log, rings, patches };
  }

  it("a waiting rings set is stepped before any patch cell", () => {
    const { log, rings, patches } = fakes(4);
    const order = createWorkOrder(rings, patches);
    rings.ask(3);
    while (order.step()) { /* all */ }
    expect(log).toEqual(["r", "r", "r", "p", "p", "p", "p"]);
  });

  it("one patch cell falls between two sets of rings that arrive back to back", () => {
    const { log, rings, patches } = fakes(10);
    const order = createWorkOrder(rings, patches);
    const sets = [2, 3, 1, 2];
    rings.ask(sets.shift() as number);
    while (order.step()) {
      // The next set arrives as the last ends, before the worker's next turn.
      if (!rings.working && sets.length > 0) rings.ask(sets.shift() as number);
    }
    expect(log.join("")).toBe("rrprrrprprrppppppp");
  });

  it("with no rings, the patches step as they did", () => {
    const { log, rings, patches } = fakes(3);
    const order = createWorkOrder(rings, patches);
    expect([order.step(), order.step(), order.step(), order.step()]).toEqual([true, true, true, false]);
    expect(log).toEqual(["p", "p", "p"]);
  });
});
