import { describe, expect, it } from "vitest";
import type { FacePatch } from "../../../src/game/facePatches.js";
import { askThenPlace, placeAsked, type PatchPlacing } from "../../../src/game/lite/patchJob.js";
import { createPatchWork, type PatchWork } from "../../../src/game/patchWork.js";
import { createWorldLink } from "../../../src/game/worldLink.js";
import { SLICE_TARGET_MS, SLICE_WAITS, SYNC_OVERDUE_BUDGET_MS, createSyncJobs, type Slices } from "../../../src/game/syncJobs.js";
import type { PatchCellAsk, WorldPatchesRequest, WorldPrepReply } from "../../../src/game/worldWork.js";

/** A patch of its own for cell `i`: the tests only follow which one goes where. */
const patchOf = (i: number): FacePatch => ({ cell: i }) as unknown as FacePatch;

/**
 * A set of `count` cells, nearest first, and what `placeAsked` is given for it: what the worker has sent is `sent`,
 * taken out as the client's `take` does; a cell is ready once placed or built here. Each `enter` costs `enterMs` of
 * `clock`; `holdFrames` makes the hold for a cell yield that many times first. `calls` is what was asked, in order.
 */
function fake(count: number, options: { clock?: { now: number }; enterMs?: number; holdFrames?: Map<number, number>; failInHold?: boolean } = {}) {
  const ready = new Set<number>();
  const sent = new Map<number, FacePatch | null>();
  const calls: string[] = [];
  const entered: [number, FacePatch | null][] = [];
  const held: [number, FacePatch | null][] = [];
  const state = { failed: false, disposed: false };
  const key = (i: number): number => 1000 + i;
  const placing: PatchPlacing = {
    changed: Array.from({ length: count }, (_, i) => i),
    isReady: (i) => ready.has(i),
    key,
    arrived(k) {
      calls.push(`arrived ${k - 1000}`);
      if (state.failed || !sent.has(k)) return undefined;
      const patch = sent.get(k) as FacePatch | null;
      sent.delete(k);
      return patch;
    },
    failed: () => state.failed,
    *hold(i, patch): Slices {
      calls.push(`hold ${i}`);
      held.push([i, patch]);
      for (let n = options.holdFrames?.get(i) ?? 0; n > 0; n--) yield 1;
      // The worker's failure arrives while the hold waited.
      if (options.failInHold === true) state.failed = true;
    },
    enter(i, patch) {
      calls.push(`enter ${i}`);
      entered.push([i, patch]);
      ready.add(i);
      if (options.clock !== undefined) options.clock.now += options.enterMs ?? 0;
    },
    *makeHere(i): Slices {
      calls.push(`make ${i}`);
      yield 0.5;
      ready.add(i);
    },
    disposed: () => state.disposed,
  };
  /** The worker sends cell `i`, as a patch or, with `empty`, as a cell with no steep ground. */
  const send = (i: number, empty = false): void => {
    sent.set(key(i), empty ? null : patchOf(i));
  };
  return { placing, ready, send, calls, entered, held, state };
}

/** A scheduler on a clock that moves only when the test or a cell moves it, and a frame of it. */
function scheduler() {
  const clock = { now: 0 };
  const jobs = createSyncJobs(() => clock.now);
  const frame = (): void => {
    clock.now += 1000 / 60;
    jobs.run();
  };
  return { jobs, clock, frame };
}

/** `inner` resumed as the scheduler resumes it, the cells `entered` counted in each resumption. */
function* counted(inner: Slices, entered: () => number, perSlice: number[]): Slices {
  for (;;) {
    const before = entered();
    const step = inner.next();
    perSlice.push(entered() - before);
    if (step.done === true) return;
    yield step.value;
  }
}

/** `inner` resumed as the scheduler resumes it, what each slice yields kept in `values`. */
function* recorded(inner: Slices, values: (number | void)[]): Slices {
  for (;;) {
    const step = inner.next();
    if (step.done === true) return;
    values.push(step.value);
    yield step.value;
  }
}

