import { describe, expect, it, vi } from "vitest";

/**
 * What a ground sample pays for the beach's shape (`sim/beachShape.ts`): gradient-noise evaluations, counted at the one function that makes them.
 * Outside the height band it is none at all, so the ground of a place with the option costs what it did, except across the beach.
 */
const calls: number[] = [];
vi.mock("../../src/sim/field.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/sim/field.js")>();
  return { ...original, fbm2dInto: (x: number, z: number, seed: number, octaves: number): void => { calls.push(octaves); original.fbm2dInto(x, z, seed, octaves); } };
});
const { beachShapeInto } = await import("../../src/sim/beachShape.js");

/** The noise evaluations (octaves summed) one sample costs at height `h`, on a bay's shore, 30 m from the coastline and far from the road. */
function evaluations(h: number, shape = 1): number {
  calls.length = 0;
  beachShapeInto(20261121, 3000.37, 30.2, 0.1, 500, 0, h, 0.05, 0.01, 0, 0, 0, 1, 0, shape);
  return calls.reduce((a, b) => a + b, 0);
}

describe("the cost of a shaped beach", () => {
  it("is nothing outside the height band, and under 6 noise evaluations inside it", () => {
    for (const h of [-30, -2, -0.81, 4, 4.5, 9, 40]) expect(evaluations(h)).toBe(0);
    // The wet flat: the bars' two octaves. The swash: those and the cusps' two. The upper swash: the cusps'. The back: the ridge's and the hummocks'.
    expect(evaluations(-0.6)).toBe(2);
    expect(evaluations(0.05)).toBe(2);
    expect(evaluations(0.5)).toBe(4);
    expect(evaluations(1.0)).toBe(2);
    expect(evaluations(1.5)).toBe(3);
    expect(evaluations(1.7)).toBe(3);
    expect(evaluations(2.0)).toBe(5);
    expect(evaluations(2.6)).toBe(2);
    expect(evaluations(3.5)).toBe(2);
    let worst = 0;
    for (let h = -0.8; h < 4; h += 0.01) worst = Math.max(worst, evaluations(h));
    expect(worst).toBe(5);
  });

  it("is nothing at all in the road's corridor, off a headland, or seaward of the stacks", () => {
    calls.length = 0;
    expect(beachShapeInto(1, 0, 30, 0, 10, 0, 1.7, 0.05, 0, 0, 0, 0, 1, 0, 1)).toBe(false);
    expect(beachShapeInto(1, 0, 30, 0, 500, 0, 1.7, 0.05, 0, 0, 0, 0, 0, 0, 1)).toBe(false);
    expect(beachShapeInto(1, 0, -60, 0, 500, 0, -0.6, 0.05, 0, 0, 0, 0, 1, 0, 1)).toBe(false);
    expect(calls.length).toBe(0);
  });
});
