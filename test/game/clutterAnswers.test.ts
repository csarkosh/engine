import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { activeTerrainVariant, type TerrainVariant } from "../../src/sim/terrain.js";
import {
  CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, clutterInCell, type ClutterInstance,
} from "../../src/sim/clutter.js";
import {
  clutterCellKey, clutterWindowAt, createClutterCollector,
} from "../../src/game/clutterField.js";
import { clutterFrameInto } from "../../src/game/clutterFrame.js";
import { createClutterLists, type ClutterLists } from "../../src/game/clutterLists.js";
import { cutsFor, seatDriftLogs } from "../../src/game/clutterInstances.js";
import { CLUTTER_STRIP_INTS, type ClutterAnswer } from "../../src/game/clutterWire.js";
import { KEPT_STRIDE } from "../../src/game/instanceLists.js";
import { finish } from "../../src/game/syncJobs.js";

/**
 * The page's memory taking the worker's answers. Whatever it is answered, whenever, in whatever order, or never, what
 * is drawn and what is kept are what a lists object never answered makes of the same path, to the bit: the reference
 * here is a second `createClutterLists` of the same seed and options driven along the same path with no answers.
 */

const SEED = 1;
const SCALE = 0.6;
const OPTIONS = { radiusScale: SCALE, nearBlades: true, cull: false, rows: Array.from({ length: CLUTTER_CLASS_COUNT }, (_, cls) => 4 * cutsFor(cls)) };

/** A tilted trunk along local X, as `seatDriftLogs` measures: not the default seat. */
function trunk(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 24; i++) {
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const x = (i / 24) * 3.2;
      out.push(x, 0.31 + 0.14 * x + 0.37 * Math.sin(t), 0.37 * Math.cos(t));
    }
  }
  return out;
}

registerOlympic(null);

/** A place's hook that keeps every class off a band of ground, as a game's overlay may (`clutterStands`). */
const PLACE: TerrainVariant["clutterStands"] = (_seed, _cls, x) => Math.abs(x - 30) > 5;

type Pos = { x: number; z: number };

/** The camera's path: crossings of the clutter's grid, along an axis and across it, one jump of 300 m. */
function path(): Pos[] {
  const out: Pos[] = [{ x: 0, z: 0 }];
  const go = (n: number, dx: number, dz: number): void => {
    for (let i = 0; i < n; i++) {
      const last = out[out.length - 1] as Pos;
      out.push({ x: last.x + dx, z: last.z + dz });
    }
  };
  go(12, 3.2, 0.2);
  go(6, 0.4, 3.1);
  go(8, 3.1, 3.1);
  go(6, -3.3, 1.2);
  go(1, 300, 0);
  go(8, -3.1, -3.1);
  go(4, 3.05, -0.5);
  return out;
}

/** What the worker would send for `strips`: each cell looked up and framed as the page would, drift logs unframed. */
function answerFor(strips: Int32Array): ClutterAnswer {
  const found: { cls: number; cx: number; cz: number; inst: ClutterInstance }[] = [];
  for (let s = 0; s < strips.length; s += CLUTTER_STRIP_INTS) {
    const [cls, x0, x1, z0, z1] = Array.from(strips.subarray(s, s + CLUTTER_STRIP_INTS)) as [number, number, number, number, number];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const inst = clutterInCell(SEED, cls, cx, cz);
        if (inst !== null) found.push({ cls, cx, cz, inst });
      }
    }
  }
  const cells = new Int32Array(found.length * 3);
  const values = new Float64Array(found.length * 8);
  const frames = new Float32Array(found.length * KEPT_STRIDE);
  const framed = new Uint8Array(found.length);
  found.forEach(({ cls, cx, cz, inst }, i) => {
    cells.set([cls, cx, cz], i * 3);
    values.set([inst.x, inst.z, inst.groundH, inst.groundDx, inst.groundDz, inst.scale, inst.variant, inst.hash], i * 8);
    if (cls !== CLUTTER_DRIFTLOG) {
      clutterFrameInto(SEED, inst, frames, i * KEPT_STRIDE);
      framed[i] = 1;
    }
  });
  return { set: 1, cells, values, frames, framed, ms: 0 };
}

