/**
 * The renderer's rebuilds, spread over frames under a per-frame budget.
 *
 * A rebuild that a crossing starts — the terrain's rings, the ground cover's
 * lists, the forest's bands, the props' chunks — is a job: a generator whose
 * every `yield` ends one slice and whose last slice applies the result to the
 * shell's meshes in one step, so no frame ever draws a buffer half written.
 * `run`, called once a frame at the end of the renderer's `sync`, gives the
 * jobs pending, oldest first, one slice after another until `SYNC_BUDGET_MS`
 * of the clock has gone.
 *
 * **A slice ends by the clock, on any device.** A builder's loop asks
 * `sliceDue` as it works, and ends its slice once the scheduler's clock says
 * `SLICE_TARGET_MS` has gone since the slice began. What a loop costs a
 * sample is a desktop's figure or a phone's, five to ten times as much, so a
 * count of samples cannot size a slice; the clock can, and it is the one the
 * scheduler is handed, so a test drives it. Only the apply step is a slice no
 * clock divides: it is one step by design, says what it expects to take (a
 * yielded number of milliseconds), and starts only as a frame's share begins
 * or where it fits in what is left; the scheduler learns each owner's real
 * figure from what its apply steps took by its own clock (`learned`) and
 * trusts it where the builder's own is smaller.
 *
 * What budget no job needs goes to idle work (`idle`): work a shell can do
 * ahead of a crossing it expects, such as the terrain sampling the ground its
 * rings will move onto next. It runs only while no job is pending, is never
 * late, and may be dropped between any two of its slices. The first slice of a
 * frame starts whatever it says it takes: slices are bounded, so that is at
 * most one slice past the budget, and idle work never waits for ever behind
 * an estimate.
 *
 * **A late job gets a larger share, not the whole frame.** A job begun
 * `SYNC_LATE_FRAMES_MAX` frames or `SYNC_LATE_MS_MAX` milliseconds ago,
 * whichever comes first, is late: it goes before the other jobs, and the
 * frame gives late jobs slices until `SYNC_LATE_BUDGET_MS` of the clock has
 * gone, then stops; what is left of the job goes on next frame. On a machine
 * where a crossing's work fits in six frames of the ordinary share no job is
 * ever late. The hard bound stays for what the soft one cannot meet, a clock
 * that jumped (a tab hidden for a minute) or a job starved: one begun
 * `SYNC_OVERDUE_MS` ago is run to its end in one frame, as a first build is.
 *
 * Which crossings wait and which do not is each shell's `crossingAt`: the
 * first build, a teleport (a step no travel makes in one frame) and a view moving
 * more than half a cell or a metre a frame (the free camera's boost) all
 * build at once, or are stepped by the loader of first builds
 * (`firstBuilds.ts`), so at those the picture is exactly what it was.
 *
 * **A job that has started is finished and shown; the newest request waits
 * behind it.** A crossing that finds the shell's last job still pending — the
 * view has moved past a further line before that job applied, as a walk along
 * a diagonal does whenever it crosses an x line and a z line a few frames
 * apart, and a drive does at every line — asks for the rebuild for the new
 * view. While that job has run no slice, the new rebuild takes its place,
 * which loses nothing and keeps the old job's deadline, in frames and in
 * time: the view it was begun for is never drawn. Once it has run one, it goes
 * on to its end and is shown, and the new rebuild waits behind it, in the
 * place of any that waited before it (ended with `return`), so only the
 * newest is ever run; as the job applies, the request waiting is begun as a
 * job of its own, with that frame and that slice's reading as its deadline.
 * Replaced whenever asked, a fast view's jobs were replaced again and again
 * until they were a second old, then run whole, several shells in one frame:
 * at 20 to 30 m/s those runs were most of the time in every frame over a
 * tenth of a second, and the work thrown away grew with the speed.
 *
 * A patient job (`begin`'s `patient`) is never late and never overdue: it is
 * the rebuild of a shell whose meshes draw the last set it applied, whole and
 * correct, until the next set is applied, so waiting costs detail and never
 * shows a hole — the face patches', whose crossing builds far more than six
 * frames' share. It runs after every other job, with the share they leave, and
 * a frame whose share the other jobs took whole gives the first patient job one
 * slice all the same (`SYNC_PATIENT_MAX_MS`): a job that is never run is never
 * shown, and a job that has run one slice is no longer replaced. Idle work runs
 * while only patient jobs are pending, with what they leave.
 *
 * Pure and Babylon-free: time is the clock handed in, so a test drives it.
 */

/**
 * The most a frame's `run` spends on jobs (ms), past which it starts no
 * further slice. A phone's frame at 60 a second is 16.7 ms and the rest of it
 * (the draw, the simulation, the rest of `sync`, the sound) takes 4 to 5, so
 * the share is what a frame can spend on streaming and still hold its rate,
 * with the slice that starts inside it.
 */
export const SYNC_BUDGET_MS = 4;

/** The most frames a job's result may take to reach the screen after the
 * crossing that began it before the job is late. */
export const SYNC_LATE_FRAMES_MAX = 6;

/**
 * The most time (ms) a job's result may take to reach the screen after the
 * crossing that began it, whatever the frame rate, before the job is late. At
 * 60 frames a second the two bounds are the same; below it, this one comes
 * first. What hides the wait is reckoned against it: in 100 ms the view
 * moves 0.33 m at 3.3 m/s, 0.525 m walking (5.25 m/s) and 0.70 m sprinting
 * (7 m/s), at any frame rate. The blade field's `BLADE_PAD` of 2.12 m leaves
 * 0.71 m past the worst offset inside its rebuild cell on a diagonal, the
 * duff's `DUFF_PAD` 1.41 m, and every clutter fade ramp at full radius at
 * least 8 m past the grass cell's 4.24 m snap; the forest's `SEAM_PAD` is
 * exactly its snap, so a late forest is up to those distances past a seam's
 * pad, and the low tier's litter ramp (4.8 m) up to 0.14 m at a sprint.
 * Past it a job is given the larger share below, so it is shown later by what
 * its work needs, a few tenths of a second on a phone.
 *
 * Time is the renderer's clock.
 */
