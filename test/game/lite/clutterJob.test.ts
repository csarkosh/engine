import { describe, expect, it } from "vitest";
import { CLUTTER_STRIP_INTS, clutterCellKey, type ClutterAnswer } from "../../../src/game/clutterWire.js";
import { CLUTTER_WAIT_MS, askAhead, askThenRebuild, fillThenAskAhead, type ClutterAsking } from "../../../src/game/lite/clutterJob.js";
import { createRebuilds, cellOrigin } from "../../../src/game/lite/rebuildJobs.js";
import { SLICE_WAITS, createSyncJobs, type Slices } from "../../../src/game/syncJobs.js";

/** The cells a place needs: three in a row, from `x * 10` (the place is `x` cells along). */
const needed = (x: number): number[] => [x * 10, x * 10 + 1, x * 10 + 2];
const keyOf = (cx: number): number => clutterCellKey(0, cx, 0);
const stripsOf = (cells: number[]): Int32Array => Int32Array.from(cells.flatMap((cx) => [0, cx, cx, 0, 0]));

/** A stand-in for the worker's client, the page's memory and the lists' rebuild, on a clock the test moves. */
function world() {
  const clock = { now: 0 };
  const known = new Set<number>();
  const asked = new Set<number>();
  const posted: { set: number; cells: number[] }[] = [];
  const waiting: { strips: Int32Array; answer: ClutterAnswer }[] = [];
  const strips = new Map<number, Int32Array>();
  const state = { last: 0, through: 0, failed: false, disposed: false, out: 0 };
  const lookedHere: number[] = [];
  const shown: number[] = [];
  const waited: number[] = [];
  const filledSets: number[] = [];
  const takeOpts = { yields: 0, refuse: false, cost: 0 };
  const work: ClutterAsking["work"] = {
    ask(s) {
      if (state.failed || s.length < CLUTTER_STRIP_INTS || state.out >= 2) return 0;
      const set = ++state.last;
      state.out++;
      const cells: number[] = [];
      for (let i = 0; i < s.length; i += CLUTTER_STRIP_INTS) {
        cells.push(s[i + 1] as number);
        asked.add(keyOf(s[i + 1] as number));
      }
      posted.push({ set, cells });
      strips.set(set, s.slice());
      return set;
    },
    asked: (key) => asked.has(key),
    get last() {
      return state.last;
    },
    get through() {
      return state.failed ? state.last : state.through;
    },
    take: () => waiting.shift() ?? null,
    filled(set) {
      filledSets.push(set);
      for (const c of posted.find((p) => p.set === set)?.cells ?? []) asked.delete(keyOf(c));
    },
    get failed() {
      return state.failed;
    },
  };
  const unknown = (x: number, _z: number, isAsked: (key: number) => boolean): Int32Array =>
    stripsOf(needed(x).filter((cx) => !known.has(keyOf(cx)) && !isAsked(keyOf(cx))));
  const asking = (ahead: { x: number; z: number } | null = null): ClutterAsking => ({
    work,
    unknown,
    *take(s): Slices<boolean> {
      for (let n = 0; n < takeOpts.yields; n++) {
        clock.now += takeOpts.cost;
        yield;
      }
      if (takeOpts.refuse) return false;
      for (let i = 0; i < s.length; i += CLUTTER_STRIP_INTS) known.add(keyOf(s[i + 1] as number));
      return true;
    },
    *rebuild(x): Slices {
      for (const cx of needed(x)) {
        if (known.has(keyOf(cx))) continue;
        lookedHere.push(cx);
        known.add(keyOf(cx));
      }
      yield;
      shown.push(x);
    },
    ahead,
    now: () => clock.now,
    disposed: () => state.disposed,
    waited: (ms) => waited.push(ms),
  });
  /** The worker answers set `set`: its answer reaches the page. */
  const answer = (set: number): void => {
    state.through = Math.max(state.through, set);
    state.out--;
    waiting.push({ strips: strips.get(set) as Int32Array, answer: { set } as unknown as ClutterAnswer });
  };
  return { clock, known, posted, state, lookedHere, shown, waited, asking, answer, work, filledSets, takeOpts, isAsked: (cx: number) => asked.has(keyOf(cx)) };
}

/** A scheduler on the world's clock, and a frame of it. */
function scheduler(clock: { now: number }) {
  const jobs = createSyncJobs(() => clock.now);
  const frame = (): void => {
    clock.now += 1000 / 60;
    jobs.run();
  };
  return { jobs, frame };
}

