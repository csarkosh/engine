import { describe, expect, it } from "vitest";
import { timeLimit } from "../../testing/timeLimit.js";
import "../../src/sim/montane.js";
import { registerOlympic } from "../../src/sim/olympic.js";
import { activeTerrainVariant, registerTerrainVariant, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  SPECIES_COUNT, SPECIES_DEER, SPECIES_ELK, SPECIES_RABBIT, WILDLIFE_CELL, forestGroundFor, lastAllowed, speciesGround,
  wildlifeUnitInCell, type WildlifeUnit,
} from "../../src/game/wildlifeField.js";

/**
 * A place laid over the coast can say where an animal of a species may not be. Here it forbids deer
 * inside one rectangle and nothing else; the same coast registered without the hook is the control.
 */

const SEEDS = [20261121, 1, 7];
const RECT = { x0: 0, x1: 600, z0: -300, z1: 300 };
const inRect = (x: number, z: number): boolean => x >= RECT.x0 && x <= RECT.x1 && z >= RECT.z0 && z <= RECT.z1;

registerOlympic({
  tunables: {},
  shapeD: (_seed, _x, _z, _u, _uDz, base) => base,
  wildlifeGround: (_seed, species, x, z) => !(species === SPECIES_DEER && inRect(x, z)),
});
const hooked = activeTerrainVariant();
registerTerrainVariant({ ...hooked, name: "olympic-plain", wildlifeGround: undefined });
registerTerrainVariant({ ...hooked, name: "olympic-open", wildlifeGround: () => true });

/** Every unit of a species anchored over a square of cells, with the given variant active. */
function sweep(name: string, seed: number, species: number, half: number): WildlifeUnit[] {
  setActiveTerrainVariant(name);
  const cell = WILDLIFE_CELL[species]!;
  const n = Math.ceil(half / cell);
  const out: WildlifeUnit[] = [];
  for (let cz = -n; cz < n; cz++) for (let cx = -n; cx < n; cx++) {
    const u = wildlifeUnitInCell(seed, species, cx, cz);
    if (u !== null) out.push(u);
  }
  return out;
}

describe("a place's wildlife ground", () => {
  it("anchors no unit of the forbidden species inside the rectangle, and still anchors the others there", () => {
    let deerPlain = 0;
    let deerHooked = 0;
    let elk = 0;
    for (const seed of SEEDS) {
      const plain = sweep("olympic-plain", seed, SPECIES_DEER, 2000);
      const withHook = sweep("olympic", seed, SPECIES_DEER, 2000);
      deerPlain += plain.filter((u) => inRect(u.x, u.z)).length;
      deerHooked += withHook.filter((u) => inRect(u.x, u.z)).length;
      expect(withHook.filter((u) => inRect(u.x, u.z))).toEqual([]);
      elk += sweep("olympic", seed, SPECIES_ELK, 2000).filter((u) => inRect(u.x, u.z)).length;
    }
    // The control: without the hook there are deer there, so the empty rectangle is the hook's doing.
    expect(deerPlain).toBeGreaterThan(0);
    expect(deerHooked).toBe(0);
    expect(elk).toBeGreaterThan(0);
  });

  it("leaves every unit as it was outside what the hook forbids", () => {
    for (const seed of SEEDS) {
      for (let species = 0; species < SPECIES_COUNT; species++) {
        const plain = sweep("olympic-plain", seed, species, 1000).filter((u) => !(species === SPECIES_DEER && inRect(u.x, u.z)));
        const withHook = sweep("olympic", seed, species, 1000);
        expect(withHook).toEqual(plain);
      }
    }
  }, timeLimit(60_000));

  it("gives the same units as the plain coast where a hook forbids nothing", () => {
    for (const seed of SEEDS) {
      for (const species of [SPECIES_ELK, SPECIES_RABBIT]) {
        expect(sweep("olympic-open", seed, species, 1000)).toEqual(sweep("olympic-plain", seed, species, 1000));
      }
    }
  }, timeLimit(60_000));

  it("makes speciesGround follow it", () => {
    setActiveTerrainVariant("olympic");
    const seed = 20261121;
    const plainAt = (x: number, z: number, sp: number): boolean => {
      setActiveTerrainVariant("olympic-plain");
      const r = speciesGround(seed, sp, x, z);
      setActiveTerrainVariant("olympic");
      return r;
    };
    let checked = 0;
    for (let z = -400; z <= 400; z += 40) for (let x = -400; x <= 400; x += 40) {
      expect(speciesGround(seed, SPECIES_DEER, x, z)).toBe(plainAt(x, z, SPECIES_DEER) && !inRect(x, z));
      expect(speciesGround(seed, SPECIES_ELK, x, z)).toBe(plainAt(x, z, SPECIES_ELK));
      expect(forestGroundFor(seed, SPECIES_RABBIT, x, z)).toBe(plainAt(x, z, SPECIES_RABBIT));
      if (plainAt(x, z, SPECIES_DEER)) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("stops a walker at the edge of the forbidden ground", () => {
    const seed = 20261121;
    setActiveTerrainVariant("olympic");
    // A start just west of the rectangle on ground the terrain allows, and a goal inside it.
    let start: { x: number; z: number } | null = null;
    for (let z = -250; z <= 250 && start === null; z += 10) {
      const x = RECT.x0 - 20;
      setActiveTerrainVariant("olympic-plain");
      const ok = speciesGround(seed, SPECIES_DEER, x, z) && speciesGround(seed, SPECIES_DEER, RECT.x0 + 100, z);
      setActiveTerrainVariant("olympic");
      if (ok) start = { x, z };
    }
    expect(start).not.toBeNull();
    const here = start!;
    const p = lastAllowed((x, z) => speciesGround(seed, SPECIES_DEER, x, z), here.x, here.z, 300, here.z);
    expect(p.x).toBeLessThanOrEqual(RECT.x0);
    expect(p.x).toBeGreaterThan(RECT.x0 - 1);
    expect(p.z).toBeCloseTo(here.z, 6);
  });
});