describe("the rock faces' cells placed as the worker sends them", () => {
  it("with nothing arrived every slice waits", () => {
    const f = fake(3);
    const job = placeAsked(f.placing);
    for (let n = 0; n < 3; n++) expect(job.next()).toEqual({ done: false, value: SLICE_WAITS });
    expect(f.entered).toEqual([]);
    expect(f.calls.some((c) => c.startsWith("enter") || c.startsWith("hold") || c.startsWith("make"))).toBe(false);
  });

  it("an arrived cell is held for, then placed", () => {
    const f = fake(2, { holdFrames: new Map([[1, 1]]) });
    f.send(1);
    const job = placeAsked(f.placing);
    // The hold waits for the upload budget: nothing is placed while it does.
    expect(job.next()).toEqual({ done: false, value: 1 });
    expect(f.entered).toEqual([]);
    job.next();
    expect(f.calls.filter((c) => !c.startsWith("arrived"))).toEqual(["hold 1", "enter 1"]);
    expect(f.held).toEqual([[1, patchOf(1)]]);
    expect(f.entered).toEqual([[1, patchOf(1)]]);
    expect(f.held[0]?.[1]).toBe(f.entered[0]?.[1]);
  });

  it("places a cell the worker sent as having no steep ground as an empty cell", () => {
    const f = fake(1);
    f.send(0, true);
    expect(placeAsked(f.placing).next().done).toBe(true);
    expect(f.held).toEqual([[0, null]]);
    expect(f.entered).toEqual([[0, null]]);
  });

  it("several arrived cells are placed in one slice while sliceDue is false", () => {
    const { jobs, clock } = scheduler();
    const f = fake(11, { clock, enterMs: 0 });
    for (let i = 0; i < 10; i++) f.send(i);
    const perSlice: number[] = [];
    jobs.begin({}, counted(placeAsked(f.placing), () => f.entered.length, perSlice), false, "facePatches");
    jobs.run();
    // The ten that arrived in the first slice; the eleventh has not come, so the job waits for it.
    expect(perSlice[0]).toBe(10);
    expect(jobs.last.waits).toBe(1);
  });

  it("several arrived cells are placed in one slice, which ends when sliceDue turns true", () => {
    const { jobs, clock } = scheduler();
    const f = fake(10, { clock, enterMs: 0.4 });
    for (let i = 0; i < 10; i++) f.send(i);
    const perSlice: number[] = [];
    const owner = {};
    jobs.begin(owner, counted(placeAsked(f.placing), () => f.entered.length, perSlice), false, "facePatches");
    for (let frames = 0; jobs.pending(owner) && frames < 20; frames++) jobs.run();
    // The clock is read after every cell placed: the slice ends with the first cell that takes it past the target.
    const first = Math.ceil(SLICE_TARGET_MS / 0.4);
    expect(perSlice[0]).toBe(first);
    expect(perSlice.slice(0, -1).every((n) => n <= first)).toBe(true);
    expect(f.entered.map(([i]) => i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("cells are placed nearest first among those arrived", () => {
    const f = fake(3);
    f.send(2);
    f.send(0);
    const job = placeAsked(f.placing);
    let step = job.next();
    while (step.done !== true && step.value !== SLICE_WAITS) step = job.next();
    expect(f.entered.map(([i]) => i)).toEqual([0, 2]);
    // And it still waits for the one between.
    expect(step).toEqual({ done: false, value: SLICE_WAITS });
    f.send(1);
    expect(job.next().done).toBe(true);
    expect(f.entered.map(([i]) => i)).toEqual([0, 2, 1]);
  });

  it("a cell already ready is neither asked for nor placed", () => {
    const f = fake(3);
    f.ready.add(1);
    f.send(0);
    f.send(1);
    f.send(2);
    expect(placeAsked(f.placing).next().done).toBe(true);
    expect(f.calls.filter((c) => c.endsWith(" 1"))).toEqual([]);
    expect(f.entered.map(([i]) => i)).toEqual([0, 2]);
  });

  it("the generator returns once every cell is ready", () => {
    const f = fake(3);
    f.send(0);
    const job = placeAsked(f.placing);
    let step = job.next();
    while (step.done !== true && step.value !== SLICE_WAITS) step = job.next();
    expect(step.done).toBe(false);
    f.send(1);
    f.send(2);
    expect(job.next()).toEqual({ done: true, value: undefined });
    expect([...f.ready].sort()).toEqual([0, 1, 2]);
    // A set built whole already asks nothing and returns at once.
    const whole = fake(2);
    whole.ready.add(0);
    whole.ready.add(1);
    expect(placeAsked(whole.placing).next().done).toBe(true);
    expect(whole.calls).toEqual([]);
  });

  it("the worker failing mid-set finishes the set on this thread", () => {
    const f = fake(5);
    f.send(0);
    f.send(1);
    const job = placeAsked(f.placing);
    let step = job.next();
    while (step.done !== true && step.value !== SLICE_WAITS) step = job.next();
    expect(f.entered.map(([i]) => i)).toEqual([0, 1]);
    f.state.failed = true;
    const after: (number | void)[] = [];
    for (step = job.next(); step.done !== true; step = job.next()) after.push(step.value);
    // Each of the other three built here, in order, each a slice of its own and then a plain one; never a wait again.
    expect(f.calls.filter((c) => c.startsWith("make"))).toEqual(["make 2", "make 3", "make 4"]);
    expect(after).toEqual([0.5, undefined, 0.5, undefined, 0.5, undefined]);
    expect(after).not.toContain(SLICE_WAITS);
    expect([...f.ready].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("the worker failing while the set waits finishes it on this thread without waiting again", () => {
    const f = fake(2);
    const job = placeAsked(f.placing);
    expect(job.next().value).toBe(SLICE_WAITS);
    f.state.failed = true;
    const after: (number | void)[] = [];
    for (let step = job.next(); step.done !== true; step = job.next()) after.push(step.value);
    expect(f.calls.filter((c) => c.startsWith("make"))).toEqual(["make 0", "make 1"]);
    expect(after).toEqual([0.5, undefined, 0.5, undefined]);
  });

  it("the worker failing while a cell is held for finishes the set on this thread without waiting again", () => {
    const { jobs, clock } = scheduler();
    // The cell held for costs more than a slice to place, so its slice ends as it is placed.
    const f = fake(3, { clock, enterMs: 2, holdFrames: new Map([[1, 1]]), failInHold: true });
    f.send(1);
    const values: (number | void)[] = [];
    const owner = {};
    jobs.begin(owner, recorded(placeAsked(f.placing), values), false, "facePatches");
    for (let frames = 0; jobs.pending(owner) && frames < 20; frames++) jobs.run();
    expect(jobs.pending(owner)).toBe(false);
    expect(f.entered.map(([i]) => i)).toEqual([1]);
    expect(f.calls.filter((c) => c.startsWith("make"))).toEqual(["make 0", "make 2"]);
    expect(values).not.toContain(SLICE_WAITS);
  });

  it("disposed ends it at once, placing nothing more", () => {
    // Gone while a cell's hold waits: the cell held for is not placed.
    const f = fake(3, { holdFrames: new Map([[1, 1]]) });
    f.send(0);
    f.send(1);
    f.send(2);
    const job = placeAsked(f.placing);
    expect(job.next()).toEqual({ done: false, value: 1 });
    expect(f.entered.map(([i]) => i)).toEqual([0]);
    f.state.disposed = true;
    expect(job.next().done).toBe(true);
    expect(f.entered.map(([i]) => i)).toEqual([0]);
    // Gone while the set waits: nothing arrived after is taken or placed.
    const g = fake(2);
    const waiting = placeAsked(g.placing);
    expect(waiting.next().value).toBe(SLICE_WAITS);
    g.state.disposed = true;
    g.send(0);
    expect(waiting.next().done).toBe(true);
    expect(g.entered).toEqual([]);
    // Gone while the set is finished on this thread: nothing more is built.
    const h = fake(3);
    const here = placeAsked(h.placing);
    h.state.failed = true;
    expect(here.next().value).toBe(0.5);
    h.state.disposed = true;
    for (let n = 0; n < 10 && here.next().done !== true; n++);
    expect(here.next().done).toBe(true);
    expect(h.calls.filter((c) => c.startsWith("make"))).toEqual(["make 0"]);
  });

  it("after a minute hidden, a hundred arrived cells are placed over several frames", () => {
    const { jobs, clock, frame } = scheduler();
    const f = fake(100, { clock, enterMs: 1 });
    const owner = {};
    jobs.begin(owner, placeAsked(f.placing), false, "facePatches");
    frame();
    expect(f.entered).toEqual([]);
    // The tab is hidden for a minute, and every cell arrives meanwhile.
    for (let i = 0; i < 100; i++) f.send(i);
    clock.now += 60_000;
    const placedByFrame: number[] = [];
    for (let frames = 0; jobs.pending(owner) && frames < 100; frames++) {
      const before = f.entered.length;
      frame();
      placedByFrame.push(f.entered.length - before);
      // The overdue share, and at most one cell past it.
      expect(jobs.last.ms).toBeLessThanOrEqual(SYNC_OVERDUE_BUDGET_MS + 1);
    }
    expect(f.entered).toHaveLength(100);
    expect(jobs.pending(owner)).toBe(false);
    expect(placedByFrame.length).toBeGreaterThan(1);
  });

  it("a job that waits costs a frame no slice", () => {
    const { jobs, clock, frame } = scheduler();
    const f = fake(4, { clock, enterMs: 1 });
    jobs.begin({}, placeAsked(f.placing), false, "facePatches");
    frame();
    expect([jobs.last.slices, jobs.last.waits]).toEqual([0, 1]);
    frame();
    expect([jobs.last.slices, jobs.last.waits]).toEqual([0, 1]);
    expect(f.entered).toEqual([]);
  });
});

describe("the rock faces' set asked of the worker, then placed", () => {
  /**
   * The real client on a worker that only records: `log` has a line for each set posted (its cells' columns) and for
   * each cell placed; `deliver` sends the newest set's cells back as patches.
   */
  function rig() {
    const log: string[] = [];
    const posted: WorldPatchesRequest[] = [];
    const worker = {
      onmessage: null as ((event: { data: WorldPrepReply }) => void) | null,
      onerror: null,
      onmessageerror: null,
      postMessage(message: WorldPatchesRequest) {
        posted.push(message);
        log.push(`post ${message.cells.map((c) => c.ci).join(",")}`);
      },
      terminate() {},
    };
    const work = createPatchWork(createWorldLink(worker as unknown as Worker), { seed: 7, variant: "v" });
    const deliver = (): void => {
      const request = posted[posted.length - 1] as WorldPatchesRequest;
      request.cells.forEach((c, index) => {
        worker.onmessage?.({ data: { id: request.id, kind: "patch", set: request.set, index, patch: patchOf(c.ci), ms: 1 } });
      });
    };
    const ready = new Set<number>();
    /** A set of the cells in columns `cis`, asked of `work` under their columns as keys, and placed by the rules of `placeAsked`. */
    const set = (cis: number[]): Slices<number[]> => askThenPlace(
      () => {
        const cells: PatchCellAsk[] = cis.map((ci) => ({ ci, cj: 0, spacing: 1, stitch: {} as PatchCellAsk["stitch"] }));
        work.ask(cells, cis);
        return cis;
      },
      (asked): PatchPlacing => ({
        changed: asked.map((_, i) => i),
        isReady: (i) => ready.has(asked[i] as number),
        key: (i) => asked[i] as number,
        arrived: (key) => work.take(key),
        failed: () => work.failed,
        *hold() {},
        enter(i) {
          ready.add(asked[i] as number);
          log.push(`enter ${asked[i] as number}`);
        },
        *makeHere() {},
        disposed: () => false,
      }),
    );
    /** `set(cis)` as a job: made here, so whatever it does as it is made is done as the job is begun. */
    const job = (cis: number[]): Slices => {
      const inner = set(cis);
      return (function* () {
        yield* inner;
      })();
    };
    return { log, posted, work: work as PatchWork, deliver, set, job };
  }

  it("asks on the job's first slice, so a request held behind a started job asks only once that job is placed", () => {
    const { jobs, frame } = scheduler();
    const r = rig();
    const owner = {};
    jobs.begin(owner, r.job([1, 2]), false, "facePatches");
    // Begun: nothing is asked until the job runs.
    expect(r.log).toEqual([]);
    frame();
    expect(r.log).toEqual(["post 1,2"]);
    expect(jobs.last.waits).toBe(1);
    // A new request while A waits: held behind it, and it asks nothing.
    jobs.begin(owner, r.job([3, 4]), false, "facePatches");
    for (let f = 0; f < 3; f++) frame();
    expect(jobs.last.waits).toBe(1);
    expect(r.posted.map((p) => p.cells.map((c) => c.ci))).toEqual([[1, 2]]);
    // A's cells come: A places them and ends, and only then does B begin and ask for its set.
    r.deliver();
    frame();
    expect(r.log).toEqual(["post 1,2", "enter 1", "enter 2", "post 3,4"]);
    r.deliver();
    frame();
    expect(r.log).toEqual(["post 1,2", "enter 1", "enter 2", "post 3,4", "enter 3", "enter 4"]);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("a job begun and replaced before it ever ran asks nothing", () => {
    const { jobs, frame } = scheduler();
    const r = rig();
    const owner = {};
    jobs.begin(owner, r.job([1, 2]), false, "facePatches");
    jobs.begin(owner, r.job([3]), false, "facePatches");
    frame();
    expect(r.log).toEqual(["post 3"]);
  });

  it("returns the set it asked, once every cell is placed", () => {
    const r = rig();
    const job = r.set([5]);
    expect(job.next()).toEqual({ done: false, value: SLICE_WAITS });
    r.deliver();
    expect(job.next()).toEqual({ done: true, value: [5] });
  });
});