export const SYNC_LATE_MS_MAX = 100;

/**
 * The most a frame's `run` spends on late jobs (ms), twice the ordinary
 * share: the phone's frame has 12 ms to spare after the 4 to 5 ms the rest of
 * it takes, and 8 leaves the other 4 for a slice that starts inside the share
 * and a frame that runs long. A late job is shown after the number of frames
 * its work needs at this share, not run to its end in the frame that finds it
 * late, which on a phone was 40 to 105 ms of one frame.
 */
export const SYNC_LATE_BUDGET_MS = 8;

/**
 * The age (ms) at which a job is run to its end in one frame whatever the
 * share: the hard bound for what the share cannot meet. A tab hidden for a
 * minute stops its frames while its clock runs on, so every pending job is
 * overdue at once on its next frame, and the next frame runs them all to
 * their end, as a first build does; a job starved by others, and replaced
 * crossing after crossing because it never ran a slice, is overdue a second
 * after the first crossing that began it. A job that has started is not
 * replaced (`SyncJobs.begin`), so a view that crosses lines faster than its
 * jobs end no longer makes them overdue by asking again. A second is ten
 * times the soft bound and three to four of a walk's crossings (a ring
 * lattice step of 4 m is 0.76 s at 5.25 m/s), so no walk meets it unless the
 * device cannot keep up.
 */
export const SYNC_OVERDUE_MS = 1000;

/**
 * The most a frame has spent (ms) when a patient job's one slice a frame may still start: the late share and a slice.
 * A patient job runs after every other, with what they leave, and the late jobs of a walk on a slow device leave
 * nothing for frames at a stretch; so a frame in which no patient job ran gives the first of them one slice, past
 * the ordinary budget and inside this, where its next slice fits in what is left (a first slice of a frame
 * starts whatever it says). A job that is never run is never shown, and one never started is replaced at a walk's every
 * crossing: one slice a frame, 1.5 ms of a phone's 12 to spare, starts it and keeps it moving.
 */
export const SYNC_PATIENT_MAX_MS = SYNC_LATE_BUDGET_MS + 1.5;

/** The frames a patient job's slice may be left out of the floor for not fitting before it is given it whatever it says: its apply step, which says what it takes, is not held for ever behind other jobs. */
export const SYNC_PATIENT_WAIT_FRAMES = 30;

/**
 * The longest a builder holds the thread in one slice (ms): the time since the
 * slice began at which `sliceDue` says to end it. Three of these fit in the
 * ordinary share and five in the late one, so the jobs behind one still run
 * in the frame, and one is under a tenth of a frame: a phone's page thread
 * answers a touch or a timer inside it.
 */
export const SLICE_TARGET_MS = 1.5;

/**
 * Units of work a loop counts between two readings of the clock. A unit is
 * about one sample of the terrain (a few microseconds on a desktop, tens on a
 * phone), so a reading comes every 8 samples, 0.05 to 0.4 ms of a phone's
 * work, and a slice is held past its target by at most that and one step of
 * the loop. A reading is a call to the clock, tens of nanoseconds to a few
 * hundred, a hundredth of the work it follows or less.
 */
export const SLICE_READ_UNITS = 8;

/** The clock the open slice reads, its end, and the units counted since its last reading; null with no slice open. */
let gateClock: (() => number) | null = null;
let gateEnd = Infinity;
let gateUnits = 0;

/**
 * Whether the slice a builder is in has used its time: true once the clock has
 * passed `SLICE_TARGET_MS` since the slice began, read every
 * `SLICE_READ_UNITS` units of the work the caller counts (`units`, 1 for a
 * sample). A builder's loop ends its slice with `if (sliceDue()) yield;`
 * where it can resume. False when no scheduler has a slice open — a build at
 * once, a first build stepped by the loader, a test — so such a build runs as
 * it always did; what a builder builds is the same either way, only where it
 * gives the thread back changes.
 */
export function sliceDue(units = 1): boolean {
  if (gateClock === null) return false;
  gateUnits += units;
  if (gateUnits < SLICE_READ_UNITS) return false;
  gateUnits = 0;
  return gateClock() >= gateEnd;
}

/** Opens a slice that began at `at` on `clock`, and returns the one it replaces (a slice run inside another's). */
function openSlice(clock: () => number, at: number): [(() => number) | null, number, number] {
  const held: [(() => number) | null, number, number] = [gateClock, gateEnd, gateUnits];
  gateClock = clock;
  gateEnd = at + SLICE_TARGET_MS;
  gateUnits = 0;
  return held;
}

/** Closes the open slice, the one it replaced open again. */
function closeSlice(held: [(() => number) | null, number, number]): void {
  [gateClock, gateEnd, gateUnits] = held;
}

/** A rebuild in slices: each `next()` runs one slice, and the call that
 * returns `done` has applied the result. A slice may yield what it expects
 * the next to take (ms); nothing yielded means a small one. Idle work's
 * slices may say so too, and one that would not fit in what is left of a
 * frame's share waits for the next, unless nothing has run yet this frame. */
export type Slices<T = void> = Generator<number | void, T, void>;

/** Elements a slice of `sortSlices` moves before it yields. */
const SORT_SLICE = 8192;
/** Elements a merge writes between two looks at the scheduler's clock (a power of two), and how many of them are one unit of work (`sliceDue`). */
const SORT_LOOK = 256;
const SORT_UNITS = 64;

