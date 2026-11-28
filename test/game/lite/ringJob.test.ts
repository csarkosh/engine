import { describe, expect, it } from "vitest";
import type { RingSamples } from "../../../src/game/clipmap.js";
import { askThenPlaceRings, type RingPlacing } from "../../../src/game/lite/ringJob.js";
import type { RingDrawn } from "../../../src/game/ringBuild.js";
import type { RingSent, WorldRingsRequest } from "../../../src/game/ringWire.js";
import { createRingWork, type RingArrived, type RingWork } from "../../../src/game/ringWork.js";
import { SLICE_WAITS, createSyncJobs, type Slices } from "../../../src/game/syncJobs.js";
import { createWorldLink } from "../../../src/game/worldLink.js";
import type { WorldPrepReply } from "../../../src/game/worldWork.js";

const drawnOf = (x: number): RingDrawn => ({ x, z: 0, fx: 0, fz: 0, cx: 0, cz: 0, kx: 0, kz: 0, kr: 0, kf: 0 });
const sentOf = (): RingSent => ({ positions: new Float32Array(3), normals: new Float32Array(3), plugin: new Float32Array(3), indices: new Uint32Array(3) });
const ringOf = (level: number): RingArrived => ({ level, drawn: drawnOf(level), ring: sentOf() });

/**
 * What `askThenPlaceRings` is given, over a worker that is only a list: `send` puts a ring among those arrived,
 * `finish` says the set is done. `calls` is what was asked, in order; `holdFrames` makes the hold for a ring of that
 * level yield that many times first, `showFrames` the hold for the show. `finishHere` yields 0.5 three times.
 */
function fake(options: { holdFrames?: Map<number, number>; showFrames?: number } = {}) {
  const arrived: RingArrived[] = [];
  const calls: string[] = [];
  const written: RingArrived[] = [];
  const state = { done: false, failed: false, disposed: false, asked: 0 };
  const placing: RingPlacing = {
    ask() {
      calls.push("ask");
      state.asked++;
    },
    arrived: () => (state.failed ? undefined : arrived.shift()),
    done: () => state.done || state.failed,
    failed: () => state.failed,
    disposed: () => state.disposed,
    *holdWrite(ring): Slices {
      calls.push(`hold ${ring.level}`);
      for (let n = options.holdFrames?.get(ring.level) ?? 0; n > 0; n--) yield 1;
    },
    write(ring) {
      calls.push(`write ${ring.level}`);
      written.push(ring);
    },
    *holdShow(): Slices {
      calls.push("holdShow");
      for (let n = options.showFrames ?? 0; n > 0; n--) yield 1;
    },
    show() {
      calls.push("show");
    },
    *finishHere(): Slices {
      calls.push("finishHere");
      for (let n = 0; n < 3; n++) yield 0.5;
    },
  };
  const send = (level: number): RingArrived => {
    const ring = ringOf(level);
    arrived.push(ring);
    return ring;
  };
  return { placing, calls, written, state, send, finish: () => (state.done = true) };
}

/** Every step of `job` until it ends or waits, the values yielded kept. */
function untilWaits(job: Slices): { values: (number | void)[]; done: boolean } {
  const values: (number | void)[] = [];
  for (;;) {
    const step = job.next();
    if (step.done === true) return { values, done: true };
    values.push(step.value);
    if (step.value === SLICE_WAITS) return { values, done: false };
  }
}

/** A scheduler on a clock that moves only when the test moves it, and a frame of it. */
function scheduler() {
  const clock = { now: 0 };
  const jobs = createSyncJobs(() => clock.now);
  const frame = (): void => {
    clock.now += 1000 / 60;
    jobs.run();
  };
  return { jobs, clock, frame };
}

