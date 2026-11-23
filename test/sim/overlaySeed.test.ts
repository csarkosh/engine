import { describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { coastGround, registerOlympic, roadCenterX } from "../../src/sim/olympic.js";

/**
 * A place laid over the coast is handed the world's seed where it shapes the bay (`blend`) and where
 * it keeps the cliff bands (`cliffKeepD`), so its reach can be the seed's: a broad bay in one world, a
 * narrow one in another.
 */

const seen = { ends: new Set<number>(), windows: new Set<number>(), keeps: new Set<number>() };

registerOlympic({
  tunables: {},
  // A bay drawn far out in the world of seed 7, and left as the coast has it in every other.
  blend: {
    end: (seed) => {
      seen.ends.add(seed);
      return seed === 7 ? 2400 : 40;
    },
    windowD: (_z, seed) => {
      seen.windows.add(seed);
      return { v: 1, dz: 0 };
    },
  },
  cliffKeepD: (_u, _uDz, _z, seed) => {
    seen.keeps.add(seed);
    return { v: 1, dx: 0, dz: 0 };
  },
  shapeD: (_seed, _x, _z, _u, _uDz, base) => base,
});

/** The ground's height 300 m inland of the highway, at a z. */
const inland = (seed: number, z: number): number => coastGround(seed, roadCenterX(seed, z) + 300, z).ground.h;

describe("a place's bay and cliffs by the world's seed", () => {
  it("hands the seed to the end, the window and the cliffs' keep", () => {
    inland(7, 900);
    inland(8, 900);
    expect([...seen.ends].sort()).toEqual([7, 8]);
    expect([...seen.windows].sort()).toEqual([7, 8]);
    expect([...seen.keeps].sort()).toEqual([7, 8]);
  });

  it("draws the bay out where the seed's end says so: the land behind the shore stands far lower", () => {
    // With the climb to the massif ended 40 m inland the ground 300 m in is the massif's own; drawn out to
    // 2400 m it is still on the way up. Compared along the coast, so no one place's hill decides it.
    let broad = 0;
    let narrow = 0;
    for (let z = -2000; z <= 2000; z += 200) {
      broad += inland(7, z);
      narrow += inland(8, z);
    }
    expect(broad).toBeLessThan(narrow * 0.5);
  });
});