/**
 * Sorts `list` in place, in slices: a bottom-up merge sort, stable like
 * `Array.prototype.sort`, so it leaves exactly the order that call would —
 * a stable sort's result is the one permutation that orders the keys and
 * keeps equal ones as they came.
 */
export function* sortSlices<T>(list: T[], compare: (a: T, b: T) => number): Slices {
  const n = list.length;
  let from = list;
  let to: T[] = new Array<T>(n);
  let moved = 0;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      let k = lo;
      // Ties take the left run first: that is what keeps it stable. A merge asks the clock every `SORT_LOOK`
      // elements, so the last passes, whose one merge is the whole list, are cut as well.
      while (i < mid && j < hi) {
        to[k++] = compare(from[j] as T, from[i] as T) < 0 ? (from[j++] as T) : (from[i++] as T);
        if ((k & (SORT_LOOK - 1)) === 0 && sliceDue(SORT_LOOK / SORT_UNITS)) yield;
      }
      while (i < mid) to[k++] = from[i++] as T;
      while (j < hi) to[k++] = from[j++] as T;
      moved += hi - lo;
      if (moved >= SORT_SLICE) {
        moved = 0;
        yield;
      }
    }
    const swap = from;
    from = to;
    to = swap;
  }
  if (from !== list) for (let i = 0; i < n; i++) list[i] = from[i] as T;
}

/** Runs `slices` to its end at once and returns what it returns. */
export function finish<T>(slices: Slices<T>): T {
  for (;;) {
    const step = slices.next();
    if (step.done === true) return step.value;
  }
}

/**
 * The longest a first build holds the page's thread before it gives it back
 * (ms): half a frame at sixty a second. A single slice longer than this runs
 * to its end; a ring's sampling is one slice, about 70 ms on a phone.
 */
export const FIRST_BUILD_SLICE_MS = 8;

/**
 * Runs `slices` to its end, giving the thread back (a macrotask) whenever
 * `sliceMs` have passed since it last did, so the page paints and its video
 * keeps its frames between, and returns what the slices return. A rebuild done
 * this way, not by `SyncJobs`, is one that has no frame to fit: the first
 * build, before the render loop runs. It is paced by the clock and not by a
 * count of slices, since a slice is a ring on one machine's 20 ms and another's
 * 400: a count of eight once let all seven rings run before the first paint.
 * Asked before every slice, `stopped` ends the run early with nothing: what
 * the slices build has gone (a renderer disposed while its world was made).
 */
export async function stepSlices<T>(
  slices: Slices<T>,
  sliceMs: number,
  stopped: () => boolean = () => false,
  now: () => number = () => performance.now(),
): Promise<T | undefined> {
  let since = now();
  for (;;) {
    if (stopped()) return undefined;
    const step = slices.next();
    if (step.done === true) return step.value;
    if (now() - since >= sliceMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      since = now();
    }
  }
}

/** The rule that decided a crossing (`crossingAt`): "first" the shell's first build, "jump" a step of more than
 * `SYNC_TELEPORT_M` in one frame (a teleport), "fast" a step over `min(cell / 2, SYNC_FAST_STEP_M)` a sixtieth of a
 * second, "unscheduled" a shell given no scheduler, and "none" no rule: the crossing waits as a job. */
export type CrossingRule = "first" | "jump" | "fast" | "unscheduled" | "none";

/** One crossing as `crossingAt` judged it, for the read-out (`SyncJobs.watch`). */
export type CrossingJudgement = {
  /** The shell's name, as its jobs are named. */
  owner: string;
  /** The verdict: "now" builds at once, "later" begins a job. */
  kind: "now" | "later";
  rule: CrossingRule;
  /** The view's step since its last frame (m), as it moved. */
  step: number;
  /** The step as judged (m): `step` scaled to a sixtieth of a second where the frame was longer; NaN for a first view, which has no step. */
  moved: number;
  /** The time since the shell's last view that the step was judged against (ms); NaN with no clock (a first view). */
  elapsedMs: number;
};

/** What `SyncJobs.last` carries: the last `run`'s slices, and the counts since the last `resetLongest`. */
export type SyncJobsLast = {
  /** Slices the last `run` ran. */
  readonly slices: number;
  /** How many of them ran as a late job's, past the ordinary budget, and how many jobs were late as the share began. */
  readonly late: number;
  readonly lateJobs: number;
  /** How many ran as an overdue job's, to its end, and how many jobs that was. */
  readonly overdue: number;
  readonly overdueJobs: number;
  /** The jobs completed, and the idle slices run. */
  readonly completed: number;
  /**
   * The requests this frame held behind a job of their owner's that had started (`begin`), each to begin as that job is
   * shown; one that replaced a request already waiting is counted too. Counted as the shells ask, before the share, and
   * moved here as the share begins, as the crossings are.
   */
  readonly held: number;
  /** The slices of a patient job run for the floor a frame has no other of (0 or 1). */
  readonly floor: number;
  readonly idle: number;
  /** The milliseconds the slices took, how many of those a late or overdue run took, and the milliseconds by the jobs' names. */
  readonly ms: number;
  readonly lateMs: number;
  /** How many of those milliseconds an overdue run took (a job run to its end in one frame), in all and by owner. A late run's are in `lateMs` too. */
  readonly overdueMs: number;
  readonly overdueOwners: Readonly<Record<string, number>>;
  /**
   * The read-out (`watch`), empty until it is switched on. What shells built at once this frame, outside every budget,
   * before the frame's share began: by owner the builds (`atOnce`) and the milliseconds they took (`atOnceMs`); an
   * owner with none this frame is 0 here, and left out of the page's `window.__syncJobs()` copy.
   */
  readonly atOnce: Readonly<Record<string, number>>;
  readonly atOnceMs: Readonly<Record<string, number>>;
  /**
   * The read-out (`watch`), empty until it is switched on. By owner, as the frame's share began, how long (ms) its
   * picture has owed a rebuild: the time since the oldest request the drawn picture does not answer yet. A request
   * that replaced a job not started answers nothing the first did not, so the first's time stands; one held behind a
   * started job is owed from its frame's time once that job is shown (the newest wins the place, the first held keeps
   * the time). 0 when nothing is owed, and left out of the page's copy.
   */
  readonly owedMs: Readonly<Record<string, number>>;
  /** The crossings judged this frame: the first `crossingCount` of `crossings` (the rest is last frames' leavings). */
  readonly crossings: readonly CrossingJudgement[];
  readonly crossingCount: number;
  readonly owners: Readonly<Record<string, number>>;
  /** The longest single slice by owner (ms) since the last `resetLongest`. */
  readonly longest: Readonly<Record<string, number>>;
  /** The apply cost learned by owner (ms): what its announced slices took, as a running figure. */
  readonly learned: Readonly<Record<string, number>>;
};

