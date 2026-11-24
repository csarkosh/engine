import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import catalog from "../../assets/catalog.json" with { type: "json" };

/**
 * The engine's models carry their textures as KTX2 (`KHR_texture_basisu`): a JPEG, PNG or WebP image
 * decodes in the browser to four bytes a texel on the GPU (5.3 MB for one 1024 x 1024 map with its smaller levels), a KTX2 image is
 * transcoded to the GPU's own block format at one byte a texel. Sixty-seven such maps were 340 MB of a game's GPU memory.
 */

const MODELS = new URL("../../assets/models/", import.meta.url);

type Gltf = { images?: { mimeType?: string; uri?: string }[]; textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]; extensionsUsed?: string[]; extensionsRequired?: string[] };

function jsonOf(file: string): Gltf {
  const bytes = readFileSync(new URL(file, MODELS));
  expect(bytes.toString("latin1", 0, 4), `${file} is a binary glTF (is Git LFS fetched?)`).toBe("glTF");
  return JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12))) as Gltf;
}

describe("the models' textures", () => {
  const files = readdirSync(MODELS).filter((f) => f.endsWith(".glb"));

  it("are KTX2 in every model, read through KHR_texture_basisu", () => {
    expect(files.length).toBeGreaterThan(20);
    let images = 0;
    for (const file of files) {
      const j = jsonOf(file);
      for (const image of j.images ?? []) {
        expect(image.mimeType, `${file}: an image's type`).toBe("image/ktx2");
        expect(image.uri, `${file}: an image is in the file`).toBeUndefined();
        images++;
      }
      for (const texture of j.textures ?? []) {
        expect(texture.source, `${file}: no texture names an image the plain way`).toBeUndefined();
        expect(texture.extensions?.KHR_texture_basisu?.source, `${file}: a texture's KTX2 image`).toBeTypeOf("number");
      }
      if ((j.images ?? []).length > 0) {
        expect(j.extensionsUsed).toContain("KHR_texture_basisu");
        expect(j.extensionsRequired).toContain("KHR_texture_basisu");
      }
    }
    expect(images).toBeGreaterThan(50);
  });

  it("are the sizes the catalog says the files are", () => {
    for (const asset of catalog.assets) {
      if (!asset.output.startsWith("models/")) continue;
      expect(statSync(new URL(`../../assets/${asset.output}`, import.meta.url)).size, asset.id).toBe(asset.bytes);
    }
  });
});