/** Every `[cls, cx, cz]` of `strips`, as a list. */
function expand(strips: Int32Array): string[] {
  const out: string[] = [];
  for (let s = 0; s < strips.length; s += CLUTTER_STRIP_INTS) {
    const [cls, x0, x1, z0, z1] = Array.from(strips.subarray(s, s + CLUTTER_STRIP_INTS)) as [number, number, number, number, number];
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) out.push(`${cls},${cx},${cz}`);
  }
  return out;
}

function same(a: Float32Array, b: Float32Array, what: string): void {
  expect(a.length, `${what} length`).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) expect.fail(`${what}[${i}]: ${a[i]} against ${b[i]}`);
  }
}

/** Every bucket's count and floats, committed and staged, equal to the reference's, and the store as large. */
function expectDrawnSame(lists: ClutterLists, ref: ClutterLists, at: string, kept: boolean): void {
  expect(lists.all.length).toBe(ref.all.length);
  lists.all.forEach((bucket, b) => {
    const other = (ref.all[b] as (typeof ref.all)[number]).list;
    const { list } = bucket;
    const tag = `${at} bucket ${b} (class ${bucket.cls})`;
    expect(list.count, `${tag} count`).toBe(other.count);
    expect(list.stagedCount, `${tag} staged count`).toBe(other.stagedCount);
    const n = list.count;
    same(list.buf.subarray(0, n * 16), other.buf.subarray(0, n * 16), `${tag} buf`);
    same(list.bands.subarray(0, n * 4 * (list.streams.bands ? 1 : 0)), other.bands.subarray(0, n * 4 * (list.streams.bands ? 1 : 0)), `${tag} bands`);
    same(list.foliage.subarray(0, n * 4 * (list.streams.foliage ? 1 : 0)), other.foliage.subarray(0, n * 4 * (list.streams.foliage ? 1 : 0)), `${tag} foliage`);
    same(list.staged.buf.subarray(0, n * 16), other.staged.buf.subarray(0, n * 16), `${tag} staged buf`);
    same(list.staged.bands.subarray(0, n * 4 * (list.streams.bands ? 1 : 0)), other.staged.bands.subarray(0, n * 4 * (list.streams.bands ? 1 : 0)), `${tag} staged bands`);
    same(list.staged.foliage.subarray(0, n * 4 * (list.streams.foliage ? 1 : 0)), other.staged.foliage.subarray(0, n * 4 * (list.streams.foliage ? 1 : 0)), `${tag} staged foliage`);
  });
  if (kept) expect(lists.kept, `${at} kept`).toBe(ref.kept);
}

type Way = "before" | "late" | "twice" | "never" | "first ten";

/**
 * Drives a lists object along `positions`, answering each crossing's unknown strips the way `way` says, and the
 * reference with none, comparing after every rebuild. `keptEqual` says whether the store's size is held to the
 * reference's at every step.
 */
function drive(way: Way, positions: Pos[], keptEqual: boolean): { lists: ClutterLists; ref: ClutterLists } {
  const lists = createClutterLists(SEED, OPTIONS);
  const ref = createClutterLists(SEED, OPTIONS);
  // A second take of the same answer changes nothing: a lists object that took each once keeps as many frames.
  const once = way === "twice" ? createClutterLists(SEED, OPTIONS) : null;
  let pending: { strips: Int32Array } | null = null;
  positions.forEach((p, i) => {
    const strips = way === "never" ? new Int32Array(0) : lists.unknown(p.x, p.z, () => false);
    if (way === "before" || way === "twice" || (way === "first ten" && i < 10)) {
      const answer = answerFor(strips);
      finish(lists.take(strips, answer, p.x, p.z));
      if (once !== null) finish(once.take(strips, answer, p.x, p.z));
      if (way === "twice") finish(lists.take(strips, answer, p.x, p.z));
    }
    finish(lists.rebuild(p.x, p.z));
    if (once !== null) finish(once.rebuild(p.x, p.z));
    finish(ref.rebuild(p.x, p.z));
    if (way === "late") {
      if (pending !== null) finish(lists.take(pending.strips, answerFor(pending.strips), p.x, p.z));
      pending = { strips };
    }
    expectDrawnSame(lists, ref, `${way}, crossing ${i}`, keptEqual);
    if (once !== null) {
      expectDrawnSame(lists, once, `${way}, crossing ${i} against one take`, true);
      // Taken before the rebuild, an answer also stores frames for cells the disc's corners and the budget leave unlisted.
      expect(lists.kept).toBeGreaterThanOrEqual(ref.kept);
    }
  });
  return { lists, ref };
}

