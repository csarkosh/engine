import { describe, expect, it } from "vitest";
import { QUALITY, type QualityTier } from "../../../src/game/quality.js";
import { modelTextureOptions } from "../../../src/game/lite/modelLoadOptions.js";
import { sourceText } from "../../helpers/source.js";

const TIERS: readonly QualityTier[] = ["low", "medium", "high"];

describe("what a model's textures are loaded with", () => {
  it("is the tier's cap, and sharing, on every tier", () => {
    expect(modelTextureOptions("low")).toEqual({ maxTextureSize: 512, shareTextures: true });
    expect(modelTextureOptions("medium")).toEqual({ maxTextureSize: 1024, shareTextures: true });
  });

  it("asks high for no cap (zero), and still for sharing", () => {
    expect(modelTextureOptions("high")).toEqual({ maxTextureSize: 0, shareTextures: true });
  });

  it("reads the quality table's cap, whole, for each tier", () => {
    for (const tier of TIERS) expect(modelTextureOptions(tier).maxTextureSize).toBe(QUALITY[tier].textureMipCap);
  });

  it("says in the quality table what reads the cap", () => {
    const quality = sourceText("game/quality.ts");
    expect(quality).not.toContain("Read by nothing\n   * (2026-10-15): the bark sets");
    expect(quality).toContain("Read by `modelTextureOptions`");
  });
});

describe("every place the engine loads a model", () => {
  const read = (file: string): string => sourceText(`game/lite/${file}`);

  it("hands the loader's own `loadGltf` the options it was given, and no model is loaded another way", () => {
    expect(read("forestModels.ts")).toContain("await loadGltf(engine, file, textures);");
    expect(read("skinnedModels.ts")).toContain("await loadGltf(engine, file, options.textures);");
    for (const file of ["forestModels.ts", "skinnedModels.ts"]) expect(read(file).split("loadGltf(").length, file).toBe(2);
  });

  it("passes the tier's options from each module that loads a file, from the tier it was made for", () => {
    expect(read("forestMeshes.ts")).toContain("loadModel(engine, modelUrl(output), lods, loads.signal, modelTextureOptions(options.tier))");
    expect(read("cliffMeshes.ts")).toContain("loadModel(engine, modelUrl(output), CLIFF_LOD_NODES, loads.signal, modelTextureOptions(options.quality))");
    expect(read("clutterMeshes.ts")).toContain("lods, loads.signal, modelTextureOptions(options.tier))");
    const wildlife = read("wildlifeMeshes.ts");
    expect(wildlife).toContain("loadModel(engine, modelUrl(output), [BIRD_LOD], loads.signal, modelTextureOptions(options.tier))");
    expect(wildlife).toContain("textures: modelTextureOptions(options.tier),");
  });

  it("is given the renderer's tier by the renderer, for the two modules that had none", () => {
    const renderer = read("renderer.ts");
    expect(renderer).toMatch(/createClutterMeshes\(engine, scene, forest\.seed, \{\n\s+tier,/);
    expect(renderer).toMatch(/createLiteWildlifeMeshes\(engine, scene, forest\.seed, \{\n\s+tier,/);
  });

  it("loads every model the engine's modules name through one of those, none through Lite's loader alone", () => {
    const loaders = new Set(["forestModels.ts", "skinnedModels.ts"]);
    for (const file of ["forestMeshes.ts", "cliffMeshes.ts", "clutterMeshes.ts", "wildlifeMeshes.ts", "renderer.ts", "propMeshes.ts"]) {
      if (loaders.has(file)) continue;
      expect(read(file), file).not.toMatch(/\bloadGltf\(/);
    }
  });
});
