import { describe, expect, it } from "vitest";
import { runBySlices } from "../../testing/sliceRun.js";
import {
  SLICE_READ_UNITS, SLICE_TARGET_MS, SYNC_BUDGET_MS, SYNC_PATIENT_MAX_MS, SYNC_PATIENT_WAIT_FRAMES, SYNC_LATE_BUDGET_MS, SYNC_LATE_FRAMES_MAX, SYNC_LATE_MS_MAX, SYNC_OVERDUE_MS,
  SYNC_OVERDUE_BUDGET_MS,
  SLICE_WAITS, createCrossing, createSyncJobs, crossingAt, finish, nextCrossing, sliceDue, sortSlices, stepSlices, syncJobsRecord, turn,
  type Slices, type SyncJobs,
} from "../../src/game/syncJobs.js";

/** `list` sorted at once by `sortSlices`. */
function sortSlicesDone(list: number[]): number[] {
  finish(sortSlices(list, (a, b) => a - b));
  return list;
}

/** A test clock: `now` is advanced by hand, by the slices below. */
function testClock(): { clock: () => number; advance(ms: number): void } {
  let now = 0;
  return { clock: () => now, advance: (ms) => { now += ms; } };
}

/** A job of `slices` slices, each advancing the clock by `ms`, that records
 * the frame its last slice ran in. */
function job(clock: { advance(ms: number): void }, slices: number, ms: number, done: { at: number | null }, frame: () => number): Slices {
  return (function* () {
    for (let i = 0; i < slices; i++) {
      clock.advance(ms);
      if (i < slices - 1) yield;
    }
    done.at = frame();
  })();
}