function drivenOn(name: string, place: TerrainVariant["clutterStands"]): void {
  describe(name, () => {
    const positions = path();
    const variant = activeTerrainVariant();
    const before = variant.clutterStands;
    beforeAll(() => {
      variant.clutterStands = place;
      seatDriftLogs(trunk());
    });
    afterAll(() => { variant.clutterStands = before; });

    it("the path crosses the grid at least thirty times, diagonally too, and jumps 300 m", () => {
      expect(positions.length).toBeGreaterThanOrEqual(30);
      const steps = positions.slice(1).map((p, i) => Math.hypot(p.x - (positions[i] as Pos).x, p.z - (positions[i] as Pos).z));
      expect(Math.max(...steps)).toBeGreaterThanOrEqual(300);
      expect(positions.slice(1).some((p, i) => p.x !== (positions[i] as Pos).x && p.z !== (positions[i] as Pos).z)).toBe(true);
    });

    it("draws the same when each crossing's unknown cells are answered and taken before the rebuild", () => {
      const { lists, ref } = drive("before", positions, false);
      expect(lists.kept).toBeGreaterThanOrEqual(ref.kept);
    });

    it("draws the same, and keeps as many frames, when the answers come after the page has rebuilt without them", () => {
      drive("late", positions, true);
    });

    it("draws the same, and keeps what one take keeps, when each answer is taken twice", () => {
      drive("twice", positions, false);
    });

    it("draws the same when nothing is ever answered", () => {
      drive("never", positions, true);
    });

    it("draws the same when only the first ten crossings are answered", () => {
      drive("first ten", positions, false);
    });
  });
}

drivenOn("on the plain coast", undefined);
drivenOn("on a coast with a place that keeps ground clear", PLACE);