export type SyncJobs = {
  /** Queues `slices` as `owner`'s job, begun this frame. An owner has at most
   * one job. One it already has that has run no slice is dropped unfinished,
   * and the new one takes its place in the queue and its deadline. One that
   * has run a slice goes on to its end and is shown, and the new slices wait
   * behind it, in the place of any already waiting (dropped): as it applies,
   * or as a slice of it throws, they are begun as a job of their own, in that
   * frame and at that slice's reading of the clock, queued as a new job is. A
   * fast view's jobs, replaced whenever it asked, were replaced until a second
   * old and then run whole in one frame. A `patient` job is never late: it
   * queues behind every other and is never run to its end at once. */
  begin(owner: object, slices: Slices, patient?: boolean, name?: string): void;
  /** Drops `owner`'s pending job unfinished, and the request waiting behind
   * it; its meshes keep what they drew. Slices dropped here or by `begin` are
   * ended with `return`, so their `finally` blocks run. */
  cancel(owner: object): void;
  /** Whether `owner` has a job begun and not yet applied, or a request waiting behind one. */
  pending(owner: object): boolean;
  /** Sets `owner`'s idle work, replacing any it has (null clears it): slices
   * run only with the budget left while no job is pending. */
  idle(owner: object, slices: Slices | null): void;
  /** This frame's share: the overdue jobs to their end, the late jobs' slices
   * until the late share has gone, then the others' until the budget is spent. Call once a frame, after every shell's update. */
  run(): void;
  /** The clock (ms) as the last `run` began, NaN before the first: a frame's
   * time for `crossingAt`, read without another reading of the clock. */
  started(): number;
  /**
   * The clock (ms) as this frame's first view was judged: read once, by the first shell to ask since the last `run`,
   * and the same for every shell after it that frame. From one frame's to the next it is the time the view's step
   * between them took, which is what `crossingAt` reckons the step against.
   */
  viewedAt(): number;
  /** Frames `run` has closed. */
  readonly frame: number;
  /** The last `run`'s record, for the tests and for the measurement mode's
   * `window.__syncJobs()` (lite/renderer.ts), which a phone harness reads
   * each frame (tools/frame-budget/phone.mjs). */
  readonly last: SyncJobsLast;
  /** Forgets the longest slices recorded, so the next reading's are those since now. */
  resetLongest(): void;
  /**
   * Switches the read-out on or off (the measurement mode switches it on). Off, `atOnceStart`, `atOnceEnd` and `judged`
   * do nothing and read no clock; on, they record into `last` for the frame whose `run` follows them. On, `begin` notes
   * when each owner's picture began to owe a rebuild, with the readings it makes already, and `run` records it
   * (`owedMs`); off, nothing is noted and what was is forgotten.
   */
  watch(on: boolean): void;
  readonly watching: boolean;
  /** Before a build made at once: the clock to hand `atOnceEnd`, NaN (no reading) while not watching. */
  atOnceStart(): number;
  /** After it: counts the build and its milliseconds to `name` in this frame's record. */
  atOnceEnd(name: string, startedAt: number): void;
  /** Records a crossing's verdict (`crossingAt` calls it, while watching). */
  judged(name: string, kind: "now" | "later", rule: CrossingRule, step: number, moved: number, elapsedMs: number): void;
};

/** A queued job: its slices, the frame whose crossing began it and the
 * clock then, what its next slice is expected to take (ms), and whether it
 * is never late; whether it has run a slice, and the owner's newest request
 * held behind it once it has (`waiting`, with its own `patient` and name),
 * begun as a job of its own as this one ends. */
type Job = {
  owner: object; slices: Slices; begun: number; begunAt: number; next: number; patient: boolean; name: string; starved: number;
  ran: boolean; waiting: Slices | null; waitingPatient: boolean; waitingName: string;
  /** The read-out's (`watch`): the clock since which the owner's picture has owed a rebuild, and since which it will
   * owe one once this job is shown (the first request held behind it); NaN for none, and while not watching. */
  owedSince: number; nextOwedSince: number;
};

/** The weight of the newest apply slice in an owner's learned cost. */
const LEARN_RATE = 0.25;

/**
 * The scheduler. `clock` is read as a job begins, once as `run` starts and
 * once before each slice (a request that waited behind a job, begun as that
 * job applies, takes the reading its last slice began at); the renderer
 * passes `performance.now`.
 */
