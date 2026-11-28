import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

const src = sourceText("game/lite/postChain.ts");

describe("the post chain's targets on Babylon Lite", () => {
  it("keeps the scene's own two targets while the frame's size stands, and asks before it lets its own go", () => {
    expect(src).toContain('createRenderTarget({ lbl: "post_scene", format: POST_FORMAT, dFormat: POST_DEPTH_FORMAT, samples: MSAA_SAMPLES, size: frameSize, keep: true });');
    expect(src).toContain('createRenderTarget({ lbl: "post_scene_resolved", format: POST_FORMAT, samples: 1, size: frameSize, keep: true });');
    // The question comes first: a recording that is no resize destroys nothing, and the anti-aliasing's history is not started again.
    expect(src).toContain("    if (chainTargetsStand(madeFor, own.depthTexture, scene)) return;\n    release();");
    expect(src.split("taaFrame.reset()").length).toBe(2);
  });

  it("keeps the frame's own target on the tier with no chain too: the hike makes that pass as Lite's own would be, into a target that stands", () => {
    const renderer = sourceText("game/lite/renderer.ts");
    // No pass of Lite's own on any tier: its target is made again at every recording of the frame's passes.
    expect(renderer).toContain("    const scene = createSceneContext(engine, { defaultRenderTask: false });");
    // Lite's own pass, by its own numbers: the canvas's format, a depth and stencil buffer, the engine's samples a
    // pixel, the surface's size, resolved into the canvas.
    expect(renderer).toContain('createRenderTarget({ lbl: "scene-color", format: engine.format, dFormat: "depth24plus-stencil8", samples: FRAME_SAMPLES, size: engine, keep: true });');
    // Resolved into the canvas, unless the look draws a line (`lineOnly.ts`): then into the target the line's pass reads.
    expect(renderer).toContain('const sceneTask = createRenderTask({ name: "scene", rt: samples, rst: line === null ? engine.scRT : line.resolved, clr: true }, engine, scene);');
    expect(renderer).toContain("addTask(scene, sceneTask);");
    expect(renderer).toContain("line = lineOnTier(chained, look.finish) ? createLiteLineOnly(");
    expect(renderer).toContain("createEngine(canvas, { msaaSamples: chained ? 1 : FRAME_SAMPLES,");
  });
});

describe("the post chain's glow", () => {
  it("takes the halation's threshold, gain and reach from the look's glow, and the engine's own where it has none", () => {
    // The extract's text is the engine's own constants with no glow; with one, the look's threshold.
    expect(src).toContain("look.glow === undefined ? HALATION_EXTRACT_WGSL : halationExtractWgsl(glowParams(look.glow, 0).threshold, glowParams(look.glow, 0).cap)");
    // The gain is changed only for a look that has a glow, from the weather's mist of the frame.
    expect(src).toContain("mist = weather.mist;\n      if (look.glow !== undefined) record = {");
    // The reach is the blur's step, not a tap more: the same kernel, a longer delta.
    expect(src).toContain("write(\"halationBlurX\" as SectionName, { delta: [reach / w, 0] });");
    expect(src).toContain("write(\"halationBlurY\" as SectionName, { delta: [0, reach / h] });");
    expect(src).toContain("blurWgsl(HALATION_KERNEL)");
    // The records are the chain's own: no uniform is added for a glow.
    expect(src).toContain("halationBlurX: { delta: [0, 0] },");
  });

  it("is asked for by the renderer from the look, so medium has the three passes when it is set", () => {
    expect(sourceText("game/lite/renderer.ts")).toContain("postFeaturesFor(tier, true, look.glow)");
  });
});
