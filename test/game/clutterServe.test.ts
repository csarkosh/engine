import { describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import {
  CLUTTER_BOULDER, CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_ROCK, clutterInCell, clutterInRect, type ClutterInstance,
} from "../../src/sim/clutter.js";
import { activeTerrainVariantName } from "../../src/sim/terrain.js";
import { clutterFrameInto } from "../../src/game/clutterFrame.js";
import { createClutterLists } from "../../src/game/clutterLists.js";
import { CLUTTER_SERVE_CELLS, createClutterServer } from "../../src/game/clutterServe.js";
import { CLUTTER_STRIP_INTS, instanceAt, stripCells, type WorldClutterRequest } from "../../src/game/clutterWire.js";
import { FOLIAGE_BY_CLASS } from "../../src/game/clutterInstances.js";
import { KEPT_FOLIAGE, KEPT_STRIDE } from "../../src/game/instanceLists.js";
import { finish } from "../../src/game/syncJobs.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

/**
 * The world's worker's server for the clutter: strips of cells asked, each cell looked up and framed as the page
 * would, one answer a request with its arrays transferred.
 */

registerOlympic(null);

const SEED = 1;
const VARIANT = activeTerrainVariantName();
type Posted = { reply: WorldPrepReply; transfer: ArrayBuffer[] };
type Cells = Extract<WorldPrepReply, { kind: "clutterCells" }>;

function strips(...list: [cls: number, x0: number, x1: number, z0: number, z1: number][]): Int32Array {
  return Int32Array.from(list.flat());
}

function request(id: number, over: Int32Array, extra: Partial<WorldClutterRequest> = {}): WorldClutterRequest {
  return { id, kind: "clutter", seed: SEED, variant: VARIANT, set: id * 10, strips: over, ...extra };
}

function collect(madeFor: () => { seed: number; variant: string } | null = () => ({ seed: SEED, variant: VARIANT })) {
  const posted: Posted[] = [];
  const server = createClutterServer((reply, transfer) => posted.push({ reply, transfer }), madeFor);
  const run = (): number => { let steps = 0; while (server.step()) steps++; return steps; };
  return { posted, server, run };
}

/** What the page would look up: the instances of the strips in the answer's order, with their cells. */
function expected(list: Int32Array): { cls: number; cx: number; cz: number; inst: ClutterInstance }[] {
  const out: { cls: number; cx: number; cz: number; inst: ClutterInstance }[] = [];
  for (let s = 0; s < list.length; s += CLUTTER_STRIP_INTS) {
    const [cls, x0, x1, z0, z1] = [list[s], list[s + 1], list[s + 2], list[s + 3], list[s + 4]] as number[] as [number, number, number, number, number];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const inst = clutterInCell(SEED, cls, cx, cz);
        if (inst !== null) out.push({ cls, cx, cz, inst });
      }
    }
  }
  return out;
}

const SEVERAL = strips(
  [CLUTTER_GRASS, -20, 20, -20, 20],
  [CLUTTER_MEADOW, -15, 10, -12, 18],
  [CLUTTER_ROCK, -10, 10, -10, 10],
  [CLUTTER_DRIFTLOG, -40, 40, -40, 40],
  [CLUTTER_BOULDER, -5, 5, -5, 5],
);