export function createSyncJobs(clock: () => number): SyncJobs {
  const queue: Job[] = [];
  /** Idle work, one per owner, and whose turn it is. */
  const idle: { owner: object; slices: Slices; next: number }[] = [];
  let idleTurn = 0;
  let frame = 0;
  let startedAt = Number.NaN;
  // The clock as this frame's first view was judged, and whether it has been read since the last share.
  let viewAt = Number.NaN;
  let viewRead = false;
  const last = {
    slices: 0, late: 0, lateJobs: 0, overdue: 0, overdueJobs: 0, completed: 0, held: 0, floor: 0, idle: 0, ms: 0, lateMs: 0,
    overdueMs: 0, overdueOwners: {} as Record<string, number>,
    atOnce: {} as Record<string, number>, atOnceMs: {} as Record<string, number>, owedMs: {} as Record<string, number>,
    crossings: [] as CrossingJudgement[], crossingCount: 0,
    owners: {} as Record<string, number>, longest: {} as Record<string, number>, learned: {} as Record<string, number>,
  };
  // The read-out's frame in the making: what is built and judged before `run` is moved into `last` as it begins, so the
  // record of a frame holds its own crossings. Written in place, entries kept: nothing is made once the owners are known.
  let watching = false;
  const madeAtOnce: Record<string, number> = {};
  const madeAtOnceMs: Record<string, number> = {};
  let judgements: CrossingJudgement[] = [];
  let judgedCount = 0;
  /** The requests held behind a started job since the last share: the next record's `held`. */
  let heldNow = 0;
  /** The slice the clock's next reading is charged to: the one that just ran
   * (its name, whether it ran late, and whether it said what it would take),
   * or none. The clock is read once as a frame's share starts, once before
   * each slice and once as the share ends, never inside a slice's timing, so
   * a test clock that advances on every reading charges each slice one
   * reading. */
  let charging: { name: string; late: boolean; announced: boolean; overdue: boolean } | null = null;
  let at = 0;
  /** Whether a patient job ran a slice this frame. */
  let patientRan = false;
  /** The clock, read: the time since the last reading goes to the slice that ran in it. */
  function tick(): number {
    const now = clock();
    if (charging !== null) {
      const ms = now - at;
      const { name } = charging;
      last.ms += ms;
      if (charging.late) last.lateMs += ms;
      if (charging.overdue) {
        last.overdueMs += ms;
        last.overdueOwners[name] = (last.overdueOwners[name] ?? 0) + ms;
      }
      last.owners[name] = (last.owners[name] ?? 0) + ms;
      if (ms > (last.longest[name] ?? 0)) last.longest[name] = ms;
      if (charging.announced) {
        const known = last.learned[name];
        last.learned[name] = known === undefined ? ms : known + (ms - known) * LEARN_RATE;
      }
      charging = null;
    }
    at = now;
    return now;
  }

  /** What `job`'s next slice is expected to take (ms): what it said, or the owner's learned figure where that is more. A slice that said nothing is a bounded one. */
  const expected = (job: Job): number => (job.next > 0 ? Math.max(job.next, last.learned[job.name] ?? 0) : 0);

  /** Whether `job`, as a share begins at `now`, is late: begun too many frames or too long ago, and not patient. */
  const isLate = (job: Job, now: number): boolean =>
    !job.patient && (frame - job.begun >= SYNC_LATE_FRAMES_MAX || now - job.begunAt >= SYNC_LATE_MS_MAX);

  function remove(job: Job): void {
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
  }

  /** Queues `job`: a patient one last, any other ahead of every patient one,
   * so the slices go to the jobs that can be late first. */
  function enqueue(job: Job): void {
    const at = job.patient ? -1 : queue.findIndex((j) => j.patient);
    if (at < 0) queue.push(job);
    else queue.splice(at, 0, job);
  }

  /** A new job of `owner`'s, begun in this frame at `begunAt` on the clock. */
  function createJob(owner: object, slices: Slices, begunAt: number, patient: boolean, name: string): Job {
    return {
      owner, slices, begun: frame, begunAt, next: 0, patient, name, starved: 0, ran: false, waiting: null, waitingPatient: false, waitingName: "",
      owedSince: Number.NaN, nextOwedSince: Number.NaN,
    };
  }

  /** One slice of `job`; true when it has applied. A slice that throws takes
   * its job out of the queue before the error goes on. A job that leaves the
   * queue either way begins the request held behind it, as of the reading
   * this slice began at: the owner is never left with nothing pending. */
  function slice(job: Job, late = false, overdue = false): boolean {
    let done: boolean | undefined;
    charging = { name: job.name, late, announced: job.next > 0, overdue };
    const sliceAt = at;
    const held = openSlice(clock, at);
    job.ran = true;
    try {
      const step = job.slices.next();
      done = step.done;
      job.next = step.done !== true && typeof step.value === "number" ? step.value : 0;
    } finally {
      closeSlice(held);
      if (done !== false) {
        remove(job);
        if (job.waiting !== null) {
          const next = createJob(job.owner, job.waiting, sliceAt, job.waitingPatient, job.waitingName);
          // The picture shown answers every request up to the first held; from it on, it owes one.
          next.owedSince = job.nextOwedSince;
          enqueue(next);
          job.waiting = null;
        }
        job.owedSince = Number.NaN;
        job.nextOwedSince = Number.NaN;
      }
    }
    last.slices++;
    if (job.patient) patientRan = true;
    job.starved = 0;
    if (done === true) last.completed++;
    return done === true;
  }

  return {
    begin(owner, slices, patient = false, name = "other") {
      const held = queue.find((job) => job.owner === owner);
      if (held === undefined) {
        const job = createJob(owner, slices, clock(), patient, name);
        if (watching) job.owedSince = job.begunAt;
        enqueue(job);
        return;
      }
      if (held.ran) {
        // The read-out: the first request held is owed from its frame's time, which is no new reading of the clock.
        if (watching && Number.isNaN(held.nextOwedSince)) held.nextOwedSince = viewRead ? viewAt : startedAt;
        // Started: it goes on to be shown, and this request waits behind it, in the place of any that waited (ended with
        // `return`, so whatever it holds is handed back): the newest wins.
        held.waiting?.return(undefined);
        held.waiting = slices;
        held.waitingPatient = patient;
        held.waitingName = name;
        heldNow++;
        return;
      }
      held.name = name;
      // Not started, so nothing is lost: dropped with `return`, so whatever it
      // holds is handed back. The replacement keeps the first crossing's frame and time.
      held.slices.return(undefined);
      held.slices = slices;
      held.next = 0;
      if (held.patient !== patient) {
        remove(held);
        held.patient = patient;
        enqueue(held);
      }
    },
    cancel(owner) {
      const held = queue.find((job) => job.owner === owner);
      if (held === undefined) return;
      remove(held);
      held.slices.return(undefined);
      held.waiting?.return(undefined);
      held.waiting = null;
    },
    pending(owner) {
      return queue.some((job) => job.owner === owner);
    },
    idle(owner, slices) {
      const at = idle.findIndex((work) => work.owner === owner);
      if (at >= 0) idle.splice(at, 1)[0]?.slices.return(undefined);
      if (slices !== null) idle.push({ owner, slices, next: 0 });
    },
    started: () => startedAt,
    viewedAt() {
      if (!viewRead) {
        viewAt = clock();
        viewRead = true;
      }
      return viewAt;
    },
    watch(on) {
      watching = on;
      // Off, the read-out keeps nothing: what was owed is forgotten, and counted again from the next requests.
      if (!on) {
        for (let i = 0; i < queue.length; i++) {
          const job = queue[i] as Job;
          job.owedSince = Number.NaN;
          job.nextOwedSince = Number.NaN;
        }
      }
    },
    get watching() {
      return watching;
    },
    atOnceStart: () => (watching ? clock() : Number.NaN),
    atOnceEnd(name, startedAt) {
      if (!watching || Number.isNaN(startedAt)) return;
      const ms = Math.max(0, clock() - startedAt);
      madeAtOnce[name] = (madeAtOnce[name] ?? 0) + 1;
      madeAtOnceMs[name] = (madeAtOnceMs[name] ?? 0) + ms;
    },
    judged(name, kind, rule, step, moved, elapsedMs) {
      if (!watching) return;
      let entry = judgements[judgedCount];
      if (entry === undefined) {
        entry = { owner: name, kind, rule, step, moved, elapsedMs };
        judgements.push(entry);
      } else {
        entry.owner = name;
        entry.kind = kind;
        entry.rule = rule;
        entry.step = step;
        entry.moved = moved;
        entry.elapsedMs = elapsedMs;
      }
      judgedCount++;
    },
    resetLongest() {
      for (const name in last.longest) last.longest[name] = 0;
    },
    run() {
      viewRead = false;
      last.slices = 0;
      last.late = 0;
      last.lateJobs = 0;
      last.overdue = 0;
      last.overdueJobs = 0;
      last.completed = 0;
      // The requests held since the last share are this frame's, as its crossings are.
      last.held = heldNow;
      heldNow = 0;
      last.floor = 0;
      patientRan = false;
      last.idle = 0;
      last.ms = 0;
      last.lateMs = 0;
      last.overdueMs = 0;
      for (const name in last.overdueOwners) last.overdueOwners[name] = 0;
      // The frame's read-out: what was built and judged since the last share is this frame's.
      for (const name in last.atOnce) {
        last.atOnce[name] = 0;
        last.atOnceMs[name] = 0;
      }
      for (const name in madeAtOnce) {
        last.atOnce[name] = madeAtOnce[name] as number;
        last.atOnceMs[name] = madeAtOnceMs[name] as number;
        madeAtOnce[name] = 0;
        madeAtOnceMs[name] = 0;
      }
      const judgedNow = last.crossings as CrossingJudgement[];
      last.crossings = judgements;
      judgements = judgedNow;
      last.crossingCount = judgedCount;
      judgedCount = 0;
      for (const name in last.owners) last.owners[name] = 0;
      charging = null;
      const start = tick();
      startedAt = start;
      // The read-out: what each owner's picture owes as the share begins. A job pending is what owes, so an owner whose
      // jobs are gone (a shell disposed) is held on to by nothing here.
      for (const name in last.owedMs) last.owedMs[name] = 0;
      for (let i = 0; watching && i < queue.length; i++) {
        const job = queue[i] as Job;
        if (Number.isNaN(job.owedSince)) continue;
        const owed = start - job.owedSince;
        if (owed > (last.owedMs[job.name] ?? 0)) last.owedMs[job.name] = owed;
      }
      for (let i = 0; i < queue.length; i++) if (isLate(queue[i] as Job, start)) last.lateJobs++;
      // A job begun `SYNC_OVERDUE_MS` ago goes to its end: the hard bound, for
      // a clock that jumped or a job starved. Its last slice takes it out of
      // the queue, so the next job moves up into its index. Indexed rather than
      // iterated over a copy: this runs every frame, and allocates nothing.
      for (let i = 0; i < queue.length;) {
        const job = queue[i] as Job;
        if (job.patient || start - job.begunAt < SYNC_OVERDUE_MS) {
          i++;
          continue;
        }
        last.overdueJobs++;
        // Each slice after a reading, so each is charged its own time.
        for (;;) {
          tick();
          const done = slice(job, true, true);
          last.overdue++;
          if (done) break;
        }
      }
      // Then the late jobs, oldest first, whose slices go before every
      // other's: until the late share has gone. A late job whose next slice
      // would not fit in what is left waits for the next frame (unless nothing
      // has run yet this frame), and the late jobs behind it go on.
      for (let i = 0, ran = last.slices; i < queue.length;) {
        const job = queue[i] as Job;
        if (!isLate(job, start)) {
          i++;
          continue;
        }
        for (;;) {
          const spent = tick() - start;
          if (spent >= SYNC_LATE_BUDGET_MS || (last.slices > ran && spent + expected(job) > SYNC_LATE_BUDGET_MS)) {
            i++;
            break;
          }
          const done = slice(job, true);
          last.late++;
          if (done) break;
        }
      }
      // Then slices, oldest job first and the patient ones last, while the
      // frame's share lasts. A job whose
      // next slice would not fit in what is left waits for the next frame
      // (unless nothing has run yet this frame), and the jobs behind it go on.
      for (let i = 0, ran = last.slices; i < queue.length;) {
        const spent = tick() - start;
        if (spent >= SYNC_BUDGET_MS) break;
        const job = queue[i] as Job;
        if (last.slices > ran && spent + expected(job) > SYNC_BUDGET_MS) {
          i++;
          continue;
        }
        slice(job);
        // A job done has left the queue, and the next has moved up to `i`.
      }
      // A patient job is not starved: with no slice of its own this frame it is given one, the first of them.
      if (!patientRan) {
        for (let i = 0; i < queue.length; i++) {
          const job = queue[i] as Job;
          if (!job.patient) continue;
          const spent = tick() - start;
          const fits = spent < SYNC_PATIENT_MAX_MS && (last.slices === 0 || spent + expected(job) <= SYNC_PATIENT_MAX_MS);
          if (fits || job.starved >= SYNC_PATIENT_WAIT_FRAMES) {
            slice(job);
            last.floor++;
          } else job.starved++;
          break;
        }
      }
      // Then idle work, with what is left, while nothing is pending: a slice
      // of each owner's in turn, so none waits on another's.
      // Patient jobs pending do not stop it: they have had their slices.
      // A slice said to be longer than what is left waits for the next
      // frame, where it is first, and the work behind it goes on; the frame's
      // idle work ends when every one left waits.
      let waiting: Slices | null = null;
      let skipped = 0;
      while ((queue.length === 0 || (queue[0] as Job).patient) && idle.length > 0) {
        const spent = tick() - start;
        if (spent >= SYNC_BUDGET_MS) break;
        idleTurn %= idle.length;
        const work = idle[idleTurn] as { owner: object; slices: Slices; next: number };
        if (last.slices + last.idle > 0 && spent + work.next > SYNC_BUDGET_MS) {
          waiting ??= work.slices;
          if (++skipped >= idle.length) break;
          idleTurn++;
          continue;
        }
        skipped = 0;
        let done = true;
        charging = { name: "idle", late: false, announced: false, overdue: false };
        const held = openSlice(clock, at);
        try {
          const step = work.slices.next();
          done = step.done === true;
          work.next = !done && typeof step.value === "number" ? step.value : 0;
        } finally {
          closeSlice(held);
          if (done) idle.splice(idleTurn, 1);
          else idleTurn++;
        }
        last.idle++;
      }
      // The first that waited is first next frame.
      for (let i = 0; waiting !== null && i < idle.length; i++) {
        if ((idle[i] as { slices: Slices }).slices === waiting) idleTurn = i;
      }
      // The share's last reading: the last slice's time, charged.
      tick();
      frame++;
    },
    get frame() {
      return frame;
    },
    last,
  };
}

