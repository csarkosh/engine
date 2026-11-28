import { describe, expect, it } from "vitest";
import { seamReport } from "../lib/seam.mjs";

const f = (...v) => Uint8Array.from(v);

describe("seamReport", () => {
  it("accepts a loop whose end meets its start", () => {
    const r = seamReport([f(0, 0), f(10, 10), f(0, 0)], 2, 1);
    expect(r).toEqual({ seam: 0, medianStep: 10, maxStep: 10, seamToMedian: 0, ok: true });
  });

  it("rejects a jump bigger than any step", () => {
    const r = seamReport([f(0, 0), f(1, 1), f(50, 50)], 2, 1);
    expect(r.ok).toBe(false);
  });
});
