import { describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { CLUTTER_DRIFTLOG, CLUTTER_DRIFTWOOD, CLUTTER_ROCK, clutterDensity } from "../../src/sim/clutter.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";

/**
 * A place laid over the coast says where the ground is made (`FeatureMask.loose`), and nothing of the shore
 * or the hillside lies loose there: no scattered rock, no driftwood, no drift log. Where the place says
 * nothing, they lie as the coast has them.
 */

// The coast with a place that makes all the ground north of z = 0 and leaves the south alone.
registerOlympic({
  tunables: {},
  shapeD: (_seed, _x, _z, _u, _uDz, base) => base,
  featureMask: (_seed, _x, z) => (z > 0 ? { tree: 1, clutter: 1, meadow: 0, bare: 0, loose: 0 } : { tree: 1, clutter: 1, meadow: 0, bare: 0 }),
});
setActiveTerrainVariant("olympic");

const SEED = 20261121;

/** The greatest density of a class across the shore and the ground behind it at one z (the coast lies near x = -400). */
function greatest(cls: number, z: number): number {
  let most = 0;
  for (let x = -900; x <= 600; x += 2) most = Math.max(most, clutterDensity(SEED, cls, x, z));
  return most;
}

describe("what lies loose on ground a game has made", () => {
  for (const [name, cls] of [["rock", CLUTTER_ROCK], ["driftwood", CLUTTER_DRIFTWOOD], ["drift logs", CLUTTER_DRIFTLOG]] as const) {
    it(`${name}: there where the place says nothing, gone where the ground is made`, () => {
      let south = 0;
      let north = 0;
      for (let k = 1; k <= 12; k++) {
        south = Math.max(south, greatest(cls, -400 - 120 * k));
        north = Math.max(north, greatest(cls, 400 + 120 * k));
      }
      expect(south).toBeGreaterThan(0);
      expect(north).toBe(0);
    });
  }
});