describe("the collector's unknown and take", () => {
  beforeAll(() => { seatDriftLogs(trunk()); });

  it("names every lacking, un-asked cell outside the held window in exactly one strip, and no other", () => {
    const collector = createClutterCollector(SEED);
    const seen: Set<string>[] = Array.from({ length: CLUTTER_CLASS_COUNT }, () => new Set());
    const marks: Pos[] = [{ x: 0, z: 0 }, { x: 3.2, z: 0.2 }, { x: 6.4, z: 3.3 }, { x: 3.3, z: 6.4 }, { x: 0, z: 0 }, { x: 1.5, z: 1.5 }, { x: 5, z: 5 }, { x: 300, z: 0 }, { x: 303, z: 3 }];
    const asked = (key: number): boolean => key % 3 === 0;
    let held: Pos | null = null;
    let nonEmpty = 0;
    for (const p of marks) {
      const strips = collector.unknown(p.x, p.z, SCALE, asked);
      expect(strips.length % CLUTTER_STRIP_INTS).toBe(0);
      const got = expand(strips);
      expect(new Set(got).size, "no cell in two strips").toBe(got.length);
      const want: string[] = [];
      if (held !== null) {
        for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
          const now = clutterWindowAt(cls, p.x, p.z, SCALE);
          const old = clutterWindowAt(cls, held.x, held.z, SCALE);
          const overlaps = now.x0 <= old.x1 && now.x1 >= old.x0 && now.z0 <= old.z1 && now.z1 >= old.z0;
          if (!overlaps) continue;
          for (let cx = now.x0; cx <= now.x1; cx++) {
            for (let cz = now.z0; cz <= now.z1; cz++) {
              const inHeld = cx >= old.x0 && cx <= old.x1 && cz >= old.z0 && cz <= old.z1;
              if (inHeld || (seen[cls] as Set<string>).has(`${cx},${cz}`) || asked(clutterCellKey(cls, cx, cz))) continue;
              want.push(`${cls},${cx},${cz}`);
            }
          }
        }
      }
      expect([...got].sort()).toEqual(want.sort());
      if (want.length > 0) nonEmpty++;
      collector.collect(p.x, p.z, SCALE);
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        const w = clutterWindowAt(cls, p.x, p.z, SCALE);
        for (let cx = w.x0; cx <= w.x1; cx++) for (let cz = w.z0; cz <= w.z1; cz++) (seen[cls] as Set<string>).add(`${cx},${cz}`);
      }
      held = p;
    }
    expect(nonEmpty).toBeGreaterThanOrEqual(3);
  });

  it("is empty before any window is built, and with every cell asked", () => {
    const collector = createClutterCollector(SEED);
    expect(collector.unknown(0, 0, SCALE, () => false).length).toBe(0);
    collector.collect(0, 0, SCALE);
    expect(collector.unknown(3.2, 0.2, SCALE, () => true).length).toBe(0);
    expect(collector.unknown(3.2, 0.2, SCALE, () => false).length).toBeGreaterThan(0);
  });

  it("is empty right after a take of its own strips, and the collect then looks up nothing itself", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(0, 0, SCALE);
    const strips = collector.unknown(3.2, 0.2, SCALE, () => false);
    expect(strips.length).toBeGreaterThan(0);
    const looked = collector.looked;
    const size = collector.size;
    finish(collector.take(strips, answerFor(strips), 3.2, 0.2));
    expect(collector.size).toBeGreaterThan(size);
    expect(collector.unknown(3.2, 0.2, SCALE, () => false).length).toBe(0);
    collector.collect(3.2, 0.2, SCALE);
    expect(collector.looked, "no cell an answer was taken for is looked up by the page").toBe(looked);
  });

  it("remembers nothing of an answer taken 1,000 m from its strips", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(0, 0, SCALE);
    const strips = collector.unknown(3.2, 0.2, SCALE, () => false);
    const size = collector.size;
    const told: number[] = [];
    finish(collector.take(strips, answerFor(strips), 1003.2, 0.2, (_inst, i) => told.push(i)));
    expect(collector.size).toBe(size);
    expect(told).toEqual([]);
  });

  it("skips a cell the page remembers, and tells found only of cells newly remembered, with their index in the answer", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(0, 0, SCALE);
    const strips = collector.unknown(3.2, 0.2, SCALE, () => false);
    const answer = answerFor(strips);
    const told: number[] = [];
    finish(collector.take(strips, answer, 3.2, 0.2, (_inst, i) => told.push(i)));
    expect(told.length).toBe(answer.framed.length);
    expect(told).toEqual(Array.from(told.keys()));
    const size = collector.size;
    finish(collector.take(strips, answer, 3.2, 0.2, (_inst, i) => told.push(i + 100000)));
    expect(collector.size).toBe(size);
    expect(told.every((i) => i < 100000)).toBe(true);
  });

  it("remembers an instance as the answer's, field for field, and a cell the answer leaves out as nothing", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(0, 0, SCALE);
    const strips = collector.unknown(3.2, 0.2, SCALE, () => false);
    const answer = answerFor(strips);
    const given: ClutterInstance[] = [];
    finish(collector.take(strips, answer, 3.2, 0.2, (inst) => given.push(inst)));
    const walked = collector.collect(3.2, 0.2, SCALE);
    const ref = createClutterCollector(SEED).collect(3.2, 0.2, SCALE);
    expect(walked).toEqual(ref);
    expect(given.length).toBeGreaterThan(0);
    expect(collector.looked).toBeGreaterThan(0);
  });
});
