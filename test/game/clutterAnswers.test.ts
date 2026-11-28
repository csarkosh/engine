import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { activeTerrainVariant, type TerrainVariant } from "../../src/sim/terrain.js";
import {
  CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, clutterCell, clutterInCell, type ClutterInstance,
} from "../../src/sim/clutter.js";
import {
  CLUTTER_RADII, clutterCellKey, clutterWindowAt, createClutterCollector,
} from "../../src/game/clutterField.js";
import { clutterFrameInto } from "../../src/game/clutterFrame.js";
import { createClutterLists, type ClutterLists } from "../../src/game/clutterLists.js";
import { cutsFor, seatDriftLogs } from "../../src/game/clutterInstances.js";
import { CLUTTER_STRIP_INTS, type ClutterAnswer } from "../../src/game/clutterWire.js";
import { KEPT_STRIDE } from "../../src/game/instanceLists.js";
import { finish } from "../../src/game/syncJobs.js";
import { timeLimit } from "../../testing/timeLimit.js";

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
  // Further jumps of 300 m, each into ground the collector has not seen, so that its memory passes `COLLECTOR_SWEEP_SIZE`.
  const hops: [number, number][] = [[0, 300], [-300, 0], [0, -300], [300, 300], [-300, 300]];
  hops.forEach(([jx, jz], k) => {
    go(1, jx, jz);
    go(5, k % 2 === 0 ? 3.1 : -2.9, k % 2 === 0 ? 0.7 : 3.2);
  });
  return out;
}

/** What the worker would send for `strips`: each cell looked up and framed as the page would, drift logs unframed. */
function answerFor(strips: Int32Array, order: "server" | "czMajor" = "server"): ClutterAnswer {
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
  if (order === "czMajor") found.sort((p, q) => p.cls - q.cls || p.cz - q.cz || p.cx - q.cx);
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
 * reference's at every step. `fell` says the collector's memory shrank at some rebuild: its sweep ran.
 */
function drive(way: Way, positions: Pos[], keptEqual: boolean): { lists: ClutterLists; ref: ClutterLists; fell: boolean; peak: number } {
  const lists = createClutterLists(SEED, OPTIONS);
  const ref = createClutterLists(SEED, OPTIONS);
  // A second take of the same answer changes nothing: a lists object that took each once keeps as many frames.
  const once = way === "twice" ? createClutterLists(SEED, OPTIONS) : null;
  let pending: { strips: Int32Array } | null = null;
  let fell = false;
  let peak = 0;
  let framedAhead = 0;
  positions.forEach((p, i) => {
    const strips = way === "never" ? new Int32Array(0) : lists.unknown(p.x, p.z, () => false);
    if (way === "before" || way === "twice" || (way === "first ten" && i < 10)) {
      const answer = answerFor(strips);
      const keptBefore = lists.kept;
      expect(finish(lists.take(strips, answer, p.x, p.z))).toBe(true);
      // Every cell asked is fresh and in reach: each framed instance of the answer takes one slot, no other does.
      const framed = answer.framed.reduce((n, f) => n + f, 0);
      expect(lists.kept - keptBefore, `${way}, crossing ${i} frames put`).toBe(framed);
      framedAhead += framed;
      if (once !== null) finish(once.take(strips, answer, p.x, p.z));
      if (way === "twice") {
        expect(finish(lists.take(strips, answer, p.x, p.z))).toBe(true);
        expect(lists.kept, `${way}, crossing ${i} second take`).toBe(keptBefore + framed);
      }
    }
    const before = lists.cells;
    finish(lists.rebuild(p.x, p.z));
    if (lists.cells < before) fell = true;
    peak = Math.max(peak, lists.cells);
    if (once !== null) finish(once.rebuild(p.x, p.z));
    finish(ref.rebuild(p.x, p.z));
    if (way === "late") {
      if (pending !== null) expect(finish(lists.take(pending.strips, answerFor(pending.strips), p.x, p.z))).toBe(true);
      pending = { strips };
    }
    expectDrawnSame(lists, ref, `${way}, crossing ${i}`, keptEqual);
    if (once !== null) {
      expectDrawnSame(lists, once, `${way}, crossing ${i} against one take`, true);
      // Taken before the rebuild, an answer also stores frames for cells the disc's corners and the budget leave unlisted.
      expect(lists.kept).toBeGreaterThanOrEqual(ref.kept);
    }
  });
  if (way === "before" || way === "twice" || way === "first ten") expect(framedAhead).toBeGreaterThan(0);
  return { lists, ref, fell, peak };
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
      const { lists, ref, fell, peak } = drive("before", positions, false);
      expect(lists.kept).toBeGreaterThanOrEqual(ref.kept);
      expect(peak).toBeGreaterThan(0);
      expect(fell, "the sweep ran").toBe(true);
    }, timeLimit(240_000));

    it("draws the same, and keeps as many frames, when the answers come after the page has rebuilt without them", () => {
      const { fell } = drive("late", positions, true);
      expect(fell, "the sweep ran").toBe(true);
    }, timeLimit(240_000));

    it("draws the same, and keeps what one take keeps, when each answer is taken twice", () => {
      const { fell } = drive("twice", positions, false);
      expect(fell, "the sweep ran").toBe(true);
    }, timeLimit(240_000));

    it("draws the same when nothing is ever answered", () => {
      const { fell } = drive("never", positions, true);
      expect(fell, "the sweep ran").toBe(true);
    }, timeLimit(240_000));

    it("draws the same when only the first ten crossings are answered", () => {
      const { fell } = drive("first ten", positions, false);
      expect(fell, "the sweep ran").toBe(true);
    }, timeLimit(240_000));
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
    const lookedBefore = collector.looked;
    const answer = answerFor(strips);
    const given: ClutterInstance[] = [];
    finish(collector.take(strips, answer, 3.2, 0.2, (inst) => given.push(inst)));
    const walked = collector.collect(3.2, 0.2, SCALE);
    const ref = createClutterCollector(SEED).collect(3.2, 0.2, SCALE);
    expect(walked).toEqual(ref);
    expect(given.length).toBeGreaterThan(0);
    // Every cell the collect added was taken from the answer: the page looked up none of them.
    expect(collector.looked).toBe(lookedBefore);
  });
});