/**
 * A copy of `last` for a page to read, since the record is written in place every frame: the owners' records copied, the
 * read-out's owners left out where they built nothing this frame or owe nothing, and the crossings judged this frame as
 * entries of their own.
 */
export function syncJobsRecord(last: SyncJobsLast): SyncJobsLast {
  const atOnce: Record<string, number> = {};
  const atOnceMs: Record<string, number> = {};
  const owedMs: Record<string, number> = {};
  for (const name in last.atOnce) {
    if ((last.atOnce[name] as number) === 0) continue;
    atOnce[name] = last.atOnce[name] as number;
    atOnceMs[name] = last.atOnceMs[name] as number;
  }
  for (const name in last.owedMs) if ((last.owedMs[name] as number) !== 0) owedMs[name] = last.owedMs[name] as number;
  return {
    ...last,
    owners: { ...last.owners }, longest: { ...last.longest }, learned: { ...last.learned }, overdueOwners: { ...last.overdueOwners },
    atOnce, atOnceMs, owedMs,
    crossings: last.crossings.slice(0, last.crossingCount).map((c) => ({ ...c })),
  };
}

/** A view that moved more than this between two frames (m) — 60 m/s at 60
 * frames a second, past any speed on foot or on wheels — builds at once whatever its
 * shell's cell: the free camera's boost moves 2.4 m a frame. */
