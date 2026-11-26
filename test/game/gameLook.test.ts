import { describe, expect, it } from "vitest";
import { ENGINE_LOOK, NO_FINISH, finishDrawsInGrade, finishDrawsLine, finishGradeUniform, finishLineUniform, gameLook, lookGradeAt, type LookFinish, type LookGrade } from "../../src/game/gameLook.js";
import { PAINT_OILS, mixPalette } from "../../src/game/gradeParams.js";
import { SWARD_FLOOR, SWARD_MAX } from "../../src/game/groundHexParams.js";
import { sunPositionAt } from "../../src/game/sky.js";
import { FAR_SOFT_RADIUS } from "../../src/game/postFrame.js";
import { PAINT_STRENGTH } from "../../src/game/postParams.js";
import { DEFAULT_HOUR } from "../../src/game/skyWait.js";
import { emptyTerrainUniforms, terrainUniforms } from "../../src/game/terrainUniforms.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS } from "../../src/game/weather.js";
import { farSoftWgsl, gradeWgsl, FAR_SOFT_WGSL } from "../../src/game/lite/postWgsl.js";
import { sourceText } from "../helpers/source.js";

describe("a game's look over the engine's", () => {
  it("is the engine's own look where a game gives none", () => {
    expect(gameLook()).toBe(ENGINE_LOOK);
  });

  it("holds the engine's constants as the engine's own look", () => {
    expect(ENGINE_LOOK.paint).toBe(PAINT_STRENGTH);
    expect(ENGINE_LOOK.farSoft).toBe(FAR_SOFT_RADIUS);
    expect(ENGINE_LOOK.exposure).toBe(1);
    expect(ENGINE_LOOK.palette).toBe(PAINT_OILS);
    expect(ENGINE_LOOK.weather).toBe(WEATHER_PRESETS[DEFAULT_WEATHER]);
    expect(ENGINE_LOOK.weatherName).toBe(DEFAULT_WEATHER);
    expect(ENGINE_LOOK.hour).toBe(DEFAULT_HOUR);
  });

  it("keeps the rest of the engine's look under the part a game gives", () => {
    const look = gameLook({ paint: 0, hour: 18 });
    expect(look.paint).toBe(0);
    expect(look.hour).toBe(18);
    expect({ ...look, paint: ENGINE_LOOK.paint, hour: ENGINE_LOOK.hour }).toEqual(ENGINE_LOOK);
  });

  it("has no finish by default: every strength 0", () => {
    expect(ENGINE_LOOK.finish).toBe(NO_FINISH);
    expect(ENGINE_LOOK.finish.grain).toBe(0);
    expect(ENGINE_LOOK.finish.edge).toBe(0);
    expect(ENGINE_LOOK.finish.line).toBe(0);
    expect(ENGINE_LOOK.finish.bands).toBe(0);
    expect(finishDrawsLine(ENGINE_LOOK.finish)).toBe(false);
    expect(finishDrawsInGrade(ENGINE_LOOK.finish)).toBe(false);
  });

  it("lays a game's whole finish over the engine's none", () => {
    const finish: LookFinish = { grain: 0.028, edge: 0.14, line: 0.6, lineColour: [0.16, 0.17, 0.22], bands: 0.25 };
    const look = gameLook({ finish });
    expect(look.finish).toBe(finish);
    expect(look.paint).toBe(ENGINE_LOOK.paint);
    expect(finishDrawsLine(finish)).toBe(true);
    expect(finishDrawsInGrade(finish)).toBe(true);
    expect(finishLineUniform(finish)).toEqual([0.16, 0.17, 0.22, 0.6]);
    expect(finishGradeUniform(finish)).toEqual([0.028, 0.14, 0.25]);
  });

  it("asks the grade for its part and the far softening for the line separately", () => {
    expect(finishDrawsLine({ ...NO_FINISH, line: 0.5 })).toBe(true);
    expect(finishDrawsInGrade({ ...NO_FINISH, line: 0.5 })).toBe(false);
    expect(finishDrawsLine({ ...NO_FINISH, grain: 0.02 })).toBe(false);
    expect(finishDrawsInGrade({ ...NO_FINISH, grain: 0.02 })).toBe(true);
    expect(finishDrawsInGrade({ ...NO_FINISH, edge: 0.1 })).toBe(true);
    expect(finishDrawsInGrade({ ...NO_FINISH, bands: 0.1 })).toBe(true);
  });

  it("leaves the passes' shader text the engine's own where the finish is off", () => {
    for (const text of [FAR_SOFT_WGSL, farSoftWgsl(false), gradeWgsl(true), gradeWgsl(false), gradeWgsl(true, false), gradeWgsl(false, false)]) {
      expect(text).not.toMatch(/finish/i);
      expect(text).not.toContain("LINE_DEPTH");
      expect(text).not.toContain("${");
    }
  });

  it("puts the finish's code in a shader only where it is asked for", () => {
    const line = farSoftWgsl(true);
    expect(line).toContain("fn finishLine(");
    expect(line).toContain("const LINE_DEPTH_LOW:f32=");
    expect(line).toContain("col=finishLine(vUV,col);");
    for (const halation of [true, false]) {
      const grade = gradeWgsl(halation, true);
      expect(grade).toContain("u.finishGrade.z");
      expect(grade.indexOf("finishShown=finishShown*mix(")).toBeLessThan(grade.indexOf("u.finishGrade.x"));
      expect(grade.indexOf("u.finishGrade.x")).toBeLessThan(grade.indexOf("u.finishGrade.y"));
      expect(grade.indexOf("u.finishGrade.y")).toBeLessThan(grade.indexOf("shown+=(d1+d2-1.0)*DITHER_LSB;"));
      expect(grade.indexOf("let pixel=vUV/u.texelSize;")).toBeLessThan(grade.indexOf("var finishShown"));
    }
  });

  it("has no grades by default, and then reads none: the caller keeps the one palette and gain", () => {
    expect(ENGINE_LOOK.grades).toEqual([]);
    expect(lookGradeAt(ENGINE_LOOK, 12, 0.5)).toBeNull();
    expect(lookGradeAt(gameLook({ exposure: 1.5 }), 3, 1)).toBeNull();
  });

  it("wears the grade the sun's height asks for: the first and the last past either end, the two between mixed", () => {
    const dark = { ...PAINT_OILS, contrast: 1.5 };
    const night: LookGrade = { sun: -0.5, palette: dark, exposure: 2, overcast: 4 };
    const day: LookGrade = { sun: 0.5, palette: PAINT_OILS, exposure: 1, overcast: 3 };
    const look = gameLook({ grades: [night, day] });
    // Midnight is under the first, noon over the last.
    expect(lookGradeAt(look, 0, 0)).toEqual({ palette: dark, exposure: 2 });
    expect(lookGradeAt(look, 12, 0)).toEqual({ palette: PAINT_OILS, exposure: 1 });
    // Sunset, the sun on the horizon, is half way between the two.
    const sunset = lookGradeAt(look, 18, 0);
    const half = (sunPositionAt(18).y + 0.5) / 1;
    expect(half).toBeCloseTo(0.5, 6);
    expect(sunset?.exposure).toBeCloseTo(1.5, 6);
    expect(sunset?.palette).toEqual(mixPalette(dark, PAINT_OILS, half));
  });

  it("takes the gain from clear to overcast by the cloud's cover, held to 0 and 1", () => {
    const look = gameLook({ grades: [{ sun: 0, palette: PAINT_OILS, exposure: 1, overcast: 3 }] });
    expect(lookGradeAt(look, 12, 0)?.exposure).toBe(1);
    expect(lookGradeAt(look, 12, 0.25)?.exposure).toBeCloseTo(1.5, 6);
    expect(lookGradeAt(look, 12, 1)?.exposure).toBe(3);
    expect(lookGradeAt(look, 12, 7)?.exposure).toBe(3);
    expect(lookGradeAt(look, 12, -2)?.exposure).toBe(1);
  });

  it("pulls the ground under the grass to the engine's own floor by default, and to a game's where it gives one", () => {
    expect(ENGINE_LOOK.sward).toEqual({ floor: [SWARD_FLOOR.r, SWARD_FLOOR.g, SWARD_FLOOR.b], pull: SWARD_MAX });
    const none = emptyTerrainUniforms();
    const own = emptyTerrainUniforms();
    const base = { eye: null, wetness: 0, rain: 0, seconds: 0, sward: true, relief: true, road: null, trail: null, features: null };
    terrainUniforms(base, none);
    // The engine's look hands the terrain what it reads with no look at all.
    const engine = emptyTerrainUniforms();
    terrainUniforms({ ...base, swardLook: ENGINE_LOOK.sward }, engine);
    expect(Array.from(engine.terrainSward)).toEqual(Array.from(none.terrainSward));
    terrainUniforms({ ...base, swardLook: { floor: [0.031, 0.041, 0.013], pull: 1 } }, own);
    expect(Array.from(own.terrainSward)).toEqual([0.031, 0.041, 0.013, 1]);
    // Where the blades are not drawn there is no pull, whatever the look.
    terrainUniforms({ ...base, sward: false, swardLook: { floor: [0.031, 0.041, 0.013], pull: 1 } }, own);
    expect(own.terrainSward[3]).toBe(0);
  });

  it("names nothing of Babylon.js", () => {
    expect(sourceText("game/gameLook.ts")).not.toMatch(/@babylonjs/);
  });
});