describe("the world's worker serving the clutter's cells", () => {
  it("names exactly the cells the page's lookup finds, field for field, in strip then cx then cz order", () => {
    expect(FOLIAGE_BY_CLASS.has(CLUTTER_GRASS) || FOLIAGE_BY_CLASS.has(CLUTTER_MEADOW)).toBe(true);
    const want = expected(SEVERAL);
    expect(new Set(want.map((w) => w.cls)).size).toBeGreaterThanOrEqual(4);
    const { posted, server, run } = collect();
    server.ask(request(1, SEVERAL));
    run();
    expect(posted.length).toBe(1);
    const reply = posted[0]?.reply as Cells;
    expect(reply).toMatchObject({ id: 1, kind: "clutterCells", set: 10 });
    expect(reply.cells.length).toBe(want.length * 3);
    want.forEach((w, i) => {
      expect([reply.cells[i * 3], reply.cells[i * 3 + 1], reply.cells[i * 3 + 2]]).toEqual([w.cls, w.cx, w.cz]);
      const got = instanceAt(reply, i);
      for (const key of Object.keys(w.inst) as (keyof ClutterInstance)[]) expect(Object.is(got[key], w.inst[key]), `${i}.${key}`).toBe(true);
    });
    expect(posted[0]?.transfer).toEqual([reply.cells.buffer, reply.values.buffer, reply.frames.buffer, reply.framed.buffer]);
  });

  it("frames every instance but a drift log's as clutterFrameInto does, and leaves a drift log's zeros", () => {
    const { posted, server, run } = collect();
    server.ask(request(1, SEVERAL));
    run();
    const reply = posted[0]?.reply as Cells;
    const count = reply.cells.length / 3;
    expect(reply.frames.length).toBe(count * KEPT_STRIDE);
    expect(reply.framed.length).toBe(count);
    let logs = 0;
    let framed = 0;
    const want = new Float32Array(KEPT_STRIDE);
    for (let i = 0; i < count; i++) {
      const slice = reply.frames.subarray(i * KEPT_STRIDE, (i + 1) * KEPT_STRIDE);
      if (reply.cells[i * 3] === CLUTTER_DRIFTLOG) {
        logs++;
        expect(reply.framed[i]).toBe(0);
        expect(slice.every((f) => f === 0)).toBe(true);
        continue;
      }
      framed++;
      expect(reply.framed[i]).toBe(1);
      want.fill(0);
      clutterFrameInto(SEED, instanceAt(reply, i), want, 0);
      expect(Array.from(slice).map((f) => Object.is(f, -0) ? "-0" : f)).toEqual(Array.from(want).map((f) => Object.is(f, -0) ? "-0" : f));
    }
    expect(logs).toBeGreaterThan(0);
    expect(framed).toBeGreaterThan(0);
  });

  it("a strip with nothing in it, and a request with no strips, are each answered once with no instances", () => {
    // A cell range the class never fills: one with a single cell that holds nothing.
    let empty: [number, number] | null = null;
    for (let cx = 0; cx < 200 && empty === null; cx++) if (clutterInCell(SEED, CLUTTER_BOULDER, cx, 0) === null) empty = [cx, 0];
    expect(empty).not.toBeNull();
    const [ex, ez] = empty as [number, number];
    const { posted, server, run } = collect();
    server.ask(request(1, strips([CLUTTER_BOULDER, ex, ex, ez, ez])));
    server.ask(request(2, new Int32Array(0)));
    run();
    expect(posted.map((p) => p.reply.kind)).toEqual(["clutterCells", "clutterCells"]);
    for (const p of posted) {
      const reply = p.reply as Cells;
      expect([reply.cells.length, reply.values.length, reply.frames.length, reply.framed.length]).toEqual([0, 0, 0, 0]);
    }
    expect(posted.map((p) => p.reply.id)).toEqual([1, 2]);
    expect(server.working).toBe(false);
  });

  it("a request for another seed or variant is one failed, and later requests are still served", () => {
    const { posted, server, run } = collect();
    server.ask(request(1, SEVERAL, { seed: SEED + 1 }));
    server.ask(request(2, SEVERAL, { variant: "no-such-terrain" }));
    server.ask(request(3, strips([CLUTTER_ROCK, 0, 3, 0, 3])));
    run();
    expect(posted.map((p) => [p.reply.id, p.reply.kind])).toEqual([[1, "failed"], [2, "failed"], [3, "clutterCells"]]);
    const none = collect(() => null);
    none.server.ask(request(4, SEVERAL));
    none.run();
    expect(none.posted.map((p) => p.reply.kind)).toEqual(["failed"]);
  });

  it("a request of 2,000 cells takes at least 8 steps, posts nothing until the last, and is working between", () => {
    const big = strips([CLUTTER_ROCK, 0, 49, 0, 39]);
    expect(stripCells(big)).toBe(2000);
    const { posted, server } = collect();
    server.ask(request(1, big));
    expect(server.working).toBe(true);
    let steps = 0;
    while (posted.length === 0) {
      expect(server.working).toBe(true);
      expect(server.step()).toBe(true);
      steps++;
      if (posted.length === 0) expect(server.working).toBe(true);
    }
    expect(steps).toBeGreaterThanOrEqual(8);
    expect(steps).toBe(Math.ceil(2000 / CLUTTER_SERVE_CELLS));
    expect(server.working).toBe(false);
    expect(server.step()).toBe(false);
    expect(posted.length).toBe(1);
    expect((posted[0]?.reply as Cells).cells.length / 3).toBe(expected(big).length);
  });

  it("a post that throws for an answer is one failed for that request, and the next request is still served", () => {
    const posted: WorldPrepReply[] = [];
    let throwing = true;
    const server = createClutterServer((reply) => {
      if (throwing && reply.kind === "clutterCells") { throwing = false; throw new Error("cannot be cloned"); }
      posted.push(reply);
    }, () => ({ seed: SEED, variant: VARIANT }));
    const b = strips([CLUTTER_ROCK, -9, 9, -9, 9]);
    server.ask(request(1, strips([CLUTTER_GRASS, -6, 6, -6, 6])));
    server.ask(request(2, b));
    while (server.step()) { /* served */ }
    expect(posted.map((r) => [r.id, r.kind])).toEqual([[1, "failed"], [2, "clutterCells"]]);
    expect((posted[1] as Cells).cells.length / 3).toBe(expected(b).length);
    expect(server.working).toBe(false);
  });

  it("a post that throws for the failed too is swallowed, and the next request is still served", () => {
    const posted: WorldPrepReply[] = [];
    let calls = 0;
    const server = createClutterServer((reply) => {
      if (calls++ < 2) throw new Error("cannot be cloned");
      posted.push(reply);
    }, () => ({ seed: SEED, variant: VARIANT }));
    server.ask(request(1, strips([CLUTTER_ROCK, 0, 3, 0, 3])));
    server.ask(request(2, strips([CLUTTER_ROCK, 0, 3, 0, 3])));
    while (server.step()) { /* served */ }
    expect(posted.map((r) => [r.id, r.kind])).toEqual([[2, "clutterCells"]]);
    expect(server.working).toBe(false);
  });

  it("an instance whose hash a float cannot hold comes through the server's packing to the bit", () => {
    const wide = strips([CLUTTER_GRASS, -30, 30, -30, 30]);
    const hit = expected(wide).filter((w) => Math.fround(w.inst.hash) !== w.inst.hash);
    expect(hit.length).toBeGreaterThan(0);
    const { posted, server, run } = collect();
    server.ask(request(1, wide));
    run();
    const reply = posted[0]?.reply as Cells;
    const all = expected(wide);
    all.forEach((w, i) => { expect(Object.is(instanceAt(reply, i).hash, w.inst.hash)).toBe(true); });
  });

  it("two requests asked back to back are both answered, in the order asked", () => {
    const a = strips([CLUTTER_GRASS, -6, 6, -6, 6]);
    const b = strips([CLUTTER_ROCK, -9, 9, -9, 9], [CLUTTER_MEADOW, 0, 5, 0, 5]);
    const { posted, server, run } = collect();
    server.ask(request(1, a));
    server.ask(request(2, b));
    run();
    expect(posted.map((p) => [p.reply.id, p.reply.kind])).toEqual([[1, "clutterCells"], [2, "clutterCells"]]);
    expect((posted[0]?.reply as Cells).cells.length / 3).toBe(expected(a).length);
    expect((posted[1]?.reply as Cells).cells.length / 3).toBe(expected(b).length);
  });
});