describe("the rings asked of the worker, written as they arrive and shown as a set", () => {
  it("the ask is made on the first resumption, never when the job is begun", () => {
    const f = fake();
    const job = askThenPlaceRings(f.placing);
    expect(f.calls).toEqual([]);
    expect(job.next()).toEqual({ done: false, value: SLICE_WAITS });
    expect(f.calls).toEqual(["ask"]);
    // Once: a job that waits asks nothing again.
    job.next();
    job.next();
    expect(f.state.asked).toBe(1);
  });

  it("with nothing arrived every slice waits", () => {
    const f = fake();
    const job = askThenPlaceRings(f.placing);
    for (let n = 0; n < 4; n++) expect(job.next()).toEqual({ done: false, value: SLICE_WAITS });
    expect(f.calls).toEqual(["ask"]);
    // And under the scheduler a frame of waiting is no slice, and one wait.
    const { jobs, frame } = scheduler();
    const g = fake();
    jobs.begin({}, askThenPlaceRings(g.placing), false, "clipmap");
    frame();
    expect([jobs.last.slices, jobs.last.waits]).toEqual([0, 1]);
    frame();
    expect([jobs.last.slices, jobs.last.waits]).toEqual([0, 1]);
    expect(g.calls).toEqual(["ask"]);
  });

  it("an arrived ring is held for, then written", () => {
    const f = fake({ holdFrames: new Map([[2, 2]]) });
    const job = askThenPlaceRings(f.placing);
    expect(job.next().value).toBe(SLICE_WAITS);
    const ring = f.send(2);
    // The hold waits for the upload budget: nothing is written while it does.
    expect(job.next()).toEqual({ done: false, value: 1 });
    expect(job.next()).toEqual({ done: false, value: 1 });
    expect(f.written).toEqual([]);
    // Written in the slice the hold ends in, and a slice ends after it.
    expect(job.next()).toEqual({ done: false, value: undefined });
    expect(f.calls).toEqual(["ask", "hold 2", "write 2"]);
    expect(f.written[0]).toBe(ring);
  });

  it("rings are written as they arrive, in order", () => {
    const f = fake();
    const job = askThenPlaceRings(f.placing);
    expect(job.next().value).toBe(SLICE_WAITS);
    f.send(0);
    f.send(1);
    // One ring a slice, then a wait for the rest.
    expect(untilWaits(job)).toEqual({ values: [undefined, undefined, SLICE_WAITS], done: false });
    f.send(3);
    expect(untilWaits(job)).toEqual({ values: [undefined, SLICE_WAITS], done: false });
    expect(f.written.map((r) => r.level)).toEqual([0, 1, 3]);
    expect(f.calls).toEqual(["ask", "hold 0", "write 0", "hold 1", "write 1", "hold 3", "write 3"]);
  });

  it("nothing is shown until the set is done and every ring is written", () => {
    const f = fake();
    const job = askThenPlaceRings(f.placing);
    f.send(0);
    expect(untilWaits(job).done).toBe(false);
    expect(f.calls).not.toContain("show");
    expect(f.calls).not.toContain("holdShow");
    // The set is done with a ring still to take: it is written before anything is shown.
    f.send(1);
    f.finish();
    const step = job.next();
    expect(step).toEqual({ done: false, value: undefined });
    expect(f.calls).toEqual(["ask", "hold 0", "write 0", "hold 1", "write 1"]);
    expect(job.next().done).toBe(true);
    expect(f.calls).toEqual(["ask", "hold 0", "write 0", "hold 1", "write 1", "holdShow", "show"]);
  });

  it("show is called once, after holdShow", () => {
    const f = fake({ showFrames: 2 });
    const job = askThenPlaceRings(f.placing);
    f.send(4);
    f.finish();
    const values: (number | void)[] = [];
    for (let step = job.next(); step.done !== true; step = job.next()) {
      values.push(step.value);
      // Nothing shown while the hold for the show waits.
      if (step.value === 1) expect(f.calls).not.toContain("show");
    }
    expect(values).toEqual([undefined, 1, 1]);
    expect(f.calls).toEqual(["ask", "hold 4", "write 4", "holdShow", "show"]);
    expect(f.calls.filter((c) => c === "show")).toHaveLength(1);
  });

  it("a set with no ring shows nothing and ends", () => {
    const f = fake();
    const job = askThenPlaceRings(f.placing);
    expect(job.next().value).toBe(SLICE_WAITS);
    f.finish();
    expect(job.next()).toEqual({ done: true, value: undefined });
    expect(f.calls).toEqual(["ask"]);
    // Done as it asks: it ends in its first slice.
    const g = fake();
    g.finish();
    expect(askThenPlaceRings(g.placing).next().done).toBe(true);
    expect(g.calls).toEqual(["ask"]);
  });

  it("the worker failing mid-set finishes on this thread", () => {
    const f = fake();
    const job = askThenPlaceRings(f.placing);
    f.send(0);
    f.send(1);
    expect(untilWaits(job).done).toBe(false);
    expect(f.written.map((r) => r.level)).toEqual([0, 1]);
    f.state.failed = true;
    const after: (number | void)[] = [];
    for (let step = job.next(); step.done !== true; step = job.next()) after.push(step.value);
    // `finishHere`'s slices and nothing more: never a wait again, and no show of its own.
    expect(after).toEqual([0.5, 0.5, 0.5]);
    expect(after).not.toContain(SLICE_WAITS);
    expect(f.calls).toEqual(["ask", "hold 0", "write 0", "hold 1", "write 1", "finishHere"]);
    expect(f.calls).not.toContain("show");
    // Failing while a ring's hold waits: that ring is not written.
    const g = fake({ holdFrames: new Map([[2, 1]]) });
    const held = askThenPlaceRings(g.placing);
    g.send(2);
    expect(held.next()).toEqual({ done: false, value: 1 });
    g.state.failed = true;
    for (let step = held.next(); step.done !== true; step = held.next()) expect(step.value).not.toBe(SLICE_WAITS);
    expect(g.calls).toEqual(["ask", "hold 2", "finishHere"]);
    // Failing while the show's hold waits: the set is finished here, not shown as it was written.
    const h = fake({ showFrames: 1 });
    const showing = askThenPlaceRings(h.placing);
    h.send(0);
    h.finish();
    expect(showing.next()).toEqual({ done: false, value: undefined });
    expect(showing.next()).toEqual({ done: false, value: 1 });
    h.state.failed = true;
    for (let step = showing.next(); step.done !== true; step = showing.next()) expect(step.value).not.toBe(SLICE_WAITS);
    expect(h.calls).toEqual(["ask", "hold 0", "write 0", "holdShow", "finishHere"]);
  });

  it("disposed ends it at once, writing and showing nothing more", () => {
    // Gone while the set waits: nothing arrived after is written.
    const f = fake();
    const waiting = askThenPlaceRings(f.placing);
    expect(waiting.next().value).toBe(SLICE_WAITS);
    f.state.disposed = true;
    f.send(0);
    f.finish();
    expect(waiting.next().done).toBe(true);
    expect(f.calls).toEqual(["ask"]);
    // Gone while a ring's hold waits: the ring held for is not written.
    const g = fake({ holdFrames: new Map([[1, 1]]) });
    const holding = askThenPlaceRings(g.placing);
    g.send(1);
    expect(holding.next()).toEqual({ done: false, value: 1 });
    g.state.disposed = true;
    expect(holding.next().done).toBe(true);
    expect(g.calls).toEqual(["ask", "hold 1"]);
    // Gone between two rings: the second is not taken.
    const h = fake();
    const between = askThenPlaceRings(h.placing);
    h.send(0);
    h.send(1);
    expect(between.next()).toEqual({ done: false, value: undefined });
    h.state.disposed = true;
    expect(between.next().done).toBe(true);
    expect(h.calls).toEqual(["ask", "hold 0", "write 0"]);
    // Gone while the show's hold waits: nothing is shown.
    const k = fake({ showFrames: 1 });
    const showing = askThenPlaceRings(k.placing);
    k.send(0);
    k.finish();
    showing.next();
    expect(showing.next()).toEqual({ done: false, value: 1 });
    k.state.disposed = true;
    expect(showing.next().done).toBe(true);
    expect(k.calls).toEqual(["ask", "hold 0", "write 0", "holdShow"]);
    // Gone as the worker fails: nothing is finished here.
    const m = fake();
    const failing = askThenPlaceRings(m.placing);
    expect(failing.next().value).toBe(SLICE_WAITS);
    m.state.disposed = true;
    m.state.failed = true;
    expect(failing.next().done).toBe(true);
    expect(m.calls).toEqual(["ask"]);
  });
});

