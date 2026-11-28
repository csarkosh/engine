/**
 * The world's worker's server for the clutter: asked for strips of cells, it
 * looks each cell up (`clutterInCell`), frames what it finds (`clutterFrameInto`)
 * and posts one answer a request. Holds no state of a world: the terrain it
 * reads is the one the worker made for `madeFor`. The page's collector decides
 * what it keeps of an answer.
 *
 * Loads no engine.
 */
import { CLUTTER_DRIFTLOG, clutterInCell } from "../sim/clutter.js";
import { clutterFrameInto } from "./clutterFrame.js";
import { CLUTTER_STRIP_INTS, CLUTTER_WIRE_VALUES, clutterTransfer, type ClutterAnswer, type WorldClutterRequest } from "./clutterWire.js";
import { KEPT_STRIDE } from "./instanceLists.js";
import type { WorldPrepReply } from "./worldWork.js";

/** The cells one `step()` looks up at most. */
export const CLUTTER_SERVE_CELLS = 256;

export type ClutterServer = {
  /** Queues a request; requests are served in the order asked. */
  ask(request: WorldClutterRequest): void;
  /** Looks up the next cells of the request at the head and posts its answer after the last; false where nothing is queued. */
  step(): boolean;
  /** Whether a request is queued or being served. */
  readonly working: boolean;
};

/** The request being served: where its cursor is, and what it has found. */
type Run = {
  request: WorldClutterRequest;
  strip: number;
  cx: number;
  cz: number;
  found: number;
  cells: Int32Array;
  values: Float64Array;
  frames: Float32Array;
  framed: Uint8Array;
  start: number;
};

const INITIAL_CAPACITY = 64;

function startRun(request: WorldClutterRequest, now: number): Run {
  return {
    request, strip: 0, cx: request.strips[1] ?? 0, cz: request.strips[3] ?? 0, found: 0,
    cells: new Int32Array(INITIAL_CAPACITY * 3), values: new Float64Array(INITIAL_CAPACITY * CLUTTER_WIRE_VALUES),
    frames: new Float32Array(INITIAL_CAPACITY * KEPT_STRIDE), framed: new Uint8Array(INITIAL_CAPACITY), start: now,
  };
}

/** Doubles the run's arrays when the next instance would not fit. */
function room(run: Run): void {
  if (run.found < run.framed.length) return;
  const cap = run.framed.length * 2;
  const cells = new Int32Array(cap * 3);
  const values = new Float64Array(cap * CLUTTER_WIRE_VALUES);
  const frames = new Float32Array(cap * KEPT_STRIDE);
  const framed = new Uint8Array(cap);
  cells.set(run.cells);
  values.set(run.values);
  frames.set(run.frames);
  framed.set(run.framed);
  run.cells = cells;
  run.values = values;
  run.frames = frames;
  run.framed = framed;
}

/**
 * The clutter requests' logic, apart from the worker's loop. `madeFor` is the seed and variant of the last world the
 * worker made, null before any: a request for another world is one `failed`. A step looks up at most
 * `CLUTTER_SERVE_CELLS` cells; the answer is posted after the last cell of the request, with its arrays cut to what
 * was found and transferred. A throw while serving posts `failed` for that request and goes on to the next.
 */
export function createClutterServer(
  post: (reply: WorldPrepReply, transfer: ArrayBuffer[]) => void,
  madeFor: () => { seed: number; variant: string } | null,
  now: () => number = () => performance.now(),
): ClutterServer {
  const queue: WorldClutterRequest[] = [];
  let run: Run | null = null;

  const fail = (id: number, error: unknown): void => {
    run = null;
    queue.shift();
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) }, []);
  };

  const finish = (current: Run): void => {
    const { found } = current;
    const answer: ClutterAnswer = {
      set: current.request.set,
      cells: current.cells.slice(0, found * 3),
      values: current.values.slice(0, found * CLUTTER_WIRE_VALUES),
      frames: current.frames.slice(0, found * KEPT_STRIDE),
      framed: current.framed.slice(0, found),
      ms: now() - current.start,
    };
    run = null;
    queue.shift();
    post({ id: current.request.id, kind: "clutterCells", ...answer }, clutterTransfer(answer));
  };

  return {
    ask(request) {
      queue.push(request);
    },
    step() {
      const head = queue[0];
      if (head === undefined) return false;
      try {
        const made = madeFor();
        if (made === null || made.seed !== head.seed || made.variant !== head.variant) {
          throw new Error(`no world of seed ${head.seed} on terrain "${head.variant}" has been made`);
        }
        const current = run ?? (run = startRun(head, now()));
        const { strips } = head;
        const count = Math.floor(strips.length / CLUTTER_STRIP_INTS);
        let budget = CLUTTER_SERVE_CELLS;
        while (current.strip < count) {
          const s = current.strip * CLUTTER_STRIP_INTS;
          const cls = strips[s] as number;
          const z0 = strips[s + 3] as number;
          const z1 = strips[s + 4] as number;
          if (current.cx > (strips[s + 2] as number) || z0 > z1) {
            // This strip is done (or empty): on to the next.
            current.strip++;
            if (current.strip < count) {
              current.cx = strips[current.strip * CLUTTER_STRIP_INTS + 1] as number;
              current.cz = strips[current.strip * CLUTTER_STRIP_INTS + 3] as number;
            }
            continue;
          }
          if (budget === 0) break;
          budget--;
          const inst = clutterInCell(head.seed, cls, current.cx, current.cz);
          if (inst !== null) {
            room(current);
            const i = current.found++;
            current.cells[i * 3] = cls;
            current.cells[i * 3 + 1] = current.cx;
            current.cells[i * 3 + 2] = current.cz;
            const v = i * CLUTTER_WIRE_VALUES;
            current.values[v] = inst.x;
            current.values[v + 1] = inst.z;
            current.values[v + 2] = inst.groundH;
            current.values[v + 3] = inst.groundDx;
            current.values[v + 4] = inst.groundDz;
            current.values[v + 5] = inst.scale;
            current.values[v + 6] = inst.variant;
            current.values[v + 7] = inst.hash;
            if (cls !== CLUTTER_DRIFTLOG) {
              clutterFrameInto(head.seed, inst, current.frames, i * KEPT_STRIDE);
              current.framed[i] = 1;
            }
          }
          current.cz++;
          if (current.cz > z1) {
            current.cz = z0;
            current.cx++;
          }
        }
        if (current.strip >= count) finish(current);
      } catch (error) {
        fail(head.id, error);
      }
      return true;
    },
    get working() {
      return queue.length > 0;
    },
  };
}
