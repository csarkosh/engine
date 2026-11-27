import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ENGINE_LOOK, SAND_DEFAULT, gameLook, lookHasSand } from "../../src/game/gameLook.js";
import { OLD_WRACK_LINE_M, STORM_LINE_M, WRACK_LINE_M } from "../../src/game/tideLines.js";
import { FRAME_FIELDS } from "../../src/game/lite/frameBlock.js";
import { NO_SAND_BLEND, NO_SAND_WET, sandBlend, sandDefs, sandMainBegin, sandWet } from "../../src/game/lite/sandWgsl.js";
import { TERRAIN_FIELDS, terrainBlend, terrainDefs, terrainMainBegin, terrainWetLights } from "../../src/game/lite/terrainPlugins.js";
import { emptyTerrainUniforms } from "../../src/game/terrainUniforms.js";
import { sourceText } from "../helpers/source.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The terrain's blend and the wet look's terrain lights as they were written before the sand's slots: pinned by digest. */
const BLEND_DIGEST = "16881bef6f5ec50a595853ba3aa50142339d23ac63150d187a79e2eab563867f";
const WET_LIGHTS_DIGEST = "2506f34afca39dbbaf6d797ccfe78c24433184cc25b6fb0bd99ebde15b413bad";

describe("a look with no sand", () => {
  it("has none, and the engine's look gives none", () => {
    expect(ENGINE_LOOK.sand).toBeUndefined();
    expect(gameLook({ exposure: 1.2 }).sand).toBeUndefined();
    expect(lookHasSand(undefined)).toBe(false);
    expect(lookHasSand({ repeat: 0, variation: 0, tide: 0, hollows: 0, ripples: 0, wetEdge: 0 })).toBe(false);
  });

  it("leaves the terrain's shader text exactly as it was, on every tier", () => {
    for (const low of [false, true]) expect(sha(terrainBlend(undefined, low))).toBe(BLEND_DIGEST);
    expect(sha(terrainWetLights())).toBe(WET_LIGHTS_DIGEST);
    expect(sha(terrainBlend({ repeat: 0, variation: 0, tide: 0, hollows: 0, ripples: 0, wetEdge: 0 }))).toBe(BLEND_DIGEST);
    expect(terrainDefs()).toBe(terrainDefs(undefined));
    expect(sandDefs(undefined)).toBe("");
    expect(sandMainBegin(undefined)).toBe("");
    expect(terrainMainBegin()).toBe("var terrainRough=1.0;var terrainF0=1.0;var terrainSpecW=1.0;var terrainFarW=0.0;var terrainPaintW=0.0;var terrainFarN=vec3<f32>(0.0,1.0,0.0);");
    expect(sandBlend(undefined, false)).toEqual(NO_SAND_BLEND);
    expect(sandWet(undefined)).toEqual(NO_SAND_WET);
  });

  it("adds no uniform to the terrain's record or to the frame's block", () => {
    const names = Object.keys(emptyTerrainUniforms());
    expect(TERRAIN_FIELDS.map((field) => field.name).filter((name) => /sand/i.test(name))).toEqual([]);
    expect(names.filter((name) => /sand/i.test(name))).toEqual([]);
    expect(FRAME_FIELDS.map((field) => field.name).filter((name) => /sand/i.test(name))).toEqual([]);
  });
});