describe("the scheduler", () => {
  it("names its budget and its lateness bounds", () => {
    expect([SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, SYNC_LATE_MS_MAX, SYNC_LATE_BUDGET_MS, SYNC_OVERDUE_MS, SYNC_OVERDUE_BUDGET_MS, SYNC_PATIENT_MAX_MS]).toEqual([4, 6, 100, 8, 1000, 12, 9.5]);
    expect([SLICE_TARGET_MS, SLICE_READ_UNITS]).toEqual([1.5, 8]);
  });

  /** A job of 400 slices of 0.125 ms begun at frame 0, with the clock set to
   * `frameMs` times the frame as each frame's share starts (the ordinary share
   * runs 32 slices, the late one 64): the frame whose share ran it to its end,
   * and how many slices each frame ran late. `replaceAt` begins it again at
   * that frame. */
  function lateAt(frameMs: number, replaceAt: number | null = null): { at: number | null; late: number[] } {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const done = { at: null as number | null };
    const clock = { advance: (ms: number) => { now += ms; } };
    const owner = {};
    jobs.begin(owner, job(clock, 400, 0.125, done, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f < 12 && done.at === null; f++) {
      now = f * frameMs;
      if (f === replaceAt) jobs.begin(owner, job(clock, 400, 0.125, done, () => jobs.frame));
      jobs.run();
      late.push(jobs.last.late);
    }
    return { at: done.at, late };
  }

  it("makes a job late 100 ms after its crossing at 30 frames a second: the fifth frame, not the seventh", () => {
    // 33.3 ms a frame: frame 3's share starts at 99.9 ms, frame 4's at 133.2.
    // Four ordinary shares of 32 slices, then late shares of 64, the last
    // of the 16 slices left.
    expect(lateAt(33.3)).toEqual({ at: 8, late: [0, 0, 0, 0, 64, 64, 64, 64, 16] });
  });

  it("makes a job late in the seventh frame after its crossing at 60 frames a second, as before", () => {
    // 16.6 ms a frame: the sixth frame's share starts at 99.6 ms, and a job
    // begun at frame 0 is six frames old there.
    expect(lateAt(16.6)).toEqual({ at: 9, late: [0, 0, 0, 0, 0, 0, 64, 64, 64, 16] });
  });

  it("keeps a replaced job's wait counted from its first crossing's time, while it has not started", () => {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const clock = { advance: (ms: number) => { now += ms; } };
    const owner = {};
    const first = { at: null as number | null }, second = { at: null as number | null };
    jobs.begin(owner, job(clock, 400, 0.125, first, () => jobs.frame));
    // A second crossing 66.6 ms on, before any frame has run the first job: it takes its place, with nothing lost.
    now = 66.6;
    jobs.begin(owner, job(clock, 400, 0.125, second, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f < 12 && second.at === null; f++) {
      now = 66.6 + f * 33.3;
      jobs.run();
      late.push(jobs.last.late);
    }
    // Late at frame 2, 133.2 ms after the first crossing, with the new job's
    // 400 slices to make; counted from the second crossing it would be late at
    // frame 4. The first job never ran, and nothing was held.
    expect({ at: second.at, late }).toEqual({ at: 7, late: [0, 0, 64, 64, 64, 64, 64, 16] });
    expect(first.at).toBeNull();
  });

  it("finishes a started job its owner asks for again, and begins the newest request after it with a fresh deadline", () => {
    // Asked again at frame 2, after its first slices: shown when it would have been had nothing been asked.
    expect(lateAt(33.3, 2)).toEqual(lateAt(33.3));
    expect(lateAt(33.3, 2)).toEqual({ at: 8, late: [0, 0, 0, 0, 64, 64, 64, 64, 16] });
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null };
    const owner = {};
    // 40 slices of 1 ms: four a frame, eight late.
    jobs.begin(owner, job(t, 40, 1, first, () => jobs.frame));
    jobs.run();
    jobs.run();
    jobs.begin(owner, job(t, 40, 1, second, () => jobs.frame));
    const late: number[] = [];
    const held: number[] = [];
    for (let f = 2; f < 20 && second.at === null; f++) {
      jobs.run();
      late.push(jobs.last.late);
      held.push(jobs.last.held);
    }
    // The first is late at frame 6 and shown at 7; the second, begun as it was shown, is late six frames after that,
    // not after the first crossing or its own: at frame 13, and shown at 15.
    expect([first.at, second.at]).toEqual([7, 15]);
    expect(late).toEqual([0, 0, 0, 0, 8, 8, 0, 0, 0, 0, 0, 8, 8, 4]);
    expect(held).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("gives every pending job the overdue share when the clock jumps, oldest first, over the frames after", () => {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const clock = { advance: (ms: number) => { now += ms; } };
    const a = { at: null as number | null }, b = { at: null as number | null };
    jobs.begin({}, job(clock, 100, 0.125, a, () => jobs.frame));
    jobs.begin({}, job(clock, 100, 0.125, b, () => jobs.frame));
    jobs.run();
    // A tab hidden for a minute: the next frame's clock is 60 s on, so both are
    // overdue. The overdue share is 96 of these slices: the first job's other
    // 68, then 28 of the second's, none of them under the late share.
    now += 60_000;
    jobs.run();
    expect([a.at, b.at, jobs.last.overdue, jobs.last.overdueJobs, jobs.last.late]).toEqual([1, null, 96, 2, 0]);
    expect([jobs.last.ms, jobs.last.lateMs]).toEqual([12, 12]);
    // The second's other 72 the frame after.
    jobs.run();
    expect([a.at, b.at, jobs.last.overdue, jobs.last.overdueJobs, jobs.last.late]).toEqual([1, 2, 72, 1, 0]);
    expect([jobs.last.ms, jobs.last.lateMs]).toEqual([9, 9]);
  });

  it("spends a frame's budget and at most one slice past it, oldest job first", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const a = { at: null as number | null }, b = { at: null as number | null };
    const ownerA = {}, ownerB = {};
    // Two jobs of 7 ms each, in slices of 1.5 ms: three slices a frame.
    jobs.begin(ownerA, job(t, 5, 1.4, a, () => jobs.frame));
    jobs.begin(ownerB, job(t, 5, 1.4, b, () => jobs.frame));
    const spent: number[] = [];
    for (let f = 0; f < 5; f++) {
      const before = t.clock();
      jobs.run();
      spent.push(Math.round((t.clock() - before) * 10) / 10);
      expect(jobs.last.late).toBe(0);
    }
    // 4.2 ms a frame: three slices, the third begun at 2.8 ms, under the budget.
    expect(spent).toEqual([4.2, 4.2, 4.2, 1.4, 0]);
    expect([a.at, b.at]).toEqual([1, 3]);
    expect(jobs.pending(ownerA) || jobs.pending(ownerB)).toBe(false);
  });

  it("gives a late job the late share a frame and no more, and ends it over the frames after", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    // 100 slices of 1 ms: the ordinary share alone would take 25 frames.
    jobs.begin(owner, job(t, 100, 1, done, () => jobs.frame));
    const late: number[] = [];
    const spent: number[] = [];
    for (let f = 0; f < 16; f++) {
      const before = t.clock();
      jobs.run();
      late.push(jobs.last.late);
      spent.push(t.clock() - before);
    }
    // Four slices a frame for six frames, then eight a frame, the last four.
    expect(late).toEqual([0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4, 0].slice(0, 16));
    expect(Math.max(...spent)).toBeLessThanOrEqual(SYNC_LATE_BUDGET_MS);
    expect(done.at).toBe(15);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("stops a late job at the late share even when its slices are long, and goes on next frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    jobs.begin(owner, job(t, 30, 3, done, () => jobs.frame));
    // Two slices of 3 ms an ordinary frame: the second begins at 3 ms, under the 4.
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX; f++) jobs.run();
    const before = t.clock();
    jobs.run();
    // The share is looked at before each slice: they begin at 0, 3 and 6 ms, and the one at 9 does not.
    expect(t.clock() - before).toBe(9);
    expect(jobs.last.late).toBe(3);
    expect(jobs.pending(owner)).toBe(true);
    expect(done.at).toBeNull();
  });

  it("goes to the late jobs first, ahead of one queued before it that is not late", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran: string[] = [];
    const named = (name: string): Slices => (function* () {
      for (let i = 0; i < 100; i++) {
        if (ran[ran.length - 1] !== name || i === 0) ran.push(name);
        t.advance(1);
        yield;
      }
    })();
    const first = {}, second = {};
    // `second` is begun patient at frame 0, and again as an ordinary job at frame 4, behind `first`, which is begun then: but its crossing is the older.
    // A patient job ahead of it takes every frame's share until then, so `second` has not started and is replaced in place.
    jobs.begin({}, job(t, 400, 1, { at: null }, () => jobs.frame), true);
    jobs.begin(second, named("second"), true);
    for (let f = 0; f < 4; f++) jobs.run();
    expect(ran).toEqual([]);
    jobs.begin(first, named("first"));
    jobs.begin(second, named("second"));
    // Frames 4 and 5: `first` is queued first and takes the ordinary share, `second` the rest if any.
    jobs.run();
    jobs.run();
    expect(jobs.last.late).toBe(0);
    ran.length = 0;
    // Frame 6: `second`'s crossing is six frames old, `first`'s two.
    jobs.run();
    expect(jobs.last.late).toBe(8);
    expect(ran[0]).toBe("second");
    expect(ran).toEqual(["second"]);
  });

  it("gives a job the overdue share a frame when it is overdue, and no more, until it ends", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    jobs.begin(owner, job(t, 400, 1, done, () => jobs.frame));
    jobs.run();
    // A frame whose clock is a second on: twelve of the 396 slices left, and the rest over the frames after.
    t.advance(SYNC_OVERDUE_MS);
    const before = t.clock();
    jobs.run();
    expect(done.at).toBeNull();
    expect([jobs.last.overdueJobs, jobs.last.overdue]).toEqual([1, 12]);
    expect(t.clock() - before).toBe(12);
    expect(jobs.pending(owner)).toBe(true);
    const overdue: number[] = [];
    while (done.at === null && overdue.length < 100) {
      jobs.run();
      overdue.push(jobs.last.overdue);
    }
    // 396 is 33 shares of 12: shown in frame 33.
    expect(done.at).toBe(33);
    expect(overdue).toEqual(Array.from({ length: 32 }, () => 12));
    expect(jobs.pending(owner)).toBe(false);
  });

  it("makes a job replaced again and again before it has started overdue a second after the first crossing", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const done = [0, 1, 2, 3].map(() => ({ at: null as number | null }));
    // A crossing every 250 ms of the clock, before any frame has run the job: each takes the last one's place.
    jobs.begin(owner, job(t, 1000, 1, done[0] as { at: number | null }, () => jobs.frame));
    for (let i = 1; i < 4; i++) {
      t.advance(250);
      jobs.begin(owner, job(t, 1000, 1, done[i] as { at: number | null }, () => jobs.frame));
    }
    // Begun at 0, replaced at 250, 500 and 750 ms, overdue when a frame starts a second on: the newest, at the overdue share.
    t.advance(250);
    jobs.run();
    expect([jobs.last.overdueJobs, jobs.last.overdue, jobs.last.held]).toEqual([1, 12, 0]);
    expect(done.map((d) => d.at)).toEqual([null, null, null, null]);
    // Its 1000 slices are 83 shares of 12 and 4: shown in frame 83.
    for (let f = 1; f < 100 && (done[3] as { at: number | null }).at === null; f++) jobs.run();
    expect(done.map((d) => d.at)).toEqual([null, null, null, 83]);
    expect([jobs.last.overdueJobs, jobs.last.overdue]).toEqual([1, 4]);
  });

  it("makes a started job asked for again and again overdue only by its own age, and begins the newest request fresh", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const done = [0, 1, 2, 3, 4].map(() => ({ at: null as number | null }));
    // A crossing every 250 ms of the clock, each asking for a job the share cannot finish.
    let overdueAt = -1;
    jobs.begin(owner, job(t, 1000, 1, done[0] as { at: number | null }, () => jobs.frame));
    for (let f = 0; f < 12 && overdueAt < 0; f++) {
      t.advance(250);
      jobs.begin(owner, job(t, 1000, 1, done[f + 1] as { at: number | null }, () => jobs.frame));
      jobs.run();
      if (jobs.last.overdueJobs > 0) overdueAt = f;
    }
    // The first request was replaced before frame 0 ran it; its replacement started there and is itself 1000 ms of
    // work, so it is overdue a second after the first crossing all the same, and given the overdue share. Those asked
    // for while it ran waited, the newest in the place of the one before it.
    expect(overdueAt).toBe(3);
    expect([jobs.last.overdueJobs, jobs.last.overdue]).toEqual([1, 12]);
    expect(done.map((d) => d.at)).toEqual([null, null, null, null, null]);
    // Three late shares of 8 and one of 12 leave 964 slices: 80 shares more and 4, shown in frame 84. The newest is
    // begun as it is shown, and is not overdue.
    for (let f = 4; f < 200 && (done[1] as { at: number | null }).at === null; f++) {
      t.advance(250);
      jobs.run();
    }
    expect(done.map((d) => d.at)).toEqual([null, 84, null, null, null]);
    expect([jobs.last.overdueJobs, jobs.last.overdue]).toEqual([1, 4]);
    expect(jobs.pending(owner)).toBe(true);
    t.advance(250);
    jobs.run();
    expect([jobs.last.overdueJobs, jobs.last.overdue]).toEqual([0, 0]);
  });

  it("keeps two crossings in one frame from making one long frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const a = { at: null as number | null }, b = { at: null as number | null };
    // 10 ms each in slices of 0.5 ms, both begun in frame 0.
    jobs.begin({}, job(t, 20, 0.5, a, () => jobs.frame));
    jobs.begin({}, job(t, 20, 0.5, b, () => jobs.frame));
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX; f++) {
      const before = t.clock();
      jobs.run();
      // The budget and one slice.
      expect(t.clock() - before).toBeLessThanOrEqual(4.5);
      expect(jobs.last.late).toBe(0);
    }
    // 20 ms over frames of 4 ms: both done inside five frames, neither late.
    expect([a.at, b.at]).toEqual([2, 4]);
  });

  it("drops a job its owner cancels, and leaves the rest queued", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const dropped = { at: null as number | null }, other = { at: null as number | null };
    const owner = {}, bystander = {};
    jobs.begin(owner, job(t, 3, 1, dropped, () => jobs.frame));
    jobs.begin(bystander, job(t, 3, 1, other, () => jobs.frame));
    jobs.cancel(owner);
    expect([jobs.pending(owner), jobs.pending(bystander)]).toEqual([false, true]);
    jobs.run();
    expect([dropped.at, other.at]).toEqual([null, 0]);
  });

  it("replaces a job its owner begins again before it has started, in its place in the queue and with its deadline", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null }, other = { at: null as number | null };
    const blocked = { at: null as number | null };
    const owner = {}, bystander = {};
    // Ahead of them, two slices of 4 ms: the whole share of frames 0 and 1.
    jobs.begin({}, job(t, 2, 4, blocked, () => jobs.frame));
    // 40 slices of 1 ms: ten frames' budget.
    jobs.begin(owner, job(t, 40, 1, first, () => jobs.frame));
    jobs.begin(bystander, job(t, 2, 1, other, () => jobs.frame));
    jobs.run();
    jobs.run();
    expect([blocked.at, jobs.last.slices]).toEqual([1, 1]);
    // A further crossing, two frames on, before the job has run a slice: the
    // new rebuild is late six frames after the first one began, and still
    // ahead of the bystander.
    jobs.begin(owner, job(t, 40, 1, second, () => jobs.frame));
    const late: number[] = [];
    for (let f = 2; f <= 9; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    expect([first.at, second.at, other.at]).toEqual([null, 8, 9]);
    // Four frames of four slices (the new job's first 16), then three of the late
    // share's eight (its other 24), the bystander's two after it: the bystander
    // is late too, and has no share while the job ahead of it takes the late one.
    expect(late).toEqual([0, 0, 0, 0, 8, 8, 8, 2]);
  });

  it("starts a slice said to be long only where it fits, or first in a frame, and lets the jobs behind it go on", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const heavy = { at: null as number | null }, light = { at: null as number | null };
    // Two small slices, then one it says takes 3 ms.
    jobs.begin({}, (function* () {
      t.advance(1);
      yield;
      t.advance(1);
      yield 3;
      t.advance(3);
      heavy.at = jobs.frame;
    })());
    jobs.begin({}, job(t, 3, 0.5, light, () => jobs.frame));
    const spent: number[] = [];
    for (let f = 0; f < 3; f++) {
      const before = t.clock();
      jobs.run();
      spent.push(t.clock() - before);
    }
    // Frame 0: the two small slices (2 ms); the long one would end at 5 ms,
    // so it waits, and the other job's three slices run instead. Frame 1:
    // the long one, first.
    expect(spent).toEqual([3.5, 3, 0]);
    expect([light.at, heavy.at]).toEqual([0, 1]);
  });

  it("never runs a patient job to its end at once, and gives it what the other jobs leave", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const slow = { at: null as number | null }, quick = { at: null as number | null };
    const patches = {}, rings = {};
    // 100 slices of 1 ms begun first, as patient; then 12 of 1 ms.
    jobs.begin(patches, job(t, 100, 1, slow, () => jobs.frame), true);
    jobs.begin(rings, job(t, 12, 1, quick, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f < 30; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    // The other first, four slices a frame, though begun after; then the
    // patient one at four a frame, never late: 25 frames from frame 3.
    expect(late.every((n) => n === 0)).toBe(true);
    expect([quick.at, slow.at]).toEqual([2, 27]);
    expect(jobs.pending(patches)).toBe(false);
  });

  it("moves a job begun again as no longer patient ahead of the patient ones, and lets it be late", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const a = { at: null as number | null }, b = { at: null as number | null };
    const first = {}, second = {};
    jobs.begin(first, job(t, 100, 1, a, () => jobs.frame), true);
    jobs.begin(second, job(t, 100, 1, b, () => jobs.frame), true);
    // The second begun again as an ordinary job: ahead of the first, and
    // run to its end six frames after its first crossing, frame 0.
    jobs.begin(second, job(t, 30, 1, b, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f <= SYNC_LATE_FRAMES_MAX; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    expect([a.at, b.at]).toEqual([null, 6]);
    // Six frames of four of its slices, then the other 6 at once.
    expect(late).toEqual([0, 0, 0, 0, 0, 0, 6]);
  });

  it("keeps a patient job patient when it is begun again, and its place behind the others", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null }, other = { at: null as number | null };
    const patches = {}, rings = {};
    jobs.begin(patches, job(t, 40, 1, first, () => jobs.frame), true);
    // A slice of 10 ms ahead of it takes frame 0 past where the patient one's floor fits: it has not started.
    jobs.begin({}, job(t, 1, 10, { at: null }, () => jobs.frame));
    jobs.run();
    expect([jobs.last.slices, jobs.last.floor]).toEqual([1, 0]);
    jobs.begin(rings, job(t, 8, 1, other, () => jobs.frame));
    jobs.begin(patches, job(t, 40, 1, second, () => jobs.frame), true);
    for (let f = 1; f < 14; f++) {
      jobs.run();
      expect(jobs.last.late).toBe(0);
    }
    expect([first.at, other.at, second.at]).toEqual([null, 2, 12]);
  });

  it("runs idle work while only patient jobs are pending, and none while another is", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    let idleSlices = 0;
    jobs.idle({}, (function* () {
      for (;;) {
        t.advance(1);
        idleSlices++;
        yield;
      }
    })());
    const slow = { at: null as number | null }, quick = { at: null as number | null };
    // A patient job whose slices say they take 3 ms: one a frame, first.
    jobs.begin({}, (function* () {
      for (let i = 0; i < 4; i++) {
        t.advance(2);
        yield 3;
      }
      slow.at = jobs.frame;
    })(), true);
    jobs.run();
    // Its slice, then idle work with the 2 ms left.
    expect([jobs.last.slices, jobs.last.idle]).toEqual([1, 2]);
    // An ordinary job besides, ten slices of 0.5 ms: eight fill the share, the
    // patient job's slice (the floor's, which its 3 ms fit in the 9.5) makes nine,
    // and while the ordinary one is pending no idle work runs.
    jobs.begin({}, job(t, 10, 0.5, quick, () => jobs.frame));
    jobs.run();
    expect([quick.at, jobs.last.slices, jobs.last.idle, jobs.last.floor]).toEqual([null, 9, 0, 1]);
    // Its last two slices, the patient one's, and idle work again.
    jobs.run();
    expect([quick.at, jobs.last.slices, jobs.last.idle]).toEqual([2, 3, 1]);
    expect(idleSlices).toBe(3);
  });

  it("lets the idle work behind a long slice go on, and puts the long one first the next frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran: string[] = [];
    const work = (name: string, first: number, then: number): Slices => (function* () {
      t.advance(first);
      ran.push(`${name}${jobs.frame}`);
      for (;;) {
        yield then;
        t.advance(then);
        ran.push(`${name}${jobs.frame}`);
      }
    })();
    // a: 1.5 ms, then slices said to take 3 ms; b: slices of 1 ms.
    jobs.idle({}, work("a", 1.5, 3));
    jobs.idle({}, work("b", 1, 1));
    jobs.run();
    jobs.run();
    // Frame 0: a, b, then a's long one waits and b goes on while it fits.
    // Frame 1: a's long one first, then b with what is left.
    expect(ran).toEqual(["a0", "b0", "b0", "a1", "b1"]);
  });

  it("starts an idle slice said to be long only where it fits, or first in a frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran: number[] = [];
    // A slice of 1.5 ms, then two it says take 3 ms each.
    jobs.idle({}, (function* () {
      t.advance(1.5);
      ran.push(jobs.frame);
      yield 3;
      t.advance(3);
      ran.push(jobs.frame);
      yield 3;
      t.advance(3);
      ran.push(jobs.frame);
    })());
    for (let f = 0; f < 4; f++) jobs.run();
    // Frame 0: the first; the next would end at 4.5 ms, so it waits for
    // frame 1, where it is first, and the third, which would end at 6 ms,
    // for frame 2.
    expect(ran).toEqual([0, 1, 2]);
  });

  it("gives idle work only the budget left while no job is pending, and ends work it drops with return", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    let idleSlices = 0;
    let ended = 0;
    const idleWork = (): Slices => (function* () {
      try {
        for (;;) {
          t.advance(1);
          idleSlices++;
          yield;
        }
      } finally {
        ended++;
      }
    })();
    const owner = {};
    jobs.idle(owner, idleWork());
    const done = { at: null as number | null };
    jobs.begin({}, job(t, 6, 1, done, () => jobs.frame));
    jobs.run();
    // A job pending: its four slices, no idle work.
    expect([jobs.last.slices, jobs.last.idle, idleSlices]).toEqual([4, 0, 0]);
    jobs.run();
    // The job's last two slices, then idle work with the 2 ms left.
    expect([done.at, jobs.last.slices, jobs.last.idle]).toEqual([1, 2, 2]);
    jobs.run();
    expect(jobs.last.idle).toBe(4);
    // Replaced, and the new work cleared once it has run: each ended where
    // it stood.
    jobs.idle(owner, idleWork());
    expect(ended).toBe(1);
    jobs.run();
    jobs.idle(owner, null);
    jobs.run();
    expect([jobs.last.idle, ended]).toEqual([0, 2]);
    // A job dropped by its owner is ended the same way.
    let jobEnded = false;
    jobs.begin(owner, (function* () {
      try {
        for (;;) {
          t.advance(3);
          yield;
        }
      } finally {
        jobEnded = true;
      }
    })());
    jobs.run();
    expect(jobEnded).toBe(false);
    jobs.cancel(owner);
    expect(jobEnded).toBe(true);
  });

  it("shares the idle budget between owners a slice each in turn", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const order: string[] = [];
    const work = (name: string): Slices => (function* () {
      for (;;) {
        t.advance(1);
        order.push(name);
        yield;
      }
    })();
    jobs.idle({}, work("a"));
    jobs.idle({}, work("b"));
    jobs.run();
    expect(order).toEqual(["a", "b", "a", "b"]);
  });

  it("takes a job whose slice throws out of the queue, and throws", () => {
    const jobs = createSyncJobs(() => 0);
    const owner = {};
    jobs.begin(owner, (function* () {
      yield;
      throw new Error("broken slice");
    })());
    expect(() => jobs.run()).toThrow("broken slice");
    expect(jobs.pending(owner)).toBe(false);
    expect(() => jobs.run()).not.toThrow();
  });

  it("sorts in slices into exactly the order Array.prototype.sort leaves, ties as they came", () => {
    // A fixed pseudo-random list with many equal keys, tagged by position.
    let state = 7;
    const list: { key: number; at: number }[] = [];
    for (let at = 0; at < 20_000; at++) {
      state = (state * 48271) % 2147483647;
      list.push({ key: state % 997, at });
    }
    const byKey = (a: { key: number }, b: { key: number }): number => a.key - b.key;
    const want = [...list].sort(byKey);
    const got = [...list];
    const slices = sortSlices(got, byKey);
    let n = 0;
    while (slices.next().done !== true) n++;
    expect(got.map((e) => e.at)).toEqual(want.map((e) => e.at));
    // 20,000 elements over 15 passes, a slice ending at the first merge to
    // bring its moves to 8,192.
    expect(n).toBe(32);
    const empty: number[] = [];
    expect([...sortSlicesDone(empty), ...sortSlicesDone([3])]).toEqual([3]);
  });

  it("sorts the same order cut at every reading of the scheduler's clock, merges of the whole list included", () => {
    const keys = Array.from({ length: 5000 }, (_, i) => ({ k: (i * 7919) % 211, i }));
    const expected = [...keys].sort((a, b) => a.k - b.k);
    const list = [...keys];
    const run = runBySlices(sortSlices(list, (a, b) => a.k - b.k));
    expect(list).toEqual(expected);
    // Cut inside the passes: the count of elements moved alone makes 8 slices of these 5000 elements in 13 passes.
    expect(run.slices).toBeGreaterThan(30);
  });

  it("finish runs a job's slices to the end and returns its result", () => {
    let slices = 0;
    const result = finish((function* () {
      for (let i = 0; i < 5; i++) {
        slices++;
        yield;
      }
      return "built";
    })());
    expect([result, slices]).toEqual(["built", 5]);
  });
});

