import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the seed and the terrain a hike's world is made from", () => {
  it("is the rule the build itself reads its seed and terrain by", () => {
    const code = (file: string): string => sourceText(`${file}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const app = code("app.ts");
    expect(app).toContain("const { seed, variant } = worldInputs(token, location.search);");
    expect(app).toContain("setActiveTerrainVariant(variant);");
    // One place reads a seed from the token.
    expect(app).not.toContain("seedFromToken(");
  });

  it("is what the page starts the world's worker with, which the start waits for and a start left ends", () => {
    const main = sourceText("shell.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(main.match(/\bstartWorldPrep\(/g)).toEqual(["startWorldPrep("]);
    expect(main).toContain("const startPrep = (from: WorldMadeFrom): WorldPrep => startWorldPrep(from, page.worldWorker);");
    // The session takes the world made for it ahead of Play, where one was, and else starts the worker itself:
    // either way from the one rule's reading of its address.
    expect(main).toContain("const madeFrom = worldInputs(route.token, location.search);\n    const early = ahead.take(route.token, madeFrom);\n    const prep = early?.prep ?? startPrep(madeFrom);");
    expect(main).toContain("prepOutcome = await prep.ready;");
    // A render that moves on, and a start that fails, end the worker; a start that built lets go of it and its scene.
    // With it goes the second worker, where a scene of another tier than the one made ahead was asked for.
    expect(main).toContain("const endPrep = (): void => {\n      prepEnded = true;\n      prep.dispose();\n      again?.dispose();\n    };");
    expect(main.match(/prep\.dispose\(\);/g)).toHaveLength(1);
    expect(main.match(/\bendPrep\(\);/g)).toHaveLength(3);
  });

  it("asks the worker for the hike's first scene once, at the tier decided, waits for it before the build and hands it to the build once", () => {
    const main = sourceText("shell.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(main.match(/prep\.scene\(/g)).toEqual(["prep.scene("]);
    expect(main).toContain("sampling = prep.scene(decided.tier);");
    // Where the world was made ahead with its scene: that scene at the tier decided, and at another tier a
    // worker of its own for this one, once the world stands.
    expect(main).toContain("if (early === null || early.first === null) sampling = prep.scene(decided.tier);\n          else if (early.first.tier === decided.tier) sampling = early.first.made;");
    expect(main.match(/again\.scene\(/g)).toEqual(["again.scene("]);
    expect(main).toContain("again = startPrep(madeFrom);\n              return again.scene(decided.tier);");
    // Only once the world stands, and never after the start has let its workers go: a world that did not come
    // is not made a second time for a scene's sake, and no worker is started that nothing would end.
    expect(main).toContain('if (prepEnded || cancelled() || (outcome.why !== "done" && outcome.why !== "cached")) return null;\n              again = startPrep(madeFrom);');
    // After the world is ready, so the wait for it is its own lap.
    const wait = main.slice(main.indexOf("prepOutcome = await prep.ready;"), main.indexOf("paint: () =>"));
    expect(wait).toContain("sampled = await sampling;");
    expect(wait).toContain('lap("scene");');
    // Nothing here holds the scene past the wait: the promise that carried it is let go of at once.
    expect(wait).toContain("sampled = await sampling;\n        sampling = Promise.resolve(null);");
    // The game is handed the way to take it, never the scene: the first renderer made takes it, and a start
    // made again finds none left.
    expect(main).toContain("takePrepared: takeSampled,");
    expect(main).not.toContain("takeSampled()");
    expect(main).toContain('scene: sampledFor === null ? "none" : "made",');
  });

  it("hands the scene to the hike's first renderer at the tier asked for, and to no other", () => {
    const app = sourceText("app.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // The one renderer made with it: the ladder's first attempt, which takes it as it is built.
    expect(app.match(/prepared: /g)).toEqual(["prepared: "]);
    const first = app.slice(app.indexOf("const first = buildFirstRenderer("), app.indexOf("let renderer: R = first.renderer;"));
    expect(first).toContain("prepared: options.takePrepared?.() ?? null,");
    // The game's options, which it keeps for the hike, never hold the scene itself: a renderer made later
    // would otherwise stand beside the first one's dead arrays.
    expect(app).not.toMatch(/\bprepared\?: PreparedScene/);
    expect(app).not.toContain("options.prepared");
  });

  it("does not register the game's terrain itself: the page's entry does: the engine's half", () => {
    expect(sourceText("game/worldInputs.ts")).not.toContain("passes/index");
  });

  it("is handed the way to start the world's worker by the page: the engine's half", () => {
    expect(sourceText("shell.ts")).toContain("const startPrep = (from: WorldMadeFrom): WorldPrep => startWorldPrep(from, page.worldWorker);");
  });
});
