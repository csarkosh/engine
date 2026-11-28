/**
 * What crosses between the page and the world's worker for the clutter: a
 * request for strips of cells, and the answer, a few typed arrays whose
 * buffers are transferred, never copied.
 *
 * Loads no engine.
 */
import type { ClutterInstance } from "../sim/clutter.js";

/** Numbers an instance takes in an answer's `values`, in this order: `x, z, groundH, groundDx, groundDz, scale, variant, hash`. */
export const CLUTTER_WIRE_VALUES = 8;
/** Integers a strip takes in a request's `strips`: `cls, x0, x1, z0, z1`, cell indices, both ends included. */
export const CLUTTER_STRIP_INTS = 5;

/**
 * Strips of cells of one world: each is a class and a rectangle of that class's cell indices. `set` numbers the
 * page's asks and is returned in the answer.
 */
export type WorldClutterRequest = { id: number; kind: "clutter"; seed: number; variant: string; set: number; strips: Int32Array };

/**
 * The instances found in a request's strips, in the order of the strips, then `cx` ascending, then `cz` ascending.
 * An instance's class and cell are in `cells` (`cls, cx, cz`), its numbers in `values` (`CLUTTER_WIRE_VALUES`), its
 * frame in `frames` (`KEPT_STRIDE` floats) where `framed` is 1 (a drift log is never framed here: its floats are zeros).
 */
export type ClutterAnswer = {
  set: number;
  cells: Int32Array;
  values: Float64Array;
  frames: Float32Array;
  framed: Uint8Array;
  ms: number;
};

/** The `i`th instance of an answer. */
export function instanceAt(answer: ClutterAnswer, i: number): ClutterInstance {
  const v = i * CLUTTER_WIRE_VALUES;
  const { values } = answer;
  return {
    cls: answer.cells[i * 3] as number,
    x: values[v] as number,
    z: values[v + 1] as number,
    groundH: values[v + 2] as number,
    groundDx: values[v + 3] as number,
    groundDz: values[v + 4] as number,
    scale: values[v + 5] as number,
    variant: values[v + 6] as number,
    hash: values[v + 7] as number,
  };
}

/** The buffers of an answer, to be transferred when it is posted. */
export function clutterTransfer(answer: ClutterAnswer): ArrayBuffer[] {
  return [answer.cells.buffer, answer.values.buffer, answer.frames.buffer, answer.framed.buffer] as ArrayBuffer[];
}

/** The cells in `strips`, both ends of each range included. */
export function stripCells(strips: Int32Array): number {
  let total = 0;
  for (let s = 0; s + CLUTTER_STRIP_INTS <= strips.length; s += CLUTTER_STRIP_INTS) {
    total += ((strips[s + 2] as number) - (strips[s + 1] as number) + 1) * ((strips[s + 4] as number) - (strips[s + 3] as number) + 1);
  }
  return total;
}

// Cell keys pack a class and a cell's two indices into one number; the indices stay well inside +-2^20 (a cell
// index is a position over the cell's size, and no camera stands far enough out), same idiom as forestField's.
export const CELL_KEY_HALF = 1 << 20;
export const CELL_KEY_SPAN = 1 << 21;
export const CELL_KEY_CLASS_SPAN = CELL_KEY_SPAN * CELL_KEY_SPAN;

/** The numeric key of cell (cx, cz) of class `cls` in the collector's cache. */
export function clutterCellKey(cls: number, cx: number, cz: number): number {
  return cls * CELL_KEY_CLASS_SPAN + (cx + CELL_KEY_HALF) * CELL_KEY_SPAN + (cz + CELL_KEY_HALF);
}