export const SYNC_FAST_STEP_M = 1;

/** A view that moved more than this in one frame (m) was moved, not carried: a teleport, built at once however long
 * the frame was. It is the most a view under the speed of `SYNC_FAST_STEP_M` moves in the longest stretch of
 * simulation one frame steps (`game/loop.ts`: 15 ticks of a sixtieth of a second), so nothing that travels reaches it. */
export const SYNC_TELEPORT_M = 15;

/**
 * Where a view at (x, z), moving (hx, hz) a frame, next crosses a line of a
 * grid of `cell` metres — whichever line, x or z, it reaches first — a
 * millimetre past the line: the view its next crossing will be built for,
 * give or take a frame's travel. Writes it to `out` as x, z and returns
 * false when the view is not moving.
 */
export function nextCrossing(x: number, z: number, hx: number, hz: number, cell: number, out: Float64Array): boolean {
  const lineX = hx > 0 ? (Math.floor(x / cell) + 1) * cell : Math.floor(x / cell) * cell;
  const lineZ = hz > 0 ? (Math.floor(z / cell) + 1) * cell : Math.floor(z / cell) * cell;
  const tx = hx !== 0 ? (lineX - x) / hx : Infinity;
  const tz = hz !== 0 ? (lineZ - z) / hz : Infinity;
  if (tx === Infinity && tz === Infinity) return false;
  if (tx <= tz) {
    const px = lineX + Math.sign(hx) * 1e-3;
    out[0] = px;
    out[1] = z + ((px - x) / hx) * hz;
  } else {
    const pz = lineZ + Math.sign(hz) * 1e-3;
    out[0] = x + ((pz - z) / hz) * hx;
    out[1] = pz;
  }
  return true;
}

