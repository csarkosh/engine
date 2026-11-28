import { describe, expect, it } from "vitest";
import { PAINT_OILS, PAINT_PALETTES, gradeRecordUnder } from "../../src/game/gradeParams.js";
import { FAR_SOFT_RADIUS, composeUniforms, createPaletteFade, createTaaFrame, farSoftUniforms, type PostView } from "../../src/game/postFrame.js";
import { PAINT_STRENGTH, TAA_SAMPLES, taaJitter } from "../../src/game/postParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { sourceText } from "../helpers/source.js";

const src = (name: string): string => sourceText(`game/${name}`);

describe("what the post chain's passes are drawn with", () => {
  it("names nothing of Babylon.js", () => {
    expect(src("postFrame.ts")).not.toMatch(/@babylonjs/);
  });
});

const VIEW: PostView = {
  eye: { x: 1, y: 2, z: 3 }, forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: 1, aspect: 16 / 9,
};

describe("what a game's look changes of the post chain's records", () => {
  it("writes the paint's strength and the far softening's radius it is given, and the engine's own where it is given none", () => {
    expect(composeUniforms(640, 360, undefined, 0.25).strength[0]).toBe(0.25);
    expect(composeUniforms(640, 360, undefined, 0).strength[0]).toBe(0);
    expect(farSoftUniforms(VIEW, 640, 360, undefined, 2).soft[2]).toBe(2);
    expect(farSoftUniforms(VIEW, 640, 360, undefined, 0).soft[2]).toBe(0);
    expect(composeUniforms(640, 360)).toEqual(composeUniforms(640, 360, undefined, PAINT_STRENGTH));
    expect(composeUniforms(640, 360).strength[0]).toBe(PAINT_STRENGTH);
    expect(farSoftUniforms(VIEW, 640, 360)).toEqual(farSoftUniforms(VIEW, 640, 360, undefined, FAR_SOFT_RADIUS));
    expect(farSoftUniforms(VIEW, 640, 360).soft[2]).toBe(FAR_SOFT_RADIUS);
  });

  it("leaves everything else of the far softening's and the compose's records as they were when the radius and the strength change", () => {
    const own = farSoftUniforms(VIEW, 640, 360);
    const other = farSoftUniforms(VIEW, 640, 360, undefined, 0);
    expect({ ...other, soft: [other.soft[0], other.soft[1], FAR_SOFT_RADIUS] }).toEqual(own);
    expect(composeUniforms(640, 360, undefined, 0).halfTexel).toEqual(composeUniforms(640, 360).halfTexel);
  });

  it("starts the palette's fade in the oils, or in the palette it is given, and fades from there", () => {
    expect(createPaletteFade(() => 0).now()).toBe(PAINT_OILS);
    const fade = createPaletteFade(() => 0, PAINT_PALETTES.ash);
    expect(fade.now()).toBe(PAINT_PALETTES.ash);
    fade.set(PAINT_OILS, 0);
    expect(fade.now()).toBe(PAINT_OILS);
  });

  it("multiplies the grade's exposure alone by the gain, and a gain of 1 is the record without one", () => {
    const w = WEATHER_PRESETS.clear;
    const plain = gradeRecordUnder(w, 12, 0, 1);
    expect(gradeRecordUnder(w, 12, 0, 1, 0, undefined, 0, PAINT_OILS, 1)).toEqual(plain);
    const gained = gradeRecordUnder(w, 12, 0, 1, 0, undefined, 0, PAINT_OILS, 1.5);
    expect(gained.exposure).toBe(plain.exposure * 1.5);
    expect({ ...gained, exposure: plain.exposure }).toEqual(plain);
  });
});

describe("the anti-aliasing restarted for a film's frame", () => {
  /** `n` frames through VIEW: each frame's jitter and its share of the history. */
  function run(taa: ReturnType<typeof createTaaFrame>, n: number): { jitter: { x: number; y: number }; share: number; history: number }[] {
    return Array.from({ length: n }, () => {
      const jitter = taa.jitter(1280, 640);
      const u = taa.step(VIEW, 1280, 640);
      return { jitter, share: u.taaParams[0], history: u.taaParams[2] };
    });
  }

  it("draws the same walk and shares after a restart however many frames came before", () => {
    const a = createTaaFrame();
    const b = createTaaFrame();
    run(a, 3);
    run(b, 17);
    a.restart();
    b.restart();
    const after = run(a, TAA_SAMPLES);
    expect(run(b, TAA_SAMPLES)).toEqual(after);
    // The walk from its first step, and a fresh history: the first frame has none.
    expect(after.map((f) => f.jitter)).toEqual(Array.from({ length: TAA_SAMPLES }, (_, i) => taaJitter(i, 1280, 640)));
    expect(after[0]!.history).toBe(0);
  });

  it("averages the frames after a restart evenly: the k-th with history takes 1/(k+1)", () => {
    const taa = createTaaFrame();
    taa.restart();
    const shares = run(taa, TAA_SAMPLES).slice(1).map((f) => f.share);
    expect(shares).toEqual(Array.from({ length: TAA_SAMPLES - 1 }, (_, i) => 1 / (i + 2)));
  });

  it("keeps play's shares where no restart was asked for", () => {
    const played = run(createTaaFrame(), 4);
    const reset = createTaaFrame();
    reset.reset();
    expect(run(reset, 4)).toEqual(played);
    // A still camera with a history blends at the still share, far below an even average's.
    expect(played[3]!.share).toBeLessThan(0.1);
  });
});