describe("the page's lists frame an instance with clutterFrameInto", () => {
  it("the matrices and tints the lists stage are what clutterFrameInto writes for the instance at that spot", () => {
    const rows = Array.from({ length: CLUTTER_CLASS_COUNT }, () => 64);
    const lists = createClutterLists(SEED, { radiusScale: 0.3, nearBlades: false, cull: false, rows });
    finish(lists.rebuild(0, 0));
    expect(lists.kept).toBeGreaterThan(0);
    const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
      for (let k = 0; k < a.length; k++) if (!Object.is(a[k], b[k])) return false;
      return a.length === b.length;
    };
    const want = new Float32Array(KEPT_STRIDE);
    let checked = 0;
    let tinted = 0;
    for (const bucket of lists.all) {
      const { list } = bucket;
      for (let i = 0; i < Math.min(list.count, 6); i++) {
        const matrix = list.buf.subarray(i * 16, i * 16 + 16);
        const [px, pz] = [matrix[12] as number, matrix[14] as number];
        const near = clutterInRect(SEED, bucket.cls, px - 1, pz - 1, px + 1, pz + 1)
          .sort((p, q) => Math.hypot(p.x - px, p.z - pz) - Math.hypot(q.x - px, q.z - pz))[0];
        expect(near, `an instance of class ${bucket.cls} near ${px}, ${pz}`).toBeDefined();
        want.fill(0);
        clutterFrameInto(SEED, near as ClutterInstance, want, 0);
        expect(same(matrix, want.subarray(0, 16)), `class ${bucket.cls} matrix ${i}`).toBe(true);
        if (list.streams.foliage) {
          expect(same(list.foliage.subarray(i * 4, i * 4 + 4), want.subarray(KEPT_FOLIAGE, KEPT_STRIDE)), `class ${bucket.cls} tint ${i}`).toBe(true);
          tinted++;
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(tinted).toBeGreaterThan(0);
  });
});