describe("an overdue job's share", () => {
  /** A job named `name` whose slices take, one after another, the milliseconds of `slices` and say what the next takes
   * (`said`, the same length less one; 0 says nothing); `done` is the frame its last ran in. */
  function told(t: { advance(ms: number): void }, slices: number[], said: number[], done: { at: number | null }, frame: () => number): Slices {
    return (function* () {
      for (let i = 0; i < slices.length; i++) {
        t.advance(slices[i] as number);
        if (i < slices.length - 1) yield said[i] as number;
      }
      done.at = frame();
    })();
  }

  it("runs the slices that fit in the overdue share each frame, and no frame spends more than the share and a slice", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    jobs.begin({}, job(t, 100, 1, done, () => jobs.frame));
    t.advance(SYNC_OVERDUE_MS);
    const overdue: number[] = [];
    const ms: number[] = [];
    while (done.at === null && overdue.length < 20) {
      jobs.run();
      overdue.push(jobs.last.overdue);
      ms.push(jobs.last.ms);
    }
    // 100 slices of 1 ms: eight shares of 12 and the last 4, shown in frame 8.
    expect(done.at).toBe(8);
    expect(overdue).toEqual([12, 12, 12, 12, 12, 12, 12, 12, 4]);
    expect(ms).toEqual([12, 12, 12, 12, 12, 12, 12, 12, 4]);
    expect(Math.max(...ms)).toBeLessThanOrEqual(SYNC_OVERDUE_BUDGET_MS + 1);
  });

  it("works off a hidden tab's jobs at the overdue share, oldest first, over the frames after", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = ["a", "b", "c"].map(() => ({ at: null as number | null }));
    // Three jobs of 20 slices of 1 ms; frame 0 runs four of the first.
    for (const [i, name] of ["a", "b", "c"].entries()) jobs.begin({}, job(t, 20, 1, done[i] as { at: number | null }, () => jobs.frame), false, name);
    jobs.run();
    // A minute hidden: all three overdue at once.
    t.advance(60_000);
    const frames: number[][] = [];
    while (done.some((d) => d.at === null) && frames.length < 10) {
      const before = t.clock();
      jobs.run();
      const by = jobs.last.overdueOwners;
      frames.push([t.clock() - before, jobs.last.overdue, jobs.last.overdueJobs, by.a ?? 0, by.b ?? 0, by.c ?? 0, jobs.last.late]);
    }
    // Each frame the share and no more, by the queue's order: a's 16, b's 20, c's 20.
    expect(frames).toEqual([
      [12, 12, 3, 12, 0, 0, 0],
      [12, 12, 3, 4, 8, 0, 0],
      [12, 12, 2, 0, 12, 0, 0],
      [12, 12, 1, 0, 0, 12, 0],
      [8, 8, 1, 0, 0, 8, 0],
    ]);
    expect(done.map((d) => d.at)).toEqual([2, 3, 5]);
  });

  it("starts an overdue slice said to be long when it is the frame's first, and holds it when another overdue job's ran first", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ahead = { at: null as number | null }, long = { at: null as number | null };
    // Frame 0: the first job's first slice takes nothing and says its next takes 5 ms, which does not fit, so it waits;
    // the second's takes 1 ms and says its next takes 20.
    jobs.begin({}, told(t, [0, 2], [5], ahead, () => jobs.frame), false, "ahead");
    jobs.begin({}, told(t, [1, 20], [20], long, () => jobs.frame), false, "long");
    jobs.run();
    expect([jobs.last.slices, jobs.last.ms]).toEqual([2, 1]);
    t.advance(SYNC_OVERDUE_MS);
    // Frame 1: the first's slice, 2 ms, which ends it; 2 + 20 is past the share, and no later share of the frame takes
    // it up, not even the ordinary one, which has 2 ms left and has run nothing yet.
    jobs.run();
    expect([ahead.at, long.at, jobs.last.overdue, jobs.last.slices, jobs.last.ms]).toEqual([1, null, 1, 1, 2]);
    // Frame 2: first in the frame, it starts whatever it says.
    jobs.run();
    expect([long.at, jobs.last.overdue, jobs.last.ms]).toEqual([2, 1, 20]);
  });

  it("gives an overdue job nothing past its share, and a late job behind it only what the late share has left", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ahead = { at: null as number | null }, long = { at: null as number | null }, late = { at: null as number | null };
    // Two overdue jobs as in the test above, and behind them one begun 999 ms before the overdue frame: late, not overdue.
    jobs.begin({}, told(t, [0, 5], [5], ahead, () => jobs.frame), false, "ahead");
    jobs.begin({}, told(t, [1, 20], [20], long, () => jobs.frame), false, "long");
    jobs.run();
    jobs.begin({}, job(t, 20, 1, late, () => jobs.frame), false, "late");
    t.advance(SYNC_OVERDUE_MS - 1);
    jobs.run();
    // The overdue share ends at 5 ms with the long slice held; the late job has the late share's other 3, the long
    // slice nothing, and the ordinary share is past.
    expect([jobs.last.overdueJobs, jobs.last.lateJobs, jobs.last.overdue, jobs.last.late, jobs.last.ms]).toEqual([2, 3, 1, 3, 8]);
    expect([jobs.last.owners.ahead, jobs.last.owners.long, jobs.last.owners.late]).toEqual([5, 0, 3]);
    expect([ahead.at, long.at, late.at]).toEqual([1, null, null]);

    // An overdue share that runs past the late one: the late job behind it gets nothing.
    const u = testClock();
    const busy = createSyncJobs(u.clock);
    busy.begin({}, job(u, 40, 1, { at: null }, () => busy.frame), false, "overdue");
    u.advance(SYNC_OVERDUE_MS - SYNC_LATE_MS_MAX);
    busy.begin({}, job(u, 20, 1, { at: null }, () => busy.frame), false, "late");
    u.advance(SYNC_LATE_MS_MAX);
    busy.run();
    expect([busy.last.overdueJobs, busy.last.lateJobs, busy.last.overdue, busy.last.late, busy.last.ms]).toEqual([1, 2, 12, 0, 12]);
    expect(busy.last.owners.late).toBeUndefined();
  });

  it("keeps a patient job a minute old to its floor slice", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const patient = { at: null as number | null };
    jobs.begin({}, job(t, 100, 1, patient, () => jobs.frame), true, "patches");
    t.advance(60_000);
    const busy = {};
    jobs.begin(busy, job(t, 400, 1, { at: null }, () => jobs.frame), false, "rings");
    const frames: number[][] = [];
    for (let f = 0; f < 3; f++) {
      jobs.run();
      frames.push([jobs.last.overdueJobs, jobs.last.overdue, jobs.last.lateJobs, jobs.last.floor, jobs.last.owners.patches ?? 0, jobs.last.owners.rings ?? 0]);
    }
    // Never overdue or late: the ordinary share goes to the job ahead, and the patient one has the floor's one slice.
    expect(frames).toEqual([
      [0, 0, 0, 1, 1, 4],
      [0, 0, 0, 1, 1, 4],
      [0, 0, 0, 1, 1, 4],
    ]);
  });

  it("begins a request held behind an overdue job as of the slice that shows it, so it is not overdue in that frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const first = { at: null as number | null }, held = { at: null as number | null };
    jobs.begin(owner, job(t, 12, 1, first, () => jobs.frame), false, "forest");
    jobs.run();
    jobs.begin(owner, job(t, 30, 1, held, () => jobs.frame), false, "forest");
    t.advance(2 * SYNC_OVERDUE_MS);
    jobs.run();
    // The first job's other 8 slices under the overdue share, which show it; the request held is begun at the last
    // one's reading, after the share began, and is neither overdue nor late: the ordinary share is past, so it waits.
    expect([first.at, held.at, jobs.last.overdueJobs, jobs.last.overdue, jobs.last.late, jobs.last.slices]).toEqual([1, null, 1, 8, 0, 8]);
    expect(jobs.pending(owner)).toBe(true);
    jobs.run();
    expect([jobs.last.overdueJobs, jobs.last.lateJobs, jobs.last.overdue, jobs.last.slices]).toEqual([0, 0, 0, 4]);
  });
});

