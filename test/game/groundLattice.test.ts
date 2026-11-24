import { describe, expect, it } from "vitest";
import { createGroundLattice } from "../../src/game/groundLattice.js";

/** The ground read off a lattice of exact corners: for a test of sight asked every frame, which must not compute the terrain each time. */
describe("the ground read off a lattice", () => {
  const hill = (x: number, z: number): number => 3 + 0.5 * x - 0.25 * z + 0.01 * x * z;

  it("is the exact ground at a corner, and between corners the four round the point weighted", () => {
    const ground = createGroundLattice(hill, 2);
    expect(ground(4, -6)).toBe(hill(4, -6));
    // `hill` is linear along each axis and bilinear across, which a bilinear reading gives back exactly.
    expect(ground(4.7, -5.1)).toBeCloseTo(hill(4.7, -5.1), 12);
    expect(ground(-3.3, 0.4)).toBeCloseTo(hill(-3.3, 0.4), 12);
  });

  it("is off by no more than the ground curves in a cell", () => {
    const bowl = (x: number, z: number): number => 0.02 * (x * x + z * z);
    const ground = createGroundLattice(bowl, 2);
    let worst = 0;
    for (let x = -20; x <= 20; x += 0.37) for (let z = -20; z <= 20; z += 0.41) worst = Math.max(worst, Math.abs(ground(x, z) - bowl(x, z)));
    // A curvature of 0.04 a metre over a 2 m cell: 0.04 * 2 * 2 / 8 for each axis.
    expect(worst).toBeLessThanOrEqual(0.0401);
  });

  it("computes a corner once: a sightline asked again, or one a step along, asks the terrain for nothing", () => {
    let asked = 0;
    const ground = createGroundLattice((x, z) => (asked++, hill(x, z)), 2);
    for (let f = 0.2; f < 1; f += 0.2) ground(100 * f, 40 * f);
    const first = asked;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(16);
    for (let frame = 0; frame < 100; frame++) for (let f = 0.2; f < 1; f += 0.2) ground(100 * f, 40 * f);
    expect(asked).toBe(first);
    for (let f = 0.2; f < 1; f += 0.2) ground(100 * f + 0.3, 40 * f + 0.2);
    expect(asked - first).toBeLessThanOrEqual(8);
    expect(ground.computed()).toBe(asked);
  });

  it("stays right when two corners want one place in the table: the later takes it, and the earlier is computed again", () => {
    let asked = 0;
    // A table of two places: nearly every corner shares one.
    const ground = createGroundLattice((x, z) => (asked++, hill(x, z)), 2, 1);
    for (let x = -9; x < 9; x += 1.3) for (let z = -9; z < 9; z += 1.7) expect(ground(x, z)).toBeCloseTo(hill(x, z), 12);
    expect(asked).toBeGreaterThan(100);
  });
});