describe("an answer that does not fit its strips", () => {
  beforeAll(() => { seatDriftLogs(trunk()); });

  const here = { x: 3.2, z: 0.2 };
  const elsewhere = { x: 0, z: 6.5 };

  /** A collector built at the origin, the strips it would ask at `here` and at `elsewhere`. */
  function warm() {
    const collector = createClutterCollector(SEED);
    collector.collect(0, 0, SCALE);
    const mine = collector.unknown(here.x, here.z, SCALE, () => false);
    const other = collector.unknown(elsewhere.x, elsewhere.z, SCALE, () => false);
    expect(mine.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    return { collector, mine, other };
  }

  const bad: [string, (mine: Int32Array, other: Int32Array) => { strips: Int32Array; answer: ClutterAnswer }][] = [
    ["an answer for other strips", (mine, other) => ({ strips: other, answer: answerFor(mine) })],
    ["a reordered answer (cz first)", (mine) => ({ strips: mine, answer: answerFor(mine, "czMajor") })],
    ["a cells array cut short", (mine) => {
      const answer = answerFor(mine);
      return { strips: mine, answer: { ...answer, cells: answer.cells.subarray(0, answer.cells.length - 1) } };
    }],
    ["a frames array cut short", (mine) => {
      const answer = answerFor(mine);
      return { strips: mine, answer: { ...answer, frames: answer.frames.subarray(0, answer.frames.length - 1) } };
    }],
    ["a values array cut short", (mine) => {
      const answer = answerFor(mine);
      return { strips: mine, answer: { ...answer, values: answer.values.subarray(0, answer.values.length - 1) } };
    }],
    ["a framed array cut short", (mine) => {
      const answer = answerFor(mine);
      return { strips: mine, answer: { ...answer, framed: answer.framed.subarray(0, answer.framed.length - 1) } };
    }],
  ];

  for (const [name, make] of bad) {
    it(`${name} is dropped whole: nothing remembered, found never told, false`, () => {
      const { collector, mine, other } = warm();
      const { strips, answer } = make(mine, other);
      expect(answer.cells.length).toBeGreaterThan(0);
      const size = collector.size;
      let told = 0;
      expect(finish(collector.take(strips, answer, here.x, here.z, () => { told++; }))).toBe(false);
      expect(collector.size).toBe(size);
      expect(told).toBe(0);
    });

    it(`${name} leaves the next rebuild drawing exactly what the reference draws`, () => {
      const lists = createClutterLists(SEED, OPTIONS);
      const ref = createClutterLists(SEED, OPTIONS);
      finish(lists.rebuild(0, 0));
      finish(ref.rebuild(0, 0));
      const mine = lists.unknown(here.x, here.z, () => false);
      const other = lists.unknown(elsewhere.x, elsewhere.z, () => false);
      const { strips, answer } = make(mine, other);
      const cells = lists.cells;
      const kept = lists.kept;
      expect(finish(lists.take(strips, answer, here.x, here.z))).toBe(false);
      expect(lists.cells).toBe(cells);
      expect(lists.kept).toBe(kept);
      finish(lists.rebuild(here.x, here.z));
      finish(ref.rebuild(here.x, here.z));
      expectDrawnSame(lists, ref, name, true);
    });
  }

  it("an answer that fits, with no instances for strips that hold none, is taken", () => {
    const { collector } = warm();
    expect(finish(collector.take(new Int32Array(0), answerFor(new Int32Array(0)), here.x, here.z))).toBe(true);
  });
});

describe("the frames an answer carries", () => {
  beforeAll(() => { seatDriftLogs(trunk()); });

  it("are the lists' own: a rebuild computes none for an instance that arrived framed, only the drift logs'", () => {
    const lists = createClutterLists(SEED, OPTIONS);
    const ref = createClutterLists(SEED, OPTIONS);
    // The first window is answered whole too, so that nothing of it waits for a frame of the page's own.
    const first: number[] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const w = clutterWindowAt(cls, 0, 0, SCALE);
      first.push(cls, w.x0, w.x1, w.z0, w.z1);
    }
    const all = Int32Array.from(first);
    expect(finish(lists.take(all, answerFor(all), 0, 0))).toBe(true);
    let logs = 0;
    const countLogs = (): number => lists.all.reduce((n, bucket) => n + (bucket.cls === CLUTTER_DRIFTLOG ? bucket.list.count : 0), 0);
    const positions: Pos[] = [{ x: 0, z: 0 }];
    for (let i = 1; i <= 14; i++) positions.push({ x: i * 3.1, z: i < 8 ? 0.3 * i : i * 3.1 - 21 });
    positions.forEach((p, i) => {
      const strips = lists.unknown(p.x, p.z, () => false);
      expect(finish(lists.take(strips, answerFor(strips), p.x, p.z))).toBe(true);
      finish(lists.rebuild(p.x, p.z));
      finish(ref.rebuild(p.x, p.z));
      logs += countLogs();
      expectDrawnSame(lists, ref, `ahead, crossing ${i}`, false);
    });
    expect(lists.framedHere, "frames computed by the page").toBeLessThanOrEqual(logs);
    expect(ref.framedHere, "frames the unanswered reference computes").toBeGreaterThan(logs + 1000);
  }, timeLimit(120_000));

  it("are taken once: the same answer again, and one taken 1,000 m away, change nothing", () => {
    const lists = createClutterLists(SEED, OPTIONS);
    finish(lists.rebuild(0, 0));
    const strips = lists.unknown(3.2, 0.2, () => false);
    const answer = answerFor(strips);
    const framed = answer.framed.reduce((n, f) => n + f, 0);
    expect(framed).toBeGreaterThan(0);
    const kept = lists.kept;
    const cells = lists.cells;
    expect(finish(lists.take(strips, answer, 1003.2, 0.2))).toBe(true);
    expect(lists.kept).toBe(kept);
    expect(lists.cells).toBe(cells);
    expect(finish(lists.take(strips, answer, 3.2, 0.2))).toBe(true);
    expect(lists.kept).toBe(kept + framed);
    const cellsAfter = lists.cells;
    expect(finish(lists.take(strips, answer, 3.2, 0.2))).toBe(true);
    expect(lists.kept).toBe(kept + framed);
    expect(lists.cells).toBe(cellsAfter);
  });
});