describe("an owner's request while its job runs", () => {
  /** `slices` as a request whose ending with `return` is counted in `ended`: one never started has no `finally` to run. */
  function counted(slices: Slices, ended: { n: number }): Slices {
    const end = slices.return.bind(slices);
    slices.return = (value) => {
      ended.n++;
      return end(value);
    };
    return slices;
  }

  it("runs only the newest of several requests made while a job runs, and ends the others with return", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const ran: number[] = [];
    let runningEnded = false;
    const ended = { n: 0 };
    const request = (id: number): Slices => (function* () {
      ran.push(id);
      for (let i = 0; i < 8; i++) {
        t.advance(1);
        yield;
      }
    })();
    jobs.begin(owner, (function* () {
      try {
        for (let i = 0; i < 12; i++) {
          t.advance(1);
          yield;
        }
        ran.push(0);
      } finally {
        runningEnded = true;
      }
    })());
    jobs.run();
    // Three requests while it runs: each waits in the place of the one before, which is ended.
    for (let id = 1; id <= 3; id++) jobs.begin(owner, counted(request(id), ended));
    expect([ended.n, runningEnded]).toEqual([2, false]);
    for (let f = 0; f < 10 && jobs.pending(owner); f++) jobs.run();
    // The running one shown (its last slice, then its `finally`), then the newest; the two between never ran.
    expect(ran).toEqual([0, 3]);
    expect([ended.n, runningEnded, jobs.pending(owner)]).toEqual([2, true, false]);
  });

  it("drops the job and the request waiting behind it when its owner cancels", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    let runningEnded = false;
    const ended = { n: 0 };
    const shown = { at: null as number | null }, waiting = { at: null as number | null };
    jobs.begin(owner, (function* () {
      try {
        for (let i = 0; i < 12; i++) {
          t.advance(1);
          yield;
        }
        shown.at = jobs.frame;
      } finally {
        runningEnded = true;
      }
    })());
    jobs.run();
    jobs.begin(owner, counted(job(t, 4, 1, waiting, () => jobs.frame), ended));
    expect(jobs.pending(owner)).toBe(true);
    jobs.cancel(owner);
    expect([jobs.pending(owner), runningEnded, ended.n]).toEqual([false, true, 1]);
    for (let f = 0; f < 10; f++) jobs.run();
    expect([shown.at, waiting.at, jobs.last.slices]).toEqual([null, null, 0]);
  });

  it("shows something about every ten frames, and runs nothing overdue, for a view that asks again every second frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const shownAt: number[] = [];
    const overdue: number[] = [];
    let held = 0;
    // A drive: a crossing every second frame for ten seconds at 60 frames a second, each asking for a rebuild of 40
    // slices of 1 ms, ten frames of the ordinary share (eight with the late share it is given).
    for (let f = 0; f < 600; f++) {
      t.advance(1000 / 60);
      if (f % 2 === 0) jobs.begin(owner, (function* () {
        for (let i = 0; i < 40; i++) {
          t.advance(1);
          if (i < 39) yield;
        }
        shownAt.push(jobs.frame);
      })());
      jobs.run();
      overdue.push(jobs.last.overdue);
      held += jobs.last.held;
    }
    expect(overdue.every((n) => n === 0)).toBe(true);
    // Four slices a frame, late 100 ms (six frames) after it began and then eight: a rebuild shown every seventh frame,
    // the next begun as it is shown, from the first crossing to the last.
    const gaps = shownAt.slice(1).map((at, i) => at - (shownAt[i] as number));
    expect(shownAt[0]).toBe(7);
    expect(gaps.every((gap) => gap === 7)).toBe(true);
    expect(shownAt.length).toBe(85);
    // Each request that found its job started waited behind it: all but the first, and one every fourteen frames that
    // found the job begun as the last was shown not yet started, and took its place.
    expect(held).toBe(257);
  });

  it("begins the request waiting behind a job whose slice throws, so its owner is not left with nothing pending", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const done = { at: null as number | null };
    jobs.begin(owner, (function* () {
      t.advance(4);
      yield;
      throw new Error("broken slice");
    })());
    jobs.run();
    jobs.begin(owner, job(t, 2, 1, done, () => jobs.frame));
    expect(() => jobs.run()).toThrow("broken slice");
    expect(jobs.pending(owner)).toBe(true);
    // The frame whose share threw was not closed, so the request is begun and shown in frame 1.
    jobs.run();
    expect([done.at, jobs.pending(owner)]).toEqual([1, false]);
  });

  it("counts the requests held behind a started job in the record of the frame whose share follows, and resets each frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {}, other = {};
    // A new job, and one that replaces it before it starts: neither is held.
    jobs.begin(owner, job(t, 12, 1, { at: null }, () => jobs.frame));
    jobs.begin(owner, job(t, 12, 1, { at: null }, () => jobs.frame));
    jobs.begin(other, job(t, 12, 1, { at: null }, () => jobs.frame), true);
    jobs.run();
    expect(jobs.last.held).toBe(0);
    // Both have started: two requests held behind the one, one behind the other.
    jobs.begin(owner, job(t, 4, 1, { at: null }, () => jobs.frame));
    jobs.begin(owner, job(t, 4, 1, { at: null }, () => jobs.frame));
    jobs.begin(other, job(t, 4, 1, { at: null }, () => jobs.frame), true);
    jobs.run();
    expect(jobs.last.held).toBe(3);
    expect(syncJobsRecord(jobs.last).held).toBe(3);
    jobs.run();
    expect(jobs.last.held).toBe(0);
    expect(syncJobsRecord(jobs.last).held).toBe(0);
  });
});

describe("a view's next crossing", () => {
  it("is where it reaches first a line of the grid, a millimetre past it", () => {
    const out = new Float64Array(2);
    // Heading mostly along x: the x line at 11 comes before the z line at 11.
    expect(nextCrossing(10.5, 10.5, 1, 0.3, 1, out)).toBe(true);
    expect(out[0]).toBeCloseTo(11.001, 9);
    expect(out[1]).toBeCloseTo(10.5 + 0.501 * 0.3, 9);
    // Heading down z: the line below, then a millimetre under it.
    expect(nextCrossing(10.5, 10.25, 0, -0.1, 1, out)).toBe(true);
    expect([out[0], out[1]]).toEqual([10.5, 9.999]);
    // Standing still: none.
    expect(nextCrossing(10.5, 10.5, 0, 0, 1, out)).toBe(false);
  });

  it("is re-aimed when the view turns, and only then", () => {
    const h = { x: 0, z: 0 };
    expect(turn(h, 0.08, 0.02)).toBe(true);
    expect(turn(h, 0.09, 0.01)).toBe(false);
    expect(turn(h, 0, 0)).toBe(false);
    expect(turn(h, 0.09, -0.01)).toBe(true);
    expect(turn(h, Number.NaN, 1)).toBe(false);
    expect(h).toEqual({ x: 0.09, z: -0.01 });
  });
});