describe("the clutter's rebuild that asks the worker and waits", () => {
  it("does not wait when the answer is in at once: the page looks nothing up", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    // The first slice posts the ask; the answer is in before the next frame.
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    expect(w.posted).toEqual([{ set: 1, cells: [10, 11, 12] }]);
    w.answer(1);
    frame();
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([]);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("an answer in before the job begins is taken without a wait", () => {
    const w = world();
    // The cells are asked and answered already by an earlier set; nothing is lacking beyond them.
    w.work.ask(stripsOf(needed(1)));
    w.answer(1);
    const job = askThenRebuild(w.asking(), 1, 0);
    const steps: (number | void)[] = [];
    for (let s = job.next(); s.done !== true; s = job.next()) steps.push(s.value);
    expect(steps).not.toContain(SLICE_WAITS);
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([]);
  });

  it("frames spent waiting cost no slice, and nothing is shown until the rebuild ends", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    frame();
    expect(jobs.last.waits).toBe(1);
    frame();
    expect(jobs.last.waits).toBe(1);
    expect(jobs.last.slices).toBe(0);
    expect(w.shown).toEqual([]);
    w.answer(1);
    frame();
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([]);
    expect(w.waited).toHaveLength(1);
    expect(w.waited[0]).toBeGreaterThan(0);
  });

  it("goes on at once when the client fails while it waits", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    frame();
    expect(w.shown).toEqual([]);
    w.state.failed = true;
    frame();
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([10, 11, 12]);
  });

  it("rebuilds without asking when the client has failed already", () => {
    const w = world();
    w.state.failed = true;
    const job = askThenRebuild(w.asking(), 1, 0);
    for (let s = job.next(); s.done !== true; s = job.next()) expect(s.value).not.toBe(SLICE_WAITS);
    expect(w.posted).toEqual([]);
    expect(w.shown).toEqual([1]);
  });

  it("goes on after CLUTTER_WAIT_MS without an answer, and the late answer is taken by the next job", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    for (let n = 0; n < 30 && w.shown.length === 0; n++) frame();
    expect(w.clock.now).toBeGreaterThanOrEqual(CLUTTER_WAIT_MS);
    expect(w.clock.now).toBeLessThan(CLUTTER_WAIT_MS + 100);
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([10, 11, 12]);
    // The answer comes late: the next job fills it, and the cells it names are remembered already, so nothing is replaced.
    w.answer(1);
    jobs.begin(owner, askThenRebuild(w.asking(), 2, 0), false, "clutter");
    frame();
    expect(w.known.has(keyOf(10))).toBe(true);
    expect(w.filledSets).toContain(1);
    expect(w.isAsked(10)).toBe(false);
    expect(w.posted.map((p) => p.set)).toEqual([1, 2]);
    expect(w.lookedHere).toEqual([10, 11, 12]);
  });

  it("holds a newer crossing behind the job that waits, and runs it after", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    frame();
    jobs.begin(owner, askThenRebuild(w.asking(), 2, 0), false, "clutter");
    frame();
    expect(w.shown).toEqual([]);
    w.answer(1);
    frame();
    expect(w.shown).toEqual([1]);
    frame();
    w.answer(2);
    frame();
    frame();
    expect(w.shown).toEqual([1, 2]);
  });

  it("does not rebuild when the meshes go while it waits", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    frame();
    w.state.disposed = true;
    w.answer(1);
    frame();
    frame();
    expect(w.shown).toEqual([]);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("asks for the next crossing too, and the job after asks nothing for its own cells", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking({ x: 2, z: 0 }), 1, 0), false, "clutter");
    frame();
    expect(w.posted).toEqual([{ set: 1, cells: [10, 11, 12] }, { set: 2, cells: [20, 21, 22] }]);
    // Only its own set is waited for.
    w.answer(1);
    frame();
    expect(w.shown).toEqual([1]);
    w.answer(2);
    jobs.begin(owner, askThenRebuild(w.asking(), 2, 0), false, "clutter");
    frame();
    expect(w.posted).toHaveLength(2);
    expect(w.shown).toEqual([1, 2]);
    expect(w.lookedHere).toEqual([]);
  });

  it("with two sets already out, asks nothing, waits for what is out, and goes on at the bound", () => {
    const w = world();
    w.work.ask(stripsOf([90]));
    w.work.ask(stripsOf([91]));
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    expect(w.posted).toHaveLength(2);
    for (let n = 0; n < 30 && w.shown.length === 0; n++) frame();
    expect(w.clock.now).toBeGreaterThanOrEqual(CLUTTER_WAIT_MS);
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([10, 11, 12]);
  });

  it("with two sets out, goes on as soon as what is out is answered", () => {
    const w = world();
    w.work.ask(stripsOf([90]));
    w.work.ask(stripsOf([91]));
    const { jobs, frame } = scheduler(w.clock);
    jobs.begin({}, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    frame();
    expect(w.shown).toEqual([]);
    w.answer(1);
    w.answer(2);
    frame();
    expect(w.shown).toEqual([1]);
  });

  it("askAhead asks only for cells not asked already", () => {
    const w = world();
    askAhead(w.asking(), 2, 0);
    askAhead(w.asking(), 2, 0);
    expect(w.posted).toEqual([{ set: 1, cells: [20, 21, 22] }]);
  });

  it("never waits on a path run to its end: the shell's rebuild is not the scheduled one", () => {
    const w = world();
    const scheduledCalls: number[] = [];
    const rebuilt: number[] = [];
    const clock = { now: 0 };
    const jobs = createSyncJobs(() => clock.now);
    const rebuilds = createRebuilds({
      name: "clutter",
      cell: 3,
      origin: cellOrigin(3),
      *rebuild(x): Slices {
        rebuilt.push(x);
        yield;
      },
      *scheduled(x, z): Slices {
        scheduledCalls.push(x);
        yield* askThenRebuild(w.asking(), 1, z);
      },
      jobs,
    });
    // A first build runs `rebuild`, which has no wait to throw on.
    expect(rebuilds.update(2.9, 0)).toBe("now");
    expect(rebuilt).toEqual([2.9]);
    expect(scheduledCalls).toEqual([]);
  });

  it("a later job whose answer has arrived runs the same frame and waits no frame", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    w.work.ask(stripsOf(needed(1)));
    w.answer(1);
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    expect(jobs.last.waits).toBe(0);
    expect(w.shown).toEqual([1]);
    expect(w.lookedHere).toEqual([]);
  });

  it("releases an answer taken when the job is cancelled while the take is suspended", () => {
    const w = world();
    const { jobs, frame } = scheduler(w.clock);
    const owner = {};
    w.takeOpts.yields = 5;
    // Each slice of the take spends the frame's share, so the job is suspended inside it when the frame ends.
    w.takeOpts.cost = 50;
    jobs.begin(owner, askThenRebuild(w.asking(), 1, 0), false, "clutter");
    frame();
    w.answer(1);
    frame();
    expect(w.filledSets).toEqual([]);
    jobs.cancel(owner);
    expect(w.filledSets).toEqual([1]);
    expect(w.isAsked(10)).toBe(false);
  });
});