describe("unknown leaves out cells that are out of reach", () => {
  beforeAll(() => { seatDriftLogs(trunk()); });

  it("at the full radius every cell of its strips is within the forgetting distance, and it is empty after taking them", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(0, 0, 1);
    const place = { x: 3.2, z: 0.2 };
    const strips = collector.unknown(place.x, place.z, 1, () => false);
    expect(strips.length).toBeGreaterThan(0);
    let corners = 0;
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      // What `unknown` would hold if it ignored reach: the window's new cells, against what it holds.
      const now = clutterWindowAt(cls, place.x, place.z, 1);
      const old = clutterWindowAt(cls, 0, 0, 1);
      const cell = clutterCell(cls);
      const ax = Math.floor(place.x / cell) * cell;
      const az = Math.floor(place.z / cell) * cell;
      const far = CLUTTER_RADII[cls] as number + 8 * cell;
      const reach = (cx: number, cz: number): number => Math.hypot(
        Math.max(cx * cell - ax, 0, ax - (cx + 1) * cell), Math.max(cz * cell - az, 0, az - (cz + 1) * cell),
      ) - far;
      for (let cx = now.x0; cx <= now.x1; cx++) {
        for (let cz = now.z0; cz <= now.z1; cz++) {
          if (cx >= old.x0 && cx <= old.x1 && cz >= old.z0 && cz <= old.z1) continue;
          if (reach(cx, cz) >= 0) corners++;
        }
      }
      for (const key of expand(strips)) {
        const [c, cx, cz] = key.split(",").map(Number) as [number, number, number];
        if (c === cls) expect(reach(cx, cz), `${key} within reach`).toBeLessThan(0);
      }
    }
    // The cells the page would look up that no answer is asked for: the leading corners of the meadow and its like.
    expect(corners).toBeGreaterThan(0);
    finish(collector.take(strips, answerFor(strips), place.x, place.z));
    expect(collector.unknown(place.x, place.z, 1, () => false).length).toBe(0);
  });
});