describe("crossingAt", () => {
  const CELL = 2;
  /** The page's clock, a frame of 60 a second on at every view unless a test says how long its frame was. */
  let clock = 0;
  const at = (c: ReturnType<typeof createCrossing>, x: number, z: number, deferrable = true, frameMs = 1000 / 60) =>
    crossingAt(c, x, z, Math.floor(x / CELL) * CELL, Math.floor(z / CELL) * CELL, CELL, deferrable, (clock += frameMs));

  it("builds the first view at once, then waits for a crossing", () => {
    const c = createCrossing();
    expect(at(c, 10.5, 10.5)).toBe("now");
    expect(at(c, 10.6, 10.6)).toBe("none");
    expect(at(c, 11.9, 10.6)).toBe("none");
  });

  it("makes a one-cell step at a walk or a run a job", () => {
    const c = createCrossing();
    at(c, 11.95, 10.5);
    // Walking, 5.25 m/s at 60 frames a second: 0.0875 m a frame.
    expect(at(c, 12.0375, 10.5)).toBe("later");
    // Running along the diagonal, both lines crossed in one frame.
    at(c, 13.95, 13.95);
    expect(at(c, 14.03, 14.03)).toBe("later");
  });

  it("builds at once after a teleport, at speed, and without a scheduler", () => {
    const c = createCrossing();
    at(c, 10.5, 10.5);
    // A teleport: 500 m in one frame.
    expect(at(c, 510.5, 10.5)).toBe("now");
    // The free camera's boost, 144 m/s: 2.4 m a frame, here a step of one
    // cell but more than half a cell since the last frame.
    at(c, 511.5, 10.5);
    expect(at(c, 513.9, 10.5)).toBe("now");
    // No scheduler.
    at(c, 515.9, 10.5);
    expect(at(c, 516.0, 10.5, false)).toBe("now");
    // A cell of 10 m: the boost's 2.4 m a frame is under half a cell, and
    // still more than a metre.
    const wide = createCrossing();
    const on10 = (x: number) => crossingAt(wide, x, 0, Math.floor(x / 10) * 10, 0, 10, true, (clock += 1000 / 60));
    on10(18.5);
    expect(on10(20.9)).toBe("now");
    on10(29.95);
    expect(on10(30.04)).toBe("later");
  });

  it("reads a step by the view's speed, so a slow frame at a sprint is a job and not a burst", () => {
    const c = createCrossing();
    at(c, 10.5, 10.5);
    // A sprint, 7 m/s, over one frame of 200 ms: 1.4 m, across a line. At 60 frames a second
    // that step is the free camera's (below); over 200 ms it is 0.117 m a frame, a run.
    expect(at(c, 11.9, 10.5, true, 200)).toBe("none");
    expect(at(c, 13.3, 10.5, true, 200)).toBe("later");
    // The same 1.4 m in one frame of 60 a second: at once.
    at(c, 13.9, 10.5);
    expect(at(c, 15.3, 10.5)).toBe("now");
    // The free camera's boost in a frame shorter than one of 60 a second is still a burst: 1.8 m in 12.5 ms.
    at(c, 15.5, 10.5);
    expect(at(c, 17.3, 10.5, true, 12.5)).toBe("now");
    // Several lines crossed over one slow frame is travel (13.2 m in 5 s), and a job like any other step.
    expect(at(c, 30.5, 10.5, true, 5000)).toBe("later");
    // A step no travel makes is a teleport, however long the frame.
    expect(at(c, 60.5, 10.5, true, 5000)).toBe("now");
    // A frame shorter than one of 60 a second is not scaled up: the uncapped page's 2 ms frames.
    const fast = createCrossing();
    at(fast, 11.95, 10.5);
    expect(at(fast, 12.0, 10.5, true, 2)).toBe("later");
  });

  it("makes the step a slow frame's simulation makes up a job, at a drive, whatever the shell's cell", () => {
    // 12 m/s. A frame of a second, of which the simulation makes up a quarter: 3 m, reckoned against that second.
    for (const cell of [1, 2, 3, 16]) {
      const c = createCrossing();
      const on = (x: number, frameMs = 1000 / 60) => crossingAt(c, x, 0, Math.floor(x / cell) * cell, 0, cell, true, (clock += frameMs));
      on(14.6);
      on(14.8);
      expect(on(17.8, 1000), `cell ${cell}`).toBe("later");
      // And the frame after it, a sixtieth of a second and 0.2 m on, is no burst either.
      expect(["none", "later"], `cell ${cell}`).toContain(on(18.0));
    }
    // 30 m/s, a quarter of a second made up in a frame of a quarter of a second: 7.5 m, under a teleport.
    const fast = createCrossing();
    const on16 = (x: number, frameMs = 1000 / 60) => crossingAt(fast, x, 0, Math.floor(x / 16) * 16, 0, 16, true, (clock += frameMs));
    on16(10);
    expect(on16(17.5, 250)).toBe("later");
  });

  it("reads the clock for a frame's views once, and again after the frame's share", () => {
    let t = 100;
    let reads = 0;
    const jobs = createSyncJobs(() => {
      reads++;
      return t;
    });
    expect(jobs.viewedAt()).toBe(100);
    t = 150;
    expect(jobs.viewedAt()).toBe(100);
    expect(reads).toBe(1);
    jobs.run();
    t = 200;
    expect(jobs.viewedAt()).toBe(200);
    expect(jobs.viewedAt()).toBe(200);
  });

  it("takes a first view's step as it is, having no frame before it", () => {
    const c = createCrossing();
    expect(Number.isNaN(c.lastAt)).toBe(true);
    expect(at(c, 10.5, 10.5, true, 5000)).toBe("now");
    expect(c.lastAt).toBe(clock);
  });
});

describe("the jobs' milliseconds, by owner", () => {
  it("counts a frame's slices' time under the owner's name, and the late run's time apart", () => {
    const { clock, advance } = testClock();
    const jobs = createSyncJobs(clock);
    const done = { at: null as number | null };
    jobs.begin({}, job({ advance }, 3, 0.5, done, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.ms).toBeCloseTo(1.5, 9);
    expect(jobs.last.lateMs).toBe(0);
    expect(jobs.last.owners.clipmap).toBeCloseTo(1.5, 9);
    expect(done.at).toBe(0);
    // A job of 50 slices of 1 ms gets 4 a frame; at its sixth frame it is late and gets the late share.
    const long = { at: null as number | null };
    jobs.begin({}, job({ advance }, 50, 1, long, () => jobs.frame), false, "forest");
    for (let f = 0; f < 6; f++) jobs.run();
    expect(jobs.last.owners.clipmap).toBe(0);
    expect(jobs.last.lateMs).toBe(0);
    expect(long.at).toBeNull();
    jobs.run();
    expect(long.at).toBeNull();
    expect(jobs.last.lateMs).toBe(8);
    expect(jobs.last.ms).toBe(jobs.last.lateMs);
    expect(jobs.last.owners.forest).toBe(jobs.last.ms);
    // The other 18 slices: eight, eight, then two, which end the job.
    jobs.run();
    jobs.run();
    expect(long.at).toBeNull();
    jobs.run();
    expect(long.at).toBe(10);
    expect(jobs.last.lateMs).toBe(2);
    // An unnamed owner counts under "other".
    jobs.begin({}, job({ advance }, 2, 0.25, { at: null }, () => jobs.frame));
    jobs.run();
    expect(jobs.last.owners.other).toBeCloseTo(0.5, 9);
  });
});

describe("a slice that ends by the clock", () => {
  /** A builder of `samples` samples, each costing `ms` of a test clock, that asks `sliceDue` after each; the slices it was cut into, by their samples. */
  function sampler(clock: { advance(ms: number): void }, samples: number, ms: number, cuts: number[]): Slices {
    return (function* () {
      let since = 0;
      for (let i = 0; i < samples; i++) {
        clock.advance(ms);
        since++;
        if (sliceDue()) {
          cuts.push(since);
          since = 0;
          yield;
        }
      }
      cuts.push(since);
    })();
  }

  it("ends by the target, held past it by at most one reading's interval of samples", () => {
    for (const ms of [0.01, 0.1, 0.4]) {
      const t = testClock();
      const jobs = createSyncJobs(t.clock);
      const cuts: number[] = [];
      const owner = {};
      jobs.begin(owner, sampler(t, 2000, ms, cuts));
      for (let frames = 0; jobs.pending(owner) && frames < 5000; frames++) jobs.run();
      // Every slice but the last ran its samples in a time that is at least the target (it ended because of it) and under the target and one reading's interval.
      const longest = Math.max(...cuts.slice(0, -1)) * ms;
      expect(Math.min(...cuts.slice(0, -1)) * ms).toBeGreaterThanOrEqual(SLICE_TARGET_MS - 1e-9);
      expect(longest).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * ms + 1e-9);
      expect(cuts.reduce((a, b) => a + b, 0)).toBe(2000);
    }
  });

  it("reads the clock once every SLICE_READ_UNITS units, not at every sample", () => {
    let reads = 0;
    let now = 0;
    const jobs = createSyncJobs(() => {
      reads++;
      return now;
    });
    jobs.begin({}, (function* () {
      const before = reads;
      for (let i = 0; i < 64; i++) sliceDue();
      // 64 calls: eight readings, none of them past the target.
      expect(reads - before).toBe(64 / SLICE_READ_UNITS);
      now += 0;
      yield;
    })());
    jobs.run();
    expect(reads).toBeGreaterThan(8);
  });

  it("counts a call's units: a unit more than the interval reads at once", () => {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const seen: boolean[] = [];
    jobs.begin({}, (function* () {
      now += 2;
      seen.push(sliceDue(1), sliceDue(SLICE_READ_UNITS));
      yield;
    })());
    jobs.run();
    expect(seen).toEqual([false, true]);
  });

  it("is false outside a scheduler's slice, so a build at once runs through", () => {
    expect(sliceDue()).toBe(false);
    expect(sliceDue(1000)).toBe(false);
    const cuts: number[] = [];
    const t = testClock();
    const slices = sampler(t, 500, 1, cuts);
    finish(slices);
    expect(cuts).toEqual([500]);
  });

  it("is not carried from one slice into the next, or out of the scheduler", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const cuts: number[] = [];
    jobs.begin({}, sampler(t, 100, 0.5, cuts));
    jobs.run();
    // After a share the gate is closed again.
    expect(sliceDue(1000)).toBe(false);
    // And a slice that begins late in a frame is given its own target, not what was left of the last.
    jobs.run();
    expect(cuts.slice(0, 2).every((n) => n * 0.5 >= SLICE_TARGET_MS - 1e-9)).toBe(true);
  });

  it("gives idle work the same bound", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const cuts: number[] = [];
    jobs.idle({}, sampler(t, 1000, 0.1, cuts));
    for (let f = 0; f < 200 && cuts.reduce((a, b) => a + b, 0) < 1000; f++) jobs.run();
    expect(Math.max(...cuts.slice(0, -1)) * 0.1).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * 0.1 + 1e-9);
    expect(jobs.last.longest.idle).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * 0.1 + 1e-9);
  });
});

