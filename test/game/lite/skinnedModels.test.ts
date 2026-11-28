import { describe, expect, it } from "vitest";
import { sharedFirst, tableOptions } from "../../../src/game/lite/skinnedModels.js";
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

describe("a primitive with bodies of its own", () => {
  it("is asked for by the game for each primitive, after the primitive is dressed, and is unset for a game that asks nothing", () => {
    expect(src).toContain("own?(part: SkinnedPart, index: number): boolean;");
    expect(src).toContain("if (options.own?.(part, index) === true) {");
    expect(src.indexOf("part.drawn = options.dress(part, index);")).toBeLessThan(src.indexOf("if (options.own?.(part, index) === true) {"));
    // A part is made with none, and only the loader gives it any.
    expect(src).toContain("drawn: true, elsewhere: false, own: null };");
    expect(src).toContain("parts: made,");
    expect(src.split("part.own = ").length).toBe(2);
  });

  it("has matrices, clips and a count that are its alone: none of the model's matrices, and a clip texture nothing shares", () => {
    const own = src.slice(src.indexOf("const ownBodies = "), src.indexOf("meshes.forEach((mesh, index) => {"));
    expect(own).toContain("const own = new Float32Array(capacity * 16);");
    expect(own).toContain("const clipsOwn = new Float32Array(capacity * CLIP_FLOATS);");
    expect(own).toContain("setThinInstances(mesh, own, capacity);");
    expect(own).toContain("handle.setInstancesBlend(clipsOwn);");
    // It is not handed the model's arrays, and its texture is not swapped for another's.
    expect(own).not.toContain("setThinInstances(mesh, matrices, capacity)");
    expect(own).not.toContain("instanceTexture");
    // The branch that makes it is not the one that does the sharing.
    const branch = src.slice(src.indexOf("if (options.own?.(part, index) === true) {"), src.indexOf("// Every other primitive draws the same bodies"));
    expect(branch).toContain("part.own = ownBodies(mesh, handle, part);");
    expect(branch).toContain("} else {");
    expect(branch).not.toContain("setThinInstances(");
  });

  it("is not the model's to draw: the model's show passes it by, for the count and for being seen, and its own show draws it", () => {
    // The model's show counts and shows only the primitives that draw its bodies.
    expect(src).toContain("const common = made.filter((part) => part.own === null);");
    expect(src).toContain("for (const part of common) {");
    expect(src).toContain("if ((next > 0) !== (count > 0)) seen(common, next);");
    const own = src.slice(src.indexOf("const ownBodies = "), src.indexOf("meshes.forEach((mesh, index) => {"));
    expect(own).toContain("if ((moved || next !== shown) && part.drawn) {");
    expect(own).toContain("if ((next > 0) !== (shown > 0)) seen([part], next);");
    expect(own).toContain("if (disposed) return;");
    // Whoever's bodies a primitive has, it is shown by the one rule: never one that only a pass of its owner's draws.
    expect(src).toContain("for (const part of parts) if (part.drawn && !part.elsewhere) setMeshVisible(part.mesh, next > 0);");
    expect(src.split("setMeshVisible(").length).toBe(3);
  });

  it("leaves the clips the others read with the first primitive that draws the model's bodies, whichever that is", () => {
    expect(sharedFirst([false, false, false])).toBe(0);
    expect(sharedFirst([true, false, true, false])).toBe(1);
    expect(sharedFirst([true, true])).toBe(-1);
    expect(sharedFirst([])).toBe(-1);
    expect(src).toContain("if (shared.mesh === null) {");
    expect(src).toContain("if (reclipped && next > 0 && shared.handle !== null) {");
    // No primitive is taken to be the first by its place in the file.
    expect(src).not.toContain("handles[0]");
    expect(src).not.toContain("meshes[0] as Mesh");
  });
});
