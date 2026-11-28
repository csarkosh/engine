import { describe, expect, it } from "vitest";
import type { ClutterInstance } from "../../src/sim/clutter.js";
import {
  CLUTTER_STRIP_INTS, CLUTTER_WIRE_VALUES, clutterTransfer, instanceAt, stripCells, type ClutterAnswer,
} from "../../src/game/clutterWire.js";
import { KEPT_STRIDE } from "../../src/game/instanceLists.js";

/** What crosses between the page and the world's worker for the clutter. */

function pack(list: ClutterInstance[]): ClutterAnswer {
  const answer: ClutterAnswer = {
    set: 3, cells: new Int32Array(list.length * 3), values: new Float64Array(list.length * CLUTTER_WIRE_VALUES),
    frames: new Float32Array(list.length * KEPT_STRIDE), framed: new Uint8Array(list.length), ms: 0,
  };
  list.forEach((inst, i) => {
    answer.cells[i * 3] = inst.cls;
    const v = i * CLUTTER_WIRE_VALUES;
    answer.values.set([inst.x, inst.z, inst.groundH, inst.groundDx, inst.groundDz, inst.scale, inst.variant, inst.hash], v);
  });
  return answer;
}

describe("the clutter's wire", () => {
  it("an instance packed and read back is the original in every field, to the bit", () => {
    const list: ClutterInstance[] = [
      { cls: 5, x: -12.345678901234, z: 7.000000001, groundH: 101.5, groundDx: -0, groundDz: 0.25, scale: 1.1, variant: 3, hash: 3_000_000_001 },
      { cls: 13, x: 0, z: -0, groundH: -4.75, groundDx: 0.125, groundDz: -0.5, scale: 0.9, variant: 0, hash: 0.123456789012345 },
    ];
    const answer = pack(list);
    list.forEach((want, i) => {
      const got = instanceAt(answer, i);
      for (const key of Object.keys(want) as (keyof ClutterInstance)[]) expect(Object.is(got[key], want[key]), `${i}.${key}`).toBe(true);
    });
  });

  it("an answer's transfer list is its four buffers", () => {
    const answer = pack([]);
    expect(clutterTransfer(answer)).toEqual([answer.cells.buffer, answer.values.buffer, answer.frames.buffer, answer.framed.buffer]);
  });

  it("the cells of strips are counted with both ends of each range included", () => {
    expect(CLUTTER_STRIP_INTS).toBe(5);
    expect(stripCells(new Int32Array(0))).toBe(0);
    expect(stripCells(new Int32Array([2, 0, 0, 0, 0]))).toBe(1);
    expect(stripCells(new Int32Array([2, -3, 4, 10, 12, 7, 5, 5, -1, 0]))).toBe(8 * 3 + 1 * 2);
  });
});