describe("what an apply step takes", () => {
  /** A job that does `small` slices of `smallMs`, says its apply takes `said` ms, and then spends `real` ms in it. */
  function applying(t: { advance(ms: number): void }, small: number, smallMs: number, said: number, real: number, done: { at: number | null }, frame: () => number): Slices {
    return (function* () {
      for (let i = 0; i < small; i++) {
        t.advance(smallMs);
        yield;
      }
      yield said;
      t.advance(real);
      done.at = frame();
    })();
  }

  it("learns an owner's figure from what its announced slices took", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    jobs.begin({}, applying(t, 0, 0, 1, 6, done, () => jobs.frame), false, "forest");
    jobs.run();
    expect(jobs.last.learned.forest).toBe(6);
    expect(done.at).toBe(0);
    // A second one weighs in at a quarter.
    // (Its apply, learned to take 6 ms, waits for a frame it is first in.)
    jobs.begin({}, applying(t, 0, 0, 1, 2, done, () => jobs.frame), false, "forest");
    jobs.run();
    jobs.run();
    expect(jobs.last.learned.forest).toBeCloseTo(5, 9);
  });

  it("keeps an apply out of a frame it does not fit, by the learned figure where it is more than the builder's", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null };
    // The first teaches the scheduler that "forest" applies take 3 ms where they say 1.
    jobs.begin({}, applying(t, 0, 0, 1, 3, first, () => jobs.frame), false, "forest");
    jobs.run();
    // A frame that has spent 2 ms on an older job: the apply says 1 ms and would fit in the 4, but it is learned to take 3.
    jobs.begin({}, job(t, 2, 1.5, { at: null }, () => jobs.frame));
    jobs.begin({}, applying(t, 0, 0, 1, 3, second, () => jobs.frame), false, "forest");
    jobs.run();
    expect(second.at).toBeNull();
    // Next frame it is first in the frame, so it runs whatever it takes.
    jobs.run();
    expect(second.at).toBe(2);
    expect(first.at).toBe(0);
  });

  it("starts an apply that is the first slice of a frame whatever it is learned to take, and never holds it for ever", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    // An apply learned at 30 ms, far past the share.
    jobs.begin({}, applying(t, 0, 0, 1, 30, { at: null }, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.learned.clipmap).toBe(30);
    // Behind a job of 40 slices of 1 ms: the apply waits while that job takes the share, then is first in a frame.
    const owner = {};
    jobs.begin({}, job(t, 6, 1, { at: null }, () => jobs.frame));
    jobs.begin(owner, applying(t, 0, 0, 1, 30, done, () => jobs.frame), false, "clipmap");
    for (let f = 0; f < 10 && done.at === null; f++) jobs.run();
    expect(done.at).not.toBeNull();
    expect(jobs.pending(owner)).toBe(false);
  });

  it("trusts what a builder says when it is more than the learned figure", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const learned = { at: null as number | null }, later = { at: null as number | null };
    jobs.begin({}, applying(t, 0, 0, 1, 0.5, learned, () => jobs.frame), false, "clipmap");
    jobs.run();
    // 2 ms of another job's, then an apply that says 3: 2 + 3 > 4, so it waits.
    jobs.begin({}, job(t, 1, 2, { at: null }, () => jobs.frame));
    jobs.begin({}, applying(t, 0, 0, 3, 0.5, later, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(later.at).toBeNull();
  });

  it("does not learn from a slice that said nothing", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    jobs.begin({}, job(t, 3, 0.5, { at: null }, () => jobs.frame), false, "clutter");
    jobs.run();
    expect(jobs.last.learned.clutter).toBeUndefined();
  });

  it("holds an apply that does not fit the late share to the next frame too", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const done = { at: null as number | null };
    // Teach "forest" 5 ms.
    jobs.begin({}, applying(t, 0, 0, 5, 5, { at: null }, () => jobs.frame), false, "forest");
    jobs.run();
    // A late job that has used 4 ms of the late share, then another whose apply is 5: 4 + 5 > 8, so it waits.
    const slow = {};
    jobs.begin(slow, job(t, 200, 1, { at: null }, () => jobs.frame));
    jobs.begin(owner, applying(t, 0, 0, 1, 5, done, () => jobs.frame), false, "forest");
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX; f++) jobs.run();
    jobs.run();
    expect(jobs.last.late).toBeGreaterThan(0);
    expect(done.at).toBeNull();
  });
});

describe("the longest slice an owner ran", () => {
  it("records the longest single slice by owner until it is reset", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    jobs.begin({}, (function* () {
      t.advance(1);
      yield;
      t.advance(3);
      yield;
      t.advance(2);
    })(), false, "clipmap");
    jobs.run();
    jobs.run();
    expect(jobs.last.longest.clipmap).toBe(3);
    jobs.begin({}, job(t, 1, 2.5, { at: null }, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.longest.clipmap).toBe(3);
    jobs.resetLongest();
    jobs.begin({}, job(t, 1, 0.5, { at: null }, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.longest.clipmap).toBe(0.5);
  });
});

describe("a patient job under busy jobs", () => {
  it("is given one slice a frame the other jobs' share left none for, and no more than the late share and a slice is spent", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const patches = {};
    const patchesDone = { at: null as number | null };
    // The ordinary jobs take the whole share for ever: a new one of 50 slices of 1 ms whenever the last ends.
    const busy = {};
    const keepBusy = (): Slices => (function* () {
      for (let i = 0; i < 50; i++) {
        t.advance(1);
        yield;
      }
    })();
    jobs.begin(busy, keepBusy());
    jobs.begin(patches, job(t, 20, 1, patchesDone, () => jobs.frame), true);
    const spent: number[] = [];
    let floors = 0;
    for (let f = 0; f < 60 && patchesDone.at === null; f++) {
      if (!jobs.pending(busy)) jobs.begin(busy, keepBusy());
      const before = t.clock();
      jobs.run();
      spent.push(t.clock() - before);
      floors += jobs.last.floor;
    }
    // Four slices of the busy job take the ordinary share, and the patient job's slice is the fifth: 5 ms a frame, and it ends.
    expect(patchesDone.at).not.toBeNull();
    expect(floors).toBeGreaterThan(15);
    expect(Math.max(...spent)).toBeLessThanOrEqual(SYNC_LATE_BUDGET_MS + 1.5);
    expect(jobs.pending(patches)).toBe(false);
  });

  it("holds a patient apply that does not fit to the next frames, and gives it a slice once it has waited for the floor", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    // The ordinary jobs take the whole share for ever.
    const busy = {};
    const keepBusy = (): Slices => (function* () {
      for (let i = 0; i < 400; i++) {
        t.advance(1);
        yield;
      }
    })();
    jobs.begin(busy, keepBusy());
    // A patient job whose apply says it takes 6 ms, after a first slice that takes nothing.
    jobs.begin({}, (function* () {
      yield;
      yield 6;
      t.advance(6);
      done.at = jobs.frame;
    })(), true);
    jobs.run();
    // The first slice is the floor's; the apply would end at 4 + 6, past 9.5, so it waits.
    expect(jobs.last.floor).toBe(1);
    let waited = 0;
    while (done.at === null && waited < 100) {
      jobs.run();
      waited++;
    }
    // The second slice (which says what the apply takes) is the next frame's floor; the apply then waits the frames it is given, and starts whatever it says.
    expect(waited).toBe(SYNC_PATIENT_WAIT_FRAMES + 2);
    expect(done.at).not.toBeNull();
  });

  it("changes nothing for a frame in which a patient job already ran, or where there is none", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    jobs.begin({}, job(t, 3, 1, { at: null }, () => jobs.frame), true);
    jobs.run();
    expect(jobs.last.floor).toBe(0);
    jobs.begin({}, job(t, 3, 1, { at: null }, () => jobs.frame));
    jobs.run();
    expect(jobs.last.floor).toBe(0);
  });
});