/** A view's heading: its last move between two frames that moved. */
export type Heading = { x: number; z: number };

/** Takes the view's move since last frame as its heading, if it moved, and
 * says whether it turned: either component changed sign, so the lines its
 * next crossings are on changed. */
export function turn(h: Heading, dx: number, dz: number): boolean {
  if ((dx === 0 && dz === 0) || Number.isNaN(dx) || Number.isNaN(dz)) return false;
  const turned = Math.sign(dx) !== Math.sign(h.x) || Math.sign(dz) !== Math.sign(h.z);
  h.x = dx;
  h.z = dz;
  return turned;
}

/** What a shell does with this frame's view. */
export type CrossingKind = "none" | "now" | "later";

/** A shell's record of the views it has been handed: the origin on its
 * rebuild grid it last built or began building for, and last frame's view. */
export type Crossing = { originX: number; originZ: number; lastX: number; lastZ: number; lastAt: number };

export function createCrossing(): Crossing {
  return { originX: NaN, originZ: NaN, lastX: NaN, lastZ: NaN, lastAt: NaN };
}

/** The frame a view's step is reckoned against (s): 60 a second. */
export const SYNC_FRAME_S = 1 / 60;

/**
 * Classifies this frame's view (x, z), whose origin on the shell's rebuild
 * grid of `cell` metres is (ox, oz), and records both. "none" while the origin
 * holds. Otherwise "now" — build at once, as before there were jobs — for the
 * first build, for a step of more than `SYNC_TELEPORT_M` in one frame (a
 * teleport), for a view that moved more than half a cell a frame (so the next
 * crossing is at most a frame or two away) or more than `SYNC_FAST_STEP_M`,
 * and for a shell given no scheduler (`deferrable` false). "later" for
 * everything else, which becomes a job: a step at a walk, a run or a drive,
 * across one line or, after a slow frame, across several.
 *
 * The step since last frame is read as it would be at 60 frames a second:
 * over a frame longer than `SYNC_FRAME_S` it is scaled to one, so it is the
 * view's speed that says a burst, not a slow frame. A sprint moves 0.12 m a
 * frame at 60; after one frame of 150 ms (a collection, a buffer's upload) it
 * had moved 1.05 m, was taken for the free camera's boost, and every shell
 * crossing a line that frame rebuilt at once: the face patches' set in one
 * frame of 1.1 to 1.3 s on the rig that measured it (2026-11-09), three times
 * in six runs, each after a frame of 0.18 to 0.26 s.
 *
 * `now` is the clock as this frame's first view was judged
 * (`SyncJobs.viewedAt`; no clock, no scaling), so the time a step is reckoned
 * against is the time between the two views it lies between: the frame the
 * step was made over. Reckoned against the frame before that one, as it was,
 * the step a slow frame's simulation makes up (a quarter of a second of
 * travel) read as a burst in the short frame before it: at 12 m/s, 3 m "in
 * 19 ms", and the face patches' set built at once in a frame of 5 s, which
 * made the next slow frame (the rig, 2026-11-26).
 *
 * A step of more than a cell since the last origin is not by itself a reason
 * to build at once: a view that travels crosses several lines in one slow
 * frame, and its build is the same build, as a job. Only a step no travel
 * makes is a teleport.
 *
 * `record`, the scheduler, and `name`, the shell's, are for the read-out: while it is watching, each verdict is recorded
 * with the rule that decided it, the step, and the time it was judged against (`SyncJobs.judged`). They change no verdict.
 */
export function crossingAt(
  c: Crossing,
  x: number,
  z: number,
  ox: number,
  oz: number,
  cell: number,
  deferrable: boolean,
  now: number = Number.NaN,
  record?: SyncJobs,
  name = "",
): CrossingKind {
  const step = Math.hypot(x - c.lastX, z - c.lastZ);
  const seconds = (now - c.lastAt) / 1000;
  // With no clock (a shell given no scheduler, a first view), the step stands as it is.
  const moved = seconds > SYNC_FRAME_S ? (step * SYNC_FRAME_S) / seconds : step;
  c.lastAt = now;
  c.lastX = x;
  c.lastZ = z;
  if (ox === c.originX && oz === c.originZ) return "none";
  const first = Number.isNaN(c.originX) || Number.isNaN(c.originZ);
  const jump = step > SYNC_TELEPORT_M;
  c.originX = ox;
  c.originZ = oz;
  const rule: CrossingRule = !deferrable ? "unscheduled" : first ? "first" : jump ? "jump" : moved > Math.min(cell / 2, SYNC_FAST_STEP_M) ? "fast" : "none";
  const kind = rule === "none" ? "later" : "now";
  // With the read-out on, the verdict and what it judged: the step and the time it was reckoned against.
  if (record?.watching === true) record.judged(name, kind, rule, step, moved, seconds * 1000);
  return kind;
}
