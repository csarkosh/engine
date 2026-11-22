import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { creditsModel } from "../../src/game/credits.js";
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
});
