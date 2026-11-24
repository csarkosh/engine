import { describe, expect, it } from "vitest";
import { timeLimit } from "../../testing/timeLimit.js";
import "../../src/sim/montane.js";
import { CLUTTER_BUSH, CLUTTER_FERN, CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_SHRUB, clutterInRect, type ClutterInstance } from "../../src/sim/clutter.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { activeTerrainVariant, registerTerrainVariant, setActiveTerrainVariant } from "../../src/sim/terrain.js";

/**
 * A place laid over the coast can keep a class of ground cover off ground narrower than the class's cell: it is asked
 * of each instance at the instance's own place. Here it forbids bushes inside one rectangle and nothing else; the same
 * coast registered without the hook is the control.
 */

const SEEDS = [20261121, 1, 7];
const RECT = { x0: 40, x1: 43, z0: -200, z1: 200 };
const SWEEP = { x0: 28, x1: 56, z0: -220, z1: 220 };
/** The classes swept as the others: a clump, the carpet, a fern and a shrub. */
const OTHERS = [CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FERN, CLUTTER_SHRUB];
const inRect = (x: number, z: number): boolean => x >= RECT.x0 && x <= RECT.x1 && z >= RECT.z0 && z <= RECT.z1;

registerOlympic({
  tunables: {},
  shapeD: (_seed, _x, _z, _u, _uDz, base) => base,
  clutterStands: (_seed, cls, x, z) => !(cls === CLUTTER_BUSH && inRect(x, z)),
});
const hooked = activeTerrainVariant();
registerTerrainVariant({ ...hooked, name: "olympic-plain", clutterStands: undefined });
registerTerrainVariant({ ...hooked, name: "olympic-open", clutterStands: () => true });

function sweep(name: string, seed: number, cls: number): ClutterInstance[] {
  setActiveTerrainVariant(name);
  return clutterInRect(seed, cls, SWEEP.x0, SWEEP.z0, SWEEP.x1, SWEEP.z1);
}

const key = (c: ClutterInstance): string => `${c.cls}:${c.x}:${c.z}:${c.scale}:${c.variant}:${c.hash}`;

describe("a place's say over where ground cover stands", () => {
  it("stands no bush in a strip narrower than a bush's cell, and every bush outside it as before", () => {
    let inside = 0;
    for (const seed of SEEDS) {
      const plain = sweep("olympic-plain", seed, CLUTTER_BUSH);
      const kept = sweep(hooked.name, seed, CLUTTER_BUSH);
      inside += plain.filter((c) => inRect(c.x, c.z)).length;
      expect(kept.filter((c) => inRect(c.x, c.z))).toEqual([]);
      expect(kept.map(key)).toEqual(plain.filter((c) => !inRect(c.x, c.z)).map(key));
    }
    // The strip is 3 m wide and a bush's cell 4 m: the control must have bushes there, or the test proves nothing.
    expect(inside).toBeGreaterThan(0);
  }, timeLimit(30_000));

  it("leaves every other class as it was, in the strip too", () => {
    for (const seed of SEEDS) {
      for (const cls of OTHERS) {
        expect(sweep(hooked.name, seed, cls).map(key)).toEqual(sweep("olympic-plain", seed, cls).map(key));
      }
    }
    expect(sweep("olympic-plain", SEEDS[0]!, CLUTTER_GRASS).length).toBeGreaterThan(0);
  }, timeLimit(60_000));

  it("changes nothing when the hook lets everything stand", () => {
    for (const seed of SEEDS) {
      for (const cls of [CLUTTER_BUSH, ...OTHERS]) {
        expect(sweep("olympic-open", seed, cls).map(key)).toEqual(sweep("olympic-plain", seed, cls).map(key));
      }
    }
  }, timeLimit(60_000));
});