describe("the read-out of what is built at once and how crossings were judged", () => {
  /** A scheduler on a clock the test advances by hand, and counts the readings of. */
  function watched(on = true) {
    let now = 0;
    let reads = 0;
    const jobs = createSyncJobs(() => {
      reads++;
      return now;
    });
    jobs.watch(on);
    return { jobs, advance: (ms: number) => { now += ms; }, reads: () => reads };
  }

  it("records a build made at once under its owner, with its count and its milliseconds, in the frame whose share follows", () => {
    const { jobs, advance } = watched();
    for (const ms of [2.5, 1]) {
      const at = jobs.atOnceStart();
      advance(ms);
      jobs.atOnceEnd("clipmap", at);
    }
    const at = jobs.atOnceStart();
    advance(4);
    jobs.atOnceEnd("clutter", at);
    jobs.run();
    expect(jobs.last.atOnce).toEqual({ clipmap: 2, clutter: 1 });
    expect(jobs.last.atOnceMs.clipmap).toBeCloseTo(3.5, 9);
    expect(jobs.last.atOnceMs.clutter).toBeCloseTo(4, 9);
    expect(syncJobsRecord(jobs.last).atOnce).toEqual({ clipmap: 2, clutter: 1 });
  });

  it("does not count a sliced job as built at once, and resets each frame", () => {
    const { jobs, advance } = watched();
    const done = { at: null as number | null };
    jobs.begin({}, job({ advance }, 3, 0.5, done, () => jobs.frame), false, "forest");
    const at = jobs.atOnceStart();
    advance(1);
    jobs.atOnceEnd("clipmap", at);
    jobs.run();
    expect(done.at).toBe(0);
    expect(jobs.last.atOnce).toEqual({ clipmap: 1 });
    expect(jobs.last.owners.forest).toBeGreaterThan(0);
    expect(jobs.last.atOnce.forest).toBeUndefined();
    // The next frame built nothing at once: the owner stays in the record at 0 and the page's copy leaves it out.
    jobs.run();
    expect(jobs.last.atOnce.clipmap).toBe(0);
    expect(jobs.last.atOnceMs.clipmap).toBe(0);
    expect(syncJobsRecord(jobs.last).atOnce).toEqual({});
    expect(syncJobsRecord(jobs.last).atOnceMs).toEqual({});
  });

  it("tells an overdue job's share from the same frame's ordinary slices", () => {
    const { jobs, advance } = watched();
    const done = { at: null as number | null };
    jobs.begin({}, job({ advance }, 30, 1, done, () => jobs.frame), false, "forest");
    advance(SYNC_OVERDUE_MS);
    jobs.begin({}, job({ advance }, 2, 0.25, { at: null }, () => jobs.frame), false, "props");
    jobs.run();
    expect(done.at).toBeNull();
    expect(jobs.last.overdueJobs).toBe(1);
    expect(jobs.last.overdueMs).toBeCloseTo(12, 9);
    expect(jobs.last.overdueOwners.forest).toBeCloseTo(12, 9);
    expect(jobs.last.overdueOwners.props).toBeUndefined();
    // The overdue share took the frame's: it is all of what the frame spent, and counted as late's too. The ordinary
    // share, already past, gave the job behind it nothing.
    expect(jobs.last.ms).toBeCloseTo(jobs.last.overdueMs, 9);
    expect(jobs.last.lateMs).toBeCloseTo(jobs.last.overdueMs, 9);
    expect(jobs.last.owners.props).toBeUndefined();
    // Twelve more, then the last six, which show it; then a frame with nothing overdue.
    jobs.run();
    expect([done.at, jobs.last.overdueMs, jobs.last.overdueOwners.forest]).toEqual([null, 12, 12]);
    jobs.run();
    expect([done.at, jobs.last.overdueMs, jobs.last.overdueOwners.forest, jobs.last.owners.props]).toEqual([2, 6, 6, undefined]);
    jobs.run();
    expect(jobs.last.overdueMs).toBe(0);
    expect(jobs.last.overdueOwners.forest).toBe(0);
    expect(jobs.last.owners.props).toBe(0.5);
  });

  it("records each verdict with the rule that decided it, the step and the time it judged", () => {
    const { jobs } = watched();
    const c = createCrossing();
    let t = 1000;
    const view = (x: number, cell: number, frameMs = 1000 / 60) =>
      crossingAt(c, x, 0, Math.floor(x / cell) * cell, 0, cell, true, (t += frameMs), jobs, "ring");
    // First build.
    expect(view(10.5, 2)).toBe("now");
    jobs.run();
    expect(jobs.last.crossingCount).toBe(1);
    expect(jobs.last.crossings[0]).toMatchObject({ owner: "ring", kind: "now", rule: "first" });
    expect(Number.isNaN(jobs.last.crossings[0]?.step)).toBe(true);
    // A teleport.
    view(10.6, 2);
    expect(view(110.5, 2)).toBe("now");
    // A step over half a cell in a sixtieth: the fast-step rule, judged at its own step.
    view(111.5, 2);
    expect(view(113.9, 2)).toBe("now");
    // A one-cell step at a walk: a job, decided by no rule.
    view(113.95, 2);
    expect(view(114.0375, 2)).toBe("later");
    jobs.run();
    const [jump, fast, later] = jobs.last.crossings;
    expect(jobs.last.crossingCount).toBe(3);
    expect(jump).toMatchObject({ owner: "ring", kind: "now", rule: "jump" });
    expect(jump?.step).toBeCloseTo(99.9, 9);
    expect(fast).toMatchObject({ kind: "now", rule: "fast" });
    expect(fast?.step).toBeCloseTo(2.4, 9);
    expect(fast?.moved).toBeCloseTo(2.4, 9);
    expect(fast?.elapsedMs).toBeCloseTo(1000 / 60, 9);
    expect(later).toMatchObject({ kind: "later", rule: "none" });
    expect(later?.step).toBeCloseTo(0.0875, 9);
  });

  it("scales a step over a long frame to a sixtieth of a second and records both, and the longer time", () => {
    const { jobs } = watched();
    const c = createCrossing();
    crossingAt(c, 5.95, 0, 4, 0, 4, true, 1000, jobs, "clutter");
    expect(crossingAt(c, 7.15, 0, 4, 0, 4, true, 1120, jobs, "clutter")).toBe("none");
    // 1.2 m in 120 ms is 0.17 m a sixtieth: a job, with the step as it moved and as judged.
    expect(crossingAt(c, 8.35, 0, 8, 0, 4, true, 1240, jobs, "clutter")).toBe("later");
    jobs.run();
    const judged = jobs.last.crossings[jobs.last.crossingCount - 1];
    expect(judged?.step).toBeCloseTo(1.2, 9);
    expect(judged?.moved).toBeCloseTo(0.1667, 3);
    expect(judged?.elapsedMs).toBeCloseTo(120, 9);
  });

  it("records the crossings of each frame in the record of the frame, not the one after", () => {
    const { jobs } = watched();
    const c = createCrossing();
    crossingAt(c, 1, 0, 0, 0, 2, true, 10, jobs, "a");
    jobs.run();
    expect(jobs.last.crossingCount).toBe(1);
    jobs.run();
    expect(jobs.last.crossingCount).toBe(0);
    expect(syncJobsRecord(jobs.last).crossings).toEqual([]);
  });

  it("writes in place: its entries are reused from frame to frame, and the page's copy is its own", () => {
    const { jobs } = watched();
    crossingAt(createCrossing(), 1, 0, 0, 0, 2, true, 10, jobs, "a");
    jobs.run();
    const copy = syncJobsRecord(jobs.last);
    const entry = jobs.last.crossings[0];
    crossingAt(createCrossing(), 9, 0, 8, 0, 2, true, 20, jobs, "b");
    jobs.run();
    crossingAt(createCrossing(), 9, 0, 8, 0, 2, true, 30, jobs, "c");
    jobs.run();
    // Two buffers swap, so an entry made in frame 1 is written again by frame 3, and not a new one made.
    expect(jobs.last.crossings[0]).toBe(entry);
    expect(jobs.last.crossings[0]?.owner).toBe("c");
    expect(copy.crossings[0]?.owner).toBe("a");
    expect(copy.crossings[0]).not.toBe(entry);
  });

  it("records no picture as owing a rebuild while it is off, and reads the clock no more often on", () => {
    // The same frames on and off: a job begun, a request held behind it once it has started, two more, and its end.
    const frames = (on: boolean) => {
      const w = watched(on);
      const owner = {};
      w.jobs.begin(owner, job({ advance: w.advance }, 12, 1, { at: null }, () => w.jobs.frame), false, "forest");
      w.jobs.run();
      w.jobs.begin(owner, job({ advance: w.advance }, 2, 1, { at: null }, () => w.jobs.frame), false, "forest");
      w.jobs.viewedAt();
      w.jobs.begin(owner, job({ advance: w.advance }, 2, 1, { at: null }, () => w.jobs.frame), false, "forest");
      for (let f = 0; f < 4; f++) w.jobs.run();
      return w;
    };
    const off = frames(false);
    expect(off.jobs.last.owedMs).toEqual({});
    expect(syncJobsRecord(off.jobs.last).owedMs).toEqual({});
    expect(off.reads()).toBe(frames(true).reads());
  });

  it("records how long a job's picture has owed its rebuild, from its begin, frame by frame, and 0 once it is shown", () => {
    const { jobs, advance } = watched();
    const done = { at: null as number | null };
    advance(10);
    // 10 slices of 1 ms: four a frame, shown in frame 2.
    jobs.begin({}, job({ advance }, 10, 1, done, () => jobs.frame), false, "forest");
    const owed: number[] = [];
    for (let f = 0; f < 4; f++) {
      advance(6);
      jobs.run();
      owed.push(jobs.last.owedMs.forest as number);
    }
    // Begun at 10; the shares begin at 16, 26 (16 + 4 of slices + 6) and 36; at 44 it has been shown.
    expect(owed).toEqual([6, 16, 26, 0]);
    expect(done.at).toBe(2);
    expect(syncJobsRecord(jobs.last).owedMs).toEqual({});
  });

  it("keeps a replaced job's owed time from the first request, which the picture still does not answer", () => {
    const { jobs, advance } = watched();
    const owner = {};
    advance(10);
    jobs.begin(owner, job({ advance }, 10, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(20);
    jobs.begin(owner, job({ advance }, 10, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(10);
    jobs.run();
    expect(jobs.last.owedMs).toEqual({ forest: 30 });
    expect(syncJobsRecord(jobs.last).owedMs).toEqual({ forest: 30 });
  });

  it("owes a request held behind a started job from its frame's time once that job is shown, not from the first request or from its begin", () => {
    const { jobs, advance } = watched();
    const owner = {};
    const first = { at: null as number | null }, held = { at: null as number | null };
    // 12 slices of 1 ms, begun at 0: four a frame, shown in frame 2.
    jobs.begin(owner, job({ advance }, 12, 1, first, () => jobs.frame), false, "forest");
    advance(5);
    jobs.run();
    advance(3);
    jobs.run();
    // Frame 1's share began at 12: the request held now is owed from then.
    jobs.begin(owner, job({ advance }, 2, 1, held, () => jobs.frame), false, "forest");
    const owed: number[] = [jobs.last.owedMs.forest as number];
    advance(4);
    jobs.run();
    owed.push(jobs.last.owedMs.forest as number);
    // Frame 2 began at 20 and showed the first job at 24, its last slice begun at 23, the held request begun there.
    expect(first.at).toBe(2);
    advance(6);
    jobs.run();
    owed.push(jobs.last.owedMs.forest as number);
    advance(6);
    jobs.run();
    owed.push(jobs.last.owedMs.forest as number);
    // From 12, as frame 3's share begins at 30: not 30 (from the first request, at 0) and not 7 (from its begin, at 23).
    expect(owed).toEqual([12, 20, 18, 0]);
    expect(held.at).toBe(3);
  });

  it("owes the newest of several requests held behind a started job from the first held, as the frame's view was judged", () => {
    const { jobs, advance } = watched();
    const owner = {};
    const first = { at: null as number | null }, newest = { at: null as number | null };
    jobs.begin(owner, job({ advance }, 12, 1, first, () => jobs.frame), false, "forest");
    jobs.run();
    // The frame's view judged at 10, before its first request; the second and third are asked a frame later.
    advance(6);
    expect(jobs.viewedAt()).toBe(10);
    jobs.begin(owner, job({ advance }, 2, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(5);
    jobs.run();
    advance(1);
    jobs.begin(owner, job({ advance }, 2, 1, { at: null }, () => jobs.frame), false, "forest");
    jobs.begin(owner, job({ advance }, 2, 1, newest, () => jobs.frame), false, "forest");
    advance(10);
    jobs.run();
    expect([first.at, jobs.last.owedMs.forest]).toEqual([2, 30]);
    advance(6);
    jobs.run();
    // At 40, from the first held at 10: not 25 (frame 1's share, when the second was asked) and not 7 (the newest's begin at 33).
    expect([newest.at, jobs.last.owedMs.forest]).toEqual([3, 30]);
    jobs.run();
    expect(jobs.last.owedMs.forest).toBe(0);
  });

  it("owes nothing for an owner whose job is cancelled, and counts its next request afresh", () => {
    const { jobs, advance } = watched();
    const owner = {};
    jobs.begin(owner, job({ advance }, 12, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(5);
    jobs.run();
    expect(jobs.last.owedMs.forest).toBe(5);
    // A request held behind it, then both dropped.
    jobs.begin(owner, job({ advance }, 2, 1, { at: null }, () => jobs.frame), false, "forest");
    jobs.cancel(owner);
    advance(5);
    jobs.run();
    expect(jobs.last.owedMs.forest).toBe(0);
    // A new request at 19, its share at 29.
    jobs.begin(owner, job({ advance }, 1, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(10);
    jobs.run();
    expect(jobs.last.owedMs.forest).toBe(10);
    jobs.run();
    expect(jobs.last.owedMs.forest).toBe(0);
  });

  it("keeps each owner's owed time apart", () => {
    const { jobs, advance } = watched();
    const forest = {};
    jobs.begin(forest, job({ advance }, 2, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(5);
    jobs.begin({}, job({ advance }, 2, 1, { at: null }, () => jobs.frame), false, "props");
    advance(5);
    jobs.run();
    expect(jobs.last.owedMs).toEqual({ forest: 10, props: 5 });
    // Both shown at 14; forest asks again at 20, and the share at 25 owes it 5 and props nothing.
    advance(6);
    jobs.begin(forest, job({ advance }, 2, 1, { at: null }, () => jobs.frame), false, "forest");
    advance(5);
    jobs.run();
    expect(jobs.last.owedMs).toEqual({ forest: 5, props: 0 });
    expect(syncJobsRecord(jobs.last).owedMs).toEqual({ forest: 5 });
  });

  it("records nothing and reads no clock while it is off, and changes no verdict", () => {
    const off = watched(false);
    const on = watched(true);
    const verdicts = (jobs: SyncJobs | undefined) => {
      const c = createCrossing();
      return [10.5, 10.6, 110.5, 111.5, 113.9, 113.95, 114.0375].map((x, i) => crossingAt(c, x, 0, Math.floor(x / 2) * 2, 0, 2, true, 1000 + (i * 1000) / 60, jobs, "ring"));
    };
    expect(verdicts(off.jobs)).toEqual(verdicts(on.jobs));
    expect(verdicts(off.jobs)).toEqual(verdicts(undefined));
    const at = off.jobs.atOnceStart();
    expect(Number.isNaN(at)).toBe(true);
    off.jobs.atOnceEnd("clipmap", at);
    off.jobs.judged("ring", "now", "first", 0, 0, 0);
    expect(off.reads()).toBe(0);
    off.jobs.run();
    expect(off.jobs.last.atOnce).toEqual({});
    expect(off.jobs.last.crossingCount).toBe(0);
    expect(off.jobs.last.crossings).toEqual([]);
    expect(off.jobs.watching).toBe(false);
  });
});

describe("a slice that waits", () => {
  /** A scheduler whose clock advances 0.01 ms on every reading, and `skip` to move it on by hand. */
  function ticking() {
    let now = 0;
    const jobs = createSyncJobs(() => (now += 0.01));
    return { jobs, skip: (ms: number) => { now += ms; } };
  }

  /** A slice that yields `SLICE_WAITS` for ever, counting its resumes. */
  function waiter(count: { n: number }): Slices {
    return (function* () {
      for (;;) {
        count.n++;
        yield SLICE_WAITS;
      }
    })();
  }

  it("a job that yields SLICE_WAITS is resumed at most once in a frame's share", () => {
    const { jobs } = ticking();
    const count = { n: 0 };
    jobs.begin({}, waiter(count));
    jobs.run();
    expect([count.n, jobs.last.waits, jobs.last.slices]).toEqual([1, 1, 0]);
  });

  it("resumes a late job that yields SLICE_WAITS once a frame, not once per loop", () => {
    const { jobs, skip } = ticking();
    const count = { n: 0 };
    jobs.begin({}, waiter(count));
    skip(200);
    jobs.run();
    expect([count.n, jobs.last.waits, jobs.last.slices, jobs.last.late, jobs.last.lateJobs]).toEqual([1, 1, 0, 0, 1]);
  });

  it("resumes an overdue job that yields SLICE_WAITS once a frame, not once per loop", () => {
    const { jobs, skip } = ticking();
    const count = { n: 0 };
    jobs.begin({}, waiter(count));
    skip(2000);
    jobs.run();
    expect([count.n, jobs.last.waits, jobs.last.slices, jobs.last.overdue, jobs.last.overdueJobs]).toEqual([1, 1, 0, 0, 1]);
  });

  it("resumes a patient job that yields SLICE_WAITS once a frame, floor included", () => {
    const { jobs } = ticking();
    const count = { n: 0 };
    jobs.begin({}, waiter(count), true);
    jobs.run();
    expect([count.n, jobs.last.waits, jobs.last.slices, jobs.last.floor]).toEqual([1, 1, 0, 0]);
  });

  it("a waiting slice does not take the frame's first-slice allowance", () => {
    const { jobs } = ticking();
    const count = { n: 0 };
    let slicesB = 0;
    jobs.begin({}, waiter(count));
    jobs.begin({}, (function* () {
      for (;;) {
        slicesB++;
        yield 20;
      }
    })());
    // Frame 1: A waits and B runs a slice, which announces that its next takes 20 ms.
    jobs.run();
    expect([count.n, slicesB, jobs.last.slices, jobs.last.waits]).toEqual([1, 1, 1, 1]);
    // Frame 2: that slice fits nowhere in the 4 ms share, so it runs only as the frame's first real slice, which A's wait must not have used.
    jobs.run();
    expect([count.n, slicesB, jobs.last.slices, jobs.last.waits]).toEqual([2, 2, 1, 1]);
  });

  it("a waiting job is tried again next frame", () => {
    const { jobs } = ticking();
    let ready = false;
    let waits = 0;
    jobs.begin({}, (function* () {
      for (;;) {
        if (!ready) {
          waits++;
          yield SLICE_WAITS;
        } else return;
      }
    })());
    jobs.run();
    expect([waits, jobs.last.waits, jobs.last.slices]).toEqual([1, 1, 0]);
    ready = true;
    jobs.run();
    expect([jobs.last.slices, jobs.last.waits, jobs.last.completed, jobs.pending({})]).toEqual([1, 0, 1, false]);
  });

  it("idle work that yields SLICE_WAITS is resumed once a frame", () => {
    const { jobs } = ticking();
    const count = { n: 0 };
    jobs.idle({}, waiter(count));
    jobs.run();
    expect([count.n, jobs.last.idle, jobs.last.waits]).toEqual([1, 0, 1]);
    jobs.run();
    expect([count.n, jobs.last.idle, jobs.last.waits]).toEqual([2, 0, 1]);
  });

  it("finish throws on a slice that waits", () => {
    expect(() => finish(waiter({ n: 0 }))).toThrow(/waits/);
  });

  it("stepSlices throws on a slice that waits", async () => {
    const count = { n: 0 };
    await expect(stepSlices(waiter(count), 8)).rejects.toThrow(/waits/);
    expect(count.n).toBe(1);
  });

  /** Idle work of slices of 1 ms on `t`, counting them. */
  function idleWork(t: { advance(ms: number): void }, count: { n: number }): Slices {
    return (function* () {
      for (;;) {
        t.advance(1);
        count.n++;
        yield;
      }
    })();
  }

  it("runs idle work in a frame whose only job that is not patient waited", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran = { n: 0 };
    jobs.idle({}, idleWork(t, ran));
    jobs.begin({}, waiter({ n: 0 }));
    jobs.run();
    // The job waited and took nothing: the whole share is the idle work's.
    expect([jobs.last.waits, jobs.last.slices, jobs.last.idle, ran.n]).toEqual([1, 0, 4, 4]);
    jobs.run();
    expect([jobs.last.waits, jobs.last.idle, ran.n]).toEqual([1, 4, 8]);
  });

  it("runs no idle work while a job that is not patient and did not wait is pending, with share left", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran = { n: 0 };
    jobs.idle({}, idleWork(t, ran));
    // A slice of 1 ms that says the next takes 5: it does not fit in the 3 ms left, and the job stays pending.
    jobs.begin({}, (function* () {
      t.advance(1);
      yield 5;
      t.advance(5);
    })());
    jobs.run();
    expect([jobs.last.slices, jobs.last.waits, jobs.last.idle, ran.n]).toEqual([1, 0, 0, 0]);
    // Its long slice first, which ends it, then idle work with nothing left: none; the frame after, the idle work's.
    jobs.run();
    expect([jobs.last.slices, jobs.last.completed, jobs.last.idle]).toEqual([1, 1, 0]);
    jobs.run();
    expect([jobs.last.idle, ran.n]).toEqual([4, 4]);
  });

  it("runs idle work beside a job that waits and a patient job as it does beside the patient job alone", () => {
    /** A patient job whose slices take 2 ms and say the next takes 3, and idle work; with `wait`, a job that waits besides. */
    const frameOf = (wait: boolean): number[] => {
      const t = testClock();
      const jobs = createSyncJobs(t.clock);
      const ran = { n: 0 };
      jobs.idle({}, idleWork(t, ran));
      if (wait) jobs.begin({}, waiter({ n: 0 }));
      jobs.begin({}, (function* () {
        for (;;) {
          t.advance(2);
          yield 3;
        }
      })(), true);
      const seen: number[] = [];
      for (let f = 0; f < 3; f++) {
        jobs.run();
        seen.push(jobs.last.slices, jobs.last.idle, jobs.last.floor);
      }
      return [...seen, ran.n];
    };
    // Its slice, then idle work with the 2 ms left, each frame.
    expect(frameOf(false)).toEqual([1, 2, 0, 1, 2, 0, 1, 2, 0, 6]);
    expect(frameOf(true)).toEqual(frameOf(false));
  });

  it("keeps counting owedMs for a job that is waiting", () => {
    let now = 0;
    const jobs = createSyncJobs(() => (now += 0.01));
    jobs.watch(true);
    now = 10;
    jobs.begin({}, waiter({ n: 0 }), false, "forest");
    const owed: number[] = [];
    for (let f = 0; f < 3; f++) {
      now += 6;
      jobs.run();
      owed.push(Math.round(jobs.last.owedMs.forest as number));
    }
    expect(owed).toEqual([6, 12, 18]);
  });
});
