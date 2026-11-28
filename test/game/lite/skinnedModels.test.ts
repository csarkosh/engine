import { describe, expect, it } from "vitest";
import { tableOptions } from "../../../src/game/lite/skinnedModels.js";
import { sourceText } from "../../helpers/source.js";

const src = sourceText("game/lite/skinnedModels.ts");

describe("a skinned model's clip table", () => {
  it("is told nothing of its layout where the game sets none, so the bake is the one it has always been", () => {
    expect(tableOptions(undefined)).toBeUndefined();
  });

  it("is told the layout the game sets, whole", () => {
    expect(tableOptions("rigid")).toEqual({ layout: "rigid" });
    expect(tableOptions("rows")).toEqual({ layout: "rows" });
    expect(tableOptions("matrix")).toEqual({ layout: "matrix" });
  });

  it("reaches the bake from the loader's options and nowhere else", () => {
    expect(src).toContain("bakeVatMany(engine, meshes.map((mesh) => ({ mesh })), groups, tableOptions(options.clipLayout));");
    expect(src.split("bakeVatMany(").length).toBe(2);
    expect(src).toContain("clipLayout?: VatLayout;");
  });
});

describe("a skinned model's textures", () => {
  it("are loaded with the options the game gives and no others, and each held is held and let go once", () => {
    expect(src).toContain("textures?: LoadGltfOptions;");
    expect(src).toContain("await loadGltf(engine, file, options.textures);");
    expect(src).toContain("if (held.has(texture)) continue;");
    expect(src).toContain("for (const texture of held) releaseTexture(texture);");
    expect(src.split("acquireTexture(").length).toBe(2);
    expect(src.split("releaseTexture(").length).toBe(2);
  });
});