describe("the rings' job under the scheduler, with the real client", () => {
  /**
   * The real client on a worker that only records: `log` has a line for each set posted (its camera's x) and for each
   * ring written and set shown; `deliver` answers the newest set with a ring of each of `levels`, then `ringsDone`
   * unless `done` is false.
   */
  function rig() {
    const log: string[] = [];
    const posted: WorldRingsRequest[] = [];
    const worker = {
      onmessage: null as ((event: { data: WorldPrepReply }) => void) | null,
      onerror: null,
      onmessageerror: null,
      postMessage(message: WorldRingsRequest) {
        posted.push(message);
        log.push(message.stop === true ? "stop" : `post ${message.camX}`);
      },
      terminate() {},
    };
    const work: RingWork = createRingWork(createWorldLink(worker as unknown as Worker), { seed: 7, variant: "v" });
    const deliver = (levels: number[], done = true): void => {
      const request = posted[posted.length - 1] as WorldRingsRequest;
      for (const level of levels) {
        worker.onmessage?.({ data: { id: request.id, kind: "ring", set: request.set, level, drawn: drawnOf(request.camX), ring: sentOf(), ms: 1 } });
      }
      if (done) worker.onmessage?.({ data: { id: request.id, kind: "ringsDone", set: request.set, ms: 1 } });
    };
    const fail = (): void => {
      const request = posted[posted.length - 1] as WorldRingsRequest;
      worker.onmessage?.({ data: { id: request.id, kind: "failed", message: "gone" } });
    };
    const sampleOf = (): RingSamples => {
      const a = (): Float32Array => new Float32Array(4);
      return { h: a(), hh: a(), dx: a(), dz: a(), colors: a(), weights: a(), weights2: a(), cover: a(), normals: a(), lift: a() } as unknown as RingSamples;
    };
    const samples = (): RingSamples[] => Array.from({ length: 7 }, sampleOf);
    /** The job for a camera at x: asks with the samples where the worker holds none, writes and shows to the log. Once
     * it has asked, a client that holds no samples and has no set out has lost the set, as `terrainMeshes.ts` reads it. */
    const job = (x: number): Slices => {
      let asked = false;
      return askThenPlaceRings({
        ask: () => {
          asked = true;
          work.ask({ camX: x, camZ: 0, cover: null, drawn: [], ...(work.holds ? {} : { samples: samples() }) });
        },
        arrived: () => work.take(),
        done: () => work.done,
        failed: () => work.failed || (asked && !work.holds && !work.out),
        disposed: () => false,
        *holdWrite() {},
        write: (ring) => log.push(`write ${ring.level} at ${ring.drawn.x}`),
        *holdShow() {},
        show: () => log.push(`show ${x}`),
        *finishHere() {
          log.push(`here ${x}`);
        },
      });
    };
    return { log, posted, work, deliver, fail, job };
  }

  it("a request held behind a started job asks nothing until that job has shown", () => {
    const { jobs, frame } = scheduler();
    const r = rig();
    const owner = {};
    jobs.begin(owner, r.job(1), false, "clipmap");
    // Begun: nothing is asked until the job runs.
    expect(r.log).toEqual([]);
    frame();
    expect(r.log).toEqual(["post 1"]);
    expect(jobs.last.waits).toBe(1);
    // A new request while the first waits: held behind it, and it asks nothing.
    jobs.begin(owner, r.job(2), false, "clipmap");
    for (let n = 0; n < 3; n++) frame();
    expect(jobs.last.waits).toBe(1);
    expect(r.posted).toHaveLength(1);
    // The first set comes: it is written and shown, and only then does the second ask.
    r.deliver([0, 1]);
    frame();
    expect(r.log).toEqual(["post 1", "write 0 at 1", "write 1 at 1", "show 1", "post 2"]);
    r.deliver([0]);
    frame();
    expect(r.log).toEqual(["post 1", "write 0 at 1", "write 1 at 1", "show 1", "post 2", "write 0 at 2", "show 2"]);
    expect(jobs.pending(owner)).toBe(false);
    // The first ask carried the samples, the second none: the worker held them.
    expect(r.posted[0]?.samples).toHaveLength(7);
    expect(r.posted[1]?.samples).toBeUndefined();
  });

  it("a job replaced before it ran asks nothing", () => {
    const { jobs, frame } = scheduler();
    const r = rig();
    const owner = {};
    jobs.begin(owner, r.job(1), false, "clipmap");
    jobs.begin(owner, r.job(3), false, "clipmap");
    frame();
    expect(r.log).toEqual(["post 3"]);
  });

  it("a worker that fails while the job waits leaves the set to this thread", () => {
    const { jobs, frame } = scheduler();
    const r = rig();
    const owner = {};
    jobs.begin(owner, r.job(5), false, "clipmap");
    frame();
    expect(jobs.last.waits).toBe(1);
    // The worker answers `failed`: the next slice finishes the set here, and the job ends without waiting again.
    r.fail();
    frame();
    expect([jobs.last.slices, jobs.last.waits]).toEqual([1, 0]);
    expect(r.log).toEqual(["post 5", "here 5"]);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("a stop from outside the job while its set is out leaves the set to this thread, and shows none of it", () => {
    const { jobs, frame } = scheduler();
    const r = rig();
    const owner = {};
    jobs.begin(owner, r.job(6), false, "clipmap");
    frame();
    // One ring of the set arrives and is written; the set is still out.
    r.deliver([0], false);
    frame();
    expect(r.log).toEqual(["post 6", "write 0 at 6"]);
    expect(r.work.out).toBe(true);
    // Stopped by another than this job: the set is no longer out, and the worker holds no samples.
    r.work.stop();
    expect([r.work.out, r.work.holds, r.work.failed]).toEqual([false, false, false]);
    frame();
    expect(r.log).toEqual(["post 6", "write 0 at 6", "stop", "here 6"]);
    expect(jobs.pending(owner)).toBe(false);
  });
});