describe("a look with sand", () => {
  it("gives every part of it at 1 in the default, six numbers", () => {
    expect(Object.keys(SAND_DEFAULT).sort()).toEqual(["hollows", "repeat", "ripples", "tide", "variation", "wetEdge"]);
    for (const value of Object.values(SAND_DEFAULT)) expect(value).toBe(1);
    expect(gameLook({ sand: SAND_DEFAULT }).sand).toBe(SAND_DEFAULT);
    expect(lookHasSand(SAND_DEFAULT)).toBe(true);
    expect(lookHasSand({ ...SAND_DEFAULT, repeat: 0, variation: 0, tide: 0, hollows: 0, ripples: 0, wetEdge: 0, tide2: 1 } as never)).toBe(false);
  });

  it("splices the sand's functions and every part into the blend, and fills every slot", () => {
    const blend = terrainBlend(SAND_DEFAULT, false);
    expect(blend).not.toContain("${");
    expect(blend).toContain("sdFetch(terrainSand,sdOn,sdhS,0,sdsx,sdsy,uvS)");
    expect(blend).toContain("sdFetch(terrainPebble,sdOn,sdhP,0,sdpx,sdpy,uvP)");
    expect(blend).toContain("sdFetch(terrainNormals,sdOn,sdhS,3,sdsx,sdsy,uvS)");
    expect(blend).toContain("sdFetch(terrainRAH,sdOn,sdhP,4,sdpx,sdpy,uvP)");
    for (const part of ["sdNL", "tWrack", "vTint", "hCav", "rPh", "sdDamp*"]) expect(blend).toContain(part);
    expect(sandDefs(SAND_DEFAULT)).toContain("fn sdNoise(");
    expect(sandDefs(SAND_DEFAULT)).toContain("fn sdFetch(");
    expect(sandMainBegin(SAND_DEFAULT)).toBe("var sdMask=0.0;var sdRag=0.0;");
    const wet = terrainWetLights(SAND_DEFAULT);
    expect(wet).not.toContain("${");
    expect(wet).toContain("sdWet");
    expect(wet).toContain("mix(WET_ROUGHNESS,sdGloss,sdE)");
  });

  it("leaves out the code of a part whose number is 0", () => {
    const only = (own: Partial<typeof SAND_DEFAULT>) => terrainBlend({ repeat: 0, variation: 0, tide: 0, hollows: 0, ripples: 0, wetEdge: 0, ...own }, false);
    expect(only({ tide: 1 })).toContain("tWrack");
    expect(only({ tide: 1 })).not.toContain("vTint");
    expect(only({ tide: 1 })).not.toContain("sdFetch(terrainSand");
    expect(only({ variation: 1 })).toContain("vTint");
    expect(only({ variation: 1 })).not.toContain("tWrack");
    expect(only({ variation: 1 })).not.toContain("sdNL");
    expect(only({ hollows: 1 })).toContain("hCav");
    expect(only({ ripples: 1 })).toContain("rPh");
    expect(only({ repeat: 1 })).toContain("hexSetup(uvS)");
    expect(only({ repeat: 1 })).not.toContain("sdFoot");
    expect(sandWet({ ...SAND_DEFAULT, wetEdge: 0 })).toEqual(NO_SAND_WET);
    expect(only({ wetEdge: 1 })).toContain("sdRag=sdWob");
  });

  it("draws no repeat-breaking and no ripples on the low tier, and the rest", () => {
    const low = terrainBlend(SAND_DEFAULT, true);
    expect(low).not.toContain("sdFetch(");
    expect(low).not.toContain("hexSetup(uvS)");
    expect(low).not.toContain("rPh");
    for (const part of ["tWrack", "vTint", "hCav", "sdRag=sdWob"]) expect(low).toContain(part);
    expect(sandBlend(SAND_DEFAULT, true).rah3Read).toBe(NO_SAND_BLEND.rah3Read);
  });

  it("reads the height above the still sea, so the lines follow it, and only the sea", () => {
    const blend = terrainBlend(SAND_DEFAULT, false);
    expect(blend).toContain("let sdHt=P.y-material.wetLevel;");
    expect(blend).toContain("material.wetRadius>=1000000.0");
    expect(blend).toContain(`abs(sdHt-${WRACK_LINE_M.toFixed(1)}-sdWob)`);
    expect(blend).toContain(`abs(sdHt-${OLD_WRACK_LINE_M}-sdWob)`);
    expect(blend).toContain(`sdHt-${STORM_LINE_M}-sdWob*1.3`);
  });
});

describe("the tide lines' heights", () => {
  it("are 0.9, 0.45 and 1.7 m above the still sea, in order", () => {
    expect([WRACK_LINE_M, OLD_WRACK_LINE_M, STORM_LINE_M]).toEqual([0.9, 0.45, 1.7]);
    expect(OLD_WRACK_LINE_M).toBeLessThan(WRACK_LINE_M);
    expect(WRACK_LINE_M).toBeLessThan(STORM_LINE_M);
  });

  it("say, in their file, that the beach's scattered objects are placed at them", () => {
    expect(sourceText("game/tideLines.ts")).toMatch(/scattered objects[\s\S]*same heights/);
  });
});
