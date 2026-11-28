import { describe, expect, it } from "vitest";
import { createKeptValues } from "../../src/game/keptValues.js";

/** The store that keeps what a shell computes for an instance, and takes a value computed elsewhere. */

type Key = { id: number };
const STRIDE = 4;

function store() {
  let computed = 0;
  const kept = createKeptValues<Key>(STRIDE, (key, out, offset) => {
    computed++;
    for (let k = 0; k < STRIDE; k++) out[offset + k] = key.id + k / 10;
  });
  return { kept, computed: () => computed };
}

describe("keptValues.put", () => {
  it("stores the floats given for a key with no slot, and offsetOf then returns them without computing", () => {
    const { kept, computed } = store();
    const key = { id: 7 };
    const given = Float32Array.from([0, 0, 1.5, 2.5, 3.5, 4.5, 0]);
    expect(kept.put(key, given, 2)).toBe(true);
    expect(kept.size).toBe(1);
    const at = kept.offsetOf(key);
    expect(Array.from(kept.data.subarray(at, at + STRIDE))).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(computed()).toBe(0);
  });

  it("leaves a key that has a slot as it is, and says so", () => {
    const { kept, computed } = store();
    const key = { id: 3 };
    const at = kept.offsetOf(key);
    const before = Array.from(kept.data.subarray(at, at + STRIDE));
    expect(kept.put(key, Float32Array.from([9, 9, 9, 9]), 0)).toBe(false);
    expect(kept.size).toBe(1);
    expect(Array.from(kept.data.subarray(at, at + STRIDE))).toEqual(before);
    expect(computed()).toBe(1);
    const put = { id: 4 };
    expect(kept.put(put, Float32Array.from([5, 6, 7, 8]), 0)).toBe(true);
    expect(kept.put(put, Float32Array.from([1, 1, 1, 1]), 0)).toBe(false);
    const p = kept.offsetOf(put);
    expect(Array.from(kept.data.subarray(p, p + STRIDE))).toEqual([5, 6, 7, 8]);
  });

  it("frees a put slot on release, and the next key reuses it", () => {
    const { kept } = store();
    const a = { id: 1 };
    kept.put(a, Float32Array.from([1, 2, 3, 4]), 0);
    const at = kept.offsetOf(a);
    kept.release(a);
    expect(kept.size).toBe(0);
    const b = { id: 2 };
    expect(kept.put(b, Float32Array.from([5, 5, 5, 5]), 0)).toBe(true);
    expect(kept.offsetOf(b)).toBe(at);
    expect(Array.from(kept.data.subarray(at, at + STRIDE))).toEqual([5, 5, 5, 5]);
  });

  it("grows the slab for put keys as for computed ones", () => {
    const { kept } = store();
    const keys = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    for (const key of keys) kept.put(key, Float32Array.from([key.id, 1, 2, 3]), 0);
    expect(kept.size).toBe(600);
    for (const key of keys) expect(kept.data[kept.offsetOf(key)]).toBe(key.id);
  });
});