describe("the idle work that fills and asks ahead", () => {
  it("fills a taken answer whole in one step, however sliced the take is", () => {
    const w = world();
    w.takeOpts.yields = 3;
    w.work.ask(stripsOf(needed(1)));
    w.answer(1);
    const job = fillThenAskAhead(w.asking(), 0, 0, null);
    // The one step filled it and released it; the yield after it holds nothing.
    expect(job.next().done).toBe(false);
    expect(w.filledSets).toEqual([1]);
    expect(w.known.has(keyOf(10))).toBe(true);
    expect(job.next().done).toBe(true);
  });

  it("fills answers in arrival order with a yield between, then asks ahead once", () => {
    const w = world();
    w.work.ask(stripsOf(needed(1)));
    w.work.ask(stripsOf(needed(3)));
    w.answer(1);
    w.answer(2);
    const job = fillThenAskAhead(w.asking(), 0, 0, { x: 2, z: 0 });
    expect(job.next().done).toBe(false);
    expect(w.filledSets).toEqual([1]);
    expect(w.posted).toHaveLength(2);
    expect(job.next().done).toBe(false);
    expect(w.filledSets).toEqual([1, 2]);
    expect(w.posted).toHaveLength(2);
    expect(job.next().done).toBe(true);
    expect(w.posted.map((p) => p.cells)).toEqual([[10, 11, 12], [30, 31, 32], [20, 21, 22]]);
  });

  it("does nothing with nothing arrived and no look-ahead", () => {
    const w = world();
    const job = fillThenAskAhead(w.asking(), 0, 0, null);
    expect(job.next().done).toBe(true);
    expect(w.posted).toEqual([]);
    expect(w.filledSets).toEqual([]);
  });

  it("releases a refused answer all the same", () => {
    const w = world();
    w.takeOpts.refuse = true;
    w.work.ask(stripsOf(needed(1)));
    w.answer(1);
    const job = fillThenAskAhead(w.asking(), 0, 0, null);
    job.next();
    expect(w.filledSets).toEqual([1]);
    expect(w.known.size).toBe(0);
  });
});
