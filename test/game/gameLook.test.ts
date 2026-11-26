import { describe, expect, it } from "vitest";
import { ENGINE_LOOK, gameLook } from "../../src/game/gameLook.js";
import { PAINT_OILS } from "../../src/game/gradeParams.js";
import { FAR_SOFT_RADIUS } from "../../src/game/postFrame.js";
import { PAINT_STRENGTH } from "../../src/game/postParams.js";
import { DEFAULT_HOUR } from "../../src/game/skyWait.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS } from "../../src/game/weather.js";
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

  it("names nothing of Babylon.js", () => {
    expect(sourceText("game/gameLook.ts")).not.toMatch(/@babylonjs/);
  });
});
