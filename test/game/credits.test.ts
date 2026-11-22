import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { creditsModel, creditsRows, requiresAttribution } from "../../src/game/credits.js";
import { sourceText } from "../helpers/source.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import { ENGINE_CREDITS } from "../../src/game/engineCredits.js";

describe("creditsModel", () => {
  it("credits the library the game is drawn with, its environment BRDF table and its tone map, each under its licence and each for something the tree holds: the engine's half", () => {
    // What each names: the dependency pinned to that source, the table as a file of the game's, and the tone map's notice beside its numbers.
    expect(existsSync(new URL("../../src/game/lite/environmentBrdf.png", import.meta.url))).toBe(true);
    expect(sourceText("game/gradeParams.ts")).toContain("ported from three.js, MIT License, Copyright 2010-2024 three.js authors");
  });
});

const ASSETS = new URL("../../assets/", import.meta.url);
const CREDITS_FILE = new URL("../../CREDITS.md", import.meta.url);

/** Every id the engine ships a file under: the catalog's models, and each texture and sound by its file's name. */
function shippedIds(): string[] {
  const files = [...readdirSync(new URL("textures/", ASSETS)), ...readdirSync(new URL("audio/", ASSETS))];
  return [...catalog.assets.map((a) => a.id), ...files.map((f) => f.replace(/\.(ktx2|webp|mp3)$/, ""))];
}

/** The ids of the file's sections, in the file's order. */
function sectionIds(): string[] {
  return [...readFileSync(CREDITS_FILE, "utf8").matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
}

/** What the engine ships that is its own work, and so has no section. */
const ORIGINAL = ["clutter.fungus_a", "clutter.fungus_b", "wildlife.gull", "wildlife.raven", "wildlife.squirrel", "wildlife.elk", "wildlife.deer"];

/** The code of others the engine carries: a section each, though no file stands under its id. */
const CODE = [
  "render.agx_tone_map",
  "render.babylon_lite",
  "render.environment_brdf",
  "render.ktx2_basis_transcoder",
  "render.ktx2_decoder",
  "render.ktx2_uastc_transcoders",
  "render.ktx2_zstd",
];

describe("the engine's credits file", () => {
  it("has a section for every shipped file but the engine's own work, and for nothing that is not shipped", () => {
    const ids = new Set(shippedIds());
    const sections = new Set(sectionIds());
    expect(ids.size).toBe(shippedIds().length);
    expect(sections.size).toBe(sectionIds().length);
    expect([...ids].filter((id) => !sections.has(id)).sort()).toEqual([...ORIGINAL].sort());
    const code = [...sections].filter((id) => !ids.has(id));
    expect(code.sort()).toEqual([...CODE].sort());
  });

  it("lists its sections in the order of their ids", () => {
    const ids = sectionIds();
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("is handed to a game as the file's own text, which the credits model reads in full", () => {
    expect(ENGINE_CREDITS).toBe(readFileSync(CREDITS_FILE, "utf8"));
    expect(creditsModel(ENGINE_CREDITS).map((e) => e.id)).toEqual(sectionIds());
  });

  it("credits the KTX2 decoder the game ships and each work its notice names, each for files the game serves", () => {
    const code = creditsModel(ENGINE_CREDITS).filter((e) => e.id.startsWith("render.ktx2_"));
    expect(code.map((e) => [e.id, e.source, e.author, e.license, e.url])).toEqual([
      ["render.ktx2_basis_transcoder", "Khronos KTX: Basis Universal transcoder", "The Khronos Group", "Apache-2.0", "https://www.khronos.org/ktx/"],
      ["render.ktx2_decoder", "Babylon.js 9.18.0: KTX2 decoder", "The Babylon.js team", "Apache-2.0", "https://github.com/BabylonJS/Babylon.js"],
      ["render.ktx2_uastc_transcoders", "Basis Universal Transcoders: UASTC to ASTC, BC7 and uncompressed", "The Khronos Group", "Apache-2.0", "https://github.com/KhronosGroup/Basis-Universal-Transcoders"],
      ["render.ktx2_zstd", "zstddec (Don McCurdy): Zstandard decompression library", "Yann Collet, Facebook, Inc.", "BSD-3-Clause", "https://github.com/donmccurdy/zstddec"],
    ]);
    // Each is a row of its own on the screen, among the rows a licence asks for.
    const rows = creditsRows(creditsModel(ENGINE_CREDITS));
    const firstOptional = rows.findIndex((r) => !requiresAttribution(r.license));
    for (const e of code) expect(rows.findIndex((r) => r.id === e.id), e.id).toBeGreaterThanOrEqual(0);
    for (const e of code) expect(rows.findIndex((r) => r.id === e.id), e.id).toBeLessThan(firstOptional);
    // What each names: the files under the page's `libs/ktx2/`, every one of them credited by one of the four.
    const served = readdirSync(new URL("../../public/libs/ktx2/", import.meta.url)).sort();
    const named: Record<string, string[]> = {
      "render.ktx2_basis_transcoder": ["msc_basis_transcoder.js", "msc_basis_transcoder.wasm"],
      "render.ktx2_decoder": ["babylon.ktx2Decoder.js"],
      "render.ktx2_uastc_transcoders": ["uastc_astc.wasm", "uastc_bc7.wasm", "uastc_r8_unorm.wasm", "uastc_rg8_unorm.wasm", "uastc_rgba8_srgb_v2.wasm", "uastc_rgba8_unorm_v2.wasm"],
      "render.ktx2_zstd": ["zstddec.wasm"],
    };
    expect(Object.keys(named)).toEqual(code.map((e) => e.id));
    expect(Object.values(named).flat().sort()).toEqual(served);
    // A row that says its work is unchanged names files that are the package's own, byte for byte; the
    // decoder is bundled from the package's modules (`tools/vendor-ktx2.mjs`), so its row says nothing of the kind.
    const shipped = join(dirname(createRequire(import.meta.url).resolve("@babylonjs/ktx2decoder/package.json")), "wasm");
    for (const e of code) {
      expect(e.modified, e.id).toBe(e.id === "render.ktx2_decoder");
      if (e.modified) continue;
      for (const file of named[e.id]!) {
        const ours = readFileSync(new URL(`../../public/libs/ktx2/${file}`, import.meta.url));
        expect(ours.equals(readFileSync(join(shipped, file))), file).toBe(true);
      }
    }
    // The package the files are vendored from says who made them, in its own notice.
    const notice = readFileSync(join(dirname(createRequire(import.meta.url).resolve("@babylonjs/ktx2decoder/package.json")), "NOTICE.md"), "utf8");
    for (const words of ["Copyright 2024 The Babylon.js team", "Copyright 2024 The Khronos Group", "github.com/KhronosGroup/Basis-Universal-Transcoders", "https://github.com/donmccurdy/zstddec by Don McCurdy", "Yann Collet, Facebook, Inc.", "BSD 3-Clause"]) {
      expect(notice, words).toContain(words);
    }
  });
});
